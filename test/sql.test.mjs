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
ok((await db.query("select count(*)::int c from public.teams where slug is distinct from 'pruebas'")).rows[0].c === 1, 'una sola mesa aunque se corra dos veces (más la de Pruebas, que no es una mesa)');
ok((await db.query("select count(*)::int c from pg_publication_tables where pubname='supabase_realtime'")).rows[0].c === 27, 'tablas en tiempo real');

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
let R = await rpc(null, "select public.roster('matias') j");
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
ok(R.ok && (await rpc(null, "select public.roster('matias') j")).people.some((p) => p.name === 'Nuevo Ag'), 'el admin suma a alguien y aparece en la lista');
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
R = await rpc(C, 'select public.reply_ping($1, $2) j', [mateB, 'no']);
r = await db.query('select reply from public.pings where id = $1', [mateB]);
ok(R.ok === true && R.skip === true && r.rows[0].reply === null, 'un "ahora no" al mate no lo cierra ni le llega a B');
R = await rpc(A, 'select public.reply_ping($1, $2) j', [mateB, 'si']);
ok(R.ok === true, 'A le ceba el mate a B (el primer sí)');
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

// pedir ayuda (al team leader y a los administradores)
r = await ping(B, 'ayuda');
ok(!r.error, 'B pide ayuda');
const ayudaB = r.rows[0].id;
r = await ping(B, 'ayuda');
ok(!!r.error && /COOLDOWN/.test(r.error) && /ayuda/.test(r.error), 'otra vez enseguida: ya les llegó (pausa de un minuto)');
R = await rpc(M, 'select public.reply_ping($1, $2) j', [ayudaB, 'si']);
ok(R.ok === true, 'el team leader dice "Voy"');
R = await rpc(A, 'select public.reply_ping($1, $2) j', [ayudaB, 'si']);
ok(R.ok === false && R.taken === true, 'si otro ya va, queda tomado');

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
// editar el propio mensaje hasta 1 minuto después; quién leyó
r = await say(A, TC, 'mensage con error');
const EM = r.rows[0].id;
r = await as(A, 'update public.messages set body = $2 where id = $1 returning body, edited_at is not null ed', [EM, 'mensaje sin error']);
ok(!r.error && r.rows[0].body === 'mensaje sin error' && r.rows[0].ed, `A edita su mensaje recién mandado (queda marcado como editado) (${JSON.stringify(r.error || r.rows)})`);
r = await as(B, 'update public.messages set body = $2 where id = $1 returning body', [EM, 'B lo cambia']);
ok(r.error || r.rows.length === 0, 'B no edita el mensaje de A');
r = await as(A, 'update public.messages set user_id = $2 where id = $1', [EM, B]);
ok(!!r.error, 'solo se cambia el texto');
await db.query("update public.messages set created_at = now() - interval '2 minutes' where id = $1", [EM]);
r = await as(A, 'update public.messages set body = $2 where id = $1 returning body', [EM, 'tarde']);
ok(r.error || r.rows.length === 0, 'pasado el minuto ya no se edita');
r = await as(A, "update public.chat_reads set read_at = now() where user_id = $1 and chat_id = $2", [A, TC]);
await as(B, 'insert into public.chat_reads (chat_id, read_at) values ($1, now()) on conflict (user_id, chat_id) do update set read_at = now()', [TC]);
r = await as(A, 'select public.chat_reads_of($1) j', [TC]);
ok(!r.error && r.rows.some((x) => String(x.j).includes(B)), 'A ve hasta dónde leyó B (quién leyó)');
r = await as(null, 'select public.chat_reads_of($1) j', [TC]);
ok(r.error || r.rows.length === 0, 'sin sesión no se ven las lecturas');
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
  R2 = await rpc(null, "select public.roster('matias') j");
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
// target individual
{
  const Ag = (await db.query("select id from public.profiles where name='Melany Go'")).rows[0].id;
  let q = await as(M, "insert into public.user_targets (user_id, ym, ftds) values ($1, '2026-11', 20), ($2, '2026-11', 15) returning 1", [Ag, B]);
  ok(!q.error && q.rows.length === 2, 'el team leader fija el target de dos agentes');
  q = await as(Ag, "select user_id::text u, ftds from public.user_targets where ym = '2026-11'");
  ok(q.rows.length === 1 && q.rows[0].u === Ag && q.rows[0].ftds === 20, 'cada agente ve solo el suyo');
  q = await as(Ag, "update public.user_targets set ftds = 5 where user_id = $1 returning 1", [Ag]);
  ok(!!q.error || q.rows.length === 0, 'y no se lo cambia');
  q = await as(Ag, "insert into public.user_targets (user_id, ym, ftds) values ($1, '2026-12', 3)", [Ag]);
  ok(!!q.error, 'ni se pone uno');
  q = await as(M, "select count(*)::int c from public.user_targets where ym = '2026-11'");
  ok(q.rows[0].c === 2, 'el team leader ve los de todos');
  q = await as(M, "update public.user_targets set ftds = 22 where user_id = $1 and ym = '2026-11' returning ftds", [Ag]);
  ok(!q.error && q.rows[0].ftds === 22, 'y los cambia');
  q = await as(null, 'select * from public.user_targets');
  ok(!!q.error || q.rows.length === 0, 'sin sesión no se ven');
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
// datos compartidos (una foto de una tarjeta) y avisos del team leader o un administrador
r = await as(A, 'insert into public.chat_cards (chat_id, title, html) values ($1, $2, $3) returning id::text', [G, 'Campaña caliente', '<section class="card"><h3>Campaña caliente</h3></section>']);
ok(!r.error, 'A comparte una tarjeta en el grupo');
const K1 = r.rows && r.rows[0].id;
r = await as(M, 'select title, html from public.chat_cards where id = $1', [K1]);
ok(r.rows.length === 1 && r.rows[0].title === 'Campaña caliente', 'Matias (del grupo) la ve');
r = await as(B, 'select 1 from public.chat_cards where id = $1', [K1]);
ok(r.rows.length === 0, 'B (que no está en el grupo) no la ve');
r = await as(B, 'insert into public.chat_cards (chat_id, title, html) values ($1, $2, $3)', [G, 'x', 'x']);
ok(!!r.error, 'B no comparte en un grupo donde no está');
r = await say(M, G, `[card:${K1}] Campaña caliente`);
ok(!!r.error, 'no se manda la tarjeta de otro');
r = await say(A, TC, `[card:${K1}] Campaña caliente`);
ok(!!r.error, 'ni en otro chat');
r = await say(A, G, `[card:${K1}] Campaña caliente\nmiren esto`);
ok(!r.error, 'A manda la tarjeta con un comentario');
const roleB = (await db.query('select role from public.profiles where id = $1', [B])).rows[0].role;
r = await as(B, 'insert into public.messages (chat_id, body, aviso) values ($1, $2, true) returning id', [TC, 'Aviso de prueba']);
ok(roleB === 'agent' && !!r.error && /AVISO/.test(r.error), `un agente no manda avisos (${roleB}: ${r.error})`);
r = await as(M, 'insert into public.messages (chat_id, body, aviso) values ($1, $2, true) returning aviso', [TC, 'Hoy cierra temprano']);
ok(!r.error && r.rows[0].aviso === true, 'el team leader manda un aviso a toda la mesa');
r = await as(B, "select aviso from public.messages where body = 'Hoy cierra temprano'");
ok(r.rows.length === 1 && r.rows[0].aviso === true, 'y a los de la mesa les llega como aviso');
r = await as(M, "update public.messages set aviso = false where body = 'Hoy cierra temprano' returning 1");
ok(!!r.error || r.rows.length === 0, 'un aviso no se cambia después');
r = await as(A, 'delete from public.messages where id = $1', [(await db.query("select id from public.messages where body like '[card:%'")).rows[0].id]);
ok((await db.query('select count(*)::int c from public.chat_cards where id = $1', [K1])).rows[0].c === 0, 'al borrar el mensaje se borra la tarjeta');
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
r = await as(A, 'update public.messages set body = $2 where chat_id = $1 and user_id <> $3 returning id', [TC, 'editado', A]);
ok(!r.error && r.rows.length === 0, 'los mensajes de otros no se editan');
// leídos y silenciar
r = await as(B, 'insert into public.chat_reads (chat_id, read_at, muted) values ($1, now(), true) on conflict (user_id, chat_id) do update set muted = true returning muted', [TC]);
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
ok(r.rows.length === 1, 'alguien de otra mesa también lo ve (los globales son de la empresa)');

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

// ---------- clientes del CRM: solo news (New y Talking) y FTDs ----------
{
  const rows = [
    { id: '900001', brand: 'Novara Markets', name: 'Ana Uno', country: 'Peru', status: 'New', reg: '2026-11-19 10:02', agent: 'Sofia Arias', camp: 'Google ES', aff: '88843' },
    { id: '900002', brand: 'Novara Markets', name: 'Beto Dos', status: 'Talking', reg: '19/11/2026' },
    { id: '900003', status: 'Do Not Call' },
    { id: '900004', status: 'call again' },
    { id: '900005', status: 'Raro raro' },
    { id: '900007', status: 'FTD' },
    { id: '900008', ftd: '2026-11-19 10:15' },
    { id: ' ', status: 'New' },
  ];
  R = await rpc(B, 'select public.crm_seen($1::jsonb) j', [JSON.stringify(rows)]);
  ok(R && R.ok && R.new === 4 && R.changed === 0 && R.fresh.length === 2 && R.fresh[0] === '900001', `crm_seen guarda los New, los Talking y los FTD; cualquier otro status no entra (${JSON.stringify(R)})`);
  r = await as(B, 'select client_id, brand, status, status_group g, reg, crm_agent, camp, ftd_at, (first_seen_by = $1) mio from public.crm_clients order by client_id', [B]);
  const G = Object.fromEntries(r.rows.map((x) => [x.client_id, x]));
  ok(r.rows.length === 4 && G['900001'].g === 'new' && G['900002'].g === 'new' && G['900007'].g === 'ftd' && G['900008'].g === 'ftd' && G['900008'].status === 'FTD' && G['900008'].ftd_at === '2026-11-19 10:15', 'New y Talking son new; FTD (por status o por la hora del depósito) es ftd');
  ok(G['900001'].reg === '2026-11-19 10:02' && G['900002'].reg === null && G['900003'] == null && G['900001'].crm_agent === 'Sofia Arias' && G['900001'].camp === 'Google ES' && G['900001'].mio, 'guarda registro, agente, campaña y quién lo vio; un registro con otro formato queda vacío; un Do Not Call no entra');
  r = await as(B, 'select count(*)::int c from public.crm_status_log');
  ok(r.rows[0].c === 4, 'el historial arranca con el primer status de cada uno');
  R = await rpc(Dh, 'select public.crm_seen($1::jsonb) j', [JSON.stringify(rows)]);
  ok(R.new === 0 && R.changed === 0, 'ver lo mismo otra vez no cambia nada');
  // otro status para un new: dejó de ser new (no se guarda cuál)
  R = await rpc(Dh, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: '900001', brand: 'Novara Markets', status: 'No Answer', agent: 'Sofia Arias' }])]);
  r = await as(Dh, "select status, status_group g, left_new_at is not null salio, camp, (last_seen_by = $1) d, (select count(*)::int from public.crm_status_log where client_id = '900001') l from public.crm_clients where client_id = '900001'", [Dh]);
  ok(R.changed === 1 && r.rows[0].status === 'New' && r.rows[0].g === 'new' && r.rows[0].salio && r.rows[0].camp === 'Google ES' && r.rows[0].d && r.rows[0].l === 1, `un new visto con otro status deja de ser new (left_new_at) sin guardar el status ni anotarlo (${JSON.stringify(r.rows[0])})`);
  // "los new solo son new una vez": el que dejó New no vuelve, aunque el CRM lo ponga otra vez en New o en Talking
  R = await rpc(Dh, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: '900001', brand: 'Novara Markets', status: 'New', agent: 'Otro Rep', note: 'volvió' }])]);
  r = await as(Dh, "select status, left_new_at is not null salio, crm_agent, note, (select count(*)::int from public.crm_status_log where client_id = '900001') l from public.crm_clients where client_id = '900001'");
  ok(R.bad === 0 && R.changed === 0 && r.rows[0].salio && r.rows[0].crm_agent === 'Otro Rep' && r.rows[0].note === 'volvió' && r.rows[0].l === 1, `vuelto a New: sigue fuera de los new (la fila sí se toma: agente, nota) (${JSON.stringify(r.rows[0])})`);
  // la columna "Status" de registro o de una transacción (Full Registration, Success…) no es su status
  R = await rpc(Dh, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: '900002', brand: 'Novara Markets', status: 'Full Registration', camp: 'Google ES' }, { id: '900050', brand: 'Novara Markets', status: 'Success' }])]);
  r = await as(Dh, "select (select status from public.crm_clients where client_id = '900002') s, (select count(*)::int from public.crm_clients where client_id = '900050') n, (select camp from public.crm_clients where client_id = '900002') c");
  ok(R.changed === 0 && R.new === 0 && r.rows[0].s === 'Talking' && r.rows[0].n === 0 && r.rows[0].c === 'Google ES', `"Full Registration" o "Success" no son su status: no cambia, y uno nuevo así no entra (${JSON.stringify(R)})`);
  R = await rpc(Dh, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: '900002', brand: 'Novara Markets', status: 'Hablando' }])]);
  ok(R.changed === 0, 'el CRM en español ("Hablando") es el mismo status que en inglés');
  // desaparecer de la lista de news: dejó de ser new (New o Talking)
  await rpc(B, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: '900009', brand: 'Novara Markets', status: 'Talking' }, { id: '900010', brand: 'Novara Markets', status: 'New' }])]);
  R = await rpc(B, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: '900009', brand: 'Novara Markets', gone: 1 }, { id: '900010', brand: 'Novara Markets', gone: 1 }, { id: '900007', brand: 'Novara Markets', gone: 1 }])]);
  r = await as(B, "select client_id, status, left_new_at is not null salio from public.crm_clients where client_id in ('900009','900010','900007') order by client_id");
  ok(R.changed === 2 && !r.rows[0].salio && r.rows[1].salio && r.rows[2].salio && r.rows[1].status === 'Talking', 'un New o un Talking que desapareció de la lista de news queda como que salió (un FTD no se toca)');
  R = await rpc(Dh, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: '900009', brand: 'Novara Markets', status: 'Talking' }])]);
  r = await as(B, "select left_new_at is not null salio from public.crm_clients where client_id = '900009'");
  ok(R.changed === 0 && r.rows[0].salio, 'y si vuelve a aparecer como Talking, sigue fuera (new una sola vez)');
  R = await rpc(Dh, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: '900010', brand: 'Novara Markets', status: 'FTD', ftd: '2026-11-20 09:00' }])]);
  r = await as(B, "select status, status_group g, ftd_at from public.crm_clients where client_id = '900010'");
  ok(R.changed === 1 && r.rows[0].g === 'ftd' && r.rows[0].ftd_at === '2026-11-20 09:00', 'un new que depositó pasa a FTD');
  r = await as(B, "insert into public.crm_clients (brand, client_id) values ('Novara Markets', '1')");
  ok(!!r.error, 'nadie escribe directo en crm_clients');
  r = await as(B, "update public.crm_clients set status = 'x' returning 1");
  ok(!!r.error || r.rows.length === 0, 'ni lo cambia a mano');
  r = await as(B, 'delete from public.crm_status_log returning 1');
  ok(!!r.error || r.rows.length === 0, 'ni borra el historial');
  r = await as(X, 'select * from public.crm_clients');
  ok(!r.error && r.rows.length === 0, 'otra mesa no ve los clientes');
  R = await rpc(B, 'select public.crm_seen($1::jsonb) j', [JSON.stringify(Array.from({ length: 501 }, (_, i) => ({ id: 'z' + i, status: 'New' })))]);
  ok(!!R.error, 'de a 500 filas como máximo');
  R = await rpc(B, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: '70936', status: 'New', call: '2026-11-19 09:45', note: 'NA 3.1' }, { id: '70759', status: 'New', call: '19/11/2026 09:46' }, { id: '70604', status: 'Talking', note: 'x'.repeat(300) }])]);
  r = await as(B, "select client_id, last_call, note from public.crm_clients where client_id in ('70936','70759','70604') order by client_id");
  const N = Object.fromEntries(r.rows.map((x) => [x.client_id, x]));
  ok(N['70936'].last_call === '2026-11-19 09:45' && N['70936'].note === 'NA 3.1' && N['70759'].last_call === null && N['70604'].note.length === 200, 'guarda el último contacto y la última nota (otro formato de fecha queda vacío; la nota, hasta 200)');
  await rpc(B, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: '70936', status: 'New', call: '2026-11-19 11:02' }])]);
  r = await as(B, "select last_call, note from public.crm_clients where client_id = '70936'");
  ok(r.rows[0].last_call === '2026-11-19 11:02' && r.rows[0].note === 'NA 3.1', 'un contacto nuevo actualiza la hora y no borra la nota');
  // FTD, desk y rotaciones
  await rpc(B, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: 'R1', status: 'New', agent: 'Ana Uno', desk: 'Team Matías' }])]);
  await rpc(B, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: 'R1', status: 'New', agent: 'Beto Dos' }])]);
  await rpc(B, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: 'R1', agent: 'beto dos', ftd: '2026-11-19 10:15' }])]);
  r = await as(B, "select crm_agent, ftd_at, desk, status_group g from public.crm_clients where client_id = 'R1'");
  ok(r.rows[0].crm_agent === 'beto dos' && r.rows[0].ftd_at === '2026-11-19 10:15' && r.rows[0].desk === 'Team Matías' && r.rows[0].g === 'ftd', 'guarda el agente actual, la hora del FTD (y pasa a ftd) y el desk');
  r = await as(B, "select old_agent, new_agent, status from public.crm_agent_log where client_id = 'R1'");
  ok(r.rows.length === 1 && r.rows[0].old_agent === 'Ana Uno' && r.rows[0].new_agent === 'Beto Dos' && r.rows[0].status === 'New', 'una rotación queda anotada una vez (mayúsculas no cuentan)');
  // la conversión del new es del primero que lo llamó: si lo rotan antes de llamarlo, del que lo llama
  await rpc(B, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: 'F1', status: 'New', agent: 'Ana Uno' }, { id: 'F2', status: 'New', agent: 'Ana Uno' }])]);
  await rpc(B, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: 'F1', status: 'New', agent: 'Beto Dos' }, { id: 'F2', status: 'Talking', agent: 'Ana Uno' }])]);
  await rpc(B, 'select public.crm_seen($1::jsonb) j', [JSON.stringify([{ id: 'F1', status: 'No Answer', agent: 'Beto Dos' }, { id: 'F2', status: 'No Answer', agent: 'Beto Dos' }])]);
  r = await as(B, "select client_id, first_agent, first_call_at is not null t, left_new_at is not null salio from public.crm_clients where client_id in ('F1','F2') order by client_id");
  ok(r.rows[0].first_agent === 'Beto Dos' && r.rows[1].first_agent === 'Ana Uno' && r.rows[0].t && r.rows[1].t && r.rows[0].salio && r.rows[1].salio, `primer agente: rotado antes de llamarlo → el que llamó; llamado y después rotado → el primero (${JSON.stringify(r.rows)})`);
  r = await as(B, "insert into public.crm_agent_log (team_id, brand, client_id) values (public.my_team(), 'x', 'y')");
  ok(!!r.error, 'nadie escribe las rotaciones a mano');
  // registro de accesos
  r = await as(B, "insert into public.sales (date, client_id, amount, tx) values ('2026-11-19', '900009', 100, 'TXAUD1') returning id");
  const sid = r.rows[0].id;
  await as(M, 'update public.sales set amount = 120 where id = $1', [sid]);
  r = await as(M, "select action, detail->>'client_id' c, detail->'campos' campos from public.audit_log where action = 'venta ajena editada' and detail->>'client_id' = '900009'");
  ok(r.rows.length === 1 && JSON.stringify(r.rows[0].campos) === '["amount"]', 'editar una venta ajena queda registrado, con qué campo cambió');
  await as(B, 'update public.sales set amount = 130 where id = $1', [sid]);
  r = await as(M, "select count(*)::int c from public.audit_log where detail->>'client_id' = '900009'");
  ok(r.rows[0].c === 1, 'editar la propia no');
  r = await as(B, 'select * from public.audit_log');
  ok(!r.error && r.rows.length === 0, 'un agente no ve el registro de accesos');
  R = await rpc(B, "select public.audit_note('exportó ventas', '{\"filas\": 3}'::jsonb) j");
  ok(R.ok, 'exportar queda registrado');
  R = await rpc(B, "select public.audit_note('cualquier cosa') j");
  ok(!!R.error, 'solo acciones conocidas');
  r = await as(A, "select count(*)::int c from public.audit_log where action = 'exportó ventas'");
  ok(r.rows[0].c === 1, 'el admin lo ve');
  await as(B, 'delete from public.sales where id = $1', [sid]);
}

