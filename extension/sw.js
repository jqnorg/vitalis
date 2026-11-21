// Vitalis — service worker
// · Agenda: recibe los contactos de Vitalis y, a la hora, avisa.
// · CRM: pasa a Vitalis las ventas (solas, por Sales Rep, para el team leader) y todos los clientes que se ven (con su status);
//   una sola pestaña (la que elegís con el botón) se actualiza cada 10 s y avisa cuando entra un cliente en "new".
// Los avisos son:
//   · tarjeta en la pestaña que estés mirando (o una ventanita si esa pestaña no se puede usar)
//   · sonido
//   · notificación del sistema (si Windows/Mac la deja pasar)

const MAX_LATE = 6 * 3600e3; // al sincronizar, los vencidos hace más de 6 h no se avisan
const z = (n) => String(n).padStart(2, '0');
const hm = (ms) => { const d = new Date(ms); return `${z(d.getHours())}:${z(d.getMinutes())}`; };
const keyOf = (it) => it.k + '@' + it.due;

async function state() {
  const s = await chrome.storage.local.get(['items', 'fired', 'url', 'lastSync', 'cmds', 'importQ', 'leadQ', 'leadIds', 'crmQ']);
  return { items: s.items || [], fired: s.fired || {}, url: s.url || null, lastSync: s.lastSync || 0, cmds: s.cmds || [], importQ: s.importQ || [], leadQ: s.leadQ || [], leadIds: s.leadIds || [], crmQ: s.crmQ || [] };
}
const nrm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // igual que en Vitalis
const leadKey = (c) => nrm(c.id ? String(c.id).replace(/\s+/g, ' ').trim().slice(0, 60) : 'n:' + nrm(c.name));
const ymdLocal = () => { const d = new Date(); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
const sess = {
  async get(k, d) { const s = await chrome.storage.session.get(k); return s[k] ?? d; },
  set(k, v) { return chrome.storage.session.set({ [k]: v }); },
};

// Lo guardado se lee, se cambia y se vuelve a escribir: si dos cosas lo hacen a la vez, una pisa a la otra.
// Con esto van de a una (por lista): no se pierde un aviso, un cliente en cola ni una llamada.
const locks = {};
function lock(name, fn) { const p = (locks[name] || Promise.resolve()).then(fn); locks[name] = p.catch(() => {}); return p; }
const mut = (fn) => lock('st', async () => { const st = await state(); const upd = await fn(st); if (upd) await chrome.storage.local.set(upd); return st; }); // colas y agenda
const liveNow = async () => (await sess.get('live', [])).filter((x) => !x.exp || x.exp > Date.now()); // los mensajes del chat se van solos
const liveSet = (fn) => lock('live', async () => { const n = fn(await liveNow()); await sess.set('live', n); return n; });

function dayTxt(ms) {
  const d = new Date(ms), t = new Date();
  t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - t) / 864e5);
  const dd = diff === 0 ? 'hoy' : diff === 1 ? 'mañana' : diff === -1 ? 'ayer' : `${z(d.getDate())}/${z(d.getMonth() + 1)}`;
  return `${dd} ${hm(ms)}`;
}

/* ---------- sonido (documento offscreen) ---------- */
async function playSound(tone = 'agenda') {
  try {
    const has = chrome.offscreen.hasDocument ? await chrome.offscreen.hasDocument()
      : (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
    if (!has) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Sonido de los avisos de agenda' });
    await chrome.runtime.sendMessage({ type: 'play', target: 'offscreen', tone });
    return null;
  } catch (e) { return String(e && e.message || e); }
}

/* ---------- tarjeta en la pestaña ---------- */
// Esta función se inyecta en la página: tiene que ser autocontenida.
function ftdOverlay(items) {
  const ID = 'ftd-agenda-overlay';
  // estilo Claro, vivo: tarjeta blanca con un borde grueso de color arriba según la urgencia (rojo, ámbar o azul) y un ícono de trazo según el tipo
  const SEAL = '<svg class="mk" viewBox="0 0 48 48" aria-hidden="true"><rect x="2" y="2" width="44" height="44" rx="12" fill="#00875a"/><path d="M14 19 23.4 34.6" stroke="#fff" stroke-opacity=".6" stroke-width="8" stroke-linecap="round"/><path d="M23.4 34.6 34.2 13.4" stroke="#fff" stroke-width="8" stroke-linecap="round"/></svg>';
  const IC = {
    campana: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5zM10.5 20.5a1.8 1.8 0 0 0 3 0"/>',
    cliente: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.9-3.7 3.7-5.6 7-5.6s6.1 1.9 7 5.6"/>',
    tareas: '<path d="M9 4.5H7.5A2.5 2.5 0 0 0 5 7v11.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V7a2.5 2.5 0 0 0-2.5-2.5H15"/><rect x="9" y="3" width="6" height="3.2" rx="1.2"/><path d="m9 13.5 2.2 2.2L15.5 11"/>',
    chat: '<path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h8a2.5 2.5 0 0 1 2.5 2.5v5A2.5 2.5 0 0 1 14 14H9.5L6 17v-3a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M19.6 8.6a2.4 2.4 0 0 1 .9 1.9v5a2.5 2.5 0 0 1-2.5 2.5v3l-3.5-3h-3.2a2.5 2.5 0 0 1-2-1"/>',
    banking: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10.5h18M7 15h3"/>',
    alerta: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17v.1"/>',
    social: '<path d="M6.6 9.5h10.8c.3 4.6-.7 8.5-2.6 10.4-.7.7-1.6 1.1-2.8 1.1s-2.1-.4-2.8-1.1C7.3 18 6.3 14.1 6.6 9.5z"/><path d="M6 9.5h12M13.5 9.2 15.6 4c.3-.6.7-.9 1.4-.9h1"/>',
  };
  const icOf = (d) => /^crm:(login|stlogin|nowatch)|^so:st:/.test(d.k) ? 'alerta' : /^crm:/.test(d.k) ? 'cliente' : /^so:t:/.test(d.k) ? 'tareas' : /^so:c:/.test(d.k) ? 'chat' : /^so:b:/.test(d.k) ? 'banking' : d.kind === 'social' ? 'social' : 'campana';
  let host = document.getElementById(ID);
  if (!host) {
    host = document.createElement('div');
    host.id = ID;
    host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;';
    (document.body || document.documentElement).appendChild(host);
    host.attachShadow({ mode: 'open' }).innerHTML = `<style>
      .stack{display:flex;flex-direction:column;gap:10px;width:min(372px,calc(100vw - 32px));font:13.5px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
      .card{--c:#e11d48;--cb:#f43f5e;background:#fff;color:#0f1720;border:1.5px solid #dde2e7;border-top:5px solid var(--cb);border-radius:18px;padding:12px 14px 13px;box-shadow:0 1px 2px rgba(16,24,40,.06),0 14px 36px rgba(16,24,40,.18);animation:in .22s ease-out}
      .card.urg{--c:#e11d48;--cb:#f43f5e}
      .card.imp{--c:#c2410c;--cb:#f59e0b}
      .card.info{--c:#2563eb;--cb:#3b82f6}
      .card.urg,.card.imp{animation:in .22s ease-out,nudge .5s ease-in-out .3s 2}
      @keyframes in{from{opacity:0;transform:translateY(-8px)}}
      @keyframes nudge{50%{transform:rotate(-1.2deg) scale(1.02)}}
      @media (prefers-reduced-motion:reduce){.card{animation:none!important}}
      .h{display:flex;align-items:center;gap:8px;margin-bottom:8px}
      .mk{width:20px;height:20px;flex:none}
      .tag{font-weight:700;font-size:14.5px;letter-spacing:-.035em}
      .t{flex:1;display:flex;align-items:center;gap:5px;min-width:0;color:var(--c);font-weight:600;font-size:12.5px}
      .t svg{width:15px;height:15px;flex:none;fill:none;stroke:currentColor;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}
      .x{all:unset;cursor:pointer;color:#6b7684;width:24px;height:24px;display:grid;place-items:center;border-radius:8px;font-size:13px}.x:hover{background:#eef0f3;color:#0f1720}
      .id{font-size:22px;font-weight:650;letter-spacing:-.03em;line-height:1.2;word-break:break-word}
      .kw{margin:3px 0 1px;word-break:break-word}
      .kw:empty{display:none}
      .m{color:#6b7684;font-size:12.5px}
      .b{display:flex;gap:6px;margin-top:12px;flex-wrap:wrap}
      .b button{all:unset;cursor:pointer;font-size:12.5px;font-weight:700;color:#0f1720;background:#fff;border:1.5px solid #dde2e7;border-radius:10px;padding:6px 12px}
      .b button:hover{border-color:#6b7684}
      .b button.p{background:#00875a;border-color:#00875a;color:#fff}
      .b button.p:hover{background:#006e49;border-color:#006e49}
      .b button:focus-visible,.x:focus-visible{outline:2px solid #00875a;outline-offset:2px}
    </style><div class="stack"></div>`;
  }
  const stack = host.shadowRoot.querySelector('.stack');
  for (const d of items) {
    const had = stack.querySelector(`[data-k="${CSS.escape(d.k)}"]`);
    if (had && (had.dataset.v || '') === (d.v || '')) continue;
    if (had) had.remove(); // misma tarjeta con algo nuevo (otro mensaje del mismo chat)
    const card = document.createElement('div');
    // color según importancia: urgente (agenda) rojo, importante (clientes new, tareas, el team leader te nombra) ámbar, el resto (chat, social) azul
    const lvl = d.lvl || (d.kind === 'crm' ? 'imp' : d.kind === 'social' ? (/^so:t:/.test(d.k) ? 'imp' : 'info') : 'urg');
    card.className = 'card ' + lvl + (d.kind ? ' ' + d.kind : ''); card.dataset.k = d.k; card.dataset.v = d.v || ''; card.setAttribute('role', 'alert');
    card.innerHTML = `<div class="h">${SEAL}<span class="tag">vitalis</span><span class="t"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[icOf(d)]}</svg><span></span></span><button class="x" data-a="close" title="Cerrar" aria-label="Cerrar">✕</button></div><div class="id"></div><div class="kw"></div><div class="m"></div><div class="b"></div>`;
    card.querySelector('.t span').textContent = d.title || 'Contactar';
    card.querySelector('.id').textContent = d.id;
    card.querySelector('.kw').textContent = d.kw || '';
    card.querySelector('.m').textContent = d.meta || '';
    for (const [a, l, p] of d.btns || [['done', 'Hecho', 1], ['snooze', '+15 min'], ['open', 'Abrir Vitalis']]) {
      const b = document.createElement('button'); b.dataset.a = a; b.textContent = l; if (p) b.className = 'p'; card.querySelector('.b').appendChild(b);
    }
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      try { chrome.runtime.sendMessage({ type: 'overlay', a: b.dataset.a, k: d.k }); } catch (x) {}
      card.remove(); if (!stack.children.length) host.remove();
    });
    stack.appendChild(card);
    if (d.exp) { // un mensaje del chat: se va solo a los segundos (si tenés el mouse encima, espera)
      const bye = () => { if (!card.isConnected) return; if (card.matches(':hover')) return card.addEventListener('mouseleave', () => setTimeout(bye, 1200), { once: true }); card.remove(); if (!stack.children.length) host.remove(); };
      setTimeout(bye, Math.max(1500, d.exp - Date.now()));
    }
  }
}
function ftdOverlayRemove(k) {
  const host = document.getElementById('ftd-agenda-overlay'); if (!host) return;
  const stack = host.shadowRoot.querySelector('.stack');
  const c = stack.querySelector(`[data-k="${CSS.escape(k)}"]`); if (c) c.remove();
  if (!stack.children.length) host.remove();
}

