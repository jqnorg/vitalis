// Supabase de mentira para probar Vitalis de punta a punta con el cliente real (supabase-js):
// Postgres real (PGlite) con el mismo SQL y RLS + un mini PostgREST + un mini GoTrue (auth).
// Uso: node server.mjs [puerto] [carpeta dist]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const PORT = +(process.argv[2] || 54321);
const DIST = process.argv[3] || new URL('../site', import.meta.url).pathname;
process.on('uncaughtException', (e) => console.error('UNCAUGHT', (e && e.stack) || e)); process.on('unhandledRejection', (e) => console.error('UNHANDLED', (e && e.stack) || e)); process.on('exit', (c) => console.error('EXIT', c));
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync(new URL('./auth-stub.sql', import.meta.url), 'utf8'));
await db.exec(fs.readFileSync(new URL('../supabase/vitalis.sql', import.meta.url), 'utf8'));
await db.exec(`update public.teams set invite_code = 'MATIAS-TEST' where name = 'Team Matías'`);
const PK = { settings: ['user_id'], adjustments: ['user_id', 'ym'], shifts: ['user_id', 'date'], sales: ['id'], agenda: ['id'], profiles: ['id'], teams: ['id'], snippets: ['id'], leads: ['id'], pings: ['id'], chats: ['id'], chat_members: ['chat_id', 'user_id'], messages: ['id'], chat_reads: ['user_id', 'chat_id'], tasks: ['id'], task_people: ['task_id', 'user_id'], targets: ['team_id', 'ym'], chat_files: ['id'], chat_cards: ['id'], avatars: ['user_id'], message_reactions: ['message_id', 'user_id', 'emoji'], user_targets: ['user_id', 'ym'], crm_clients: ['team_id', 'brand', 'client_id'], crm_status_log: ['id'], crm_agent_log: ['id'], crm_status_map: ['team_id', 'status_key'], audit_log: ['id'], pay_methods: ['id'], processors: ['id'], processor_methods: ['processor_id', 'method_id'], banks: ['id'], pay_incidents: ['id'], pay_files: ['id'], campaign_info: ['team_id', 'aff', 'camp', 'country'], campaign_requests: ['id'], client_comments: ['id'], calls: ['id'], client_profiles: ['team_id', 'brand', 'client_id'], client_keywords: ['team_id', 'brand', 'client_id'], station_state: ['team_id', 'vista'], rmo_days: ['user_id', 'date'], day_closes: ['team_id', 'date'], polls: ['id'], poll_votes: ['poll_id', 'user_id', 'opt'], kb_articles: ['id'], kb_files: ['id'], kb_reads: ['user_id', 'article_id'], kb_votes: ['user_id', 'article_id'] };
const TABLES = new Set(Object.keys(PK));
let DOLAR = { compra: 39.4, venta: 41.8, ebrou: { compra: 39.9, venta: 41.3 } };

