// Vitalis — service worker
// · Agenda: recibe los contactos de Vitalis y, a la hora, avisa.
// · CRM: pasa a Vitalis las ventas del botón y vigila una página para avisar cuando entra un cliente en "new".
// Los avisos son:
//   · tarjeta en la pestaña que estés mirando (o una ventanita si esa pestaña no se puede usar)
//   · sonido
//   · notificación del sistema (si Windows/Mac la deja pasar)

const MAX_LATE = 6 * 3600e3; // al sincronizar, los vencidos hace más de 6 h no se avisan
const z = (n) => String(n).padStart(2, '0');
const hm = (ms) => { const d = new Date(ms); return `${z(d.getHours())}:${z(d.getMinutes())}`; };
const keyOf = (it) => it.k + '@' + it.due;

async function state() {
  const s = await chrome.storage.local.get(['items', 'fired', 'url', 'lastSync', 'cmds', 'importQ', 'leadQ', 'leadIds']);
  return { items: s.items || [], fired: s.fired || {}, url: s.url || null, lastSync: s.lastSync || 0, cmds: s.cmds || [], importQ: s.importQ || [], leadQ: s.leadQ || [], leadIds: s.leadIds || [] };
}
const nrm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // igual que en Vitalis
const leadKey = (c) => nrm(c.id ? String(c.id).replace(/\s+/g, ' ').trim().slice(0, 60) : 'n:' + nrm(c.name));
const ymdLocal = () => { const d = new Date(); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
const sess = {
  async get(k, d) { const s = await chrome.storage.session.get(k); return s[k] ?? d; },
  set(k, v) { return chrome.storage.session.set({ [k]: v }); },
};

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
  let host = document.getElementById(ID);
  if (!host) {
    host = document.createElement('div');
    host.id = ID;
    host.style.cssText = 'all:initial;position:fixed;top:14px;right:14px;z-index:2147483647;';
    (document.body || document.documentElement).appendChild(host);
    host.attachShadow({ mode: 'open' }).innerHTML = `<style>
      .stack{display:flex;flex-direction:column;gap:10px;width:min(370px,calc(100vw - 28px));font:13.5px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
      .card{--c:#e08a1e;background:#fff;color:#15201a;border:1px solid #dfe5dc;border-top:5px solid var(--c);border-radius:18px;padding:12px 14px 13px;box-shadow:0 18px 48px rgba(0,0,0,.28);animation:in .25s ease-out,nudge .6s ease-in-out .3s 2}
      .card.crm{--c:#2f7fd0}
      @keyframes in{from{opacity:0;transform:translateY(-10px)}}
      @keyframes nudge{50%{transform:rotate(-1.2deg) scale(1.02)}}
      .h{display:flex;align-items:center;gap:8px;margin-bottom:6px}
      .mk{width:22px;height:22px}
      .tag{font-weight:800;font-size:15px;letter-spacing:-.03em}
      .t{color:var(--c);font-weight:800;flex:1;font-size:12.5px;text-transform:none}
      .x{all:unset;cursor:pointer;color:#5b685f;padding:0 6px;border-radius:6px}.x:hover{background:#ecf0e9;color:#15201a}
      .id{font-size:24px;font-weight:800;letter-spacing:-.02em}
      .kw{margin:2px 0 4px;word-break:break-word}
      .m{color:#5b685f;font-size:12.5px}
      .b{display:flex;gap:6px;margin-top:11px;flex-wrap:wrap}
      .b button{all:unset;cursor:pointer;font-size:13px;font-weight:700;color:#15201a;border:1px solid #dfe5dc;border-radius:999px;padding:5px 12px}
      .b button:hover{border-color:#5b685f}
      .b button.p{background:#1b874a;border-color:#1b874a;color:#fff}
      .b button.p:hover{background:#156f3c}
    </style><div class="stack"></div>`;
  }
  const stack = host.shadowRoot.querySelector('.stack');
  for (const d of items) {
    if (stack.querySelector(`[data-k="${CSS.escape(d.k)}"]`)) continue;
    const card = document.createElement('div');
    card.className = 'card' + (d.kind === 'crm' ? ' crm' : ''); card.dataset.k = d.k; card.setAttribute('role', 'alert');
    card.innerHTML = '<div class="h"><img class="mk" alt=""><span class="tag">vitalis</span><span class="t"></span><button class="x" data-a="close" title="Cerrar">✕</button></div><div class="id"></div><div class="kw"></div><div class="m"></div><div class="b"></div>';
    try { card.querySelector('.mk').src = chrome.runtime.getURL('icons/48.png'); } catch (e) { card.querySelector('.mk').remove(); }
    card.querySelector('.t').textContent = d.title || 'Contactar';
    card.querySelector('.id').textContent = d.id;
    card.querySelector('.kw').textContent = d.kw;
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
  }
}
function ftdOverlayRemove(k) {
  const host = document.getElementById('ftd-agenda-overlay'); if (!host) return;
  const stack = host.shadowRoot.querySelector('.stack');
  const c = stack.querySelector(`[data-k="${CSS.escape(k)}"]`); if (c) c.remove();
  if (!stack.children.length) host.remove();
}

