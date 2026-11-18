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
ok((await db.query("select count(*)::int c from pg_publication_tables where pubname='supabase_realtime'")).rows[0].c === 17, 'tablas en tiempo real');

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

// toques
r = await ping(B, 'toque');
ok(!!r.error && /toque/.test(r.error), 'el toque es para alguien');
r = await ping(B, 'toque', C);
ok(!r.error, 'B le da un toque a C');
const toqueB = r.rows[0].id;
r = await ping(B, 'toque', C);
ok(!!r.error && /COOLDOWN/.test(r.error), 'otro toque a C enseguida: cooldown');
r = await ping(B, 'toque', M);
ok(!r.error, 'a otra persona sí puede darle un toque');
R = await rpc(C, 'select public.reply_ping($1, $2) j', [toqueB, 'si']);
ok(R.ok === true, 'C le devuelve el toque');

// ---------- chat ----------
const team = (await db.query('select id from public.chats where kind = $1', ['team'])).rows;
ok(team.length === 1, 'hay un chat de toda la mesa (aunque el SQL se corra dos veces)');
const TC = team[0].id;
const rid = async (uid, q, params) => { const r = await as(uid, q, params); return r.error ? { error: r.error } : r.rows[0].j; };
const say = (uid, cid, body) => as(uid, 'insert into public.messages (chat_id, body) values ($1, $2) returning id, user_id, body', [cid, body]);
r = await say(A, TC, '  Buen día, mesa!  ');
ok(!r.error && r.rows[0].body === 'Buen día, mesa!' && r.rows[0].user_id === A, 'A escribe en el chat de la mesa (sin espacios de más)');
r = await as(B, 'select body from public.messages where chat_id = $1', [TC]);
ok(r.rows.length === 1, 'B lo ve');
r = await say(B, TC, '   ');
ok(!!r.error, 'no se mandan mensajes vacíos');
r = await as(B, 'insert into public.messages (chat_id, user_id, body) values ($1, $2, $3)', [TC, A, 'soy A']);
ok(!!r.error, 'B no escribe a nombre de A');
R = await rid(A, 'select public.chat_create($1, $2::uuid[])::text j', ['Los del fondo', [B, M, '00000000-0000-0000-0000-000000000000']]);
ok(!R.error && typeof R === 'string', 'A crea un grupo con B y Matias');
const G = R;
r = await as(A, 'select user_id from public.chat_members where chat_id = $1', [G]);
ok(r.rows.length === 3, 'el grupo tiene a A, B y Matias (nadie de afuera)');
r = await say(B, G, 'hola grupo');
ok(!r.error, 'B escribe en el grupo');
r = await as(C, 'select id from public.messages where chat_id = $1', [G]);
ok(r.rows.length === 0, 'C (fuera del grupo) no lo lee');
r = await say(C, G, 'me meto');
ok(!!r.error, 'C no escribe en el grupo');
r = await as(C, 'select id from public.chats');
ok(r.rows.length === 1, 'C solo ve el chat de la mesa');
r = await as(B, 'insert into public.chats (kind, name) values ($1, $2)', ['group', 'trucho']);
ok(!!r.error, 'los grupos no se crean a mano (solo con la función)');
r = await as(B, 'insert into public.chat_members (chat_id, user_id) values ($1, $2)', [G, C]);
ok(!!r.error, 'no se suma gente a mano');
R = await rpc(C, 'select public.chat_add($1, $2::uuid[]) j', [G, [C]]);
ok(!!R.error, 'C no se puede sumar solo a un grupo');
R = await rpc(B, 'select public.chat_add($1, $2::uuid[]) j', [G, [C]]);
ok(R.ok && R.added === 1, 'B (que está adentro) suma a C');
r = await as(C, 'select body from public.messages where chat_id = $1', [G]);
ok(r.rows.length === 1, 'ahora C lee el grupo');
R = await rpc(B, 'select public.chat_rename($1, $2) j', [G, 'Fondo ☕']);
ok(R.ok && (await db.query('select name from public.chats where id = $1', [G])).rows[0].name === 'Fondo ☕', 'B le cambia el nombre');
R = await rpc(B, 'select public.chat_leave($1, $2) j', [G, C]);
ok(!!R.error, 'B no puede sacar a C (no creó el grupo)');
R = await rpc(A, 'select public.chat_leave($1, $2) j', [G, C]);
ok(R.ok, 'A (que lo creó) saca a C');
R = await rpc(B, 'select public.chat_leave($1) j', [G]);
ok(R.ok, 'B sale del grupo');
r = await as(B, 'select id from public.messages where chat_id = $1', [G]);
ok(r.rows.length === 0, 'B ya no lo lee');
// desvinculados desde el CRM
{
  let R2 = await rpc(B, 'select public.add_former($1) j', ['Gonzalo Perez']);
  ok(!!R2.error, 'un agente no crea desvinculados');
  R2 = await rpc(M, 'select public.add_former($1) j', ['  Gonzalo   Perez ']);
  ok(R2.ok && R2.new, 'el team leader crea un desvinculado (Gonzalo Perez)');
  const GP = R2.id;
  let q = await db.query('select name, active, former, crm_name, login is not null l from public.profiles where id = $1', [GP]);
  ok(q.rows[0].name === 'Gonzalo Perez' && !q.rows[0].active && q.rows[0].former && q.rows[0].crm_name === 'Gonzalo Perez', 'queda dado de baja, marcado como desvinculado y con su nombre en el CRM');
  R2 = await rpc(M, 'select public.add_former($1) j', ['gonzalo perez']);
  ok(R2.ok && !R2.new && R2.id === GP, 'si ya existe, no lo repite');
  R2 = await rpc(M, 'select public.add_former($1) j', ['Matias Me']);
  ok(R2.ok && !R2.new && R2.id === M, 'si es alguien de la mesa, devuelve a esa persona');
  R2 = await rpc(M, "select public.add_formers(array['Gonzalo Perez','Lucia Diaz','x']) j");
  ok(Array.isArray(R2) && R2[0].id === GP && !R2[0].new && R2[1].new && R2[2].error, 'de a varios: reusa, crea y avisa los nombres inválidos');
  R2 = await rpc(B, "select public.add_formers(array['Otro Mas']) j");
  ok(!!R2.error, 'un agente no crea de a varios');
  R2 = await rpc(null, 'select public.roster() j');
  ok(!R2.people.some((p) => p.id === GP), 'no aparece en la lista para entrar');
  R2 = await rpc(null, `select public.pin_login('${GP}', '0000') j`);
  ok(!!R2.error || !R2.ok, 'y no puede entrar');
  q = await as(M, 'insert into public.sales (user_id, n, date, client_id, amount, brand) values ($1, 1, $2, $3, 100, $4), ($1, 2, $2, $5, 120, $4) returning id', [GP, '2025-03-10', 'F-1', 'Trade24Seven', 'F-2']);
  ok(!q.error && q.rows.length === 2, 'el team leader le carga ventas');
  q = await as(B, 'update public.profiles set former = true where id = $1', [B]);
  ok(!!q.error, 'nadie se cambia la marca de desvinculado');
  R2 = await rpc(B, `select public.merge_former('${GP}', '${B}') j`);
  ok(!!R2.error, 'un agente no une desvinculados');
  R2 = await rpc(M, `select public.merge_former('${A}', '${B}') j`);
  ok(!!R2.error, 'solo se unen desvinculados del CRM (no a alguien de la mesa)');
  const nB = (await db.query('select coalesce(max(n),0)::int m from public.sales where user_id = $1', [B])).rows[0].m;
  R2 = await rpc(M, `select public.merge_former('${GP}', '${B}') j`);
  ok(R2.ok && R2.moved === 2, 'era B: el team leader los une');
  q = await db.query("select user_id, n from public.sales where client_id in ('F-1','F-2') order by n");
  ok(q.rows.every((r) => r.user_id === B) && q.rows[0].n === nB + 1 && q.rows[1].n === nB + 2, 'las ventas pasan a B con números nuevos');
  q = await db.query('select count(*)::int c from public.profiles where id = $1', [GP]);
  ok(q.rows[0].c === 0 && (await db.query('select crm_name from public.profiles where id = $1', [B])).rows[0].crm_name, 'el desvinculado se borra y B queda con ese nombre en el CRM');
}
// foto de perfil
{
  const PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let q = await as(A, 'insert into public.avatars (mime, data) values ($1, $2) returning user_id::text', ['image/png', PX]);
  ok(!q.error && q.rows[0].user_id === A, 'A sube su foto');
  q = await as(B, 'select data from public.avatars where user_id = $1', [A]);
  ok(q.rows.length === 1 && q.rows[0].data === PX, 'B la ve');
  q = await as(B, 'update public.avatars set data = $1 where user_id = $2 returning 1', [PX, A]);
  ok(!q.error && q.rows.length === 0, 'B no le cambia la foto a A');
  q = await as(B, 'insert into public.avatars (user_id, mime, data) values ($1, $2, $3)', [A, 'image/png', PX]);
  ok(!!q.error, 'ni sube una a su nombre');
  q = await as(A, 'insert into public.avatars (mime, data) values ($1, $2) on conflict (user_id) do update set data = excluded.data returning 1', ['image/png', '<svg onload=x>']);
  ok(!!q.error, 'la foto tiene que ser una imagen');
  q = await as(null, 'select * from public.avatars');
  ok(!!q.error || q.rows.length === 0, 'sin sesión no se ven las fotos');
  q = await as(A, 'delete from public.avatars where user_id = $1 returning 1', [A]);
  ok(!q.error && q.rows.length === 1, 'A saca su foto');
}
// responder y reaccionar
{
  let q = await say(A, G, 'para responder');
  const M1 = q.rows[0].id;
  q = await as(M, 'insert into public.messages (chat_id, body, reply_to) values ($1, $2, $3) returning reply_to::text', [G, 'te respondo', M1]);
  ok(!q.error && q.rows[0].reply_to === M1, 'Matias responde a un mensaje de A');
  q = await as(A, 'insert into public.messages (chat_id, body, reply_to) values ($1, $2, $3) returning reply_to', [TC, 'otro chat', M1]);
  ok(!q.error && q.rows[0].reply_to === null, 'no se responde a un mensaje de otro chat');
  q = await as(M, 'insert into public.message_reactions (message_id, emoji) values ($1, $2) returning chat_id::text', [M1, '👍']);
  ok(!q.error && q.rows[0].chat_id === G, 'Matias reacciona 👍 (el chat sale del mensaje)');
  q = await as(M, 'insert into public.message_reactions (message_id, emoji) values ($1, $2)', [M1, '👍']);
  ok(!!q.error, 'la misma reacción no se repite');
  q = await as(M, 'insert into public.message_reactions (message_id, emoji) values ($1, $2)', [M1, '💩']);
  ok(!!q.error, 'solo los emojis de la lista');
  q = await as(B, 'insert into public.message_reactions (message_id, emoji) values ($1, $2)', [M1, '🔥']);
  ok(!!q.error, 'B (que no está en el grupo) no reacciona');
  q = await as(B, 'select * from public.message_reactions where message_id = $1', [M1]);
  ok(q.rows.length === 0, 'ni las ve');
  q = await as(A, 'select emoji from public.message_reactions where message_id = $1', [M1]);
  ok(q.rows.length === 1, 'A la ve');
  q = await as(A, 'delete from public.message_reactions where message_id = $1 returning 1', [M1]);
  ok(!q.error && q.rows.length === 0, 'A no borra la reacción de Matias');
  q = await as(M, 'delete from public.message_reactions where message_id = $1 returning 1', [M1]);
  ok(!q.error && q.rows.length === 1, 'Matias la saca');
}
// imágenes del chat
const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
r = await as(A, 'insert into public.chat_files (chat_id, mime, w, h, data) values ($1, $2, 1, 1, $3) returning id::text', [G, 'image/png', B64]);
ok(!r.error, 'A sube una imagen al grupo');
const F1 = r.rows && r.rows[0].id;
r = await as(M, 'select data from public.chat_files where id = $1', [F1]);
ok(r.rows.length === 1 && r.rows[0].data === B64, 'Matias (del grupo) la ve');
r = await as(B, 'select data from public.chat_files where id = $1', [F1]);
ok(r.rows.length === 0, 'B (que salió del grupo) no la ve');
r = await as(B, 'insert into public.chat_files (chat_id, mime, data) values ($1, $2, $3)', [G, 'image/png', B64]);
ok(!!r.error, 'B no sube imágenes al grupo');
r = await as(A, 'insert into public.chat_files (chat_id, mime, data) values ($1, $2, $3)', [G, 'image/png', '<script>alert(1)</script>']);
ok(!!r.error, 'solo se guarda base64');
r = await as(A, 'insert into public.chat_files (chat_id, mime, data) values ($1, $2, $3)', [G, 'text/html', B64]);
ok(!!r.error, 'solo imágenes');
r = await say(M, G, `[img:${F1}:1x1] es mía`);
ok(!!r.error, 'no se manda la imagen de otro');
r = await say(A, TC, `[img:${F1}:1x1]`);
ok(!!r.error, 'ni en otro chat');
r = await say(A, G, `[img:${F1}:1x1] mirá esto`);
ok(!r.error, 'A manda la imagen con texto');
r = await as(M, 'delete from public.chat_files where id = $1 returning id', [F1]);
ok(!r.error && r.rows.length === 0, 'Matias no borra la imagen de A');
r = await as(A, 'delete from public.messages where id = $1', [r.error ? null : (await db.query("select id from public.messages where body like '[img:%'")).rows[0].id]);
ok((await db.query('select count(*)::int c from public.chat_files where id = $1', [F1])).rows[0].c === 0, 'al borrar el mensaje se borra la imagen');
R = await rpc(B, 'select public.chat_leave($1) j', [TC]);
ok(!!R.error, 'del chat de la mesa no se sale');
// privados
R = await rid(A, 'select public.chat_dm($1)::text j', [C]);
const D1 = R;
R = await rid(C, 'select public.chat_dm($1)::text j', [A]);
ok(typeof D1 === 'string' && R === D1, 'el privado entre A y C es uno solo, lo abra quien lo abra');
R = await rid(A, 'select public.chat_dm($1)::text j', [A]);
ok(!!R.error, 'no hay privado con uno mismo');
r = await say(C, D1, 'che, ¿salís a los 10?');
ok(!r.error, 'C escribe por privado');
r = await as(B, 'select id from public.messages where chat_id = $1', [D1]);
ok(r.rows.length === 0, 'B no lee el privado de A y C');
r = await as(A, 'delete from public.messages where chat_id = $1 returning id', [D1]);
ok(!r.error && r.rows.length === 0, 'A no borra mensajes de C');
r = await as(C, 'delete from public.messages where chat_id = $1 returning id', [D1]);
ok(!r.error && r.rows.length === 1, 'C borra su mensaje');
r = await as(A, 'update public.messages set body = $2 where chat_id = $1', [TC, 'editado']);
ok(!!r.error, 'los mensajes no se editan');
// leídos y silenciar
r = await as(B, 'insert into public.chat_reads (chat_id, read_at, muted) values ($1, now(), true) returning muted', [TC]);
ok(!r.error && r.rows[0].muted === true, 'B marca leído y silencia el chat de la mesa');
r = await as(A, 'select * from public.chat_reads');
ok(r.rows.length === 0, 'A no ve lo que leyó B');
r = await as(B, 'insert into public.chat_reads (chat_id) values ($1)', [D1]);
ok(!!r.error, 'no se marca un chat ajeno');
// otra mesa
const t2 = (await db.query("insert into public.teams (name, invite_code) values ('Otra', 'OTRA-1') returning id")).rows[0].id;
const X = (await db.query("select public._new_seat($1, 'Xavier Ot', 'agent') id", [t2])).rows[0].id;
await db.query("insert into public.chats (team_id, kind, name) values ($1, 'team', 'Otra mesa')", [t2]);
r = await as(X, 'select id from public.messages');
ok(r.rows.length === 0, 'alguien de otra mesa no lee nada');
r = await say(X, TC, 'hola');
ok(!!r.error, 'ni escribe en el chat de Team Matías');
R = await rid(X, 'select public.chat_dm($1)::text j', [A]);
ok(!!R.error, 'ni abre un privado con alguien de la mesa');
R = await rid(A, 'select public.chat_create($1, $2::uuid[])::text j', ['Con X', [X]]);
ok((await db.query('select count(*)::int c from public.chat_members where chat_id = $1', [R])).rows[0].c === 1, 'no se puede meter a alguien de otra mesa en un grupo');
// sin inundar
for (let i = 0; i < 15; i++) await say(M, TC, 'spam ' + i);
r = await say(M, TC, 'uno más');
ok(!!r.error && /SLOW/.test(r.error), 'más de 15 mensajes en 30 s: frena');