// ---------- auth ----------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (u) => { const exp = Math.floor(Date.now() / 1000) + 3600; return [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp }), 'sig'].join('.'); };
const refresh = new Map();
function userObj(u) { return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: new Date().toISOString(), user_metadata: u.raw_user_meta_data || {}, app_metadata: { provider: 'email' }, identities: [{ id: u.id, provider: 'email' }], created_at: new Date().toISOString() }; }
function session(u) { const rt = crypto.randomUUID(); refresh.set(rt, u.id); return { access_token: jwt(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: rt, user: userObj(u) }; }
function uidFrom(req) { const a = req.headers.authorization || ''; const t = a.replace(/^Bearer /, '').split('.'); if (t.length !== 3) return null; try { const p = JSON.parse(Buffer.from(t[1], 'base64url').toString()); return p.role === 'authenticated' ? p.sub : null; } catch (e) { return null; } }

// ---------- REST ----------
async function asUser(uid, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(uid ? 'set local role authenticated' : 'set local role anon');
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || '']);
    return fn(tx);
  });
}
const ident = (c) => { if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw Object.assign(new Error('bad column ' + c), { code: 'PGRST100' }); return '"' + c + '"'; };
function filters(u, params) {
  const w = [];
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const li = v.match(/^in\.\((.*)\)$/);
    if (li) { params.push(li[1].split(',').map((x) => decodeURIComponent(x).replace(/^"|"$/g, ''))); w.push(`${ident(k)}::text = any($${params.length}::text[])`); continue; }
    const m = v.match(/^(eq|neq|gt|gte|lt|lte)\.(.*)$/);
    if (!m) continue;
    const op = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[m[1]];
    params.push(decodeURIComponent(m[2]));
    w.push(m[1] === 'eq' || m[1] === 'neq' ? `${ident(k)}::text ${op} $${params.length}` : `${ident(k)} ${op} $${params.length}`); // rangos con el tipo real (fechas)
  }
  return w.length ? ' where ' + w.join(' and ') : '';
}
async function rpc(req, res, fn, body) {
  const uid = uidFrom(req), args = body || {}, keys = Object.keys(args);
  try {
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw Object.assign(new Error('bad fn'), { code: 'PGRST202' });
    const call = `public.${fn}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')})`;
    const meta = (await db.query("select bool_or(proretset) s, max(array_to_string(proargnames, ',')) n, max(array_to_string(proargtypes::regtype[]::text[], ',')) t from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [fn])).rows[0] || {};
    const set = meta.s, an = String(meta.n || '').split(','), at = String(meta.t || '').split(',');
    const isJson = (k) => /json/.test(at[an.indexOf(k)] || '');
    const sql = set ? `select coalesce(json_agg(t), '[]')::text as j from ${call} t` : `select (${call})::text as j`; // las que devuelven tabla, como lista
    const out = await asUser(uid, (tx) => tx.query(sql, keys.map((k) => (args[k] == null ? null : isJson(k) ? JSON.stringify(args[k]) : Array.isArray(args[k]) ? '{' + args[k].map((x) => '"' + String(x).replace(/["\\]/g, '') + '"').join(',') + '}' : typeof args[k] === 'object' ? JSON.stringify(args[k]) : String(args[k])))));
    const j = out.rows[0].j;
    let data = null; if (j != null && j !== '') { try { data = JSON.parse(j); } catch (e) { data = j; } }
    return send(res, 200, data);
  } catch (e) {
    const code = e.code || 'XX000';
    return send(res, code === '42501' ? 403 : code === 'PGRST202' ? 404 : 400, { code, message: e.message, details: null, hint: null });
  }
}
async function rest(req, res, table, body) {
  const u = new URL(req.url, 'http://x'), uid = uidFrom(req), single = /vnd\.pgrst\.object/.test(req.headers.accept || '');
  const prefer = req.headers.prefer || '', ret = /return=representation/.test(prefer);
  if (!TABLES.has(table)) return send(res, 404, { code: 'PGRST205', message: 'no table' });
  const params = [];
  let sql;
  try {
    if (req.method === 'GET') {
      let q = `select * from public.${table}` + filters(u, params);
      const ord = u.searchParams.get('order');
      if (ord) q += ' order by ' + ord.split(',').map((o) => { const [c, d] = o.split('.'); return ident(c) + (d === 'desc' ? ' desc' : ' asc'); }).join(', ');
      const lim = u.searchParams.get('limit'), off = u.searchParams.get('offset');
      const rng = (req.headers.range || '').match(/(\d+)-(\d+)/);
      if (lim) q += ` limit ${+lim}`; else if (rng) q += ` limit ${+rng[2] - +rng[1] + 1}`;
      if (off) q += ` offset ${+off}`; else if (rng) q += ` offset ${+rng[1]}`;
      sql = `select coalesce(json_agg(t), '[]'::json) j from (${q}) t`;
    } else if (req.method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      params.push(JSON.stringify(rows));
      let q = `insert into public.${table} (${cols.map(ident).join(',')}) select ${cols.map(ident).join(',')} from json_populate_recordset(null::public.${table}, $1)`;
      if (/resolution=(merge|ignore)-duplicates/.test(prefer)) {
        const pk = (u.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
        const key = pk.length ? pk : PK[table];
        const upd = /ignore-duplicates/.test(prefer) ? [] : cols.filter((c) => !key.includes(c));
        q += ` on conflict (${key.map(ident).join(',')}) do ` + (upd.length ? 'update set ' + upd.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(',') : 'nothing');
      }
      sql = `with r as (${q} returning *) select coalesce(json_agg(r), '[]'::json) j from r`;
    } else if (req.method === 'PATCH') {
      const cols = Object.keys(body);
      params.push(JSON.stringify(body));
      const w = filters(u, params);
      sql = `with r as (update public.${table} set (${cols.map(ident).join(',')}) = (select ${cols.map(ident).join(',')} from json_populate_record(null::public.${table}, $1))${w} returning *) select coalesce(json_agg(r), '[]'::json) j from r`;
      if (cols.length === 1) sql = sql.replace(`set (${ident(cols[0])}) = (select ${ident(cols[0])} from`, `set ${ident(cols[0])} = (select ${ident(cols[0])} from`);
    } else if (req.method === 'DELETE') {
      sql = `with r as (delete from public.${table}${filters(u, params)} returning *) select coalesce(json_agg(r), '[]'::json) j from r`;
    } else return send(res, 405, {});
    const out = await asUser(uid, (tx) => tx.query(sql, params));
    let data = out.rows[0].j;
    if (typeof data === 'string') data = JSON.parse(data);
    if (single) {
      if (data.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${data.length} rows` });
      return send(res, req.method === 'POST' ? 201 : 200, data[0]);
    }
    if (req.method !== 'GET' && !ret) return send(res, req.method === 'POST' ? 201 : 204, null);
    return send(res, req.method === 'POST' ? 201 : 200, data, { 'content-range': `0-${Math.max(0, data.length - 1)}/*` });
  } catch (e) {
    const code = e.code || 'XX000';
    const st = code === '23505' ? 409 : code === '42501' ? 403 : code.startsWith('PGRST') ? 400 : 400;
    return send(res, st, { code, message: e.message, details: null, hint: null });
  }
}

// ---------- servidor ----------
function send(res, status, obj, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS, ...extra });
  res.end(obj == null ? '' : JSON.stringify(obj));
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.css': 'text/css', '.svg': 'image/svg+xml', '.zip': 'application/zip' };
const srv = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const u = new URL(req.url, 'http://x');
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : null;
  try {
    if (u.pathname === '/__sql' && req.method === 'POST') { if (!body.params || !body.params.length) { const r = await db.exec(body.sql); return send(res, 200, r[r.length - 1].rows); } const r = await db.query(body.sql, body.params); return send(res, 200, r.rows); } // solo para pruebas
    // la función dolar-brou de Supabase (el dólar BROU de pizarra): acá, un valor fijo. POST /__dolar con {compra} lo cambia; con {} responde 502
    if (u.pathname === '/__dolar') { DOLAR = body && body.compra ? body : null; return send(res, 200, { ok: true }); }
    if (u.pathname === '/functions/v1/dolar-brou') return DOLAR ? send(res, 200, { ...DOLAR, fuente: 'BROU · pizarra', at: new Date().toISOString() }) : send(res, 502, { error: 'sin cotización' });
    if (u.pathname.startsWith('/rest/v1/rpc/')) return rpc(req, res, u.pathname.slice(13), body);
    if (u.pathname.startsWith('/rest/v1/')) return rest(req, res, u.pathname.slice(9), body);
    if (u.pathname === '/auth/v1/signup') {
      try {
        const r = await db.query("insert into auth.users (email, raw_user_meta_data, raw_app_meta_data, encrypted_password) values ($1,$2,'{\"provider\":\"email\"}',crypt($3, gen_salt('bf'))) returning *", [String(body.email).toLowerCase(), JSON.stringify(body.data || {}), String(body.password)]);
        return send(res, 200, session(r.rows[0]));
      } catch (e) {
        if (e.code === '23505') return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
        return send(res, 500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' });
      }
    }
    if (u.pathname === '/auth/v1/token') {
      if (u.searchParams.get('grant_type') === 'password') {
        const r = await db.query('select * from auth.users where email = $1 and encrypted_password = crypt($2, encrypted_password) and email_confirmed_at is not null', [String(body.email).toLowerCase(), String(body.password)]);
        if (!r.rows[0]) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return send(res, 200, session(r.rows[0]));
      }
      const id = refresh.get(body.refresh_token);
      if (!id) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      const r = await db.query('select * from auth.users where id = $1', [id]);
      return send(res, 200, session(r.rows[0]));
    }
    if (u.pathname === '/auth/v1/user') {
      const id = uidFrom(req); if (!id) return send(res, 401, { msg: 'no session' });
      if (req.method === 'PUT' && body.password) await db.query("update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where id = $1", [id, String(body.password)]);
      const r = await db.query('select * from auth.users where id = $1', [id]);
      return send(res, 200, userObj(r.rows[0]));
    }
    if (u.pathname === '/auth/v1/recover') return send(res, 200, {});
    if (u.pathname === '/auth/v1/logout') { res.writeHead(204, CORS); return res.end(); }
    if (u.pathname.startsWith('/realtime/')) { res.writeHead(404, CORS); return res.end(); }
    // archivos de la app
    let f = path.join(DIST, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (u.pathname === '/config.js') { res.writeHead(200, { 'content-type': MIME['.js'] }); return res.end(`window.VITALIS_CONFIG={url:'http://localhost:${PORT}',key:'test-anon-key'};`); }
    if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
    if (f.endsWith('index.html')) { res.writeHead(200, { 'content-type': MIME['.html'] || 'text/html' }); return res.end(fs.readFileSync(f, 'utf8').replace(/<script id="cfg">[\s\S]*?<\/script>/, `<script id="cfg">window.VITALIS_CONFIG={url:'http://localhost:${PORT}',key:'test-anon-key'};</script>`)); } // la configuración va adentro de la página: apunto a esta base de prueba
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { send(res, 500, { message: String(e.message || e) }); }
}).listen(PORT, () => console.log('mock supabase en http://localhost:' + PORT));
// el navegador de prueba reusa conexiones: si el servidor las cierra a los 5 s (lo normal en Node) a veces choca con un pedido nuevo (ECONNRESET)
srv.keepAliveTimeout = 120000; srv.headersTimeout = 121000;
