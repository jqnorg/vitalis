// Prueba el esquema de Vitalis en un Postgres local (PGlite) imitando lo que hace Supabase:
// auth.users, auth.uid() desde el JWT y los roles "anon" / "authenticated" con RLS.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';

const db = new PGlite({ extensions: { pgcrypto } });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails++; };

await db.exec(fs.readFileSync(new URL('./auth-stub.sql', import.meta.url), 'utf8'));
const sql = fs.readFileSync(new URL('../supabase/vitalis.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(sql); // se puede correr dos veces
ok((await db.query('select count(*)::int c from public.teams')).rows[0].c === 1, 'una sola mesa aunque se corra dos veces');
ok((await db.query("select count(*)::int c from pg_publication_tables where pubname='supabase_realtime'")).rows[0].c === 9, 'tablas en tiempo real');

async function as(uid, q, params = []) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || '']);
  await db.exec(uid ? 'set role authenticated' : 'set role anon');
  try { return await db.query(q, params); } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); }
}
const J = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const rpc = async (uid, q, params) => { const r = await as(uid, q, params); return r.error ? { error: r.error } : J(r.rows[0].j); };

// ---------- la lista de la mesa ----------
ok((await db.query('select count(*)::int c from public.profiles')).rows[0].c === 13, 'la mesa arranca con 13 personas (aunque se corra dos veces)');
let R = await rpc(null, 'select public.roster() j');
ok(R && R.team === 'Team Matías' && R.people.length === 13, 'se ve la lista de nombres sin código (una sola mesa)');
const P = Object.fromEntries(R.people.map((p) => [p.name, p]));
ok(P['Matias Me'].role === 'leader' && P['Joaquín Or'].role === 'agent' && !R.people.some((p) => p.role === 'admin'), 'Matias es team leader; todavía no hay admin');
ok(R.people.every((p) => !p.pin_set), 'nadie creó su PIN todavía');
ok(!Object.keys(R.people[0]).some((k) => /pin_hash|secret|login/.test(k)), 'la lista no trae datos de la cuenta');
const tok = (await db.query("select count(*)::int c from auth.users where confirmation_token is null or recovery_token is null or email_change is null or email_change_token_new is null")).rows[0].c;
ok(tok === 0, 'las cuentas tienen los campos que espera Supabase (sin NULL)');
ok((await db.query('select count(*)::int c from auth.identities')).rows[0].c === 13, 'cada cuenta tiene su identidad de email');

let r = await as(null, 'select * from public.pins');
ok(!!r.error || r.rows.length === 0, 'anon no puede leer los PIN');
r = await as(null, "select public._new_seat((select id from public.teams), 'Intruso', 'admin')");
ok(!!r.error, 'anon no puede crear cuentas');
let e2 = null; try { await db.query("insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('z@x.com', $1, '{\"provider\":\"email\"}')", [JSON.stringify({ vitalis_seat: true })]); } catch (e) { e2 = e.message; }
ok(e2 && e2.includes('SIGNUP_DISABLED'), 'registrarse con email está cerrado (aunque se mande vitalis_seat en los datos)');

// ---------- ingreso con PIN ----------
const login = (name, pin) => rpc(null, 'select public.pin_login($1, $2) j', [P[name].id, pin]);
R = await login('Alfonso Ro', '1234');
ok(R.ok === false && R.error === 'wrong' && R.left === 4, 'PIN equivocado: quedan 4 intentos');
R = await rpc(null, 'select public.pin_login($1, $2) j', ['00000000-0000-0000-0000-000000000000', '0000']);
ok(R.ok === false && R.error === 'nouser', 'alguien que no está en la lista no entra');
for (let i = 0; i < 3; i++) await login('Alfonso Ro', '9999');
R = await login('Alfonso Ro', '1111');
ok(R.ok === false && R.error === 'locked' && R.minutes === 15, 'al quinto error: bloqueado 15 minutos');
R = await login('Alfonso Ro', '0000');
ok(R.ok === false && R.error === 'locked', 'bloqueado: ni con el PIN correcto');
await db.query("update public.pins set locked_until = now() - interval '1 minute' where user_id = $1", [P['Alfonso Ro'].id]);
for (let i = 0; i < 5; i++) R = await login('Alfonso Ro', '9999');
ok(R.error === 'locked' && R.minutes === 30, 'el segundo bloqueo seguido dura el doble (30 min)');
await db.query("update public.pins set locked_until = now() - interval '1 minute' where user_id = $1", [P['Alfonso Ro'].id]);
R = await login('Alfonso Ro', '0000');
ok(R.ok === true && (await db.query('select locks from public.pins where user_id = $1', [P['Alfonso Ro'].id])).rows[0].locks === 0, 'entrar bien resetea los bloqueos');
R = await login('Joaquín Or', '0000');
ok(R.ok === true && R.email && R.password && R.pin_set === false, 'la primera vez entra con 0000');
const pw1 = R.password;
ok((await db.query('select (encrypted_password = crypt($2, encrypted_password)) m from auth.users where id = $1', [P['Joaquín Or'].id, pw1])).rows[0].m, 'la contraseña interna abre la cuenta de Supabase');
R = await login('Joaquín Or', '0000');
ok(R.password !== pw1 && !(await db.query('select (encrypted_password = crypt($2, encrypted_password)) m from auth.users where id = $1', [P['Joaquín Or'].id, pw1])).rows[0].m, 'en cada ingreso cambia la contraseña interna');