// ---------- banking ----------
{
  let q = await as(B, "insert into public.processors (name) values ('Proc agente') returning id");
  ok(!!q.error, 'un agente no carga procesadores');
  q = await as(C, "insert into public.processors (name, countries) values ('Kushki', '{Chile,Colombia}') returning id");
  ok(!q.error, 'el team leader carga un procesador');
  const pid = q.rows[0].id;
  q = await as(A, "insert into public.methods (processor_id, name, kind, country) values ($1, 'Efectivo raro', 'cheque', 'Chile') returning id", [pid]);
  ok(!!q.error, 'el tipo de pago es efectivo, transferencia o tarjeta');
  // Banking 3: el método es un renglón del procesador con su país; el mismo nombre en otro país convive
  q = await as(A, "insert into public.methods (processor_id, name, kind, country) values ($1, 'Transferencia', 'transferencia', 'Chile'), ($1, 'Tarjeta', 'tarjeta', 'Chile'), ($1, 'Tarjeta', 'tarjeta', 'Colombia') returning id, name, country", [pid]);
  ok(!q.error && q.rows.length === 3, 'el admin carga métodos adentro del procesador, uno por país');
  const M = Object.fromEntries(q.rows.map((x) => [x.name + ':' + x.country, x.id]));
  q = await as(A, "insert into public.methods (processor_id, name, kind, country) values ($1, 'tarjeta', 'tarjeta', 'Chile') returning id", [pid]);
  ok(!!q.error, 'pero no dos veces el mismo método en el mismo país');
  q = await as(A, "insert into public.methods (processor_id, name, kind, country) values ($1, 'Banco Popular', 'efectivo', 'Costa Rica'), ($1, 'Banco Popular', 'transferencia', 'Costa Rica') returning id", [pid]);
  ok(!q.error && q.rows.length === 2, 'el mismo nombre con otro tipo sí (Banco Popular efectivo y digital)');
  await as(A, 'delete from public.methods where id = any($1)', [q.rows.map((x) => x.id)]);
  q = await as(B, "insert into public.methods (processor_id, name, kind, country) values ($1, 'Nequi', 'transferencia', 'Colombia') returning id", [pid]);
  ok(!!q.error, 'un agente no carga métodos');
  q = await as(C, "insert into public.processors (name, parent_id) values ('Cash', $1) returning id", [pid]);
  ok(!q.error, 'un sub-procesador adentro de un procesador (parent_id)');
  const rid = q.rows[0].id;
  q = await as(A, "insert into public.methods (processor_id, name, kind, country) values ($1, 'OXXO', 'efectivo', 'México') returning id", [rid]);
  ok(!q.error, 'con sus propios métodos');
  const oxxo = q.rows[0].id;
  // el orden, arrastrando: pay_order
  q = await as(A, 'select public.pay_order($1, $2::uuid[], $3) j', ['method', [M['Tarjeta:Chile'], M['Transferencia:Chile']], pid]);
  ok(!q.error, 'el admin ordena los métodos de una caja');
  q = await as(B, 'select name from public.methods where processor_id = $1 and country = $2 order by sort', [pid, 'Chile']);
  ok(q.rows.map((x) => x.name).join(',') === 'Tarjeta,Transferencia', 'y quedan en ese orden');
  q = await as(A, 'select public.pay_order($1, $2::uuid[], $3) j', ['method', [oxxo], pid]);
  q = await as(B, 'select processor_id from public.methods where id = $1', [oxxo]);
  ok(q.rows[0].processor_id === pid, 'un método arrastrado a otra caja cambia de caja');
  await as(A, 'select public.pay_order($1, $2::uuid[], $3) j', ['method', [oxxo], rid]);
  q = await as(B, 'select public.pay_order($1, $2::uuid[]) j', ['proc', [pid]]);
  ok(!!q.error, 'un agente no ordena');
  q = await as(A, 'select public.pay_report_many($1, array[$2, $3]::uuid[], true, $4) j', [pid, M['Tarjeta:Chile'], M['Transferencia:Chile'], 'los dos caídos']);
  ok(!q.error && q.rows[0].j.ok, 'se reportan dos métodos a la vez');
  q = await as(B, "select (select count(*)::int from public.methods where processor_id = $1 and status = 'falla') f, (select cardinality(method_ids) from public.pay_incidents order by created_at desc limit 1) n", [pid]);
  ok(q.rows[0].f === 2 && q.rows[0].n === 2, 'los dos quedan en falla y hay un solo aviso con los dos');
  await as(A, 'select public.pay_report_many($1, array[$2, $3]::uuid[], false, null) j', [pid, M['Tarjeta:Chile'], M['Transferencia:Chile']]);
  await as(C, 'delete from public.processors where id = $1', [rid]);
  await db.query('delete from public.pay_incidents');
  q = await as(B, 'select public.pay_report($1, null, true, $2) j', [pid, 'caído']);
  ok(!!q.error, 'un agente no reporta fallas');
  q = await as(A, 'select public.pay_report($1, $2, true, $3) j', [pid, '00000000-0000-0000-0000-000000000001', 'no']);
  ok(!!q.error && /METODO/.test(q.error), 'no se reporta un método que el procesador no tiene');
  q = await as(A, 'select public.pay_report($1, $2, true, $3) j', [pid, M['Tarjeta:Chile'], 'rechaza todas']);
  ok(!q.error && q.rows[0].j.ok, 'el admin reporta que falla un método');
  q = await as(C, 'select public.pay_report($1, null, true, null) j', [pid]);
  q = await as(B, "select status, (select status from public.methods where id = $2) ms, (select status from public.methods where id = $3) ms2, (select count(*)::int from public.pay_incidents) n from public.processors p where id = $1", [pid, M['Tarjeta:Chile'], M['Tarjeta:Colombia']]);
  ok(q.rows[0].status === 'falla' && q.rows[0].ms === 'falla' && q.rows[0].ms2 === 'ok' && q.rows[0].n === 2, 'el agente ve el procesador y el método con falla (la Tarjeta de Colombia sigue bien), y las dos fallas en el historial');
  await as(A, 'select public.pay_report($1, null, false, null) j', [pid]);
  q = await as(B, 'select status, status_note from public.processors where id = $1', [pid]);
  ok(q.rows[0].status === 'ok' && q.rows[0].status_note === null, 'volvió a andar');
  // fallas por país
  const fst = async () => (await as(B, 'select status, fail_countries, status_note from public.processors where id = $1', [pid])).rows[0];
  await as(A, "select public.pay_report($1, null, true, 'caído en Chile', array['Chile']) j", [pid]);
  let f = await fst();
  ok(f.status === 'falla' && JSON.stringify(f.fail_countries) === '["Chile"]', 'una falla puede ser solo en un país');
  await as(A, "select public.pay_report($1, null, true, null, array['Perú']) j", [pid]);
  f = await fst();
  ok(JSON.stringify(f.fail_countries) === '["Chile","Perú"]', 'otra falla en otro país se suma');
  await as(A, "select public.pay_report($1, null, false, null, array['Chile']) j", [pid]);
  f = await fst();
  ok(f.status === 'falla' && JSON.stringify(f.fail_countries) === '["Perú"]' && f.status_note === 'caído en Chile', 'vuelve en un país y sigue fallando en el otro');
  q = await as(B, 'select countries from public.pay_incidents order by created_at desc limit 1');
  ok(JSON.stringify(q.rows[0].countries) === '["Chile"]', 'el historial guarda en qué país');
  await as(A, "select public.pay_report($1, null, false, null, array['Perú']) j", [pid]);
  f = await fst();
  ok(f.status === 'ok' && f.fail_countries.length === 0 && f.status_note === null, 'cuando vuelve en todos, anda');
  await as(A, 'select public.pay_report($1, null, true, null) j', [pid]);
  await as(A, "select public.pay_report($1, null, false, null, array['Chile']) j", [pid]);
  f = await fst();
  ok(f.status === 'falla' && f.fail_countries.length > 0 && !f.fail_countries.includes('Chile'), `si fallaba en todos y vuelve en uno, sigue fallando en los demás (${f.fail_countries})`);
  await as(A, 'select public.pay_report($1, null, false, null) j', [pid]);
  q = await as(B, "insert into public.pay_incidents (team_id, processor_id, kind) values (public.my_team(), $1, 'falla')", [pid]);
  ok(!!q.error, 'nadie escribe el historial a mano');
  q = await as(C, `insert into public.banks (name, country, steps, use_pm, avoid_pm) values ('Falabella', 'Chile', '["Pagar con tarjeta"]', $1::jsonb, $2::jsonb) returning id`, [JSON.stringify([{ m: M['Tarjeta:Chile'] }]), JSON.stringify([{ m: M['Transferencia:Chile'] }])]);
  ok(!q.error, 'el team leader arma el flujo recomendado de un banco');
  q = await as(B, "update public.banks set notes = 'x' returning 1");
  ok(!!q.error || q.rows.length === 0, 'un agente no lo cambia');
  q = await as(A, "insert into public.pay_files (ref_kind, ref_id, mime, data) values ('bank', $1, 'image/webp', 'AAAA') returning 1", [pid]);
  ok(!q.error, 'fotos: el admin sube una');
  q = await as(B, "insert into public.pay_files (ref_kind, ref_id, mime, data) values ('bank', $1, 'image/webp', 'AAAA') returning 1", [pid]);
  ok(!!q.error, 'un agente no sube fotos');
}