// donde la tarjeta molesta (el softphone de Voiso): ahí no se muestra; aparece en la próxima pestaña que abras
const NOCARD = /^https?:\/\/([^/]+\.)?voiso\.com(\/|$)/i;
const cardOk = (t) => !!t && t.id != null && !NOCARD.test(t.url || t.pendingUrl || '');
async function cardTab() { // la pestaña activa de la última ventana normal que usaste (no la ventanita de Voiso ni otros popups)
  let t = null;
  try { const w = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] }); t = w && w.tabs && w.tabs.find((x) => x.active); } catch (e) {}
  if (!t) [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!t || cardOk(t)) return { tab: t || null };
  const otra = (await chrome.tabs.query({ active: true, windowType: 'normal' })).find(cardOk); // Voiso en una pestaña: otra ventana, si hay
  return { tab: otra || null, blocked: !otra };
}
async function injectInto(tabId) {
  const live = await liveNow();
  if (!live.length) return true;
  try {
    if (!cardOk(await chrome.tabs.get(tabId))) return false;
    await chrome.scripting.executeScript({ target: { tabId }, func: ftdOverlay, args: [live] });
    const tabs = await sess.get('tabs', []);
    if (!tabs.includes(tabId)) await sess.set('tabs', [...tabs, tabId].slice(-50));
    return true;
  } catch (e) { return false; }
}
async function showNow(noWin) {
  const { tab, blocked } = await cardTab();
  if (tab && await injectInto(tab.id)) {
    try { await chrome.windows.update(tab.windowId, { drawAttention: true }); } catch (e) {}
    return 'pestaña';
  }
  if (blocked || noWin) return 'espera'; // estás en Voiso: no te tapo nada, la tarjeta te espera en la próxima pestaña
  await openAlertWindow();
  return 'ventana';
}
async function openAlertWindow() {
  const wid = await sess.get('win', null);
  if (wid != null) { try { await chrome.windows.update(wid, { focused: true, drawAttention: true }); return; } catch (e) {} }
  const w = await chrome.windows.create({ url: 'alarm.html', type: 'popup', width: 420, height: 300, focused: true });
  await sess.set('win', w.id);
}
chrome.windows.onRemoved.addListener(async (id) => { if (id === await sess.get('win', null)) await sess.set('win', null); });

async function dismiss(k) {
  const live = await liveSet((l) => l.filter((x) => x.k !== k));
  try { chrome.notifications.getAll((all) => { for (const nid in all || {}) if (kOf(nid) === k) chrome.notifications.clear(nid); }); } catch (e) {} // y la notificación del sistema de ese aviso
  for (const tabId of await sess.get('tabs', [])) {
    chrome.scripting.executeScript({ target: { tabId }, func: ftdOverlayRemove, args: [k] }).catch(() => {});
  }
  if (!live.length) await sess.set('tabs', []);
}
// al cambiar de pestaña (o cargar otra página) el aviso te sigue hasta que lo atiendas
chrome.tabs.onActivated.addListener(async ({ tabId }) => { if ((await liveNow()).length) injectInto(tabId); });
chrome.windows.onFocusChanged.addListener(async (wid) => { // volvés a Chrome (o cambiás de ventana): el aviso pendiente está ahí
  if (wid === chrome.windows.WINDOW_ID_NONE || !(await liveNow()).length) return;
  try { const [t] = await chrome.tabs.query({ active: true, windowId: wid }); if (t) injectInto(t.id); } catch (e) {}
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === 'complete' && tab.active && (await liveNow()).length) injectInto(tabId);
});