const A = P['Joaquín Or'].id, B = P['Alfonso Ro'].id, C = P['Arlette Ga'].id, M = P['Matias Me'].id;
const setPin = (uid, n, o) => rpc(uid, 'select public.set_pin($1, $2) j', [n, o ?? null]);
R = await setPin(A, '0000');
ok(!!R.error && /0000/.test(R.error), 'no se puede quedar con 0000');
R = await setPin(A, '12a4');
ok(!!R.error && /4 números/.test(R.error), 'el PIN son 4 números');
R = await setPin(A, '4821');
ok(R.ok && R.role === 'admin', 'el primero que crea su PIN queda como admin');
R = await setPin(B, '1357');
ok(R.ok && R.role === 'agent', 'el segundo queda como agente');
R = await setPin(M, '2468');
ok(R.ok && R.role === 'leader', 'el team leader sigue de team leader');
R = await login('Joaquín Or', '0000');
ok(R.ok === false, 'después de crear el PIN, 0000 ya no entra');
R = await login('Joaquín Or', '4821');
ok(R.ok === true && R.pin_set === true, 'entra con su PIN nuevo');
R = await setPin(A, '1111', '0000');
ok(!!R.error && /actual/.test(R.error), 'para cambiar el PIN hay que saber el actual');
R = await setPin(A, '1111', '4821');
ok(R.ok, 'cambia su PIN sabiendo el actual');
R = await rpc(null, 'select public.set_pin($1, $2) j', ['5555', null]);
ok(!!R.error, 'sin sesión no se cambia ningún PIN');
r = await as(B, 'update public.profiles set pin_set = false where id = $1', [B]);
ok(!!r.error, 'nadie se toca pin_set a mano');
r = await as(A, "update public.profiles set login = 'x' where id = $1", [B]);
ok(!!r.error, 'ni el admin cambia la cuenta interna de otro');
R = await rpc(B, 'select public.reset_pin($1) j', [A]);
ok(!!R.error, 'un agente no resetea PINs');
R = await rpc(A, 'select public.reset_pin($1) j', [B]);
ok(R.ok && (await login('Alfonso Ro', '0000')).ok, 'el admin vuelve el PIN de alguien a 0000');
R = await rpc(B, "select public.add_member('Nuevo Ag', 'agent') j");
ok(!!R.error, 'un agente no suma gente');
R = await rpc(A, "select public.add_member('  Nuevo   Ag ', 'agent') j");
ok(R.ok && (await rpc(null, 'select public.roster() j')).people.some((p) => p.name === 'Nuevo Ag'), 'el admin suma a alguien y aparece en la lista');
R = await rpc(A, "select public.add_member('nuevo ag') j");
ok(!!R.error && /nombre/.test(R.error), 'no se repiten nombres');
R = await rpc(null, "select public.add_member('Otro') j");
ok(!!R.error, 'anon no suma gente');

// ---------- ventas compartidas ----------
r = await as(A, "insert into public.sales (date, client_id, name, amount, tx, brand) values ('2026-11-17','68336','Maria',100,'51271','Novara Markets') returning id, team_id, user_id");
ok(!r.error && r.rows[0].user_id === A, 'A carga una venta (mesa y vendedor automáticos)');
const saleA = r.rows[0].id;
r = await as(B, 'select client_id, user_id from public.sales');
ok(r.rows.length === 1 && r.rows[0].user_id === A, 'B ve la venta de A');
r = await as(B, 'update public.sales set amount = 1 where id = $1 returning id', [saleA]);
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
r = await as(B, "insert into public.sales (user_id, date, client_id, amount, tx) values ($1,'2026-11-17','71000',100,'71000') returning id", [C]);
ok(!!r.error, 'un agente no carga ventas a nombre de otro');

