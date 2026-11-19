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
      .card{--c:#cf3049;background:#fff;color:#15201a;border:1px solid #dfe5dc;border-top:5px solid var(--c);border-radius:18px;padding:12px 14px 13px;box-shadow:0 18px 48px rgba(0,0,0,.28);animation:in .25s ease-out,nudge .6s ease-in-out .3s 2}
      .card.urg{--c:#cf3049}
      .card.imp{--c:#c9661f}
      .card.info{--c:#2f7fd0;animation:in .25s ease-out}
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
      .b button.p{background:var(--c);border-color:var(--c);color:#fff}
      .b button.p:hover{filter:brightness(.92)}
    </style><div class="stack"></div>`;
  }
  const stack = host.shadowRoot.querySelector('.stack');
  for (const d of items) {
    const had = stack.querySelector(`[data-k="${CSS.escape(d.k)}"]`);
    if (had && (had.dataset.v || '') === (d.v || '')) continue;
    if (had) had.remove(); // misma tarjeta con algo nuevo (otro mensaje del mismo chat)
    const card = document.createElement('div');
    // color según importancia: urgente (agenda) rojo, importante (clientes new, tareas, el team leader te nombra) naranja, el resto (chat, social) celeste
    const lvl = d.lvl || (d.kind === 'crm' ? 'imp' : d.kind === 'social' ? (/^so:t:/.test(d.k) ? 'imp' : 'info') : 'urg');
    card.className = 'card ' + lvl + (d.kind ? ' ' + d.kind : ''); card.dataset.k = d.k; card.dataset.v = d.v || ''; card.setAttribute('role', 'alert');
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
  const live = await sess.get('live', []);
  if (!live.length) return true;
  try {
    if (!cardOk(await chrome.tabs.get(tabId))) return false;
    await chrome.scripting.executeScript({ target: { tabId }, func: ftdOverlay, args: [live] });
    const tabs = await sess.get('tabs', []);
    if (!tabs.includes(tabId)) await sess.set('tabs', [...tabs, tabId].slice(-50));
    return true;
  } catch (e) { return false; }
}
async function showNow() {
  const { tab, blocked } = await cardTab();
  if (tab && await injectInto(tab.id)) {
    try { await chrome.windows.update(tab.windowId, { drawAttention: true }); } catch (e) {}
    return 'pestaña';
  }
  if (blocked) return 'espera'; // estás en Voiso: no te tapo nada, la tarjeta te espera en la próxima pestaña
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
  if (msg.desk) upd.desk = msg.desk; // para el botón del CRM del team leader
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
  return { scheduled, cmds: st.cmds, imports: st.importQ, leads: upd.leadQ || st.leadQ, seen: st.crmQ.slice(0, 500) };
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

/* ---------- todos los clientes que se ven en el CRM → registro de clientes de Vitalis ---------- */
// cola por marca y cliente con la última foto de cada uno; cada fila lleva k = clave@hora, y Vitalis devuelve las que guardó
const seenKey = (r) => nrm(r.brand) + '|' + nrm(r.id);
const REG_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;
async function crmSeen(rows) {
  const st = await state(), q = new Map(st.crmQ.map((r) => [seenKey(r), r])), now = Date.now();
  const cl = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  for (const r of rows.slice(0, 1000)) {
    const id = cl(r.id, 60); if (!id) continue;
    const row = { id, brand: cl(r.brand, 40), name: cl(r.name, 120), country: cl(r.country, 60), status: cl(r.status, 60), reg: REG_RE.test(r.reg || '') ? r.reg : '',
      agent: cl(r.agent, 80), camp: cl(r.camp, 120), aff: cl(r.aff, 60), call: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.call || '') ? r.call : '', note: cl(r.note, 200) };
    row.k = seenKey(row) + '@' + now;
    q.set(seenKey(row), row);
  }
  await chrome.storage.local.set({ crmQ: [...q.values()].slice(-5000) });
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
async function seenDone(keys) { const st = await state(), ks = new Set(keys.map(String)); await chrome.storage.local.set({ crmQ: st.crmQ.filter((r) => !ks.has(r.k)) }); }

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
  const st = await state(), seen = new Set(), q = [];
  for (const x of [...st.importQ, ...rows]) { const k = x.brand + '|' + x.id; if (!seen.has(k)) { seen.add(k); q.push(x); } }
  await chrome.storage.local.set({ importQ: q.slice(-500) });
  return { queued: rows.length };
}
/* ---------- una sola pestaña del CRM se actualiza sola cada 10 s: la que se eligió con el botón ---------- */
const EVERY = 10; // segundos, fijo
async function allW() { return (await chrome.storage.local.get('watches')).watches || {}; }
async function getW(tabId) { return (await allW())[tabId] || null; }
async function setW(tabId, w) { const all = await allW(); if (w) all[tabId] = w; else delete all[tabId]; await chrome.storage.local.set({ watches: all }); }
const isCrmUrl = async (url) => { try { const h = new URL(url).hostname, s = (await chrome.storage.local.get('crmSites')).crmSites || {}; return /(^|\.)crm(novaramarkets|trade24seven)\.com$/.test(h) || !!s[h]; } catch (e) { return false; } };
async function watchStart(tab) {
  const all = await allW();
  for (const w of Object.values(all)) { // ya hay otra elegida (y sigue abierta en el CRM): no se puede elegir esta
    if (!w || w.tabId === tab.id) continue;
    let t = null; try { t = await chrome.tabs.get(w.tabId); } catch (e) {}
    if (t && await isCrmUrl(t.url)) return { busy: true, tabId: w.tabId, title: t.title || w.title || '' };
    delete all[w.tabId];
  }
  const old = all[tab.id];
  all[tab.id] = { tabId: tab.id, url: tab.url, title: tab.title, seen: old ? old.seen : {}, base: old ? old.base : false, since: old ? old.since : Date.now(), lastRefresh: old ? old.lastRefresh : 0, loginAt: old ? old.loginAt : 0, inNew: old ? old.inNew : null };
  await chrome.storage.local.set({ watches: all });
  try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch (e) {} // que Chrome no la duerma para ahorrar memoria
  await ensureLoop();
  return { ok: true };
}
async function watchGo() { const w = Object.values(await allW())[0]; if (!w) return; try { const t = await chrome.tabs.get(w.tabId); await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); } catch (e) {} }
async function watchPrune() { // de la versión anterior (todas las pestañas): queda solo la más reciente
  const ws = Object.values(await allW()); if (ws.length <= 1) return;
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
  if (!r || !r.skipped) { const cur = await getW(w.tabId); if (cur) await setW(w.tabId, { ...cur, lastRefresh: Date.now() }); }
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
chrome.storage.local.remove('watch'); // la vigilancia vieja (una sola pestaña, con opciones)
chrome.tabs.onRemoved.addListener(async (tabId) => { if (await getW(tabId)) await watchStop(tabId); });
async function crmClients(tabId, m) {
  const w = await getW(tabId);
  if (!w) return { watched: false };
  const now = Date.now();
  if (m.login) { // se cerró la sesión del CRM: aviso una vez por hora
    if (now - (w.loginAt || 0) > 3600e3) {
      await setW(tabId, { ...w, loginAt: now });
      await alertCard({ k: 'crm:login', kind: 'crm', title: 'El CRM cerró la sesión', id: 'Volvé a entrar al CRM', kw: 'Mientras tanto no puedo ver los clientes nuevos.', meta: hm(now), btns: [['crm', 'Ir al CRM', 1], ['close', 'Ok']] }, 'crm', '⚠ El CRM cerró la sesión', 'Volvé a entrar para seguir vigilando los clientes nuevos.');
    }
    return { watched: true };
  }
  if (!m.ok) return { watched: true };
  if ((await sess.get('live', [])).some((x) => x.k === 'crm:login')) await dismiss('crm:login'); // volvió la sesión
  const seen = { ...w.seen }, fresh = [];
  for (const c of m.clients) { if (!seen[c.key]) { if (w.base) fresh.push(c); seen[c.key] = now; } }
  const keys = Object.keys(seen); if (keys.length > 3000) for (const k of keys.sort((a, b) => seen[a] - seen[b]).slice(0, keys.length - 3000)) delete seen[k];
  await setW(tabId, { ...w, seen, base: true, inNew: m.clients.length, loginAt: 0 });
  for (const c of fresh.slice(0, 10)) if (c.id) await sendCmd({ cmd: 'nuevo', k: String(c.id).slice(0, 60), at: now }); // en Vitalis se abre la ficha
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
async function focusCrm() { // la pestaña de clientes (la que tiene clientes en new), si no cualquiera del CRM
  const ws = Object.values(await allW()), w = ws.find((x) => x.inNew != null) || ws[0] || null;
  let tab = null;
  if (w) { try { tab = await chrome.tabs.get(w.tabId); } catch (e) {} }
  if (!tab) [tab] = await chrome.tabs.query({ url: await crmUrls() });
  if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
  else if (w) await chrome.tabs.create({ url: w.url });
}

async function tellCrm(res) {
  for (const t of await chrome.tabs.query({ url: await crmUrls() })) { try { await chrome.tabs.sendMessage(t.id, { type: 'import-result', res }); } catch (e) {} }
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
  if (msg.type === 'social' && msg.card) { alertCard(msg.card, 'social'); return false; }
  if (msg.type === 'social-close' && msg.k) { dismiss(msg.k); return false; }
  if (msg.type === 'crm-site-add' && msg.tabId) {
    chrome.tabs.get(msg.tabId).then((tab) => crmSiteAdd(tab, String(msg.brand || 'Novara Markets'))).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, err: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'whoami') { reply({ tabId: sender.tab ? sender.tab.id : null }); return false; }
  if (msg.type === 'crm-watch-start' && sender.tab) { watchStart(sender.tab).then(reply).catch(() => reply(null)); return true; }
  if (msg.type === 'crm-watch-go') { watchGo().then(() => reply({ ok: true })); return true; }
  if (msg.type === 'crm-seen' && Array.isArray(msg.rows)) { crmSeen(msg.rows).then(reply).catch(() => reply(null)); return true; }
  if (msg.type === 'seen-done' && Array.isArray(msg.keys)) { seenDone(msg.keys); return false; }
  if (msg.type === 'crm-watch-stop' && sender.tab) { watchStop(sender.tab.id).then(() => reply({ ok: true })); return true; }
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

// cada 30 s despierto a Vitalis si está en segundo plano (Chrome frena sus relojes): se pone al día con lo social y el chat
async function tickVitalis() { for (const t of await vitalisTabs()) { try { await chrome.tabs.sendMessage(t.id, { type: 'tick' }); } catch (e) {} } }
chrome.alarms.get('vt').then((a) => { if (!a) chrome.alarms.create('vt', { periodInMinutes: 0.5 }); });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'vt') return tickVitalis();
  if (a.name === 'crm-watch') return ensureLoop(); // revive el temporizador de 10 s si Chrome lo frenó
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