// ---------- ficha: campañas y comentarios ----------
{
  let q = await as(B, "insert into public.campaign_info (aff, camp, country, min_amount, ad_text) values ('108887', 'Nitivalori', 'Colombia', '250 USD', 'Ganá con IA') returning 1");
  ok(!q.error, 'un agente carga la campaña que falta');
  q = await as(B, "insert into public.campaign_info (aff, camp, country, min_amount) values ('108887', 'Nitivalori', 'Colombia', '1 USD') returning 1");
  ok(!!q.error, 'si ya está cargada no se pisa');
  q = await as(B, "update public.campaign_info set min_amount = '1 USD' where camp = 'Nitivalori' returning 1");
  ok(!!q.error || q.rows.length === 0, 'el agente no la cambia: pide el cambio');
  q = await as(B, "insert into public.campaign_requests (aff, camp, country, body) values ('108887', 'Nitivalori', 'Colombia', 'Ahora el mínimo es 300') returning id");
  ok(!q.error, 'y el pedido de cambio queda');
  const rid = q.rows[0].id;
  q = await as(Dh, 'select count(*)::int c from public.campaign_requests');
  ok(q.rows[0].c === 0, 'otro agente no ve el pedido');
  q = await as(C, "update public.campaign_info set min_amount = '300 USD', updated_by = auth.uid() where camp = 'Nitivalori' returning 1");
  ok(!q.error && q.rows.length === 1, 'el team leader la cambia');
  q = await as(C, 'update public.campaign_requests set done = true, done_by = auth.uid(), done_at = now() where id = $1 returning 1', [rid]);
  ok(!q.error && q.rows.length === 1, 'y marca el pedido como hecho');
  q = await as(B, "insert into public.client_comments (client_id, body) values ('70370', 'Paga el viernes') returning id");
  ok(!q.error, 'un agente comenta un cliente');
  const cid = q.rows[0].id;
  q = await as(Dh, "select body from public.client_comments where client_id = '70370'");
  ok(q.rows.length === 1, 'la mesa ve el comentario');
  q = await as(Dh, 'delete from public.client_comments where id = $1 returning 1', [cid]);
  ok(!!q.error || q.rows.length === 0, 'otro agente no lo borra');
  q = await as(B, "update public.client_comments set body = 'x' where id = $1 returning 1", [cid]);
  ok(!!q.error, 'los comentarios no se editan');
  q = await as(B, 'delete from public.client_comments where id = $1 returning 1', [cid]);
  ok(!q.error && q.rows.length === 1, 'el autor lo borra');
}