/* ---------- aviso completo ---------- */
const createN = (id, opt) => new Promise((r) => chrome.notifications.create(id, opt, () => r(chrome.runtime.lastError ? chrome.runtime.lastError.message : null)));
const level = () => new Promise((r) => chrome.notifications.getPermissionLevel(r));

async function alertItem(it, { snooze = false } = {}) {
  await mut((st) => { st.fired[keyOf(it)] = Date.now(); return { fired: st.fired }; });
  const late = Date.now() - it.due > 5 * 6e4;
  const tag = snooze ? 'recordatorio' : late ? 'atrasado' : '';
  const info = { k: it.k, kind: 'agenda', title: 'Hora de contactar', id: it.id, kw: it.kw || '(sin palabra clave)', meta: `${dayTxt(it.due)}${tag ? ', ' + tag : ''}`,
    btns: [['done', 'Hecho', 1], ['snooze', '+15 min'], ['open', 'Abrir Vitalis']] };
  await liveSet((l) => [...l.filter((x) => x.k !== it.k), info]);
  const sound = await playSound('agenda');
  const where = await showNow();
  const sys = await createN('n|' + Date.now() + '|' + it.k, {
    type: 'basic', iconUrl: 'icons/128.png', title: `Contactar ${it.id}`, message: info.kw,
    contextMessage: info.meta,
    priority: 2, requireInteraction: true, buttons: [{ title: 'Abrir Vitalis' }, { title: 'Recordar en 15 min' }],
  });
  return { where, sound, sys };
}

/* ---------- sincronización con el panel ---------- */
async function sync(msg) {
  const { items, url, known } = msg;
  const now = Date.now();
  const keys = new Set(items.map(keyOf));
  const fired = {};
  let upd = null;
  const st = await mut((st) => {
    for (const k in st.fired) if (keys.has(k)) fired[k] = st.fired[k];
    upd = { items, url: url || st.url, lastSync: now, fired, cmds: [] };
    if (known) upd.known = { ids: known.ids, txs: known.txs, at: now }; // para que el botón del CRM sepa cuáles ya están
    if (Array.isArray(msg.snips)) upd.snips = msg.snips; // los snippets que pega snip.js en cualquier página
    if (msg.user) upd.me = msg.user;
    if (msg.desk) upd.desk = msg.desk; // para el botón del CRM del team leader
    if (Array.isArray(msg.leadIds)) { upd.leadIds = msg.leadIds; const have = new Set(msg.leadIds); upd.leadQ = st.leadQ.filter((c) => !have.has(leadKey(c))); }
    return upd;
  });

  const alive = new Set(items.map((x) => x.k));
  for (const a of await chrome.alarms.getAll()) {
    if (a.name.startsWith('p:') || (a.name.startsWith('s:') && !alive.has(a.name.slice(2)))) await chrome.alarms.clear(a.name);
  }
  // solo las tarjetas de agenda ya resueltas en el panel: las demás (clientes new, tareas, chat, fallas de pago) quedan hasta que las cierres
  for (const l of await liveNow()) if (l.kind === 'agenda' && l.k !== 'test' && !alive.has(l.k)) await dismiss(l.k);
  let scheduled = 0;
  for (const it of items) {
    if (fired[keyOf(it)]) continue;
    if (it.due > now) { await chrome.alarms.create('p:' + it.k, { when: it.due }); scheduled++; }
    else if (now - it.due < MAX_LATE) await alertItem(it);
  }
  return { scheduled, cmds: st.cmds, imports: st.importQ, leads: upd.leadQ || st.leadQ, seen: st.crmQ.slice(0, 500) };
}

/* ---------- clientes new del CRM → registro de Vitalis ---------- */
async function crmLeads(clients) {
  const today = ymdLocal(), fresh = [];
  const cl = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  await mut((st) => {
    const have = new Set(st.leadIds), inQ = new Set(st.leadQ.map(leadKey));
    for (const c of clients.slice(0, 300)) {
      const k = leadKey(c);
      if (!k || k === 'n:' || have.has(k) || inQ.has(k)) continue;
      inQ.add(k); fresh.push({ id: cl(c.id, 60), name: cl(c.name, 120), country: cl(c.country, 60), date: today });
    }
    return fresh.length ? { leadQ: [...st.leadQ, ...fresh].slice(-500) } : null;
  });
  if (!fresh.length) return { ok: true, fresh: 0 };
  await deliverLeads();
  return { ok: true, fresh: fresh.length };
}
async function deliverLeads() {
  const st = await state();
  if (!st.leadQ.length) return false;
  for (const t of await vitalisTabs()) {
    try {
      const r = await withTimeout(chrome.tabs.sendMessage(t.id, { type: 'leads', rows: st.leadQ }), 10000);
      if (r && !r.noPanel && !r.err) { await leadsDone(r.keys || []); return true; }
    } catch (e) {}
  }
  return false; // Vitalis cerrado: quedan en cola hasta que se abra
}
async function leadsDone(keys) {
  const ks = new Set(keys.map(String));
  await mut((st) => ({ leadQ: st.leadQ.filter((c) => !ks.has(leadKey(c))), leadIds: [...new Set([...st.leadIds, ...ks])].slice(-50000) }));
}

/* ---------- todos los clientes que se ven en el CRM → registro de clientes de Vitalis ---------- */
// cola por marca y cliente con la última foto de cada uno; cada fila lleva k = clave@hora, y Vitalis devuelve las que guardó
const seenKey = (r) => nrm(r.brand) + '|' + nrm(r.id);
const REG_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;
async function crmSeen(rows) {
  const now = Date.now();
  const cl = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  await mut((st) => {
  const q = new Map(st.crmQ.map((r) => [r.ln ? r.k : seenKey(r), r])); // las llamadas tienen su propia clave
  for (const r of rows.slice(0, 1000)) {
    const id = cl(r.id, 60); if (!id) continue;
    if (/^(omega|gizat|voiso)$/.test(r.ln || '')) { // una llamada: va aparte, cada una con su clave
      const at = new Date(r.at); const row = { id, brand: cl(r.brand, 40), ln: r.ln, at: isFinite(at) ? at.toISOString() : new Date(now).toISOString() };
      row.k = 'call|' + seenKey(row) + '|' + row.ln + '|' + row.at; q.set(row.k, row); continue;
    }
    const row = { id, brand: cl(r.brand, 40), name: cl(r.name, 120), country: cl(r.country, 60), status: cl(r.status, 60), reg: REG_RE.test(r.reg || '') ? r.reg : '',
      agent: cl(r.agent, 80), camp: cl(r.camp, 120), aff: cl(r.aff, 60), call: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.call || '') ? r.call : '', note: cl(r.note, 200), ftd: /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(r.ftd || '') ? r.ftd : '', desk: cl(r.desk, 80) };
    if (r.gone) row.gone = 1; // salió de Talking en la pestaña que se actualiza
    row.k = seenKey(row) + '@' + now;
    q.set(seenKey(row), row);
  }
  return { crmQ: [...q.values()].slice(-5000) };
  });
  await deliverSeen();
  return { ok: true };
}
let delivering = false;
async function deliverSeen() {
  if (delivering) return false; delivering = true;
  try {
    for (let round = 0; round < 10; round++) {
      const st = await state(); if (!st.crmQ.length) return true;
      let done = false;
      for (const t of await vitalisTabs()) {
        try {
          const r = await withTimeout(chrome.tabs.sendMessage(t.id, { type: 'seen', rows: st.crmQ.slice(0, 500) }), 20000);
          if (r && !r.noPanel && !r.err) { await seenDone(r.keys || []); done = true; break; }
        } catch (e) {}
      }
      if (!done) return false; // Vitalis cerrado (o sin la base nueva): quedan en cola
    }
    return true;
  } finally { delivering = false; }
}
async function seenDone(keys) { const ks = new Set(keys.map(String)); await mut((st) => ({ crmQ: st.crmQ.filter((r) => !ks.has(r.k)) })); }