// ---------- privados ----------
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

// ---------- snippets ----------
r = await as(A, "insert into public.snippets (shortcut, title, body) values ('kyc','KYC','Hola {yo}...') returning id");
ok(!r.error, 'A crea un snippet privado');
const snipA = r.rows[0].id;
r = await as(A, "insert into public.snippets (shortcut, body) values ('kyc','otro')");
ok(!!r.error, 'A no puede repetir su atajo');
r = await as(A, "insert into public.snippets (shortcut, body) values ('KYC Doc','x')");
ok(!!r.error, 'atajo con mayúsculas o espacios: rechazado');
r = await as(B, 'select * from public.snippets');
ok(r.rows.length === 0, 'B no ve el snippet privado de A');
r = await as(A, "insert into public.snippets (shortcut, body, shared) values ('saludo','Buenas!', true) returning id");
const snipShared = r.rows[0].id;
r = await as(B, 'select shortcut from public.snippets');
ok(r.rows.length === 1 && r.rows[0].shortcut === 'saludo', 'B ve el snippet compartido de A');
r = await as(B, "insert into public.snippets (shortcut, body) values ('kyc','el mío') returning id");
ok(!r.error, 'B puede tener su propio /kyc');
r = await as(B, "update public.snippets set body = 'hackeado' where id = $1 returning id", [snipShared]);
ok(!r.error && r.rows.length === 0, 'B (agente) no edita el compartido de A');
r = await as(B, 'delete from public.snippets where id = $1 returning id', [snipA]);
ok(!r.error && r.rows.length === 0, 'B no borra el privado de A');

// ---------- clientes new ----------
r = await as(A, "insert into public.leads (client_id, name, date) values ('80001','Ana','2026-11-17'),('80002','Beto','2026-11-17') returning id");
ok(!r.error && r.rows.length === 2, 'A registra 2 clientes new');
r = await as(B, "insert into public.leads (client_id, name) values ('80001','Ana') on conflict (team_id, client_id) do nothing returning id");
ok(!r.error && r.rows.length === 0, 'el mismo cliente no se registra dos veces en la mesa');
r = await as(B, 'select client_id from public.leads');
ok(r.rows.length === 2, 'B ve los clientes de la mesa');
r = await as(B, "delete from public.leads where client_id = '80001' returning id");
ok(!r.error && r.rows.length === 0, 'B no borra clientes de A');
r = await as(B, "insert into public.leads (user_id, client_id) values ($1, '1')", [A]);
ok(!!r.error, 'B no registra clientes a nombre de A');

// ---------- roles ----------
r = await as(B, "update public.profiles set role = 'admin' where id = $1", [B]);
ok(!!r.error, 'B no puede hacerse admin');
r = await as(B, "update public.profiles set name = 'Alfonso R.' where id = $1 returning name", [B]);
ok(!r.error && r.rows[0].name === 'Alfonso R.', 'B cambia su nombre');
r = await as(A, "update public.profiles set role = 'leader' where id = $1 returning role", [C]);
ok(!r.error && r.rows[0].role === 'leader', 'A pone a C de team leader');
r = await as(C, 'update public.sales set amount = 260 where id = $1 returning amount', [saleB]);
ok(!r.error && r.rows.length === 1, 'el team leader corrige una venta de B');
r = await as(C, "insert into public.sales (user_id, date, client_id, amount, tx, brand) values ($1,'2026-11-17','72000',150,'72000','Trade24Seven'), ($2,'2026-11-17','72001',90,'72001','Novara Markets') returning user_id", [B, A]);
ok(!r.error && r.rows.length === 2 && r.rows[0].user_id === B, 'el team leader carga ventas de la mesa a nombre de cada uno (las dos marcas)');
r = await as(C, "insert into public.sales (user_id, date, client_id, amount) values ('00000000-0000-0000-0000-000000000000','2026-11-17','1',1)");
ok(!!r.error, 'ni el team leader carga a nombre de alguien de afuera');
r = await as(C, 'update public.sales set user_id = $2 where id = $1 returning user_id', [saleB, A]);
ok(!r.error && r.rows[0].user_id === A, 'el team leader cambia el vendedor de una venta');
R = await rpc(C, "select public.set_crm_name($1, ' Alfonso Rodriguez ') j", [B]);
ok(R.ok && (await db.query('select crm_name from public.profiles where id = $1', [B])).rows[0].crm_name === 'Alfonso Rodriguez', 'el team leader guarda cómo figura alguien en el CRM');
R = await rpc(B, "select public.set_crm_name($1, 'x') j", [B]);
ok(!!R.error, 'un agente no cambia nombres del CRM');
r = await as(C, "update public.snippets set body = 'Buenas tardes!' where id = $1 returning id", [snipShared]);
ok(!r.error && r.rows.length === 1, 'el team leader corrige un snippet compartido');
r = await as(A, "update public.profiles set role = 'agent' where id = $1", [A]);
ok(!!r.error, 'el único admin no puede sacarse el rol');
r = await as(B, "update public.teams set invite_code = 'X' returning id");
ok(!r.error && r.rows.length === 0, 'B no cambia el código de la mesa');

