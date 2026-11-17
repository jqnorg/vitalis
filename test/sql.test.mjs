// Prueba el esquema de Vitalis en un Postgres local (PGlite) imitando lo que hace Supabase:
// auth.users, auth.uid() desde el JWT y el rol "authenticated" con RLS.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';

const db = new PGlite({ extensions: { pgcrypto } });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails++; };

await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated nologin; create role anon nologin;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  create publication supabase_realtime;
`);
const sql = fs.readFileSync(new URL('../supabase/vitalis.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(sql); // se puede correr dos veces
const code = (await db.query('select invite_code from public.teams')).rows[0].invite_code;
console.log('código:', code);
ok((await db.query('select count(*)::int c from public.teams')).rows[0].c === 1, 'una sola mesa aunque se corra dos veces');
ok((await db.query("select count(*)::int c from pg_publication_tables where pubname='supabase_realtime'")).rows[0].c === 6, 'tablas en tiempo real');

async function signup(email, name, invite) {
  try {
    const r = await db.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, JSON.stringify({ name, invite })]);
    return r.rows[0].id;
  } catch (e) { return 'ERR:' + e.message; }
}
async function as(uid, q, params = []) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || '']);
  await db.exec(uid ? 'set role authenticated' : 'set role anon');
  try { return await db.query(q, params); } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); }
}

const A = await signup('yo@x.com', 'Yo', code.toLowerCase());
const B = await signup('b@x.com', 'Agente B', ' ' + code + ' ');
const C = await signup('c@x.com', 'Agente C', code);
const bad = await signup('z@x.com', 'Intruso', 'NOPE');
ok(String(bad).includes('INVITE_INVALID'), 'código inválido no deja registrarse');
ok((await db.query('select count(*)::int c from auth.users')).rows[0].c === 3, 'el intruso no quedó en auth.users');
const roles = Object.fromEntries((await db.query('select name, role from public.profiles')).rows.map((r) => [r.name, r.role]));
ok(roles['Yo'] === 'admin' && roles['Agente B'] === 'agent', 'el primero es admin, el resto agentes');

// ventas compartidas
let r = await as(A, "insert into public.sales (date, client_id, name, amount, tx, brand) values ('2026-11-17','68336','Maria',100,'51271','Novara Markets') returning id, team_id, user_id");
ok(!r.error && r.rows[0].user_id === A, 'A carga una venta (mesa y vendedor automáticos)');
const saleA = r.rows[0].id;
r = await as(B, 'select client_id, user_id from public.sales');
ok(r.rows.length === 1 && r.rows[0].user_id === A, 'B ve la venta de A');
r = await as(B, "update public.sales set amount = 1 where id = $1 returning id", [saleA]);
ok(!r.error && r.rows.length === 0, 'B no puede editar la venta de A');
r = await as(B, 'delete from public.sales where id = $1 returning id', [saleA]);
ok(!r.error && r.rows.length === 0, 'B no puede borrar la venta de A');
r = await as(B, "insert into public.sales (user_id, date, client_id, amount) values ($1,'2026-11-17','1',1)", [A]);
ok(!!r.error, 'B no puede cargar una venta a nombre de A');
r = await as(B, "insert into public.sales (date, client_id, name, amount, tx, brand) values ('2026-11-17','68336','Maria',100,'51271','novara markets')");
ok(!!r.error && /duplicate|unique/i.test(r.error), 'misma transacción y marca en la mesa: rechazada');
r = await as(B, "insert into public.sales (date, client_id, amount, tx, brand) values ('2026-11-17','70001',250,'51271','Trade24Seven') returning id");
ok(!r.error, 'misma transacción en otra marca: permitida');
const saleB = r.rows[0].id;

// privados
await as(A, "insert into public.agenda (client_id, kw, due) values ('4521','docs','2026-11-18T09:00')");
await as(A, `insert into public.settings (cfg) values ('{"base":33500}')`);
await as(A, "insert into public.shifts (date, data) values ('2026-11-17','{}')");
await as(A, "insert into public.adjustments (ym, n) values ('2026-11', 3)");
for (const t of ['agenda', 'settings', 'shifts', 'adjustments']) {
  r = await as(B, `select * from public.${t}`);
  ok(r.rows.length === 0, `B no ve ${t} de A`);
}
r = await as(A, 'select * from public.settings');
ok(r.rows.length === 1, 'A ve sus settings');
r = await as(B, "insert into public.agenda (user_id, client_id, due) values ($1, 'x', '2026-11-18T09:00')", [A]);
ok(!!r.error, 'B no puede escribir en la agenda de A');

// roles
r = await as(B, "update public.profiles set role = 'admin' where id = $1", [B]);
ok(!!r.error, 'B no puede hacerse admin');
r = await as(B, "update public.profiles set name = 'Bea' where id = $1 returning name", [B]);
ok(!r.error && r.rows[0].name === 'Bea', 'B cambia su nombre');
r = await as(A, "update public.profiles set role = 'leader' where id = $1 returning role", [C]);
ok(!r.error && r.rows[0].role === 'leader', 'A pone a C de team leader');
r = await as(C, 'update public.sales set amount = 260 where id = $1 returning amount', [saleB]);
ok(!r.error && r.rows.length === 1, 'el team leader corrige una venta de B');
r = await as(A, "update public.profiles set role = 'agent' where id = $1", [A]);
ok(!!r.error, 'el único admin no puede sacarse el rol');
r = await as(B, "update public.teams set invite_code = 'X' returning id");
ok(!r.error && r.rows.length === 0, 'B no cambia el código de invitación');
r = await as(A, "update public.teams set invite_code = 'MATIAS-NUEVO' returning invite_code");
ok(!r.error && r.rows.length === 1, 'A cambia el código de invitación');

// baja
r = await as(A, 'update public.profiles set active = false where id = $1 returning active', [B]);
ok(!r.error && r.rows[0].active === false, 'A da de baja a B');
r = await as(B, 'select * from public.sales');
ok(r.rows.length === 0, 'B dado de baja no ve más las ventas de la mesa');
r = await as(null, 'select * from public.sales');
ok(!!r.error || r.rows.length === 0, 'sin sesión no se ve nada');

console.log(fails ? `\n${fails} FALLAS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