/* ---------- ventas desde el CRM ---------- */
const CRM_URLS = ['https://crmnovaramarkets.com/*', 'https://*.crmnovaramarkets.com/*', 'https://crmtrade24seven.com/*', 'https://*.crmtrade24seven.com/*'];
async function crmUrls() { const s = (await chrome.storage.local.get('crmSites')).crmSites || {}; return [...CRM_URLS, ...Object.keys(s).map((h) => `https://${h}/*`)]; }
// "Usar en este CRM" desde el ícono: registra crm.js para ese sitio y le asigna la marca
async function crmSiteAdd(tab, brandName) {
  const u = new URL(tab.url); if (u.protocol !== 'https:') throw new Error('El CRM tiene que ser https');
  const sites = (await chrome.storage.local.get('crmSites')).crmSites || {};
  sites[u.hostname] = brandName; await chrome.storage.local.set({ crmSites: sites });
  const id = 'crm-' + u.hostname.replace(/[^a-z0-9]/gi, '-');
  try { await chrome.scripting.unregisterContentScripts({ ids: [id] }); } catch (e) {}
  await chrome.scripting.registerContentScripts([{ id, matches: [`https://${u.hostname}/*`], js: ['crm.js'], allFrames: true, runAt: 'document_idle', persistAcrossSessions: true }]);
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['crm.js'] });
}
async function vitalisTabs() { // pestañas abiertas de Vitalis (la dirección la aprende al sincronizar)
  const { url } = await state(); let origin = null;
  try { origin = new URL(url).origin; } catch (e) {}
  if (!origin) return [];
  return (await chrome.tabs.query({})).filter((t) => t.url && t.url.startsWith(origin + '/'));
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
async function crmImport(rows) {
  const tabs = await vitalisTabs();
  for (const t of tabs) {
    try {
      const r = await withTimeout(chrome.tabs.sendMessage(t.id, { type: 'import', rows }), 60000); // muchas de una (toda la historia) pueden tardar
      if (r && !r.noPanel) return r;
    } catch (e) {}
  }
  // Vitalis no está abierto: quedan en espera hasta la próxima vez que se abra
  await mut((st) => {
    const seen = new Set(), q = [];
    for (const x of [...st.importQ, ...rows]) { const k = x.brand + '|' + x.id; if (!seen.has(k)) { seen.add(k); q.push(x); } }
    return { importQ: q.slice(-500) };
  });
  return { queued: rows.length };
}
/* ---------- una sola pestaña del CRM se actualiza sola cada 10 s: la que se eligió con el botón ---------- */
const EVERY = 10; // segundos, fijo
async function allW() { return (await chrome.storage.local.get('watches')).watches || {}; }
async function getW(tabId) { return (await allW())[tabId] || null; }
const updW = (tabId, fn) => lock('w', async () => { // fn recibe la vigilancia de esa pestaña como está ahora y devuelve la nueva (null = soltarla)
  const all = await allW(), cur = all[tabId] || null, w = fn(cur);
  if (w === cur) return cur;
  if (w) all[tabId] = w; else delete all[tabId];
  await chrome.storage.local.set({ watches: all }); return w;
});
const setW = (tabId, w) => updW(tabId, () => w);
let wCache = {}; chrome.storage.local.get('watches').then((s) => { wCache = s.watches || {}; }); chrome.storage.onChanged.addListener((ch) => { if (ch.watches) wCache = ch.watches.newValue || {}; });
const watchedTab = (id) => !!wCache[id];
const isCrmUrl = async (url) => { try { const h = new URL(url).hostname, s = (await chrome.storage.local.get('crmSites')).crmSites || {}; return /(^|\.)crm(novaramarkets|trade24seven)\.com$/.test(h) || !!s[h]; } catch (e) { return false; } };
// el team leader no gestiona clientes: puede tener varias pestañas actualizándose (para el registro, sin avisos de new)
const deskRole = async () => (((await chrome.storage.local.get('desk')).desk) || {}).role || '';
const MAX_WATCH = 8;
const watchStart = (tab) => lock('w', () => watchStart0(tab)).then(async (r) => { if (r && r.ok) { await ensureLoop(); if ((await liveNow()).some((x) => x.k === 'crm:nowatch')) await dismiss('crm:nowatch'); } return r; });
async function watchStart0(tab) {
  const all = await allW(), multi = (await deskRole()) === 'leader';
  for (const w of Object.values(all)) { // ya hay otra elegida (y sigue abierta en el CRM): no se puede elegir esta (salvo el team leader)
    if (!w || w.tabId === tab.id) continue;
    let t = null; try { t = await chrome.tabs.get(w.tabId); } catch (e) {}
    if (!(t && await isCrmUrl(t.url))) { delete all[w.tabId]; continue; }
    if (!multi) return { busy: true, tabId: w.tabId, title: t.title || w.title || '' };
  }
  if (multi && !all[tab.id] && Object.keys(all).length >= MAX_WATCH) return { busy: true, max: MAX_WATCH };
  const old = all[tab.id];
  all[tab.id] = { tabId: tab.id, url: tab.url, title: tab.title, seen: old ? old.seen : {}, base: old ? old.base : false, since: old ? old.since : Date.now(), lastRefresh: old ? old.lastRefresh : 0, loginAt: old ? old.loginAt : 0, inNew: old ? old.inNew : null };
  await chrome.storage.local.set({ watches: all });
  try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch (e) {} // que Chrome no la duerma para ahorrar memoria
  return { ok: true };
}
async function watchGo() { const w = Object.values(await allW())[0]; if (!w) return; try { const t = await chrome.tabs.get(w.tabId); await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); } catch (e) {} }
async function watchPrune() { // de la versión anterior (todas las pestañas): queda solo la más reciente (el team leader puede tener varias)
  const ws = Object.values(await allW()); if (ws.length <= 1 || (await deskRole()) === 'leader') return;
  const keep = ws.sort((a, b) => (b.lastRefresh || b.since || 0) - (a.lastRefresh || a.since || 0))[0];
  await chrome.storage.local.set({ watches: { [keep.tabId]: keep } });
}
watchPrune();
async function watchStop(tabId) { await setW(tabId, null); if (!Object.keys(await allW()).length) { loopOn = false; clearTimeout(loopT); await chrome.alarms.clear('crm-watch'); } }
async function tickOne(w) {
  let tab = null; try { tab = await chrome.tabs.get(w.tabId); } catch (e) {}
  if (!tab || !(await isCrmUrl(tab.url))) return watchStop(w.tabId); // se cerró o se fue del CRM
  if (tab.discarded) { try { await chrome.tabs.reload(w.tabId); } catch (e) {} return; }
  let r = null;
  try { r = await withTimeout(chrome.tabs.sendMessage(w.tabId, { type: 'crm-refresh' }), 5000); } catch (e) {}
  if (!r && tab.status === 'complete') { try { await chrome.tabs.reload(w.tabId); } catch (e) {} } // la página no responde: la recargo
  if (!r || !r.skipped) await updW(w.tabId, (cur) => (cur ? { ...cur, lastRefresh: Date.now() } : cur));
}
let ticking = false;
async function watchTick() {
  if (ticking) return; ticking = true;
  try { for (const w of Object.values(await allW())) await tickOne(w); } finally { ticking = false; }
}
// Las alarmas de Chrome no bajan de 30 s: para 10 s uso un temporizador propio, y la alarma de 30 s lo revive si Chrome lo frena.
let loopT = null, loopOn = false;
async function ensureLoop() {
  if (!Object.keys(await allW()).length) { loopOn = false; clearTimeout(loopT); return chrome.alarms.clear('crm-watch'); }
  if (!(await chrome.alarms.get('crm-watch'))) await chrome.alarms.create('crm-watch', { periodInMinutes: 0.5, delayInMinutes: 0.5 });
  if (loopOn) return;
  loopOn = true; clearTimeout(loopT);
  const step = async () => {
    if (!loopOn) return;
    if (!Object.keys(await allW()).length) { loopOn = false; return; }
    await watchTick();
    loopT = setTimeout(step, EVERY * 1000);
  };
  loopT = setTimeout(step, EVERY * 1000);
}
chrome.runtime.onStartup.addListener(() => ensureLoop());
ensureLoop(); // Chrome apaga y prende este proceso: al volver, el temporizador de 10 s arranca enseguida (no espera a la alarma)
chrome.storage.local.remove('watch'); // la vigilancia vieja (una sola pestaña, con opciones)
chrome.tabs.onRemoved.addListener(async (tabId) => { if (await getW(tabId)) await watchStop(tabId); });
async function crmClients(tabId, m) {
  const w = await getW(tabId);
  if (!w) return { watched: false };
  const now = Date.now();
  if (m.login) { // se cerró la sesión del CRM: aviso una vez por hora
    if (now - (w.loginAt || 0) > 3600e3) {
      await updW(tabId, (c) => (c ? { ...c, loginAt: now } : c));
      await alertCard({ k: 'crm:login', kind: 'crm', title: 'El CRM cerró la sesión', id: 'Volvé a entrar al CRM', kw: 'Mientras tanto no puedo ver los clientes nuevos.', meta: hm(now), btns: [['crm', 'Ir al CRM', 1], ['close', 'Ok']] }, 'crm', 'El CRM cerró la sesión', 'Volvé a entrar para seguir vigilando los clientes nuevos.');
    }
    return { watched: true };
  }
  if (!m.ok) return { watched: true };
  if ((await liveNow()).some((x) => x.k === 'crm:login')) await dismiss('crm:login'); // volvió la sesión
  const fresh = [];
  const got = await updW(tabId, (w) => { // con la vigilancia como está ahora: dos listas seguidas no avisan dos veces del mismo cliente
    if (!w) return w;
    const seen = { ...w.seen };
    for (const c of m.clients) { if (!seen[c.key]) { if (w.base) fresh.push(c); seen[c.key] = now; } }
    const keys = Object.keys(seen); if (keys.length > 3000) for (const k of keys.sort((a, b) => seen[a] - seen[b]).slice(0, keys.length - 3000)) delete seen[k];
    return { ...w, seen, base: true, inNew: m.clients.length, loginAt: 0 };
  });
  if (!got) return { watched: false };
  if ((await deskRole()) === 'leader') return { watched: true, fresh: 0 }; // el team leader no recibe avisos de new: los gestionan los agentes
  for (const c of fresh.slice(0, 10)) if (c.id) await sendCmd({ cmd: 'nuevo', k: String(c.id).slice(0, 60), at: now }); // en Vitalis se abre la ficha
  for (const c of fresh.slice(0, 5)) {
    await alertCard({ k: 'crm:' + c.key, kind: 'crm', title: 'Cliente nuevo en el CRM', id: c.id || c.name, kw: c.id ? c.name : '', meta: [c.country, 'entró ' + hm(now)].filter(Boolean).join(' · '),
      btns: [['crm', 'Ver en el CRM', 1], ['close', 'Ok']] }, 'crm', `Cliente nuevo: ${c.id || c.name}`, [c.name, c.country].filter(Boolean).join(' · '));
  }
  if (fresh.length > 5) await alertCard({ k: 'crm:mas' + now, kind: 'crm', title: 'Clientes nuevos en el CRM', id: `+${fresh.length - 5} más`, kw: 'Hay más clientes en new.', meta: hm(now), btns: [['crm', 'Ver en el CRM', 1], ['close', 'Ok']] }, null);
  return { watched: true, fresh: fresh.length };
}
const CHAT_MS = 8000; // un mensaje del chat se va solo; todo lo demás queda hasta que lo cierres
async function alertCard(info, tone, sysTitle, sysMsg) {
  await liveSet((l) => [...l.filter((x) => x.k !== info.k), info]);
  if (tone) await playSound(tone);
  await showNow(!!info.exp); // por un mensaje del chat no abro una ventanita
  if (info.exp) setTimeout(() => liveSet((l) => l.filter((x) => !(x.k === info.k && x.exp === info.exp))), info.exp - Date.now() + 300);
  if (sysTitle) await createN('n|' + Date.now() + '|' + info.k, { type: 'basic', iconUrl: 'icons/128.png', title: sysTitle, message: sysMsg || '', priority: 2, requireInteraction: true, buttons: [{ title: 'Ver en el CRM' }] });
}
async function focusCrm() { // la pestaña de clientes (la que tiene clientes en new), si no cualquiera del CRM
  const ws = Object.values(await allW()), w = ws.find((x) => x.inNew != null) || ws[0] || null;
  let tab = null;
  if (w) { try { tab = await chrome.tabs.get(w.tabId); } catch (e) {} }
  if (!tab) [tab] = await chrome.tabs.query({ url: await crmUrls() });
  if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
  else if (w) await chrome.tabs.create({ url: w.url });
}