// ---------- llamadas (toques en Omega, Gizat, Voiso) ----------
{
  const now = new Date(), iso = (ms) => new Date(now.getTime() + ms).toISOString();
  let q = await as(B, "insert into public.calls (client_id, line) values ('70370', 'omega') returning 1");
  ok(!!q.error, 'nadie escribe directo en calls');
  let R = await rpc(B, 'select public.calls_add($1::jsonb) j', [JSON.stringify([
    { id: '70370', line: 'omega', at: iso(0) }, { id: '70370', line: 'omega', at: iso(10000) }, { id: '70370', line: 'gizat', at: iso(12000) },
    { id: '70370', line: 'Voiso', at: iso(15000) }, { id: '70370', line: 'skype' }, { id: '', line: 'omega' }, { id: '70371', line: 'omega', at: '2001-01-01T00:00:00Z' }])]);
  ok(R.ok && R.added === 4, `calls_add guarda cada línea; el mismo toque a la misma línea en menos de 30 s cuenta uno; otra línea sí cuenta (${JSON.stringify(R)})`);
  R = await rpc(B, 'select public.calls_add($1::jsonb) j', [JSON.stringify([{ id: '70370', line: 'omega', at: iso(60000) }])]);
  ok(R.added === 1, 'pasados los 30 s, otra llamada a la misma línea cuenta');
  q = await as(B, "select at > now() - interval '1 minute' reciente from public.calls where client_id = '70371'");
  ok(q.rows.length === 1 && q.rows[0].reciente, 'una hora imposible queda como ahora');
  q = await as(Dh, "select user_id = $1 mio, line from public.calls where client_id = '70370'", [B]);
  ok(q.rows.length === 4 && q.rows.every((x) => x.mio), 'la mesa ve las llamadas de cada uno');
  q = await as(X, 'select * from public.calls');
  ok(q.rows.length === 0, 'otra mesa no las ve');
  q = await as(B, 'delete from public.calls returning 1');
  ok(!!q.error || q.rows.length === 0, 'no se borran');
  R = await rpc(B, 'select public.set_min_calls(200) j');
  ok(!!R.error, 'un agente no cambia el mínimo de llamadas');
  R = await rpc(M, 'select public.set_min_calls(200) j');
  q = await as(B, 'select min_calls from public.teams');
  ok(R.ok && q.rows[0].min_calls === 200, 'el team leader fija el mínimo de llamadas');
  await rpc(M, 'select public.set_min_calls(250) j');
}

// ---------- palabra clave de confidencialidad del cliente ----------
{
  let q = await as(B, "insert into public.client_keywords (client_id, kw) values ('70390','azul') returning 1");
  ok(!!q.error, 'nadie escribe directo en client_keywords');
  let R = await rpc(B, "select public.client_kw_set('70390','Novara Markets','  Montevideo  ') j");
  ok(!R.error && R.ok && R.kw === 'Montevideo', 'client_kw_set guarda la palabra clave (sin espacios de más)');
  q = await as(Dh, "select kw from public.client_keywords where client_id='70390'");
  ok(q.rows.length === 1 && q.rows[0].kw === 'Montevideo', 'la mesa la ve');
  R = await rpc(B, "select public.client_kw_set('70390','Novara Markets','Colonia') j");
  q = await as(B, "select count(*)::int n, max(kw) k from public.client_keywords where client_id='70390'");
  ok(q.rows[0].n === 1 && q.rows[0].k === 'Colonia', 'editar pisa la misma (una por cliente)');
  R = await rpc(B, "select public.client_kw_set('70390','Novara Markets','') j");
  q = await as(B, "select count(*)::int n from public.client_keywords where client_id='70390'");
  ok(!R.error && R.kw === null && q.rows[0].n === 0, 'vacía la borra');
  await rpc(B, "select public.client_kw_set('70390','Novara Markets','Rocha') j");
  q = await as(X, 'select * from public.client_keywords');
  ok(q.rows.length === 0, 'otra mesa no la ve');
  await db.query("delete from public.client_keywords where client_id='70390'");
}