// ---------- snippets globales ----------
r = await as(B, "insert into public.snippets (shortcut, body, global) values ('glob', 'x', true)");
ok(!!r.error, 'un agente no crea snippets globales');
r = await as(M, "insert into public.snippets (shortcut, body, global) values ('glob', 'x', true)");
ok(!!r.error, 'el team leader tampoco');
r = await as(A, "insert into public.snippets (shortcut, body, global) values ('bienvenida', 'Hola {yo}', true) returning id");
ok(!r.error, 'el admin crea un snippet global');
const GS = r.rows[0].id;
r = await as(C, 'select shortcut from public.snippets where id = $1', [GS]);
ok(r.rows.length === 1, 'todos lo ven (sin marcarlo como compartido)');
r = await as(M, "update public.snippets set body = 'cambiado' where id = $1 returning id", [GS]);
ok(!r.error && r.rows.length === 0, 'el team leader no edita un global');
r = await as(M, 'delete from public.snippets where id = $1 returning id', [GS]);
ok(!r.error && r.rows.length === 0, 'ni lo borra');
r = await as(B, "insert into public.snippets (shortcut, body) values ('mio', 'x') returning id");
r = await as(B, 'update public.snippets set global = true where id = $1', [r.rows[0].id]);
ok(!!r.error, 'un agente no convierte su snippet en global');
r = await as(A, "update public.snippets set body = 'Hola, soy {yo}' where id = $1 returning id", [GS]);
ok(!r.error && r.rows.length === 1, 'el admin lo edita');
r = await as(X, 'select id from public.snippets where id = $1', [GS]);
ok(r.rows.length === 0, 'alguien de otra mesa no lo ve');