/* ---------- estación: el Chrome del team leader con una pestaña propia por vista del CRM ---------- */
// El team leader arma cada vista una vez (filtro, orden, filas por página) y en el botón de Vitalis del CRM dice cuál es.
// Desde ahí la extensión la fija, la actualiza a su ritmo (con un poco de variación) y, si se cierra, la vuelve a abrir.
// Solo en horario: fuera de hora no toca el CRM. Cada 30 s le cuenta a Vitalis cómo le fue con cada vista (latido).
const SVIEWS = { news: { n: 'News', every: 10 }, trx: { n: 'Transactions', every: 15 }, cola: { n: 'Cola', every: 30 }, agen: { n: 'Agendables', every: 60 }, cerr: { n: 'Cerrados', every: 600 } };
const ST_HOURS = { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 17 * 60 + 30 }; // lunes a viernes, 9:00 a 17:30
async function stGet() { return (await chrome.storage.local.get('station')).station || { views: {} }; }
const stUpd = (fn) => lock('station', async () => { const s = await stGet(), n = fn(s); if (n && n !== s) await chrome.storage.local.set({ station: n }); return n || s; }); // fn devuelve la nueva (o null si no cambia)
const stRun = (v, patch) => lock('stRuns', async () => { const all = await sess.get('stRuns', {}); all[v] = { ...(all[v] || {}), ...patch }; await sess.set('stRuns', all); return all[v]; });
async function stHours() {
  const h = (await chrome.storage.local.get('stationHours')).stationHours || ST_HOURS, d = new Date(), m = d.getHours() * 60 + d.getMinutes();
  return h.days.includes(d.getDay()) && m >= h.from && m < h.to;
}
let stCache = { views: {} }; chrome.storage.local.get('station').then((s) => { stCache = s.station || { views: {} }; }); chrome.storage.onChanged.addListener((ch) => { if (ch.station) stCache = ch.station.newValue || { views: {} }; });
const stationOf = (tabId) => (Object.entries(stCache.views || {}).find(([, c]) => c.tabId === tabId) || [null])[0];
async function stationSet(tab, view) { // "Esta pestaña es la de…" desde el botón del CRM ('' = ya no es parte de la estación)
  if (!['leader', 'admin'].includes(await deskRole())) return { err: 'Solo el team leader o el administrador' };
  if (view && !SVIEWS[view]) return { err: 'vista desconocida' };
  let freed = null;
  await stUpd((s) => {
    const views = { ...s.views };
    for (const [k, c] of Object.entries(views)) if (c.tabId === tab.id) delete views[k];
    if (view) { if (views[view]) freed = views[view].tabId; views[view] = { tabId: tab.id, url: tab.url, title: tab.title || '', at: Date.now() }; }
    return { ...s, views };
  });
  if (freed != null && freed !== tab.id) { try { await chrome.tabs.update(freed, { pinned: false }); } catch (e) {} } // la que tenía esa vista antes queda como una pestaña común
  try { await chrome.tabs.update(tab.id, view ? { pinned: true, autoDiscardable: false } : { pinned: false }); } catch (e) {}
  if (view) {
    if (await getW(tab.id)) await watchStop(tab.id); // si se actualizaba para los news, ahora la maneja la estación
    await stRun(view, { nextAt: 0, problem: '', noTable: 0 });
  }
  await stLoop(); stFlushSoon();
  return { ok: true };
}
async function stationOff() { // apagar la estación entera (desde el ícono): las pestañas quedan como pestañas comunes
  const s = await stGet();
  for (const c of Object.values(s.views)) { try { await chrome.tabs.update(c.tabId, { pinned: false }); } catch (e) {} }
  await stUpd((x) => ({ ...x, views: {} }));
  await stLoop(); await stFlush();
  return { ok: true };
}
async function stReopen(v, cfg, s) { // se cerró: la abro de nuevo, fija y en segundo plano, al lado de las otras de la estación
  let windowId;
  for (const o of Object.values(s.views)) { if (o.tabId === cfg.tabId) continue; try { windowId = (await chrome.tabs.get(o.tabId)).windowId; break; } catch (e) {} }
  if (windowId == null) { try { const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }); windowId = w && w.id; } catch (e) {} }
  try {
    const t = await chrome.tabs.create({ url: cfg.url, pinned: true, active: false, ...(windowId != null ? { windowId } : {}) });
    try { await chrome.tabs.update(t.id, { autoDiscardable: false }); } catch (e) {}
    await stUpd((st) => (st.views[v] ? { ...st, views: { ...st.views, [v]: { ...st.views[v], tabId: t.id } } } : null));
    await stRun(v, { nextAt: Date.now() + 8000, noTable: 0 }); // recién abierta: se lee sola al cargar
    return t;
  } catch (e) { return null; }
}
async function stVitalis() { // la estación necesita Vitalis abierto: por ahí llegan los clientes a la base
  if ((await vitalisTabs()).length) return;
  const { url } = await state(); if (!url) return;
  if (Date.now() - (await sess.get('stVitAt', 0)) < 5 * 6e4) return;
  await sess.set('stVitAt', Date.now());
  try { const t = await chrome.tabs.create({ url, pinned: true, active: false }); await chrome.tabs.update(t.id, { autoDiscardable: false }); } catch (e) {}
}
let stBusy = false;
async function stTick() {
  if (stBusy) return; stBusy = true;
  try {
    const s = await stGet(), views = Object.entries(s.views);
    if (!views.length || !(await stHours())) return; // fuera de horario no se toca el CRM
    const runs = await sess.get('stRuns', {}), now = Date.now();
    for (const [v, cfg] of views) {
      const r = runs[v] || {};
      let tab = null; try { tab = await chrome.tabs.get(cfg.tabId); } catch (e) {}
      if (!tab || !(await isCrmUrl(tab.url || tab.pendingUrl || ''))) {
        if (now - (r.reopenAt || 0) < 6e4) continue; // no la abro una y otra vez
        await stRun(v, { reopenAt: now });
        if (!(await stReopen(v, cfg, s))) await stRun(v, { problem: 'cerrada', lastTry: now });
        continue;
      }
      if ((r.nextAt || 0) > now) continue;
      await stRun(v, { lastTry: now, nextAt: now + SVIEWS[v].every * 1000 * (0.7 + Math.random() * 0.6) }); // un poco de variación: no es un reloj exacto
      if (tab.discarded) { try { await chrome.tabs.reload(tab.id); } catch (e) {} continue; }
      let res = null; try { res = await withTimeout(chrome.tabs.sendMessage(tab.id, { type: 'crm-refresh' }), 5000); } catch (e) {}
      if (!res && tab.status === 'complete') { try { await chrome.tabs.reload(tab.id); } catch (e) {} } // la página no responde: la recargo
    }
    await stVitalis();
  } finally { stBusy = false; }
}
// lo que vio una pestaña de la estación al leer (lo manda crm.js después de cada lectura)
async function stScan(tabId, m, url) {
  const v = Object.entries((await stGet()).views).find(([, c]) => c.tabId === tabId);
  if (!v) return { station: null };
  const [view] = v, now = Date.now(), prev = (await sess.get('stRuns', {}))[view] || {};
  const patch = { n: Math.max(0, +m.n || 0), total: m.total == null ? null : +m.total, statuses: m.statuses || {}, seenAt: now };
  if (m.login) { patch.problem = 'login'; patch.noTable = 0; }
  else if (m.table) { patch.problem = ''; patch.lastOk = now; patch.noTable = 0; }
  else if (!prev.noTable) patch.noTable = now; // la lista desaparece un momento al actualizar: recién a los 20 s es un problema
  else if (now - prev.noTable > 2e4) patch.problem = 'sin-tabla';
  await stRun(view, patch);
  if (url && await isCrmUrl(url)) await stUpd((s) => (s.views[view] && s.views[view].url !== url ? { ...s, views: { ...s.views, [view]: { ...s.views[view], url } } } : null)); // el filtro puede vivir en la dirección: guardo la última
  if ((patch.problem ?? prev.problem ?? '') !== (prev.problem || '')) {
    stFlushSoon();
    if (patch.problem === 'login' && now - (await sess.get('stLoginAt', 0)) > 3600e3) { // el team leader está ahí: se lo digo en su Chrome (una vez por hora)
      await sess.set('stLoginAt', now);
      await alertCard({ k: 'crm:stlogin', kind: 'crm', title: 'La estación quedó sin sesión', id: 'Volvé a entrar al CRM', kw: `La pestaña de ${SVIEWS[view].n} pide entrar de nuevo. Mientras tanto no se leen clientes.`, meta: hm(now), btns: [['crm', 'Ir al CRM', 1], ['close', 'Ok']] }, 'crm', 'La estación quedó sin sesión del CRM', 'Volvé a entrar para que siga leyendo.');
    }
  }
  return { station: view };
}
// cada 30 s (y cuando algo cambia) le cuento a Vitalis cómo está cada vista; al apagarla, una vez más vacía
async function stFlush() {
  const s = await stGet(), views = Object.keys(s.views);
  if (views.length && !(await stHours())) return false; // fuera de horario no hay nada que contar
  if (!views.length && !(await sess.get('stWasOn', false))) return false; // acá nunca hubo estación
  const runs = await sess.get('stRuns', {}), iso = (ms) => (ms ? new Date(ms).toISOString() : null);
  const rows = views.map((v) => { const r = runs[v] || {}; return { vista: v, ok: iso(r.lastOk), try: iso(r.lastTry || r.seenAt), n: r.n || 0, total: r.total ?? null, statuses: r.statuses || {}, problem: r.problem || '' }; });
  let sent = false; // a todas las pestañas de Vitalis: lo guarda la del team leader (o admin); las demás lo ignoran
  for (const t of await vitalisTabs()) { try { const r = await withTimeout(chrome.tabs.sendMessage(t.id, { type: 'station', views: rows }), 8000); if (r && r.ok) sent = true; } catch (e) {} }
  if (sent) await sess.set('stWasOn', views.length > 0);
  return sent;
}
let stFlushT = null;
const stFlushSoon = () => { clearTimeout(stFlushT); stFlushT = setTimeout(() => stFlush(), 1500); };
// temporizador propio cada 5 s (las alarmas no bajan de 30 s); la alarma "st" lo revive si Chrome lo frena
let stT = null, stOn = false;
async function stLoop() {
  if (!Object.keys((await stGet()).views).length) { stOn = false; clearTimeout(stT); return chrome.alarms.clear('st'); }
  if (!(await chrome.alarms.get('st'))) await chrome.alarms.create('st', { periodInMinutes: 0.5, delayInMinutes: 0.5 });
  if (stOn) return;
  stOn = true; clearTimeout(stT);
  const step = async () => { if (!stOn) return; try { await stTick(); } catch (e) {} stT = setTimeout(step, 5000); };
  stT = setTimeout(step, 1000);
}
chrome.runtime.onStartup.addListener(() => stLoop());
stLoop();