// ---------- estación: el Chrome del team leader avisa cómo le fue con cada vista del CRM ----------
{
  const ts = new Date().toISOString();
  let q = await as(M, "insert into public.station_state (team_id, vista) values ((select team_id from public.profiles where id = auth.uid()), 'news') returning 1");
  ok(!!q.error, 'nadie escribe directo en station_state');
  let R = await rpc(B, "select public.station_beat('[]'::jsonb) j");
  ok(!!R.error, 'un agente no puede latir como estación');
  R = await rpc(M, 'select public.station_beat($1::jsonb) j', [JSON.stringify([
    { vista: 'news', ok: ts, try: ts, n: 3, statuses: { New: 2, Talking: 1 } },
    { vista: 'trx', try: ts, n: 0, problem: 'login' },
    { vista: 'cola', ok: ts, try: ts, n: 8 },
    { vista: 'nada', n: 1 },
  ])]);
  ok(!R.error && R.n === 2, 'el team leader late con sus dos vistas (news y trx; las demás ya no existen)');
  q = await as(B, 'select vista, n, total, off_pct, problem, last_ok is not null ok from public.station_state order by vista');
  const S = Object.fromEntries(q.rows.map((x) => [x.vista, x]));
  ok(q.rows.length === 2 && S.news.problem === '' && S.news.off_pct === 0, 'la mesa ve el estado de cada vista');
  ok(S.trx.problem === 'login' && !S.trx.ok, 'una vista sin sesión del CRM queda marcada, sin lectura buena');
  R = await rpc(M, 'select public.station_beat($1::jsonb) j', [JSON.stringify([{ vista: 'news', ok: ts, try: ts, n: 6, statuses: { New: 1, CallBack: 5 } }])]);
  q = await as(B, 'select vista, off_pct, problem, last_ok is not null ok from public.station_state');
  ok(!R.error && q.rows.length === 1 && q.rows[0].vista === 'news' && q.rows[0].off_pct === 83 && q.rows[0].problem === 'filtro', 'las vistas que ya no vienen salen; la de news llena de otros status perdió el filtro');
  R = await rpc(M, 'select public.station_beat($1::jsonb) j', [JSON.stringify([{ vista: 'news', try: ts, n: 0, ok: 'mañana' }])]);
  q = await as(B, 'select last_ok is not null ok from public.station_state');
  ok(!R.error && q.rows[0].ok, 'una hora rara no borra la última lectura buena');
  q = await as(X, 'select * from public.station_state');
  ok(q.rows.length === 0, 'otra mesa no ve la estación');
  await rpc(M, "select public.station_beat('[]'::jsonb) j");
  ok((await db.query('select count(*)::int c from public.station_state')).rows[0].c === 0, 'sin vistas, la estación queda vacía');
}

// ---------- la extensión de prueba: código de mesa + nombre, solo news y llamadas, la campaña compartida ----------
{
  R = await rpc(B, "select public.trial_desk_create('Mesa Prueba') j");
  ok(!!R.error, 'un agente no crea mesas de prueba');
  await db.query("update public.profiles set global = true where id = $1", [A]);
  R = await rpc(A, "select public.trial_desk_create('Mesa Prueba') j");
  ok(R.ok && /^[A-Z0-9]{6}$/.test(R.code), `el dueño crea una mesa de prueba y recibe el código (${R.code})`);
  const CODE = R.code;
  R = await rpc(null, "select public.trial_join('ZZZZZZ', 'Pepe Rep', 'agent', 'dev1') j");
  ok(R.ok === false && /no existe/.test(R.err), 'un código que no existe no entra');
  R = await rpc(null, `select public.trial_join('${CODE.toLowerCase()}', 'Pepe Rep', 'agent', 'dev1') j`);
  ok(R.ok && R.desk === 'Mesa Prueba' && R.role === 'agent', 'con el código (en minúscula también) y el nombre entra, sin cuenta');
  await rpc(null, `select public.trial_join('${CODE}', 'Lider Prueba', 'tl', 'dev2') j`);
  const te = (await db.query("select public._trial_now_mvd() d")).rows[0].d;
  R = await rpc(null, `select public.trial_seen('${CODE}', 'Pepe Rep', $1::jsonb) j`, [JSON.stringify([
    { id: 'T1', name: 'Nuevo Uno', country: 'Peru', status: 'New', reg: te + ' 09:00', agent: 'Pepe Rep', camp: 'Finvera AI', aff: '97275' },
    { id: 'T2', name: 'De Otro', status: 'New', reg: te + ' 09:05', agent: 'Otro Rep' },
    { id: 'T3', name: 'Viejo', status: 'Call Again', reg: te + ' 08:00', agent: 'Pepe Rep' },
    { id: 'T4', status: 'Talking', reg: te + ' 09:10', agent: 'Pepe Rep' }])]);
  ok(R.ok && R.new === 3 && R.fresh.length === 1 && R.fresh[0].id === 'T1', `guarda los news; un Call Again no entra; avisa solo de los míos en New (${JSON.stringify(R)})`);
  r = await db.query("select client_id, status, first_call_at is not null c from public.trial_news where desk = $1 order by client_id", [CODE]);
  ok(r.rows.map((x) => x.client_id).join() === 'T1,T2,T4' && r.rows[2].c && !r.rows[0].c, 'T4 en Talking ya cuenta como llamado; T1 todavía no');
  R = await rpc(null, `select public.trial_seen('${CODE}', 'Pepe Rep', $1::jsonb) j`, [JSON.stringify([{ id: 'T1', ln: 'omega', at: new Date(Date.now()).toISOString() }, { id: 'T1', ln: 'omega', at: new Date(Date.now() + 5000).toISOString() }, { id: 'T1', ln: 'gizat', at: new Date(Date.now() + 9000).toISOString() }])]);
  r = await db.query("select (select count(*)::int from public.trial_calls where desk = $1) n, (select first_call_by from public.trial_news where desk = $1 and client_id = 'T1') by", [CODE]);
  ok(R.ok && r.rows[0].n === 2 && r.rows[0].by === 'Pepe Rep', `las llamadas se guardan (la misma línea en 30 s cuenta una) y marcan la primera llamada al new (${JSON.stringify(r.rows[0])})`);
  R = await rpc(null, `select public.trial_seen('${CODE}', 'Pepe Rep', $1::jsonb) j`, [JSON.stringify([{ id: 'T2', status: 'No Answer', agent: 'Otro Rep' }, { id: 'T4', gone: 1 }])]);
  r = await db.query("select client_id, left_new_at is not null l from public.trial_news where desk = $1 order by client_id", [CODE]);
  ok(R.changed === 2 && r.rows.map((x) => x.l).join() === 'false,true,true', 'otro status o desaparecer de la lista: dejó de ser new');
  R = await rpc(null, `select public.trial_seen('${CODE}', 'Pepe Rep', $1::jsonb) j`, [JSON.stringify([{ id: 'T2', status: 'New', agent: 'Pepe Rep' }])]);
  ok(R.new === 0 && R.fresh.length === 0 && (await db.query("select left_new_at is not null l from public.trial_news where desk = $1 and client_id = 'T2'", [CODE])).rows[0].l, 'new una sola vez: vuelto a New no vuelve ni avisa');
  R = await rpc(null, `select public.trial_board('${CODE}') j`);
  const pepe = (R.agents || []).find((a) => a.name === 'Pepe Rep');
  ok(R.ok && R.desk === 'Mesa Prueba' && R.news.length === 1 && R.news[0].id === 'T1' && R.news[0].called && typeof R.news[0].min === 'number', `el tablero: los que siguen en New, llamados o no, y hace cuánto (${JSON.stringify(R.news)})`);
  ok(pepe && pepe.news === 3 && pepe.called === 3 && pepe.calls === 2 && pepe.med != null, `y por agente: news de hoy, llamados, llamadas y la velocidad al new (${JSON.stringify(pepe)})`);
  // la info de la campaña: compartida entre todas las mesas (Team Matías la ve, y lo que cargan las de prueba también)
  await as(A, "insert into public.campaign_info (aff, camp, country, min_amount, ad_text) values ('97275', 'Banamex', 'México', '250 USD', 'Invertí con el banco')");
  R = await rpc(null, `select public.trial_camp_set('${CODE}', 'Pepe Rep', '97275', 'Finvera AI', 'México', '300 USD', 'Gana con IA') j`);
  ok(R.ok, 'una mesa de prueba carga el anuncio de una campaña');
  R = await rpc(null, `select public.trial_camp('${CODE}', '97275', 'Finvera AI', 'México') j`);
  ok(R.ok && R.camps.length === 2 && R.camps[0].camp === 'Finvera AI' && R.camps[0].mine && R.camps[0].min === '300 USD' && R.camps[1].camp === 'Banamex' && R.camps[1].min === '250 USD', `la ficha ve la del cliente primero y las otras del afiliador en su país, de cualquier mesa (${JSON.stringify(R.camps)})`);
  R = await rpc(null, `select public.trial_camp('${CODE}', null, null, null, 'T1') j`);
  ok(R.ok && R.aff === '97275' && R.cl && R.cl.name === null && R.country === 'Peru' && R.camps.length === 0, `con solo el ID del cliente: lo que la mesa sabe de él (y en Perú no hay anuncios cargados) (${JSON.stringify(R)})`);
  r = await db.query("select count(*)::int c from public.trial_news where desk = $1 and name is not null", [CODE]);
  ok(r.rows[0].c === 0, 'la base no guarda nombres de clientes (news de prueba)');
  r = await as(B, "select camp from public.campaign_info where aff = '97275' order by camp");
  ok(r.rows.length === 2, 'y Team Matías ve también lo que cargó la mesa de prueba (la info del anuncio se comparte)');
  R = await rpc(null, 'select public.trial_invite() j');
  ok(R && R.name === 'Joaquín Or', `la invitación dice quién invita (${R && R.name})`);
  R = await rpc(A, 'select public.trial_desks_list() j');
  ok(R.length === 1 && R[0].code === CODE && R[0].people === 2 && R[0].news_today === 3 && R[0].in_new === 1, `el dueño ve las mesas de prueba con su gente y sus news (${JSON.stringify(R)})`);
  R = await rpc(B, 'select public.trial_desks_list() j');
  ok(Array.isArray(R) && R.length === 0, 'un agente no las ve');
  r = await as(null, 'select * from public.trial_news');
  ok(!!r.error || r.rows.length === 0, 'anon no lee las tablas de prueba directo');
  r = await as(B, 'select * from public.trial_calls');
  ok(!!r.error || r.rows.length === 0, 'ni un agente');
  await db.query("update public.profiles set global = false where id = $1", [A]);
  await db.query("delete from public.trial_desks where code = $1", [CODE]);
  await db.query("delete from public.campaign_info where aff = '97275'");
}

