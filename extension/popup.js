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
  const { items = [], lastSync = 0 } = await chrome.storage.local.get(['items', 'lastSync']);
  const st = document.getElementById('st'), ul = document.getElementById('list');
  st.textContent = lastSync ? `sincronizado ${ago(lastSync)} · ${items.length} pendiente${items.length === 1 ? '' : 's'}` : 'Abrí Vitalis en este Chrome para sincronizar.';
  ul.textContent = '';
  const now = Date.now();
  const list = [...items].sort((a, b) => a.due - b.due).slice(0, 12);
  if (!list.length && lastSync) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Sin contactos pendientes.'; ul.appendChild(e); }
  for (const it of list) {
    const li = document.createElement('li');
    const t = document.createElement('span'); t.className = 't' + (it.due <= now ? ' hot' : ''); t.textContent = when(it.due);
    const i = document.createElement('span'); i.className = 'i'; i.textContent = it.id;
    const k = document.createElement('span'); k.className = 'k'; k.textContent = it.kw; k.title = it.kw;
    li.append(t, i, k); ul.appendChild(li);
  }
}
const NO_SE_VE = 'Aviso enviado: tarjeta en la pestaña + sonido.';
function showRes(cls, txt) { const r = document.getElementById('res'); r.hidden = false; r.className = 'st ' + cls; r.textContent = txt; }
document.getElementById('test').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'test' }, (res) => {
    if (chrome.runtime.lastError || !res) return showRes('bad', '✖ No pude hablar con la extensión. Recargala en chrome://extensions.');
    if (res.level === 'denied') return showRes('bad', '✖ Las notificaciones de esta extensión están desactivadas en Chrome.');
    if (!res.ok) return showRes('bad', '✖ No se pudo avisar: ' + (res.err || 'error desconocido'));
    showRes(res.sound ? 'bad' : 'ok', (res.sound ? '✖ Sin sonido: ' + res.sound : '✔ Tarjeta en la ' + res.where + ' + sonido.') + (res.sys ? ' · Notificación del sistema: ' + res.sys : ''));
    setTimeout(() => window.close(), 1800);
  });
});
chrome.notifications.getPermissionLevel((l) => { if (l === 'denied') showRes('bad', '✖ Las notificaciones de esta extensión están desactivadas en Chrome.'); });
document.getElementById('open').addEventListener('click', async () => {
  chrome.runtime.sendMessage({ type: 'open-panel' });
  window.close();
});
async function renderWatch() {
  const { watch } = await chrome.storage.local.get('watch');
  const el = document.getElementById('watch');
  if (!watch) { el.hidden = true; return; }
  el.hidden = false; el.textContent = '';
  const t = document.createElement('div'); t.className = 'ok';
  t.textContent = `● vigilando el CRM · cada ${(watch.sec || 60) < 60 ? (watch.sec || 60) + ' s' : (watch.sec || 60) / 60 + ' min'}${watch.inNew != null ? ' · ' + watch.inNew + ' en new' : ''}${watch.lastRefresh ? ' · ' + new Date(watch.lastRefresh).toTimeString().slice(0, 5) : ''}`;
  const b = document.createElement('button'); b.textContent = 'dejar de vigilar'; b.style.marginTop = '6px';
  b.onclick = () => chrome.runtime.sendMessage({ type: 'crm-watch-stop' }, () => renderWatch());
  el.append(t, b);
}
render();
renderWatch();