async function tellCrm(res) {
  for (const t of await chrome.tabs.query({ url: await crmUrls() })) { try { await chrome.tabs.sendMessage(t.id, { type: 'import-result', res }); } catch (e) {} }
}

async function sendCmd(cmd) { // "hecho" desde el aviso: se lo paso a Vitalis si está abierto; si no, queda en cola
  const tabs = await vitalisTabs();
  for (const t of tabs) {
    try { const r = await chrome.tabs.sendMessage(t.id, { type: 'cmds', cmds: [cmd] }); if (r && r.ok) return true; } catch (e) {}
  }
  await mut((st) => ({ cmds: [...st.cmds, cmd] }));
  return false;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.target === 'offscreen') return false;
  if (msg.type === 'sync' && Array.isArray(msg.items)) {
    sync(msg).then(reply).catch(() => reply({ scheduled: 0, cmds: [] }));
    return true;
  }
  if (msg.type === 'crm-import' && Array.isArray(msg.rows)) {
    crmImport(msg.rows.slice(0, 500)).then(reply).catch((e) => reply({ err: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'crm-leads' && Array.isArray(msg.clients)) { crmLeads(msg.clients).then(reply).catch(() => reply(null)); return true; }
  if (msg.type === 'leads-done' && msg.res && Array.isArray(msg.res.keys)) { leadsDone(msg.res.keys); return false; }
  if (msg.type === 'import-done') { // se cargaron las que estaban en espera
    mut(() => ({ importQ: [] })).then(() => tellCrm(msg.res));
    return false;
  }
  if (msg.type === 'open-panel') { openPanel(); return false; }
  if (msg.type === 'social' && msg.card) {
    const card = msg.card;
    if (/^so:c:/.test(card.k) && card.lvl !== 'imp') card.exp = Date.now() + CHAT_MS; // mensaje común del chat: se va solo (si te nombran o es el team leader, queda)
    alertCard(card, 'social'); return false;
  }
  if (msg.type === 'social-close' && msg.k) { dismiss(msg.k); return false; }
  if (msg.type === 'crm-site-add' && msg.tabId) {
    chrome.tabs.get(msg.tabId).then((tab) => crmSiteAdd(tab, String(msg.brand || 'Novara Markets'))).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, err: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'whoami') { reply({ tabId: sender.tab ? sender.tab.id : null }); return false; }
  if (msg.type === 'crm-watch-start' && sender.tab) { watchStart(sender.tab).then(reply).catch(() => reply(null)); return true; }
  if (msg.type === 'crm-watch-go') { watchGo().then(() => reply({ ok: true })); return true; }
  if (msg.type === 'crm-current' && msg.id && sender.tab && (watchedTab(sender.tab.id) || stationOf(sender.tab.id))) { reply({ sent: false, watched: true }); return false; } // la pestaña de los news y las de la estación no cuentan (copias viejas de crm.js)
  if (msg.type === 'station-set' && sender.tab) { stationSet(sender.tab, String(msg.view || '')).then(reply).catch((e) => reply({ err: String(e && e.message || e) })); return true; }
  if (msg.type === 'station-scan' && sender.tab) { stScan(sender.tab.id, msg, sender.tab.url).then(reply).catch(() => reply(null)); return true; }
  if (msg.type === 'station-off') { stationOff().then(reply).catch(() => reply(null)); return true; }
  if (msg.type === 'crm-current' && msg.id) { // el cliente abierto en el CRM: Vitalis lo muestra como cliente actual (en la cola queda solo el último)
    (async () => {
      const c = { cmd: 'actual', k: String(msg.id).slice(0, 60), r: String(msg.name || '').slice(0, 120), at: Date.now() };
      const done = (sent) => chrome.storage.local.set({ curLast: { id: c.k, sent, at: c.at } }).then(() => sent, () => sent); // para el ícono de la extensión
      for (const t of await vitalisTabs()) { try { const r = await chrome.tabs.sendMessage(t.id, { type: 'cmds', cmds: [c] }); if (r && r.ok) return done(true); } catch (e) {} }
      await mut((st) => ({ cmds: [...st.cmds.filter((x) => x.cmd !== 'actual'), c] }));
      return done(false);
    })().then((sent) => reply({ ok: true, sent }), () => reply({ ok: true, sent: false }));
    return true;
  }
  if (msg.type === 'crm-seen' && Array.isArray(msg.rows)) { crmSeen(msg.rows).then(reply).catch(() => reply(null)); return true; }
  if (msg.type === 'seen-done' && Array.isArray(msg.keys)) { seenDone(msg.keys).then(() => deliverSeen()); return false; } // si quedaron más en cola, siguen
  if (msg.type === 'crm-watch-stop' && sender.tab) {
    watchStop(sender.tab.id).then(async () => {
      reply({ ok: true });
      // se soltó sola (esa pestaña se fue de la lista de clientes) y no queda ninguna: sin esto no llegan los avisos de new
      if (msg.auto && !Object.keys(await allW()).length && (await deskRole()) !== 'leader') {
        await alertCard({ k: 'crm:nowatch', kind: 'crm', title: 'Ninguna pestaña se actualiza sola', id: 'Elegí una en el CRM', kw: 'La que se actualizaba salió de la lista de clientes. Sin una elegida no te aviso de los clientes nuevos.', meta: hm(Date.now()), btns: [['crm', 'Ir al CRM', 1], ['close', 'Ok']] }, 'social');
      }
    });
    return true;
  }
  if (msg.type === 'crm-clients' && sender.tab && Array.isArray(msg.clients)) { crmClients(sender.tab.id, msg).then(reply).catch(() => reply(null)); return true; }
  if (msg.type === 'test') {
    alertItem({ k: 'test', n: 0, id: 'PRUEBA', kw: 'Así te van a llegar los avisos', due: Date.now() })
      .then(async (r) => reply({ ok: true, ...r, level: await level() }))
      .catch((e) => reply({ ok: false, err: String(e) }));
    return true;
  }
  if (msg.type === 'overlay' && msg.k) {
    (async () => {
      await dismiss(msg.k);
      if (msg.k.startsWith('crm:')) { if (msg.a === 'crm') await focusCrm(); return; }
      if (msg.k.startsWith('so:b:')) { // falla de pago: abrir Vitalis en Banking
        if (msg.a === 'open') { await openPanel(); await sendCmd({ cmd: 'banking', k: msg.k.slice(5), at: Date.now() }); }
        return;
      }
      if (msg.k.startsWith('so:c:')) { // mensaje del chat: abrir Vitalis en ese chat
        if (msg.a === 'open') { await openPanel(); await sendCmd({ cmd: 'chat', k: msg.k.slice(5), at: Date.now() }); }
        return;
      }
      if (msg.k.startsWith('so:')) { // tarjeta social: la respuesta va a Vitalis
        const id = msg.k.slice(3);
        if (msg.a.startsWith('r:')) await sendCmd({ cmd: 'reply', k: id, r: msg.a.slice(2), at: Date.now() });
        else if (msg.a === 'quiet') await sendCmd({ cmd: 'quiet', k: id, at: Date.now() });
        return;
      }
      if (msg.k === 'test') { if (msg.a === 'open') await openPanel(); return; }
      if (msg.a === 'done') {
        await mut((st) => ({ items: st.items.filter((x) => x.k !== msg.k) }));
        await chrome.alarms.clear('p:' + msg.k); await chrome.alarms.clear('s:' + msg.k);
        await sendCmd({ cmd: 'done', k: msg.k, at: Date.now() });
      } else if (msg.a === 'snooze') {
        await chrome.alarms.create('s:' + msg.k, { when: Date.now() + 15 * 6e4 });
      } else if (msg.a === 'open') await openPanel();
    })();
    return false;
  }
  return false;
});

// cada 30 s despierto a Vitalis si está en segundo plano (Chrome frena sus relojes): se pone al día con lo social y el chat
async function tickVitalis() {
  for (const t of await vitalisTabs()) { try { await chrome.tabs.sendMessage(t.id, { type: 'tick' }); } catch (e) {} }
  // lo que quedó en cola (Vitalis estaba cargando o cerrado) se vuelve a intentar; y el aviso pendiente sigue a la vista
  const st = await state();
  if (st.crmQ.length) deliverSeen();
  if (st.leadQ.length) deliverLeads();
  if ((await liveNow()).length) { const { tab } = await cardTab(); if (tab) injectInto(tab.id); }
  stFlush(); // la estación (si esta compu lo es): el latido
}
chrome.alarms.get('vt').then((a) => { if (!a) chrome.alarms.create('vt', { periodInMinutes: 0.5 }); });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'vt') return tickVitalis();
  if (a.name === 'crm-watch') return ensureLoop(); // revive el temporizador de 10 s si Chrome lo frenó
  if (a.name === 'st') return stLoop(); // y el de la estación
  const snooze = a.name.startsWith('s:');
  if (!snooze && !a.name.startsWith('p:')) return;
  const k = a.name.slice(2);
  const st = await state();
  const it = st.items.find((x) => x.k === k);
  if (!it) return;
  if (!snooze && st.fired[keyOf(it)]) return;
  await alertItem(it, { snooze });
});