// ---------- RMO por día ----------
{
  R = await rpc(B, 'select public.rmo_save($1::jsonb) j', [JSON.stringify([{ n: 120, talk: 600000, dead: 1800000, req: 240, q: 2, open: true }, { uid: A, n: 5, talk: 0, dead: 0, q: 3 }])]);
  ok(R && R.ok && R.n === 1, `un agente guarda su RMO del día, no el de otro (${JSON.stringify(R)})`);
  R = await rpc(M, 'select public.rmo_save($1::jsonb) j', [JSON.stringify([{ uid: A, n: 50, talk: 60000, dead: 3600000, req: 250, q: 3, open: false }, { uid: B, n: 130, talk: 600000, dead: 1700000, req: 240, q: 2, open: true }])]);
  ok(R && R.ok && R.n === 2, 'el team leader guarda el de todos');
  const qr = await as(A, 'select user_id, n, q, open from public.rmo_days order by n');
  ok(qr.rows.length === 2 && qr.rows[0].user_id === A && qr.rows[0].q === 3 && qr.rows[1].n === 130 && qr.rows[1].open === true, `la mesa lo lee; el último guardado pisa al anterior (${JSON.stringify(qr.rows)})`);
  R = await rpc(B, 'select public.rmo_save($1::jsonb) j', [JSON.stringify([{ date: '2020-01-01', n: 1 }])]);
  ok(R && R.n === 0, 'un día viejo no se guarda');
  r = await as(B, 'insert into public.rmo_days (user_id, date) values ($1, current_date)', [B]);
  ok(!!r.error, 'nadie escribe directo en rmo_days');
}

// ---------- Vitalis felicita las ventas de hoy ----------
{
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const n0 = (await db.query("select count(*)::int c from public.messages m join public.profiles p on p.id = m.user_id where p.bot")).rows[0].c;
  r = await as(C, "insert into public.sales (date, client_id, amount, tx) values ('2026-01-05','88001',100,'88001') returning id");
  ok(!r.error && (await db.query("select count(*)::int c from public.messages m join public.profiles p on p.id = m.user_id where p.bot")).rows[0].c === n0, 'una venta vieja no manda felicitación');
  r = await as(C, "insert into public.sales (date, client_id, amount, tx) values ($1,'88002',100,'88002') returning id", [hoy]);
  const bm = (await db.query("select m.body, m.chat_id, p.name, p.active, p.login from public.messages m join public.profiles p on p.id = m.user_id where p.bot order by m.created_at desc")).rows;
  ok(!r.error && bm.length === n0 + 1 && bm[0].name === 'Vitalis' && bm[0].chat_id === TC && bm[0].body.includes('Arlette'), `una venta de hoy: Vitalis felicita en el chat de la mesa (${bm[0] && bm[0].body})`);
  ok(bm[0] && bm[0].active === false && bm[0].login === null && !(await rpc(null, "select public.roster('matias') j")).people.some((p) => p.name === 'Vitalis'), 'Vitalis no entra ni aparece en la lista de nombres');
  r = await as(C, "insert into public.sales (date, client_id, amount, tx) values ($1,'88003',100,'88003') returning id", [hoy]);
  ok((await db.query("select count(*)::int c from public.profiles where bot")).rows[0].c === 1, 'es uno solo aunque haya más ventas');
  r = await as(A, 'select body from public.messages where chat_id = $1 order by created_at desc limit 1', [TC]);
  ok(!r.error && /Va \d+ este mes|Primera del mes/.test(r.rows[0].body), `la mesa lo lee, con cuántas va en el mes (${r.rows[0] && r.rows[0].body})`);
  await db.query("delete from public.sales where client_id in ('88001','88002','88003')");
}

// ---------- /vitalis: admin o team leader mandan un mensaje por Vitalis ----------
{
  R = await rpc(C, "select public.vitalis_say('Mensaje de un agente') j"); // C es team leader ahora
  const bot = (await db.query('select id from public.profiles where bot limit 1')).rows[0].id;
  let m = (await db.query('select body, chat_id, user_id from public.messages where user_id = $1 order by created_at desc limit 1', [bot])).rows[0];
  ok(!R.error && R.ok && m.body === 'Mensaje de un agente' && m.chat_id === TC, 'el team leader manda un mensaje por Vitalis, y va al chat de la mesa');
  R = await rpc(A, "select public.vitalis_say('Hola desde el admin') j");
  ok(!R.error && R.ok, 'el admin también');
  r = await as(B, "select public.vitalis_say('No deberían') j"); // B es agente
  ok(!!r.error && /administrador o el team leader/.test(r.error), `un agente no puede (${r.error})`);
  ok((await db.query("select count(*)::int c from public.messages where body = 'No deberían'")).rows[0].c === 0, 'y no quedó nada');
  R = await rpc(A, "select public.vitalis_say('   ') j");
  ok(!!R.error, 'un mensaje vacío no va');
  R = await rpc(A, "select public.vitalis_say('[img:x] trucho') j");
  ok(!!R.error && /solo texto/.test(R.error), 'Vitalis manda solo texto (no imágenes ni tarjetas)');
  R = await rpc(A, `select public.vitalis_say('A un grupo', '${G}') j`); // A está en el grupo G
  m = (await db.query('select chat_id from public.messages where body = $1', ['A un grupo'])).rows[0];
  ok(!R.error && m && m.chat_id === G, 'puede mandarlo a un chat puntual donde esté');
  await db.query("delete from public.messages where user_id = (select id from public.profiles where bot limit 1) and body in ('Mensaje de un agente','Hola desde el admin','A un grupo')");
}

// ---------- el cierre del día: day_close lo manda Vitalis al privado de cada team leader y admin, una vez por día ----------
{
  const bot = (await db.query('select id from public.profiles where bot limit 1')).rows[0].id;
  R = await rpc(C, "select public.day_close(current_date, 'Cierre del lunes\nFTDs de hoy: 3') j"); // C es team leader
  ok(!R.error && R.ok && !R.dup && R.n >= 2, `el team leader manda el cierre y Vitalis se lo escribe al team leader y al admin (${JSON.stringify(R)})`);
  let q = await db.query("select c.id, c.kind, c.dm_key from public.chats c join public.chat_members m on m.chat_id = c.id where m.user_id = $1 and c.kind = 'dm'", [bot]);
  ok(q.rows.length >= 2 && q.rows.every(x => x.dm_key && x.dm_key.includes(bot)), 'quedan privados con Vitalis');
  r = await as(C, "select body from public.messages where user_id = $1 and body like 'Cierre del lunes%'", [bot]);
  ok(!r.error && r.rows.length === 1, 'el team leader lo lee en su privado con Vitalis (uno solo)');
  r = await as(A, "select body from public.messages where user_id = $1 and body like 'Cierre del lunes%'", [bot]);
  ok(!r.error && r.rows.length === 1, 'el admin también');
  r = await as(B, "select body from public.messages where user_id = $1 and body like 'Cierre del lunes%'", [bot]);
  ok(!r.error && r.rows.length === 0, 'un agente no lo ve');
  R = await rpc(A, "select public.day_close(current_date, 'Otro cierre') j");
  ok(!R.error && R.ok && R.dup, 'el segundo del mismo día no se manda (dup)');
  ok((await db.query("select count(*)::int c from public.messages where body = 'Otro cierre'")).rows[0].c === 0, 'y no quedó nada');
  r = await as(B, "select public.day_close(current_date, 'De un agente') j");
  ok(!!r.error && /team leader o el administrador/.test(r.error), `un agente no puede (${r.error})`);
  R = await rpc(A, "select public.day_close(current_date - 10, 'Viejo') j");
  ok(!!R.error && /fuera de rango/i.test(R.error), 'una fecha vieja no va');
  r = await as(B, 'select date from public.day_closes');
  ok(!r.error && r.rows.length === 1, 'la mesa ve que el cierre de hoy ya se mandó');
  await db.query("delete from public.messages where user_id = $1 and body like 'Cierre del lunes%'", [bot]);
}

// ---------- el rol director: entra, ve los números de la mesa y nada más ----------
{
  R = await rpc(A, "select public.add_member('Dir Ector', 'director') j");
  ok(!R.error && R.ok, `el admin suma un director (${JSON.stringify(R)})`);
  const DR = R.id;
  r = await as(DR, 'select count(*)::int c from public.sales'); ok(!r.error && r.rows[0].c > 0, 'el director lee las ventas de la mesa');
  r = await as(DR, 'select count(*)::int c from public.crm_clients'); ok(!r.error, 'y los clientes del CRM');
  r = await as(DR, 'select count(*)::int c from public.rmo_days'); ok(!r.error, 'y el RMO guardado');
  r = await as(DR, 'select public.in_chat($1) ic', [TC]); ok(!r.error && r.rows[0].ic === false, 'no tiene chat, ni el de la mesa');
  r = await as(DR, 'select count(*)::int c from public.messages'); ok(!r.error && r.rows[0].c === 0, 'y no lee ningún mensaje');
  r = await as(DR, "select public.set_min_calls(100) j"); ok(!!r.error, 'no cambia nada de la mesa');
  r = await as(DR, "select public.day_close(current_date, 'x') j"); ok(!!r.error, 'ni cierres');
  r = await as(DR, "select public.vitalis_say('hola') j"); ok(!!r.error, 'ni habla por Vitalis');
  r = await as(DR, "update public.profiles set role = 'admin' where id = $1 returning role", [DR]); ok(r.error || r.rows.length === 0 || r.rows[0].role !== 'admin', 'no se hace admin solo');
  r = await as(A, "update public.profiles set role = 'gerente' where id = $1 returning role", [DR]); ok(!!r.error, 'un rol inventado no entra');
  await db.query("update public.profiles set active = false where id = $1", [DR]);
}