// ---------- tareas ----------
const task = (uid, args) => rid(uid, 'select public.task_create($1, $2::text[], $3::text[], $4::date, $5::date, $6, $7, $8::date, $9::uuid[])::text j', args);
R = await task(B, ['Repasar', [], [], null, null, null, null, null, null]);
ok(!!R.error, 'un agente no manda tareas');
R = await task(M, ['  Repasar  ', ['Camp A', ' camp a ', '', 'Camp B'], ['Aff 1'], '2026-11-01', '2026-11-15', 'No answer', 'Ojo con los de Perú', '2026-11-20', null]);
ok(typeof R === 'string', 'el team leader manda una tarea a toda la mesa');
const T1 = R;
r = (await db.query('select what, campaigns, affiliates, status from public.tasks where id = $1', [T1])).rows[0];
ok(r.what === 'Repasar' && JSON.stringify(r.campaigns) === '["Camp A","Camp B"]' && r.status === 'No answer', 'limpia el texto y las listas (sin repetidos ni vacíos)');
const nPeople = (await db.query("select count(*)::int c from public.profiles where team_id = (select team_id from public.profiles where id = $1) and active and login is not null and id <> $1", [M])).rows[0].c;
ok((await db.query('select count(*)::int c from public.task_people where task_id = $1', [T1])).rows[0].c === nPeople, 'le llega a toda la mesa menos a quien la manda');
r = await as(B, 'select id from public.tasks where id = $1', [T1]);
ok(r.rows.length === 1, 'B la ve');
R = await task(M, ['Llamar', [], [], null, null, null, null, null, [B]]);
const T2 = R;
const Dh = P['Dahiana Le'].id;
r = await as(Dh, 'select id from public.tasks where id = $1', [T2]);
ok(r.rows.length === 0, 'una tarea solo para B: otra agente no la ve');
r = await as(C, 'select id from public.tasks where id = $1', [T2]);
ok(r.rows.length === 1, 'otro team leader sí');
r = await as(A, 'select id from public.tasks where id = $1', [T2]);
ok(r.rows.length === 1, 'el admin ve todas');
R = await rpc(B, 'select public.task_done($1) j', [T2]);
ok(R.ok && (await db.query('select done_at from public.task_people where task_id = $1 and user_id = $2', [T2, B])).rows[0].done_at, 'B la marca como hecha');
R = await rpc(Dh, 'select public.task_done($1) j', [T2]);
ok(!!R.error, 'nadie marca una tarea que no es suya');
R = await rpc(B, 'select public.task_done($1, false) j', [T2]);
ok(R.ok && !(await db.query('select done_at from public.task_people where task_id = $1 and user_id = $2', [T2, B])).rows[0].done_at, 'y la puede desmarcar');
r = await as(B, 'update public.task_people set done_at = now() where task_id = $1', [T1]);
ok(!!r.error, 'no se marca a mano (solo con la función)');
r = await as(B, "update public.tasks set what = 'nada' where id = $1", [T1]);
ok(!!r.error, 'un agente no edita la tarea');
r = await as(B, 'delete from public.tasks where id = $1 returning id', [T1]);
ok(!r.error && r.rows.length === 0, 'ni la borra');
R = await task(M, ['Repasar', [], [], '2026-11-15', '2026-11-01', null, null, null, null]);
ok(!!R.error, 'fechas al revés: avisa');
R = await task(M, ['Repasar', [], [], null, null, null, null, null, [X]]);
ok(!!R.error, 'no se manda a alguien de otra mesa');
r = await as(X, 'select id from public.tasks');
ok(r.rows.length === 0, 'alguien de otra mesa no ve las tareas');
r = await as(M, 'delete from public.tasks where id = $1 returning id', [T2]);
ok(!r.error && r.rows.length === 1 && (await db.query('select count(*)::int c from public.task_people where task_id = $1', [T2])).rows[0].c === 0, 'quien la mandó la borra (y se va de todos)');