// ---------- social ----------
const ping = (uid, kind, to = null, body = null) => as(uid, 'insert into public.pings (kind, to_id, body) values ($1, $2, $3) returning id, team_id', [kind, to, body]);
r = await ping(B, 'mate');
ok(!r.error && r.rows.length === 1, 'B pide un mate a toda la mesa');
const mateB = r.rows[0].id;
r = await ping(B, 'mate');
ok(!!r.error && /mate.*min/.test(r.error), 'pedir otro mate enseguida: hay que esperar (' + (r.error || '').slice(0, 60) + ')');
r = await ping(B, 'd10', C);
ok(!r.error, 'B le pregunta a C si sale a los 10');
const d10 = r.rows[0].id;
r = await ping(B, 'd10', C);
ok(!!r.error && /esperá/.test(r.error), 'la misma pregunta a la misma persona: hay que esperar');
r = await ping(B, 'd30', B);
ok(!!r.error, 'no se puede pedir algo a uno mismo');
r = await ping(B, 'msg', C, '   ');
ok(!!r.error, 'mensaje vacío: no');
r = await as(C, 'select id from public.pings');
ok(r.rows.length === 2, 'C ve el mate de la mesa y lo que le mandaron');
r = await as(A, 'select id from public.pings');
ok(r.rows.length === 1, 'A ve solo el mate de la mesa (no lo de B a C)');
R = await rpc(A, 'select public.reply_ping($1, $2) j', [d10, 'si']);
ok(!!R.error, 'A no contesta lo que era para C');
R = await rpc(C, 'select public.reply_ping($1, $2) j', [d10, 'si']);
ok(R.ok === true, 'C contesta que sí');
R = await rpc(B, 'select public.reply_ping($1, $2) j', [mateB, 'si']);
ok(!!R.error, 'nadie se contesta a sí mismo');
R = await rpc(A, 'select public.reply_ping($1, $2) j', [mateB, 'si']);
ok(R.ok === true, 'A le ceba el mate a B');
R = await rpc(C, 'select public.reply_ping($1, $2) j', [mateB, 'si']);
ok(R.ok === false && R.taken === true, 'el mate ya lo cebó otro');
r = await as(A, "update public.pings set reply = 'no' where id = $1 returning id", [mateB]);
ok(!!r.error || r.rows.length === 0, 'las respuestas solo por la función (nadie edita a mano)');
r = await as(B, "update public.profiles set quiet_until = now() + interval '1 hour' where id = $1 returning quiet_until", [B]);
ok(!r.error && r.rows.length === 1, 'B silencia los avisos sociales');
await db.query("insert into public.pings (team_id, from_id, kind, created_at) select team_id, $1, 'mate', now() - interval '8 days' from public.profiles where id = $1", [M]);
await db.query("update public.pings set created_at = now() - interval '8 days' where from_id = $1", [M]);
r = await ping(C, 'd30');
ok((await db.query('select count(*)::int c from public.pings where from_id = $1', [M])).rows[0].c === 0, 'los pedidos de hace más de una semana se borran solos');


// ---------- baja ----------
r = await as(A, 'update public.profiles set active = false where id = $1 returning active', [B]);
ok(!r.error && r.rows[0].active === false, 'A da de baja a B');
r = await as(B, 'select * from public.sales');
ok(r.rows.length === 0, 'B dado de baja no ve más las ventas de la mesa');
ok(!(await rpc(null, 'select public.roster() j')).people.some((p) => p.id === B), 'B dado de baja no aparece en la lista');
ok((await rpc(null, 'select public.pin_login($1, $2) j', [B, '0000'])).ok === false, 'B dado de baja no puede entrar');
r = await as(null, 'select * from public.sales');
ok(!!r.error || r.rows.length === 0, 'sin sesión no se ve nada');

console.log(fails ? `\n${fails} FALLAS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