// ---------- varias mesas: slug, globales, crear mesa, cambiar de mesa, Gerencia de la empresa, lo compartido ----------
{
  ok((await db.query("select slug from public.teams where name = 'Team Matías'")).rows[0].slug === 'matias', 'la mesa de siempre tiene su slug: matias');
  await db.query("update public.teams set slug = 'otra' where id = $1", [t2]);
  R = await rpc(null, 'select public.roster(null) j');
  ok(R && R.teams && R.teams.length === 2 && !R.people, `sin slug y con dos mesas, la lista de mesas para elegir (${JSON.stringify(R)})`);
  R = await rpc(null, "select public.roster('otra') j");
  ok(R && R.slug === 'otra' && R.people.some((p) => p.name === 'Xavier Ot') && !R.people.some((p) => p.name === 'Joaquín Or'), 'por slug, la lista de esa mesa');
  R = await rpc(null, "select public.roster('nada') j");
  ok(R && R.teams, 'un slug que no existe: a elegir');
  r = await as(A, "select public.team_create('Mesa Dos', 'dos', 'Lider Dos', array['Ag Uno', 'Ag Dos']) j");
  ok(!!r.error && /dueño/.test(r.error), `un admin común no crea mesas (${r.error})`);
  await db.query("update public.profiles set global = true where id = $1", [A]); // el dueño
  R = await rpc(null, "select public.roster('otra') j");
  ok(R.people.some((p) => p.name === 'Joaquín Or' && p.global), 'el dueño figura en todas las mesas');
  R = await rpc(A, "select public.team_create('Mesa Dos', 'Mesa Dós!', 'Lider Dos', array['Ag Uno', ' Ag  Dos ', 'Ag Uno']) j");
  ok(!R.error && R.ok && R.slug === 'mesa-dos' && R.people === 3, `el dueño crea una mesa con su team leader y sus agentes (${JSON.stringify(R)})`);
  const T2 = R.id;
  ok((await db.query("select count(*)::int c from public.chats where team_id = $1 and kind = 'team'", [T2])).rows[0].c === 1, 'con su chat de toda la mesa');
  ok((await db.query("select role from public.profiles where team_id = $1 and name = 'Lider Dos'", [T2])).rows[0].role === 'leader', 'el team leader con su rol');
  R = await rpc(A, "select public.team_create('Mesa Dos bis', 'mesa-dos') j");
  ok(!!R.error && /SLUG_TAKEN/.test(R.error), 'no se repite el nombre corto');
  R = await rpc(A, 'select public.teams_list() j');
  ok(R.length === 3 && R.find((t) => t.slug === 'mesa-dos').people === 3 && R.find((t) => t.slug === 'mesa-dos').leader === 'Lider Dos' && R.find((t) => t.slug === 'matias').mine, `el dueño ve las mesas (${R.length})`);
  r = await as(B, 'select public.teams_list() j'); ok(!r.error && J(r.rows[0].j).length === 0, 'un agente no');
  // entrar por otra mesa: el dueño pasa a esa mesa; un agente de otra mesa no entra
  R = await rpc(null, "select public.pin_login($1, '1111', 'mesa-dos') j", [A]);
  ok(R.ok && (await db.query('select team_id from public.profiles where id = $1', [A])).rows[0].team_id === T2, `el dueño entra por el dominio de otra mesa y pasa a esa mesa (${JSON.stringify(R)})`);
  r = await as(A, 'select count(*)::int c from public.sales'); ok(r.rows[0].c === 0, 'y ahí ve solo lo de esa mesa');
  r = await as(A, "select public.add_member('Ag Tres', 'agent') j"); ok(!r.error && (await db.query("select team_id from public.profiles where name = 'Ag Tres'")).rows[0].team_id === T2, 'y la administra (suma gente)');
  R = await rpc(null, "select public.pin_login($1, '0000', 'mesa-dos') j", [B]);
  ok(R.ok === false && R.error === 'nouser', 'alguien de otra mesa no entra por un dominio ajeno');
  R = await rpc(A, "select public.switch_team('matias') j");
  ok(R.ok && (await db.query('select team_id from public.profiles where id = $1', [A])).rows[0].team_id === (await db.query("select id from public.teams where slug = 'matias'")).rows[0].id, 'vuelve a su mesa con switch_team');
  r = await as(B, "select public.switch_team('mesa-dos') j"); ok(!!r.error, 'un agente no cambia de mesa');
  // Gerencia de la empresa
  R = await rpc(A, 'select public.ger_company(current_date - 60, current_date) j');
  ok(!R.error && R.teams.length === 3 && R.teams.find((t) => t.slug === 'matias').ftd > 0 && R.teams.every((t) => 'reg' in t && 'affs' in t), `ger_company: cada mesa con sus números (${R.teams.map((t) => t.slug + ':' + t.ftd).join(', ')})`);
  r = await as(B, 'select public.ger_company(current_date - 60, current_date) j'); ok(!!r.error, 'un agente no la ve');
  // lo compartido: Banking lo ven todas las mesas
  r = await as(X, "select name from public.processors where name = 'Kushki'"); ok(!r.error && r.rows.length === 1, 'Banking es de la empresa: otra mesa ve los procesadores');
  r = await as(X, "insert into public.processors (name) values ('De otra mesa') returning id"); ok(!!r.error || r.rows.length === 0, 'pero un agente de otra mesa no los edita');
  await db.query("update public.profiles set active = false where team_id = $1", [T2]);
  await db.query("update public.teams set active = false where id = $1", [T2]);
}

// ---------- encuestas en el chat ----------
{
  const bot = (await db.query('select id from public.profiles where bot limit 1')).rows[0].id;
  R = await rpc(B, "select public.poll_create($1, '¿Pizza o empanadas?', array['Pizza', ' Empanadas ', 'Pizza', ''], false, false, null, false, false) j", [TC]);
  ok(!R.error && R.ok && R.id, `cualquiera arma una encuesta en el chat de la mesa (${JSON.stringify(R)})`);
  const P1 = R.id;
  r = await db.query('select body, user_id from public.messages where id = $1', [R.message]);
  ok(r.rows[0].body === `[poll:${P1}] ¿Pizza o empanadas?` && r.rows[0].user_id === B, 'queda como mensaje [poll:id] del que la armó');
  ok((await db.query('select options from public.polls where id = $1', [P1])).rows[0].options.length === 2, 'las opciones repetidas o vacías no cuentan');
  r = await as(B, "select public.poll_create($1, 'Una sola', array['Sí'], false, false, null, false, false) j", [TC]); ok(!!r.error && /OPTS/.test(r.error), 'con una sola opción no va');
  r = await as(B, "select public.poll_create($1, 'Vieja', array['a','b'], false, false, now() - interval '1 hour', false, false) j", [TC]); ok(!!r.error && /CLOSE/.test(r.error), 'una hora de cierre pasada no va');
  r = await as(X, "select public.poll_create($1, 'De otra mesa', array['a','b']) j", [TC]); ok(!!r.error, 'alguien de otra mesa no arma encuestas acá');
  R = await rpc(A, 'select public.poll_vote($1, array[0]) j', [P1]); ok(!R.error && R.ok, 'A vota Pizza');
  R = await rpc(C, 'select public.poll_vote($1, array[1]) j', [P1]); ok(!R.error && R.ok, 'Matias vota Empanadas');
  r = await as(A, 'select public.poll_vote($1, array[0, 1]) j', [P1]); ok(!!r.error && /una sola/.test(r.error), 'con una opción por persona, dos no van');
  R = await rpc(A, 'select public.poll_vote($1, array[1]) j', [P1]); ok(!R.error, 'A cambia su voto a Empanadas');
  R = await rpc(B, 'select public.polls_of($1) j', [TC]);
  let p = R.find((x) => x.id === P1);
  ok(p && p.counts.join() === '0,2' && p.voted === 2 && p.voters >= 13 && !p.closed && p.who.length === 2 && p.who.every((w) => w.opt === 1) && p.mine.length === 0, `los resultados: 0 y 2, con nombres, y lo mío (${JSON.stringify(p)})`);
  r = await as(X, 'select public.polls_of($1) j', [TC]); ok(!r.error && J(r.rows[0].j).length === 0, 'desde otra mesa no se ven');
  r = await as(B, 'select count(*)::int c from public.poll_votes where poll_id = $1', [P1]); ok(r.rows[0].c === 0, 'los votos ajenos no se leen de la tabla (solo por polls_of)');
  r = await as(A, 'select public.poll_close($1) j', [P1]); ok(!r.error, 'el admin la cierra');
  r = await as(C, 'select public.poll_vote($1, array[0]) j', [P1]); ok(!!r.error && /CLOSED/.test(r.error), 'cerrada, no se vota más');
  // anónima y de varias opciones; en un grupo, termina cuando votaron todos
  R = await rid(A, 'select public.chat_create($1, $2::uuid[])::text j', ['Encuestados', [B]]);
  const GP = R;
  R = await rpc(A, "select public.poll_create($1, '¿Qué días?', array['Lunes', 'Martes', 'Jueves'], true, true, null, true, false) j", [GP]);
  const P2 = R.id; ok(!R.error && R.ok, 'A arma una anónima, de varias opciones, que termina cuando votan todos');
  r = await as(M, 'select public.poll_vote($1, array[0]) j', [P2]); ok(!!r.error, 'alguien que no está en el grupo no vota');
  R = await rpc(A, 'select public.poll_vote($1, array[0, 2]) j', [P2]); ok(!R.error, 'A vota dos opciones');
  p = (await rpc(B, 'select public.polls_of($1) j', [GP])).find((x) => x.id === P2);
  ok(p.counts.join() === '1,0,1' && p.who === null && p.voters === 2 && p.voted === 1 && !p.closed, `anónima: números sin nombres, y todavía falta uno (${JSON.stringify(p)})`);
  R = await rpc(B, 'select public.poll_vote($1, array[1]) j', [P2]);
  p = (await rpc(B, 'select public.polls_of($1) j', [GP])).find((x) => x.id === P2);
  ok(p.closed && p.closed_at && p.counts.join() === '1,1,1' && p.mine.join() === '1', 'votó el último: termina sola');
  r = await as(B, 'select public.poll_close($1) j', [P2]); ok(!!r.error && /quien la arm/.test(r.error), 'un agente no cierra la de otro (solo quien la armó, el team leader o un admin)');
  // con /vitalis: el mensaje lo escribe Vitalis, la encuesta es del que la pidió
  R = await rpc(B, "select public.poll_create($1, '¿Mate?', array['Sí', 'No'], false, false, null, false, true) j", [TC]);
  r = await db.query('select user_id from public.messages where id = $1', [R.message]);
  ok(!R.error && r.rows[0].user_id === bot && (await db.query('select user_id from public.polls where id = $1', [R.id])).rows[0].user_id === B, 'por /vitalis, el mensaje es de Vitalis y la encuesta de quien la pidió');
  r = await as(B, "insert into public.messages (chat_id, body) values ($1, '[poll:' || $2 || '] trucha') returning id", [TC, P1]);
  ok(!!r.error && /POLL/.test(r.error), 'un [poll:] a mano no entra');
  await db.query('delete from public.polls where id in ($1, $2, $3)', [P1, P2, R.id]);
  await db.query("delete from public.messages where body like '[poll:%'");
}

