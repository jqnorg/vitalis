const z = (n) => String(n).padStart(2, '0');
function when(ms) {
  const d = new Date(ms), t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - t) / 864e5);
  const dd = diff === 0 ? 'hoy' : diff === 1 ? 'mañana' : diff === -1 ? 'ayer' : `${z(d.getDate())}/${z(d.getMonth() + 1)}`;
  return `${dd} ${z(d.getHours())}:${z(d.getMinutes())}`;
}
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 6e4);
  return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
}
async function render() {
  const { items = [], lastSync = 0, snips = [], leadQ = [], me = '', curLast = null } = await chrome.storage.local.get(['items', 'lastSync', 'snips', 'leadQ', 'me', 'curLast']);
  const st = document.getElementById('st'), ul = document.getElementById('list');
  document.getElementById('who').textContent = me;
  st.textContent = (lastSync ? `Sincronizado ${ago(lastSync)}.` : 'Abrí Vitalis en este Chrome para sincronizar.') + ` Versión ${chrome.runtime.getManifest().version}.`
    + (curLast ? ` Cliente actual: ${curLast.id} (${ago(curLast.at)}${curLast.sent ? ', en Vitalis' : ', Vitalis no estaba abierto'}).` : ' Todavía no vi un cliente abierto en el CRM.');
  const stats = document.getElementById('stats'); stats.textContent = '';
  for (const [n, l] of [[items.length, items.length === 1 ? 'pendiente' : 'pendientes'], [snips.length, 'snippets'], [leadQ.length, 'clientes en cola']]) {
    const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = n; const sm = document.createElement('small'); sm.textContent = l; d.append(b, sm); stats.appendChild(d);
  }
  ul.textContent = '';
  const now = Date.now();
  const list = [...items].sort((a, b) => a.due - b.due).slice(0, 12);
  if (!list.length && lastSync) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Nada pendiente.'; ul.appendChild(e); }
  for (const it of list) {
    const li = document.createElement('li');
    const t = document.createElement('span'); t.className = 't' + (it.due <= now ? ' hot' : ''); t.textContent = when(it.due);
    const i = document.createElement('span'); i.className = 'i'; i.textContent = it.id;
    const k = document.createElement('span'); k.className = 'k'; k.textContent = it.kw; k.title = it.kw;
    li.append(t, i, k); ul.appendChild(li);
  }
}
const NO_SE_VE = 'Aviso enviado: tarjeta en la pestaña + sonido.';
function showRes(cls, txt) { const r = document.getElementById('res'); r.hidden = false; r.className = 'st box ' + cls; r.textContent = txt; }
const dotLine = (el, cls, txt) => { el.textContent = ''; const d = document.createElement('span'); d.className = 'dot' + (cls ? ' ' + cls : ''); el.append(d, txt); };
document.getElementById('test').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'test' }, (res) => {
    if (chrome.runtime.lastError || !res) return showRes('bad', 'No pude hablar con la extensión. Recargala en chrome://extensions.');
    if (res.level === 'denied') return showRes('bad', 'Las notificaciones de esta extensión están desactivadas en Chrome.');
    if (!res.ok) return showRes('bad', 'No se pudo avisar: ' + (res.err || 'error desconocido'));
    showRes(res.sound ? 'bad' : 'ok', (res.sound ? 'Sin sonido: ' + res.sound : 'Tarjeta en la ' + res.where + ' y sonido.') + (res.sys ? ' Notificación del sistema: ' + res.sys : ''));
    setTimeout(() => window.close(), 1800);
  });
});
chrome.notifications.getPermissionLevel((l) => { if (l === 'denied') showRes('bad', 'Las notificaciones de esta extensión están desactivadas en Chrome.'); });
document.getElementById('open').addEventListener('click', async () => {
  chrome.runtime.sendMessage({ type: 'open-panel' });
  window.close();
});
async function renderWatch() { // páginas del CRM que se actualizan solas
  const { watches = {} } = await chrome.storage.local.get('watches');
  const ws = Object.values(watches), el = document.getElementById('watch');
  if (!ws.length) { el.hidden = true; return; }
  const last = Math.max(0, ...ws.map((w) => w.lastRefresh || 0)), inNew = ws.reduce((a, w) => a + (w.inNew || 0), 0);
  el.hidden = false;
  dotLine(el, '', `${ws.length === 1 ? 'Una pestaña' : ws.length + ' pestañas'} del CRM se ${ws.length === 1 ? 'actualiza' : 'actualizan'} sola${ws.length === 1 ? '' : 's'} cada 10 s${inNew ? ' · ' + inNew + ' en new' : ''}${last ? ' · ' + new Date(last).toTimeString().slice(0, 5) : ''}`);
}
async function renderStation() { // la estación (el Chrome del team leader): cuántas vistas tiene y si está leyendo
  const { station = { views: {} }, stationHours = null } = await chrome.storage.local.get(['station', 'stationHours']);
  const vs = Object.keys(station.views || {}), el = document.getElementById('station');
  if (!vs.length) { el.hidden = true; return; }
  let runs = {}; try { runs = (await chrome.storage.session.get('stRuns')).stRuns || {}; } catch (e) {}
  const h = stationHours || { days: [1, 2, 3, 4, 5], from: 540, to: 1050 }, d = new Date(), m = d.getHours() * 60 + d.getMinutes(), on = h.days.includes(d.getDay()) && m >= h.from && m < h.to;
  const bad = vs.filter((v) => runs[v] && runs[v].problem), last = Math.max(0, ...vs.map((v) => (runs[v] && runs[v].lastOk) || 0));
  el.hidden = false;
  dotLine(document.getElementById('stTxt'), !on ? 'off' : bad.length ? 'bad' : '', `Estación: ${plural(vs.length, 'vista', 'vistas')} · ${!on ? 'fuera de horario' : bad.length ? plural(bad.length, 'con problema', 'con problemas') : last ? 'leyendo, ' + ago(last) : 'arrancando'}`);
  document.getElementById('stOff').onclick = () => chrome.runtime.sendMessage({ type: 'station-off' }, () => renderStation());
}
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
async function renderCrm() { // en un sitio https que no es Vitalis: ofrecer usarlo como CRM
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\//.test(tab.url || '') || /\.joaquin-or24\.workers\.dev|vitaliscrm\.netlify\.app/.test(tab.url)) return;
  const host = new URL(tab.url).hostname, { crmSites = {} } = await chrome.storage.local.get('crmSites');
  const known = /crmnovaramarkets\.com$|crmtrade24seven\.com$/.test(host) || crmSites[host];
  const box = document.getElementById('crmBox'); box.hidden = false;
  if (known) { box.querySelector('summary').textContent = `CRM de ${crmSites[host] || (/novara/.test(host) ? 'Novara Markets' : 'Trade24Seven')}: el botón de Vitalis está activo acá.`; box.querySelector('summary').style.cursor = 'default'; box.querySelector('details').onclick = (e) => e.preventDefault(); return; }
  document.getElementById('crmAdd').onclick = () => chrome.runtime.sendMessage({ type: 'crm-site-add', tabId: tab.id, brand: document.getElementById('crmBrand').value }, (r) => {
    document.getElementById('crmRes').textContent = r && r.ok ? 'Listo: el botón de Vitalis aparece en esta página.' : 'No se pudo: ' + ((r && r.err) || 'error');
  });
}
render();
renderWatch();
renderStation();
renderCrm();