// ---------- el team leader ve todo de la mesa menos el sueldo ----------
await as(B, "insert into public.agenda (client_id, kw, due) values ('70001', 'kyc', '2026-11-18T10:00')");
await as(B, "insert into public.shifts (date, data) values ('2026-11-18', '{\"in\": 1, \"breaks\": []}')");
await as(B, "insert into public.adjustments (ym, n) values ('2026-11', 2)");
await as(B, `insert into public.settings (cfg) values ('{"base": 40000, "hijos": 2, "faltas": [{"d": "2026-11-10", "j": false}], "laborables": [1,2,3,4,5]}') on conflict (user_id) do update set cfg = excluded.cfg`);
r = await as(M, 'select client_id from public.agenda where user_id = $1', [B]);
ok(r.rows.length === 1, 'el team leader ve la agenda de un agente');
r = await as(M, 'select date from public.shifts where user_id = $1', [B]);
ok(r.rows.length === 1, 'y sus turnos');
r = await as(M, 'select n from public.adjustments where user_id = $1', [B]);
ok(r.rows.length === 1 && r.rows[0].n === 2, 'y sus "sin detalle"');
r = await as(M, 'select cfg from public.settings where user_id = $1', [B]);
ok(r.rows.length === 0, 'pero no sus datos de sueldo');
R = await as(M, 'select user_id, faltas, laborables from public.team_days() where user_id = $1', [B]);
ok(R.rows.length === 1 && R.rows[0].faltas.length === 1 && !('base' in R.rows[0]), 've sus faltas y días laborables (sin el sueldo)');
r = await as(B, 'select * from public.team_days()');
ok(r.rows.length === 0, 'un agente no ve los días de los demás');
r = await as(Dh, 'select client_id from public.agenda where user_id = $1', [B]);
ok(r.rows.length === 0, 'un agente no ve la agenda de otro');
r = await as(Dh, 'select date from public.shifts where user_id = $1', [B]);
ok(r.rows.length === 0, 'ni sus turnos');
r = await as(M, "update public.agenda set kw = 'tocado' where user_id = $1 returning id", [B]);
ok(!r.error && r.rows.length === 0, 'el team leader no le cambia la agenda (solo mira)');
r = await as(M, 'delete from public.shifts where user_id = $1 returning date', [B]);
ok(!r.error && r.rows.length === 0, 'ni le borra turnos');
r = await as(X, 'select client_id from public.agenda');
ok(r.rows.length === 0, 'alguien de otra mesa no ve agendas');
// target del mes
r = await as(B, "insert into public.targets (ym, ftds) values ('2026-11', 400)");
ok(!!r.error, 'un agente no fija el target');
r = await as(M, "insert into public.targets (ym, ftds) values ('2026-11', 400) on conflict (team_id, ym) do update set ftds = excluded.ftds returning ftds");
ok(!r.error && r.rows[0].ftds === 400, 'el team leader fija el target del mes');
r = await as(M, "insert into public.targets (ym, ftds) values ('2026-11', 450) on conflict (team_id, ym) do update set ftds = excluded.ftds returning ftds");
ok(!r.error && r.rows[0].ftds === 450, 'y lo cambia');
r = await as(B, "select ftds from public.targets where ym = '2026-11'");
ok(r.rows.length === 1 && r.rows[0].ftds === 450, 'todos lo ven');
r = await as(X, 'select * from public.targets');
ok(r.rows.length === 0, 'otra mesa no');
r = await as(M, "insert into public.targets (ym, ftds) values ('nov', 10)");
ok(!!r.error, 'el mes va como AAAA-MM');

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