async function injectInto(tabId) {
  const live = await sess.get('live', []);
  if (!live.length) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: ftdOverlay, args: [live] });
    const tabs = await sess.get('tabs', []);
    if (!tabs.includes(tabId)) await sess.set('tabs', [...tabs, tabId].slice(-50));
    return true;
  } catch (e) { return false; }
}
async function showNow() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab && tab.id != null && await injectInto(tab.id)) {
    try { await chrome.windows.update(tab.windowId, { drawAttention: true }); } catch (e) {}
    return 'pestaña';
  }
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
  const live = (await sess.get('live', [])).filter((x) => x.k !== k);
  await sess.set('live', live);
  for (const tabId of await sess.get('tabs', [])) {
    chrome.scripting.executeScript({ target: { tabId }, func: ftdOverlayRemove, args: [k] }).catch(() => {});
  }
  if (!live.length) await sess.set('tabs', []);
}
// al cambiar de pestaña (o cargar otra página) el aviso te sigue hasta que lo atiendas
chrome.tabs.onActivated.addListener(async ({ tabId }) => { if ((await sess.get('live', [])).length) injectInto(tabId); });
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === 'complete' && tab.active && (await sess.get('live', [])).length) injectInto(tabId);
});

/* ---------- aviso completo ---------- */
const createN = (id, opt) => new Promise((r) => chrome.notifications.create(id, opt, () => r(chrome.runtime.lastError ? chrome.runtime.lastError.message : null)));
const level = () => new Promise((r) => chrome.notifications.getPermissionLevel(r));

async function alertItem(it, { snooze = false } = {}) {
  const st = await state();
  st.fired[keyOf(it)] = Date.now();
  await chrome.storage.local.set({ fired: st.fired });
  const late = Date.now() - it.due > 5 * 6e4;
  const tag = snooze ? 'recordatorio' : late ? 'atrasado' : '';
  const info = { k: it.k, kind: 'agenda', title: 'Hora de contactar', id: it.id, kw: it.kw || '(sin palabra clave)', meta: `${dayTxt(it.due)}${tag ? ', ' + tag : ''}`,
    btns: [['done', 'Hecho', 1], ['snooze', '+15 min'], ['open', 'Abrir Vitalis']] };
  const live = (await sess.get('live', [])).filter((x) => x.k !== it.k);
  await sess.set('live', [...live, info]);
  const sound = await playSound('agenda');
  const where = await showNow();
  const sys = await createN('n|' + Date.now() + '|' + it.k, {
    type: 'basic', iconUrl: 'icons/128.png', title: `📞 Contactar ${it.id}`, message: info.kw,
    contextMessage: info.meta,
    priority: 2, requireInteraction: true, buttons: [{ title: 'Abrir Vitalis' }, { title: 'Recordar en 15 min' }],
  });
  return { where, sound, sys };
}