async function openPanel() {
  const { url } = await state();
  if (!url) return;
  const [tab] = await vitalisTabs();
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}
const kOf = (nid) => nid.split('|').slice(2).join('|');

chrome.notifications.onClicked.addListener((nid) => { chrome.notifications.clear(nid); const k = kOf(nid); if (k.startsWith('crm:')) { dismiss(k); focusCrm(); } else openPanel(); });
chrome.notifications.onButtonClicked.addListener(async (nid, btn) => {
  chrome.notifications.clear(nid);
  const k = kOf(nid);
  if (k) await dismiss(k);
  if (k.startsWith('crm:')) return focusCrm();
  if (btn === 0) return openPanel();
  if (k && k !== 'test') await chrome.alarms.create('s:' + k, { when: Date.now() + 15 * 6e4 });
});

/* ---------- snippets en todo Chrome ---------- */
// al instalar o actualizar, los pongo en las pestañas que ya estaban abiertas (sin tener que recargarlas)
const VITALIS_URL = ['https://vitalis.joaquin-or24.workers.dev/*', 'https://vitaliscrm.netlify.app/*']; // la nueva (Cloudflare) y la vieja mientras dure el cambio
chrome.runtime.onInstalled.addListener(async () => {
  snipMenu();
  for (const t of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['snip.js'] }).catch(() => {});
  }
  for (const t of await chrome.tabs.query({ url: VITALIS_URL })) {
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['bridge.js'] }).catch(() => {});
  }
  // las pestañas del CRM abiertas también reciben la copia nueva (si no, quedaban sin andar hasta recargarlas)
  for (const t of await chrome.tabs.query({ url: await crmUrls() })) {
    chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['crm.js'] }).catch(() => {});
  }
});
chrome.runtime.onStartup.addListener(() => snipMenu());
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.snips) snipMenu(); });
// clic derecho en cualquier campo → Snippets de Vitalis → el que quieras (por si el /atajo no anda en alguna página)
let menuT = null;
function snipMenu() {
  clearTimeout(menuT);
  menuT = setTimeout(async () => {
    if (!chrome.contextMenus) return;
    const { snips = [] } = await chrome.storage.local.get('snips');
    await new Promise((r) => chrome.contextMenus.removeAll(r));
    chrome.contextMenus.create({ id: 'snip', title: 'Snippets de Vitalis', contexts: ['editable'] });
    if (!snips.length) { chrome.contextMenus.create({ id: 'snip:none', parentId: 'snip', title: 'Abrí Vitalis para traer tus snippets', contexts: ['editable'], enabled: false }); return; }
    for (const x of snips.slice(0, 60)) {
      const pv = (x.t || x.b || '').replace(/\s+/g, ' ').trim();
      chrome.contextMenus.create({ id: 'snip:' + x.s, parentId: 'snip', title: `/${x.s}${pv ? '  ·  ' + (pv.length > 40 ? pv.slice(0, 39) + '…' : pv) : ''}`, contexts: ['editable'] });
    }
  }, 300);
}
chrome.contextMenus && chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId || '');
  if (!id.startsWith('snip:') || !tab || tab.id == null) return;
  const { snips = [], me = '' } = await chrome.storage.local.get(['snips', 'me']);
  const x = snips.find((s) => s.s === id.slice(5));
  if (!x) return;
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const text = x.b.replace(/\{fecha\}/g, `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`).replace(/\{hora\}/g, `${p2(d.getHours())}:${p2(d.getMinutes())}`).replace(/\{yo\}/g, me);
  const target = { tabId: tab.id }; if (info.frameId) target.frameIds = [info.frameId];
  chrome.scripting.executeScript({ target, func: pasteSnip, args: [text] }).catch(() => {});
});
function pasteSnip(text) { // corre en la página: pega en el campo donde estás (aunque esté en un shadow DOM)
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el) return false;
  const cur = text.indexOf('{cursor}'); text = text.replace(/\{cursor\}/g, '');
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a, was = el.value;
    el.focus();
    if (!document.execCommand('insertText', false, text) || el.value === was) { el.setRangeText(text, a, b, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); }
    if (cur >= 0 && el.setSelectionRange) { const q = a + cur; el.setSelectionRange(q, q); }
    return true;
  }
  if (el.isContentEditable) {
    let ok = false;
    if (text.includes('\n')) { try { const dt = new DataTransfer(); dt.setData('text/plain', text); const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); el.dispatchEvent(ev); ok = ev.defaultPrevented; } catch (e) {} }
    if (!ok) document.execCommand('insertText', false, text);
    return true;
  }
  return false;
}