// ---------- privacidad: cuándo se tapa Vitalis y cuándo el chat pide el PIN ----------
{
  let q = await as(B, 'select idle_min, chat_lock_min from public.teams');
  ok(q.rows[0].idle_min === 15 && q.rows[0].chat_lock_min === 10, 'arranca en 15 min sin uso y 10 min sin mirar el chat');
  let R = await rpc(B, 'select public.set_locks(20, 5) j');
  ok(!!R.error, 'un agente no lo cambia');
  R = await rpc(M, 'select public.set_locks(20, 5) j');
  ok(!!R.error, 'el team leader tampoco (solo el administrador)');
  R = await rpc(A, 'select public.set_locks(2, 5) j');
  ok(!!R.error, 'menos de 5 minutos no');
  R = await rpc(A, 'select public.set_locks(20, 5) j');
  q = await as(B, 'select idle_min, chat_lock_min from public.teams');
  ok(R.ok && q.rows[0].idle_min === 20 && q.rows[0].chat_lock_min === 5, 'el administrador lo cambia y la mesa lo ve');
  await rpc(A, 'select public.set_locks(15, 10) j');
}

// ---------- Knowledgebase: quién escribe, quién lee, la ruta del nuevo ----------
{
  let r = await as(B, "insert into public.kb_articles (topic, title, blocks, published) values ('crm', 'x', '[]', true) returning id");
  ok(!!r.error || r.rows.length === 0, 'un agente no escribe en el Knowledgebase');
  r = await as(M, "insert into public.kb_articles (topic, title, summary, blocks, published, ruta) values ('crm', 'Cómo abrir el CRM', 'Lo básico', '[{\"t\":\"text\",\"md\":\"Hola **mundo**\"}]', true, 1) returning id");
  ok(!r.error && r.rows.length === 1, 'el team leader publica un artículo');
  const K1 = r.rows[0].id;
  r = await as(M, "insert into public.kb_articles (topic, title, blocks, published) values ('crm', 'Borrador', '[]', false) returning id");
  const KD = r.rows[0].id;
  r = await as(B, 'select id, title from public.kb_articles order by title');
  ok(r.rows.length === 1 && r.rows[0].id === K1, 'el agente ve lo publicado de su mesa, no el borrador');
  r = await as(M, 'select id from public.kb_articles');
  ok(r.rows.length === 2, 'el que escribe ve también los borradores');
  r = await as(B, 'update public.profiles set kb_editor = true where id = $1 returning id', [B]);
  ok(!r.error && r.rows.length === 1, '(un perfil se edita a sí mismo…)');
  r = await as(B, 'select public.kb_editor() e');
  ok(r.rows[0].e === true, 'con kb_editor, el agente puede escribir');
  r = await as(B, "insert into public.kb_articles (topic, title, blocks, published) values ('vitalis', 'De un agente', '[]', true) returning id");
  ok(!r.error && r.rows.length === 1, 'y publica');
  await as(A, 'update public.profiles set kb_editor = false where id = $1', [B]);
  r = await as(B, "insert into public.kb_articles (topic, title, blocks, published) values ('vitalis', 'Otro', '[]', true) returning id");
  ok(!!r.error || r.rows.length === 0, 'el admin le saca el permiso y no escribe más');
  r = await as(B, 'insert into public.kb_files (article_id, mime, data) values ($1, $2, $3) returning id', [K1, 'image/webp', 'AAAA']);
  ok(!!r.error || r.rows.length === 0, 'tampoco sube fotos');
  r = await as(M, 'insert into public.kb_files (article_id, mime, data) values ($1, $2, $3) returning id', [K1, 'image/webp', 'AAAA']);
  ok(!r.error && r.rows.length === 1, 'el team leader sube una foto al artículo');
  r = await as(B, 'select id from public.kb_files');
  ok(r.rows.length === 1, 'la mesa la ve');
  r = await as(B, 'insert into public.kb_reads (user_id, article_id) values ($1, $2) returning read_at', [B, K1]);
  ok(!r.error && r.rows.length === 1, 'B marca "Lo leí"');
  r = await as(C, 'insert into public.kb_reads (user_id, article_id) values ($1, $2) returning read_at', [B, K1]);
  ok(!!r.error || r.rows.length === 0, 'nadie marca por otro');
  const AG2 = (await db.query("select id from public.profiles where role = 'agent' and active and team_id = (select team_id from public.profiles where id = $1) and id <> $1 limit 1", [B])).rows[0].id;
  r = await as(AG2, 'select * from public.kb_reads');
  ok(r.rows.length === 0, 'un agente no ve lo que leyeron los demás');
  r = await as(M, 'select user_id from public.kb_reads');
  ok(r.rows.length === 1 && r.rows[0].user_id === B, 'el team leader ve quién va por dónde');
  r = await as(B, 'insert into public.kb_votes (user_id, article_id, ok) values ($1, $2, false) returning ok', [B, K1]);
  ok(!r.error, 'B dice que no le quedó claro');
  const st = await rpc(M, 'select public.kb_stats() j');
  ok(Array.isArray(st) && st.find((x) => x.id === K1).no === 1 && st.find((x) => x.id === K1).reads === 1, 'el team leader ve las cuentas por artículo');
  ok((await rpc(B, 'select public.kb_stats() j')).length === 0, 'el agente no');
  // global: lo ven las otras mesas
  r = await as(A, "insert into public.kb_articles (topic, title, blocks, published, global) values ('reglas', 'Para todas las mesas', '[]', true, true) returning id");
  const KG = r.rows[0].id;
  const L2 = (await db.query("select id from public.profiles where name = 'Lider Dos'")).rows[0].id;
  r = await as(L2, 'select id from public.kb_articles');
  ok(r.rows.length === 1 && r.rows[0].id === KG, 'la otra mesa ve solo el artículo global');
  r = await as(L2, 'update public.kb_articles set title = $1 where id = $2 returning id', ['x', KG]);
  ok(!!r.error || r.rows.length === 0, 'pero no lo edita');
  await as(M, 'delete from public.kb_articles where id = $1', [KD]);
}

// ---------- baja ----------
r = await as(A, 'update public.profiles set active = false where id = $1 returning active', [B]);
ok(!r.error && r.rows[0].active === false, 'A da de baja a B');
r = await as(B, 'select * from public.sales');
ok(r.rows.length === 0, 'B dado de baja no ve más las ventas de la mesa');
ok(!(await rpc(null, "select public.roster('matias') j")).people.some((p) => p.id === B), 'B dado de baja no aparece en la lista');
ok((await rpc(null, 'select public.pin_login($1, $2) j', [B, '0000'])).ok === false, 'B dado de baja no puede entrar');
r = await as(null, 'select * from public.sales');
ok(!!r.error || r.rows.length === 0, 'sin sesión no se ve nada');

console.log(fails ? `\n${fails} FALLAS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