/* ---------- sincronización con el panel ---------- */
async function sync(msg) {
  const { items, url, known } = msg;
  const st = await state();
  const now = Date.now();
  const keys = new Set(items.map(keyOf));
  const fired = {};
  for (const k in st.fired) if (keys.has(k)) fired[k] = st.fired[k];
  const upd = { items, url: url || st.url, lastSync: now, fired, cmds: [] };
  if (known) upd.known = { ids: known.ids, txs: known.txs, at: now }; // para que el botón del CRM sepa cuáles ya están
  if (Array.isArray(msg.snips)) upd.snips = msg.snips; // los snippets que pega snip.js en cualquier página
  if (msg.user) upd.me = msg.user;
  if (Array.isArray(msg.leadIds)) { upd.leadIds = msg.leadIds; const have = new Set(msg.leadIds); upd.leadQ = st.leadQ.filter((c) => !have.has(leadKey(c))); }
  await chrome.storage.local.set(upd);

  const alive = new Set(items.map((x) => x.k));
  for (const a of await chrome.alarms.getAll()) {
    if (a.name.startsWith('p:') || (a.name.startsWith('s:') && !alive.has(a.name.slice(2)))) await chrome.alarms.clear(a.name);
  }
  for (const l of await sess.get('live', [])) if (l.k !== 'test' && !alive.has(l.k)) await dismiss(l.k); // ya resuelto en el panel
  let scheduled = 0;
  for (const it of items) {
    if (fired[keyOf(it)]) continue;
    if (it.due > now) { await chrome.alarms.create('p:' + it.k, { when: it.due }); scheduled++; }
    else if (now - it.due < MAX_LATE) await alertItem(it);
  }
  return { scheduled, cmds: st.cmds, imports: st.importQ, leads: upd.leadQ || st.leadQ };
}

/* ---------- clientes new del CRM → registro de Vitalis ---------- */
async function crmLeads(clients) {
  const st = await state(), have = new Set(st.leadIds), inQ = new Set(st.leadQ.map(leadKey)), today = ymdLocal(), fresh = [];
  const cl = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  for (const c of clients.slice(0, 300)) {
    const k = leadKey(c);
    if (!k || k === 'n:' || have.has(k) || inQ.has(k)) continue;
    inQ.add(k); fresh.push({ id: cl(c.id, 60), name: cl(c.name, 120), country: cl(c.country, 60), date: today });
  }
  if (!fresh.length) return { fresh: 0 };
  await chrome.storage.local.set({ leadQ: [...st.leadQ, ...fresh].slice(-500) });
  await deliverLeads();
  return { fresh: fresh.length };
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
  const st = await state(), ks = new Set(keys.map(String));
  await chrome.storage.local.set({ leadQ: st.leadQ.filter((c) => !ks.has(leadKey(c))), leadIds: [...new Set([...st.leadIds, ...ks])].slice(-50000) });
}

