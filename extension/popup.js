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
/* ---------- modo prueba (vTL / vAgente): el código de la mesa y tu nombre; el tablero del team leader ---------- */
const esc = (v) => String(v == null ? '' : v).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const trMin = (m) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${z(m % 60)}` : `${Math.round(m / 1440)} días`);
let trT = null;
async function renderTrial() {
  const r = await new Promise((ok) => chrome.runtime.sendMessage({ type: 'trial-get' }, (x) => ok(chrome.runtime.lastError ? null : x)));
  if (!r || !r.trial) return false;
  const T = document.getElementById('trial'); T.hidden = false; document.getElementById('main').hidden = true; document.querySelector('footer').hidden = true; document.getElementById('crmBox').hidden = true;
  document.getElementById('who').textContent = r.trial.role === 'tl' ? 'Prueba · team leader' : 'Prueba · agente';
  if (!r.me) {
    T.innerHTML = `<p class="lead">Extensión de prueba de Vitalis. Entrá con el código de tu mesa y tu nombre <b>tal como aparece en el CRM</b> (Sales Rep).</p>
      <label for="tCode">Código de la mesa</label><input id="tCode" class="code" maxlength="6" autocomplete="off" spellcheck="false" placeholder="ABC123">
      <label for="tName">Tu nombre en el CRM</label><input id="tName" maxlength="80" autocomplete="off" placeholder="Nombre Apellido">
      <button class="p go" id="tGo" type="button">Entrar</button><div class="msg" id="tMsg"></div>`;
    const go = async () => {
      const b = document.getElementById('tGo'), m = document.getElementById('tMsg'); b.disabled = true; b.textContent = 'Entrando…'; m.className = 'msg'; m.textContent = '';
      const x = await new Promise((ok) => chrome.runtime.sendMessage({ type: 'trial-join', code: document.getElementById('tCode').value, name: document.getElementById('tName').value }, (v) => ok(chrome.runtime.lastError ? null : v)));
      if (!x || !x.ok) { b.disabled = false; b.textContent = 'Entrar'; m.className = 'msg err'; m.textContent = (x && x.err) || 'No pude entrar: recargá la extensión.'; return; }
      renderTrial();
    };
    document.getElementById('tGo').onclick = go;
    T.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
    document.getElementById('tCode').focus();
    return true;
  }
  const b = r.board, me = r.me, low = (s) => String(s || '').trim().toLowerCase();
  let h = `<div class="me"><span><b>${esc(me.desk)}</b> · ${esc(me.name)}</span><button class="out" id="tOut" type="button">Salir</button></div>`;
  if (!b) h += '<p class="lead">Cargando el tablero…</p>';
  else if (me.role === 'tl') {
    const all = (b.news || []).slice().sort((p, q) => q.min - p.min), news = all.filter((x) => !x.talking), sin = news.filter((x) => !x.called), talk = all.length - news.length;
    h += `<div class="big">${all.length} <small style="font-size:13px;font-weight:500;color:var(--dim)">activos</small></div><p class="lead">${news.length} en New (${sin.length ? `<b class="bad">${sin.length} sin llamar</b>` : 'todos llamados'}) · ${talk} en llamada</p>`;
    if (news.length) h += `<h3>En New</h3><table><tr><th>ID</th><th>Agente</th><th>Está</th><th class="n">Hace</th></tr>${news.slice(0, 30).map((x) => `<tr><td class="i">${esc(x.id)}</td><td>${esc(x.agent || '—')}</td><td>${x.called ? 'llamado' : '<b class="bad">sin llamar</b>'}</td><td class="n${!x.called && x.min >= 5 ? ' hot' : ''}">${trMin(x.min)}</td></tr>`).join('')}</table>`;
    const tk = all.filter((x) => x.talking);
    if (tk.length) h += `<h3>En Talking</h3><table><tr><th>ID</th><th>Agente</th><th class="n">Hace</th></tr>${tk.slice(0, 30).map((x) => `<tr><td class="i">${esc(x.id)}</td><td>${esc(x.agent || '—')}</td><td class="n">${trMin(x.min)}</td></tr>`).join('')}</table>`;
    const ag = (b.agents || []).filter((a) => a.role !== 'tl');
    h += `<h3>Hoy por agente</h3><table><tr><th>Agente</th><th class="n">News</th><th class="n">Llamados</th><th class="n">Llam.</th><th class="n">Al new en</th></tr>${ag.length ? ag.map((a) => `<tr><td>${esc(a.name)}</td><td class="n">${a.news}</td><td class="n${a.news && a.called < a.news ? ' hot' : ''}">${a.called}</td><td class="n">${a.calls}</td><td class="n${a.med != null && a.med > 5 ? ' hot' : ''}">${a.med == null ? '—' : Math.round(a.med) + ' min'}${a.slow ? ` <small>(${a.slow} >5)</small>` : ''}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">Todavía nadie entró con la extensión de agente.</td></tr>'}</table>
      <p class="lead" style="margin-top:8px">Te aviso con una tarjeta y sonido por cada New que pasa de 5 min sin llamar. Código de la mesa: <b>${esc(me.code)}</b>.</p>`;
  } else {
    const st = (b.agents || []).find((a) => low(a.name) === low(me.name)), mine = b.news.filter((x) => low(x.agent) === low(me.name) && !x.talking).sort((p, q) => q.min - p.min);
    h += `<div class="big">${mine.length} <small style="font-size:13px;font-weight:500;color:var(--dim)">en New: llamalos ya</small></div>`;
    if (mine.length) h += `<table>${mine.slice(0, 15).map((x) => `<tr><td class="i">${esc(x.id)}</td><td>${esc(x.name || '')}</td><td class="n${!x.called && x.min >= 5 ? ' hot' : ''}">${trMin(x.min)}</td></tr>`).join('')}</table>`;
    h += `<h3>Tus news de hoy</h3><table><tr><td>Te llegaron</td><td class="n">${st ? st.news : 0}</td></tr><tr><td>Llamados</td><td class="n">${st ? st.called : 0}</td></tr><tr><td>Llamadas</td><td class="n">${st ? st.calls : 0}</td></tr><tr><td>Al new en (mediana)</td><td class="n">${st && st.med != null ? Math.round(st.med) + ' min' : '—'}</td></tr></table>
      <p class="lead" style="margin-top:8px">En el CRM, elegí tu lista de news con "Actualizar esta pestaña": así te aviso de cada new con sonido.</p>`;
  }
  T.innerHTML = h;
  document.getElementById('tOut').onclick = () => chrome.runtime.sendMessage({ type: 'trial-out' }, () => renderTrial());
  if (!b) chrome.runtime.sendMessage({ type: 'trial-board' }, () => renderTrial());
  else { clearTimeout(trT); trT = setTimeout(() => chrome.runtime.sendMessage({ type: 'trial-board' }, () => renderTrial()), 30000); }
  return true;
}
/* ---------- el tablero de Vitalis en el ícono (lo mismo que tenía la prueba, 1.28.0): el team leader ve New y Talking con su agente y hoy por agente; el agente, sus news en New ---------- */
let bdT = null;
async function renderBoard() {
  const el = document.getElementById('board'); let d = null; try { d = (await chrome.storage.session.get('dock')).dock || null; } catch (e) {}
  const b = d && d.board; clearTimeout(bdT); bdT = setTimeout(renderBoard, 30000);
  if (!b || Date.now() - (d.at || 0) > 10 * 6e4) { el.hidden = true; return; } // sin Vitalis abierto no hay tablero
  el.hidden = false; let h = '';
  if (b.tl) {
    const all = (b.news || []).slice(), news = all.filter((x) => !x.talking).sort((p, q) => q.min - p.min), talk = all.filter((x) => x.talking).sort((p, q) => q.min - p.min), sin = news.filter((x) => x.wait);
    h += `<div class="big">${news.length} <small style="font-size:13px;font-weight:500;color:var(--dim)">en New</small> · ${talk.length} <small style="font-size:13px;font-weight:500;color:var(--dim)">en Talking</small></div><p class="lead">${sin.length ? `<b class="bad">${sin.length} sin gestionar hace +5 min</b>` : 'nadie espera'}</p>`;
    if (news.length) h += `<h3>En New</h3><table><tr><th>ID</th><th>Agente</th><th class="n">Sin gestionar hace</th></tr>${news.slice(0, 30).map((x) => `<tr><td class="i">${esc(x.id)}</td><td>${esc(x.agent || 'sin agente')}</td><td class="n${x.wait ? ' hot' : ''}">${trMin(x.min)}</td></tr>`).join('')}</table>`;
    if (talk.length) h += `<h3>En Talking</h3><table><tr><th>ID</th><th>Agente</th><th class="n">Hace</th></tr>${talk.slice(0, 30).map((x) => `<tr><td class="i">${esc(x.id)}</td><td>${esc(x.agent || 'sin agente')}</td><td class="n">${trMin(x.min)}</td></tr>`).join('')}</table>`;
    const ag = (b.agents || []).filter((a) => a.news || a.inNew || a.talk || a.calls);
    if (ag.length) h += `<h3>Hoy por agente</h3><table><tr><th>Agente</th><th class="n">News</th><th class="n">New</th><th class="n">Talking</th><th class="n">Llam.</th><th class="n">Al new en</th></tr>${ag.map((a) => `<tr><td>${esc(a.name)}</td><td class="n">${a.news}</td><td class="n${a.inNew ? ' hot' : ''}">${a.inNew}</td><td class="n">${a.talk}</td><td class="n">${a.calls}</td><td class="n${a.med != null && a.med > 5 ? ' hot' : ''}">${a.med == null ? '—' : Math.round(a.med) + ' min'}${a.slow ? ` <small>(${a.slow} >5)</small>` : ''}</td></tr>`).join('')}</table>`;
  } else {
    const mine = (b.news || []).slice().sort((p, q) => q.min - p.min), st = b.stats || {};
    h += `<div class="big">${mine.length} <small style="font-size:13px;font-weight:500;color:var(--dim)">en New: pasalos a Talking</small></div>`;
    if (mine.length) h += `<table>${mine.slice(0, 15).map((x) => `<tr><td class="i">${esc(x.id)}</td><td>${esc(x.country || '')}</td><td class="n${x.min >= 5 ? ' hot' : ''}">${trMin(x.min)}</td></tr>`).join('')}</table>`;
    h += `<h3>Tus news de hoy</h3><table><tr><td>Te llegaron</td><td class="n">${st.news || 0}</td></tr><tr><td>Gestionados</td><td class="n">${st.done || 0}</td></tr><tr><td>Llamadas</td><td class="n">${st.calls || 0}</td></tr><tr><td>Al new en (mediana)</td><td class="n">${st.med != null ? Math.round(st.med) + ' min' : '—'}</td></tr></table>`;
  }
  el.innerHTML = h;
}
renderTrial().then((t) => { if (t) return; render(); renderWatch(); renderStation(); renderCrm(); renderBoard(); });