/* ---------- ventas desde el CRM ---------- */
const CRM_URLS = ['https://crmnovaramarkets.com/*', 'https://*.crmnovaramarkets.com/*'];
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
      const r = await withTimeout(chrome.tabs.sendMessage(t.id, { type: 'import', rows }), 10000);
      if (r && !r.noPanel) return r;
    } catch (e) {}
  }
  // Vitalis no está abierto: quedan en espera hasta la próxima vez que se abra
  const st = await state(), seen = new Set(), q = [];
  for (const x of [...st.importQ, ...rows]) { const k = x.brand + '|' + x.id; if (!seen.has(k)) { seen.add(k); q.push(x); } }
  await chrome.storage.local.set({ importQ: q.slice(-500) });
  return { queued: rows.length };
}
/* ---------- vigilar una página del CRM: clientes en "new" ---------- */
async function getWatch() { return (await chrome.storage.local.get('watch')).watch || null; }
const setWatchS = (w) => chrome.storage.local.set({ watch: w });
async function watchStart(tab, sec) {
  const old = await getWatch();
  const same = old && old.tabId === tab.id;
  const w = { tabId: tab.id, url: tab.url, title: tab.title, sec: sec || 30, seen: same ? old.seen : {}, base: same ? old.base : false, since: same ? old.since : Date.now(), lastRefresh: same ? old.lastRefresh : 0, loginAt: 0 };
  await setWatchS(w);
  try { await chrome.tabs.update(tab.id, { pinned: true }); } catch (e) {}
  await ensureLoop(true);
  return w;
}
async function watchStop() { loopOn = false; clearTimeout(loopT); await chrome.storage.local.remove('watch'); await chrome.alarms.clear('crm-watch'); }
async function watchTick() {
  const w = await getWatch();
  if (!w) return chrome.alarms.clear('crm-watch');
  let tab = null; try { tab = await chrome.tabs.get(w.tabId); } catch (e) {}
  if (!tab) return watchStop();
  let r = null;
  try { r = await withTimeout(chrome.tabs.sendMessage(w.tabId, { type: 'crm-refresh' }), 5000); } catch (e) {}
  if (!r && tab.status === 'complete') { try { await chrome.tabs.reload(w.tabId); } catch (e) {} } // la página no responde: la recargo
  if (!r || !r.skipped) await setWatchS({ ...(await getWatch() || w), lastRefresh: Date.now() });
}
// Las alarmas de Chrome no bajan de 30 s: para 10 o 15 s uso un temporizador propio, y la alarma de 30 s lo revive si Chrome lo frena.
let loopT = null, loopOn = false;
const secOf = (w) => (w && (w.sec || (w.every ? w.every * 60 : 30))) || 30;
async function ensureLoop(restart) {
  const w = await getWatch();
  if (!w) { loopOn = false; clearTimeout(loopT); return chrome.alarms.clear('crm-watch'); }
  const sec = secOf(w);
  const a = await chrome.alarms.get('crm-watch'), period = Math.max(0.5, sec / 60);
  if (restart || !a || Math.abs(a.periodInMinutes - period) > 0.01) await chrome.alarms.create('crm-watch', { periodInMinutes: period, delayInMinutes: period });
  if (sec >= 30) { loopOn = false; clearTimeout(loopT); return; }
  if (loopOn && !restart) return;
  loopOn = true; clearTimeout(loopT);
  const step = async () => {
    if (!loopOn) return;
    const w2 = await getWatch();
    if (!w2 || secOf(w2) >= 30) { loopOn = false; return; }
    await watchTick();
    loopT = setTimeout(step, secOf(w2) * 1000);
  };
  loopT = setTimeout(step, sec * 1000);
}
chrome.runtime.onStartup.addListener(() => ensureLoop(false));
ensureLoop(false);
chrome.tabs.onRemoved.addListener(async (tabId) => { const w = await getWatch(); if (w && w.tabId === tabId) await watchStop(); });
async function crmClients(tabId, m) {
  const w = await getWatch();
  if (!w || w.tabId !== tabId) return { watched: false };
  const now = Date.now();
  if (m.login) { // se cerró la sesión del CRM: aviso una vez por hora
    if (now - (w.loginAt || 0) > 3600e3) {
      await setWatchS({ ...w, loginAt: now });
      await alertCard({ k: 'crm:login', kind: 'crm', title: 'El CRM cerró la sesión', id: 'Volvé a entrar al CRM', kw: 'Mientras tanto no puedo ver los clientes nuevos.', meta: hm(now), btns: [['crm', 'Ir al CRM', 1], ['close', 'Ok']] }, 'crm', '⚠ El CRM cerró la sesión', 'Volvé a entrar para seguir vigilando los clientes nuevos.');
    }
    return { watched: true };
  }
  if (!m.ok) return { watched: true };
  if ((await sess.get('live', [])).some((x) => x.k === 'crm:login')) await dismiss('crm:login'); // volvió la sesión
  const seen = { ...w.seen }, fresh = [];
  for (const c of m.clients) { if (!seen[c.key]) { if (w.base) fresh.push(c); seen[c.key] = now; } }
  const keys = Object.keys(seen); if (keys.length > 3000) for (const k of keys.sort((a, b) => seen[a] - seen[b]).slice(0, keys.length - 3000)) delete seen[k];
  await setWatchS({ ...w, seen, base: true, inNew: m.clients.length, loginAt: 0 });
  for (const c of fresh.slice(0, 5)) {
    await alertCard({ k: 'crm:' + c.key, kind: 'crm', title: 'Cliente nuevo en el CRM', id: c.id || c.name, kw: c.id ? c.name : '', meta: [c.country, 'entró ' + hm(now)].filter(Boolean).join(' · '),
      btns: [['crm', 'Ver en el CRM', 1], ['close', 'Ok']] }, 'crm', `🆕 Cliente nuevo: ${c.id || c.name}`, [c.name, c.country].filter(Boolean).join(' · '));
  }
  if (fresh.length > 5) await alertCard({ k: 'crm:mas' + now, kind: 'crm', title: 'Clientes nuevos en el CRM', id: `+${fresh.length - 5} más`, kw: 'Hay más clientes en new.', meta: hm(now), btns: [['crm', 'Ver en el CRM', 1], ['close', 'Ok']] }, null);
  return { watched: true, fresh: fresh.length };
}
async function alertCard(info, tone, sysTitle, sysMsg) {
  const live = (await sess.get('live', [])).filter((x) => x.k !== info.k);
  await sess.set('live', [...live, info]);
  if (tone) await playSound(tone);
  await showNow();
  if (sysTitle) await createN('n|' + Date.now() + '|' + info.k, { type: 'basic', iconUrl: 'icons/128.png', title: sysTitle, message: sysMsg || '', priority: 2, requireInteraction: true, buttons: [{ title: 'Ver en el CRM' }] });
}
async function focusCrm() {
  const w = await getWatch();
  let tab = null;
  if (w) { try { tab = await chrome.tabs.get(w.tabId); } catch (e) {} }
  if (!tab) [tab] = await chrome.tabs.query({ url: CRM_URLS });
  if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
  else if (w) await chrome.tabs.create({ url: w.url });
}

async function tellCrm(res) {
  for (const t of await chrome.tabs.query({ url: CRM_URLS })) { try { await chrome.tabs.sendMessage(t.id, { type: 'import-result', res }); } catch (e) {} }
}

async function sendCmd(cmd) { // "hecho" desde el aviso: se lo paso a Vitalis si está abierto; si no, queda en cola
  const tabs = await vitalisTabs();
  for (const t of tabs) {
    try { const r = await chrome.tabs.sendMessage(t.id, { type: 'cmds', cmds: [cmd] }); if (r && r.ok) return true; } catch (e) {}
  }
  const st = await state();
  await chrome.storage.local.set({ cmds: [...st.cmds, cmd] });
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
    chrome.storage.local.set({ importQ: [] }).then(() => tellCrm(msg.res));
    return false;
  }
  if (msg.type === 'open-panel') { openPanel(); return false; }
  if (msg.type === 'whoami') { reply({ tabId: sender.tab ? sender.tab.id : null }); return false; }
  if (msg.type === 'crm-watch-start' && sender.tab) { watchStart(sender.tab, Math.max(10, Math.min(1800, +msg.sec || 30))).then(() => reply({ ok: true })); return true; }
  if (msg.type === 'crm-watch-stop') { watchStop().then(() => reply({ ok: true })); return true; }
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
      if (msg.k === 'test') { if (msg.a === 'open') await openPanel(); return; }
      if (msg.a === 'done') {
        const st = await state();
        await chrome.storage.local.set({ items: st.items.filter((x) => x.k !== msg.k) });
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

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'crm-watch') { const w = await getWatch(); if (secOf(w) < 30) return ensureLoop(false); return watchTick(); }
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
