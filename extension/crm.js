// Vitalis · en el CRM:
//   1) botón para pasar a Vitalis las ventas aprobadas que todavía no están
//   2) los clientes en "new" se anotan en el registro de Vitalis (conversión del día)
//   3) vigilar una página (la de clientes): se refresca sola y avisa cuando aparece un cliente en "new"
(() => {
  if (window.__ftdCrm) return;
  window.__ftdCrm = true;

  const BRANDS = { 'crmnovaramarkets.com': 'Novara Markets' };
  const host = location.hostname;
  const brand = (Object.entries(BRANDS).find(([h]) => host === h || host.endsWith('.' + h)) || [, host])[1];
  const z = (n) => String(n).padStart(2, '0');
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); // igual que en el panel
  const lab = (s) => norm(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const cellText = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/\s+/g, ' ').trim();
  const escH = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : (b || a + 's'));
  const send = (msg) => new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => res(chrome.runtime.lastError ? null : r)); } catch (e) { res(null); } });

  /* ================= tablas de la página ================= */
  const match = (l, al) => al.some((a) => l === a || l.startsWith(a + ' '));
  const idxOf = (labels, al) => { // el alias más específico primero: "client id" no es el nombre aunque empiece con "client"
    for (const a of al) { const i = labels.findIndex((l) => l === a); if (i >= 0) return i; }
    for (const a of al) { const i = labels.findIndex((l) => l.startsWith(a + ' ')); if (i >= 0) return i; }
    return -1;
  };
  function tables() { // [{labels, rows: [[texto de cada celda]]}]
    const out = [];
    for (const t of document.querySelectorAll('table')) {
      const rows = [...t.rows];
      let hdr = null;
      for (const r of rows.slice(0, 5)) {
        const labels = [...r.cells].map((c) => lab(cellText(c)));
        if (labels.filter(Boolean).length >= 3) { hdr = { r, labels }; break; }
      }
      if (!hdr) continue;
      const n = hdr.labels.length;
      let data = rows.filter((r) => r !== hdr.r && !(r.parentElement && r.parentElement.tagName === 'THEAD'));
      if (!data.some((r) => r.cells.length >= n - 1)) { // encabezado fijo: los datos están en otra tabla al lado
        data = [];
        let box = t.parentElement;
        for (let i = 0; i < 6 && box && !data.length; i++, box = box.parentElement) {
          for (const t2 of box.querySelectorAll('table')) {
            if (t2 === t) continue;
            const rr = [...t2.rows].filter((r) => Math.abs(r.cells.length - n) <= 1);
            if (rr.length) { data = rr; break; }
          }
        }
      }
      out.push({ labels: hdr.labels, rows: data.map((r) => [...r.cells].map(cellText)) });
    }
    const first = document.querySelector('[role=columnheader]');
    if (first) {
      const hr = first.closest('[role=row]') || first.parentElement;
      const hc = [...hr.querySelectorAll('[role=columnheader]')];
      const byIdx = hc.every((c) => c.hasAttribute('aria-colindex')), idx = hc.map((c) => c.getAttribute('aria-colindex'));
      const rows = [...document.querySelectorAll('[role=row]')].filter((r) => r.querySelector('[role=gridcell],[role=cell]'));
      out.push({ labels: hc.map((c) => lab(cellText(c))), rows: rows.map((r) => {
        const cs = [...r.querySelectorAll('[role=gridcell],[role=cell]')];
        if (!byIdx) return cs.map(cellText);
        const by = {}; for (const c of cs) by[c.getAttribute('aria-colindex')] = cellText(c);
        return idx.map((i) => by[i] || '');
      }) });
    }
    return out;
  }

  /* ================= 1) ventas aprobadas → panel ================= */
  const COLS = {
    status: ['status', 'estado'],
    date: ['time of ftd', 'ftd time', 'ftd date', 'date of ftd', 'fecha ftd'],
    id: ['user id', 'userid', 'client id', 'customer id'],
    name: ['full name', 'client name', 'name'],
    country: ['country', 'pais'],
    camp: ['user source', 'campaign', 'source'],
    aff: ['affiliate', 'affiliate id', 'afiliado'],
    amount: ['amount', 'monto'],
    tx: ['transaction id', 'transaction', 'tx id'],
    reg: ['registration time', 'registration date', 'registration', 'registered'],
  };
  function mapFtd(labels) { const m = {}; for (const k in COLS) m[k] = idxOf(labels, COLS[k]); return m; }
  const isFtdTable = (m) => m.date >= 0 && m.id >= 0 && m.amount >= 0;
  function parseDT(s) { // 17/11/2026 13:59 · 2026-11-17 13:59:00 · 11/17/2026 1:59 PM
    s = String(s || '').trim();
    let y, mo, d, h = null, mi = null, m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/);
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; if (m[4] != null) { h = +m[4]; mi = m[5]; } }
    else {
      m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?\s?m\.?)?)?/i);
      if (!m) return null;
      const a = +m[1], b = +m[2]; y = +m[3]; if (y < 100) y += 2000;
      if (b > 12 && a <= 12) { mo = a; d = b; } else { d = a; mo = b; } // día/mes, como en tu CRM
      if (m[4] != null) { h = +m[4]; mi = m[5]; if (m[6]) h = (h % 12) + (/p/i.test(m[6]) ? 12 : 0); }
    }
    const dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return { date: `${y}-${z(mo)}-${z(d)}`, time: h != null ? `${z(h)}:${mi}` : '' };
  }
  function parseAmount(s) {
    s = String(s ?? '').trim().replace(/us\$|usd|uyu|u\$s|\$|\s/gi, '');
    if (!s || !/^-?[\d.,]+$/.test(s)) return NaN;
    const hasC = s.includes(','), hasD = s.includes('.');
    if (hasC && hasD) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (hasC) { const p = s.split(','); s = p.length === 2 && p[1].length !== 3 ? s.replace(',', '.') : s.replace(/,/g, ''); }
    else if (hasD) { const p = s.split('.'); if (p.length > 2 || p[1].length === 3) s = s.replace(/\./g, ''); }
    const n = Number(s); return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }
  function toSale(cells, m, off) {
    const g = (k) => (m[k] >= 0 ? (cells[m[k] + off] || '') : '');
    if (m.status >= 0 && !/success|approved|aprobad|exitos/i.test(g('status'))) return null;
    const dt = parseDT(g('date')), amount = parseAmount(g('amount')), id = g('id');
    if (!dt || !id || isNaN(amount)) return null;
    const r = m.reg >= 0 ? parseDT(g('reg')) : null;
    let reg = r ? r.date + (r.time ? ' ' + r.time : '') : dt.date;
    if (reg.slice(0, 10) > dt.date) reg = dt.date;
    return { date: dt.date, time: dt.time, id, name: g('name'), country: g('country'), aff: g('aff'), camp: g('camp'), amount, tx: g('tx'), reg, brand };
  }
  function scanSales(T) {
    const t = T.find((x) => isFtdTable(mapFtd(x.labels)));
    if (!t) return null;
    const m = mapFtd(t.labels);
    let best = [];
    for (const off of [0, 1, -1]) { // por si las filas tienen una columna de más o de menos que el encabezado
      const sales = t.rows.map((c) => toSale(c, m, off)).filter(Boolean);
      if (sales.length > best.length) best = sales;
      if (off === 0 && sales.length) break;
    }
    const seen = new Set();
    return best.filter((s) => { const k = s.id + '|' + s.tx; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  /* ================= 2) clientes en "new" ================= */
  const CL = {
    status: ['status', 'estado', 'sales status', 'lead status', 'retention status'],
    id: ['client id', 'user id', 'lead id', 'customer id', 'account id', 'id', 'cid'],
    name: ['full name', 'client name', 'lead name', 'name', 'client', 'nombre'],
    first: ['first name'], last: ['last name'],
    country: ['country', 'pais'],
    created: ['registration time', 'registration date', 'created at', 'created', 'registered', 'date'],
  };
  function scanClients(T) { // tabla con columna de estado que no sea la de FTDs
    const t = T.find((x) => idxOf(x.labels, CL.status) >= 0 && !isFtdTable(mapFtd(x.labels)) && (idxOf(x.labels, CL.id) >= 0 || idxOf(x.labels, CL.name) >= 0 || idxOf(x.labels, CL.first) >= 0));
    if (!t) return null;
    const ix = {}; for (const k in CL) ix[k] = idxOf(t.labels, CL[k]);
    const g = (c, k) => (ix[k] >= 0 ? c[ix[k]] || '' : '');
    const out = [];
    for (const c of t.rows) {
      if (!/^new\b/i.test(g(c, 'status').trim())) continue;
      const name = g(c, 'name') || [g(c, 'first'), g(c, 'last')].filter(Boolean).join(' ');
      const id = g(c, 'id');
      if (!id && !name) continue;
      out.push({ key: id ? 'id:' + id : 'n:' + norm(name) + '|' + g(c, 'created'), id, name, country: g(c, 'country'), created: g(c, 'created') });
    }
    return out;
  }
  const loginPage = () => !!document.querySelector('input[type=password]');

  /* ================= cuáles ya están en el panel ================= */
  let known = null, queued = new Set();
  const qset = (q) => new Set((q || []).map((x) => norm(x.brand) + '|' + norm(x.id)));
  const prep = () => { if (known && !known.idSet) { known.idSet = new Set(known.ids || []); known.txSet = new Set(known.txs || []); } };
  chrome.storage.local.get(['known', 'importQ', 'watch']).then((s) => { known = s.known || null; queued = qset(s.importQ); setWatch(s.watch); refresh(); }).catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.known) known = ch.known.newValue || null;
    if (ch.importQ) queued = qset(ch.importQ.newValue);
    if (ch.watch) setWatch(ch.watch.newValue);
    if (ch.known || ch.importQ || ch.watch) refresh();
  });
  const isKnown = (s) => { if (!known) return false; prep(); const b = norm(s.brand); return (s.tx && known.txSet.has(b + '|' + s.tx)) || known.idSet.has(b + '|' + norm(s.id)); };
  const isQueued = (s) => queued.has(norm(s.brand) + '|' + norm(s.id));

  /* ================= vigilancia de esta pestaña ================= */
  let myTab = null, watch = null, watched = false;
  send({ type: 'whoami' }).then((r) => { myTab = r && r.tabId; setWatch(watch); refresh(); });
  function setWatch(w) { watch = w || null; watched = !!(watch && myTab != null && watch.tabId === myTab); }
  let lastInput = 0;
  for (const ev of ['keydown', 'pointerdown', 'wheel']) addEventListener(ev, () => { lastInput = Date.now(); }, { capture: true, passive: true });
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (m && m.type === 'import-result') { result(m.res); return false; }
    if (m && m.type === 'crm-refresh') { // pedido de la extensión: refrescar la lista
      if (document.hasFocus() && Date.now() - lastInput < 15000) { reply({ skipped: true }); return false; } // la estás usando: no te la muevo
      // tocar "Search" del CRM (recarga la lista sin recargar la página); si no está, "Refresh"; si tampoco, recargar
      const btns = [...document.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]')].filter((b) => b.offsetParent !== null && !b.disabled);
      const txt = (b) => cellText(b) || b.value || '';
      const rb = [...document.querySelectorAll('.refresh-btn')].map((e) => e.closest('button,a,[role=button]') || e).find((b) => b.offsetParent !== null && !b.disabled); // el botón de tu CRM
      const btn = rb || btns.find((b) => /^\W*(search|buscar)\W*$/i.test(txt(b))) || btns.find((b) => /^\W*(refresh|actualizar|refrescar)\W*$/i.test(txt(b)));
      if (btn) { btn.click(); reply({ clicked: txt(btn).trim() || 'refresh-btn' }); setTimeout(() => refresh(true), 2500); }
      else { reply({ reload: true }); setTimeout(() => location.reload(), 50); }
      return false;
    }
    return false;
  });
  let lastReport = '';
  function report(clients, force) {
    if (!watched) return;
    const login = loginPage();
    const sig = JSON.stringify([clients ? clients.map((c) => c.key) : null, login]);
    if (!force && sig === lastReport) return;
    lastReport = sig;
    send({ type: 'crm-clients', clients: clients || [], ok: !!clients, login, title: document.title });
  }

  // clientes en "new": van al registro de Vitalis (para la conversión del día), estés vigilando o no
  let lastLeads = '';
  function reportLeads(list) {
    if (!list || !list.length) return;
    const rows = list.filter((c) => c.id || c.name).map((c) => ({ id: c.id, name: c.name, country: c.country }));
    const sig = rows.map((c) => c.id || c.name).join('|');
    if (sig === lastLeads) return;
    lastLeads = sig;
    send({ type: 'crm-leads', clients: rows.slice(0, 300) });
  }

  /* ================= botón ================= */
  let ui = null, busy = false, msg = null, msgT = null, sales = null, clients = null;
  function build() {
    const h = document.createElement('div');
    h.id = 'ftd-crm-button';
    h.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646;';
    const root = h.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .box{font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fff;color:#15201a;border:1px solid #dfe5dc;border-radius:16px;padding:10px 12px;box-shadow:0 14px 40px rgba(0,0,0,.22);min-width:260px;max-width:370px}
      .h{display:flex;align-items:center;gap:8px}
      .mk{width:22px;height:22px;flex:none}
      .tag{font-weight:800;font-size:16px;letter-spacing:-.03em}
      .t{flex:1;color:#5b685f;font-size:12px;text-align:right}
      .x{all:unset;cursor:pointer;color:#5b685f;padding:0 6px;border-radius:6px;font-size:15px}.x:hover{background:#ecf0e9;color:#15201a}
      .sec{margin-top:9px}.sec[hidden]{display:none}
      .sec+.sec{border-top:1px solid #ecf0e9;padding-top:9px}
      .go{all:unset;box-sizing:border-box;display:block;width:100%;text-align:center;cursor:pointer;background:#1b874a;color:#fff;font-weight:700;border-radius:999px;padding:7px 12px}
      .go:hover{background:#156f3c}
      .go[disabled]{background:#ecf0e9;color:#5b685f;cursor:default;font-weight:600}
      .go.alt{background:#fff;color:#15201a;border:1px solid #dfe5dc}
      .go.alt:hover{border-color:#5b685f}
      .row{display:flex;gap:6px;align-items:center}
      .row .go{flex:1}
      select{font:inherit;font-size:12.5px;background:#fff;color:#15201a;border:1px solid #dfe5dc;border-radius:999px;padding:5px 8px}
      .ids{margin-top:6px;color:#5b685f;font-size:12px;word-break:break-word}
      .ids b{color:#15201a}
      .st{color:#5b685f;font-size:12px;margin-bottom:6px}
      .on{color:#1b874a;font-weight:700}
      .msg{margin-top:7px;font-size:12.5px;font-weight:600}
      .ok{color:#1b874a}.warn{color:#b0620a}.err{color:#cf3049}
      .lnk{all:unset;cursor:pointer;color:#2f7fd0;text-decoration:underline;margin-left:6px}
      .min .sec{display:none}
    </style><div class="box"><div class="h"><img class="mk" src="${chrome.runtime.getURL('icons/48.png')}" alt=""><span class="tag">vitalis</span><span class="t" id="t"></span><button class="x" id="min" title="Minimizar">–</button></div>
      <div class="sec" id="sSales"><button class="go" id="go"></button><div class="ids" id="ids"></div><div class="msg" id="msg"></div></div>
      <div class="sec" id="sWatch"><div class="st" id="wst"></div><div class="row"><button class="go alt" id="wgo"></button><select id="wint" title="Cada cuánto se actualiza la lista"><option value="10">10 s</option><option value="15">15 s</option><option value="30">30 s</option><option value="60">1 min</option><option value="120">2 min</option><option value="300">5 min</option></select></div><div class="ids" id="wids"></div></div></div>`;
    root.getElementById('go').addEventListener('click', () => (ui.diag ? diagnostic() : sendSales()));
    root.getElementById('min').addEventListener('click', () => root.querySelector('.box').classList.toggle('min'));
    root.getElementById('msg').addEventListener('click', (e) => { if (e.target.closest('[data-open]')) send({ type: 'open-panel' }); });
    root.getElementById('wgo').addEventListener('click', toggleWatch);
    root.getElementById('wint').addEventListener('change', (e) => { if (watched) send({ type: 'crm-watch-start', sec: +e.target.value }); });
    document.documentElement.appendChild(h);
    return { h, root, $: (id) => root.getElementById(id), diag: false };
  }
  function setMsg(html, cls, ms) { msg = { html, cls }; clearTimeout(msgT); if (ms) msgT = setTimeout(() => { msg = null; render(); }, ms); render(); }
  function render() {
    if (!ui) return;
    const $ = ui.$, head = [];
    // ventas
    const looksFtd = !sales && /bank|transaction/i.test(location.hash + location.pathname) && /transaction id/i.test(document.body ? document.body.innerText : '');
    ui.diag = looksFtd;
    $('sSales').hidden = !sales && !looksFtd;
    if (looksFtd) { head.push('no encuentro la tabla de FTDs'); $('go').disabled = false; $('go').textContent = 'Copiar diagnóstico'; $('ids').textContent = ''; }
    else if (sales) {
      const n0 = sales.filter((s) => !isKnown(s)), espera = n0.filter(isQueued), nuevas = n0.filter((s) => !isQueued(s)), ya = sales.length - n0.length;
      head.push(`${plural(sales.length, 'aprobada')}${known ? ` · ${ya} ya en Vitalis` : ''}`);
      const go = $('go');
      if (busy) { go.disabled = true; go.textContent = 'Enviando…'; }
      else if (!nuevas.length) { go.disabled = true; go.textContent = espera.length ? `${espera.length} esperando que abras Vitalis` : sales.length ? 'Ya están todas en Vitalis' : 'Sin ventas aprobadas'; }
      else { go.disabled = false; go.textContent = `Pasar ${plural(nuevas.length, 'venta nueva', 'ventas nuevas')} a Vitalis`; }
      $('ids').innerHTML = nuevas.length ? 'Nuevas: ' + nuevas.slice(0, 12).map((s) => `<b>${escH(s.id)}</b>`).join(', ') + (nuevas.length > 12 ? '…' : '') : '';
    }
    $('msg').className = 'msg ' + (msg ? msg.cls : '');
    $('msg').innerHTML = msg ? msg.html : (sales && !known ? '<span class="warn">Abrí Vitalis una vez para saber cuáles ya están.</span>' : '');
    // vigilancia
    const showW = watched || (clients && !sales);
    $('sWatch').hidden = !showW;
    if (showW) {
      const n = clients ? clients.length : 0;
      if (clients && !sales) head.push(`${n} en new`);
      $('wst').innerHTML = watched
        ? `<span class="on">Vigilando esta página</span> · ${clients ? plural(n, 'cliente') + ' en new' : 'esperando la tabla'}${watch && watch.lastRefresh ? ' · ' + new Date(watch.lastRefresh).toTimeString().slice(0, 5) : ''}`
        : 'Te aviso con sonido cuando aparezca un cliente en new, estés en la pestaña que estés. Los new se anotan solos en Vitalis.';
      $('wgo').textContent = watched ? 'Dejar de vigilar' : 'Vigilar esta página';
      $('wint').value = String(watch && watched ? (watch.sec || 60) : 30);
      $('wids').innerHTML = clients && clients.length ? 'En new: ' + clients.slice(0, 10).map((c) => `<b>${escH(c.id || c.name)}</b>`).join(', ') + (clients.length > 10 ? '…' : '') : '';
    }
    $('t').textContent = head.join(' · ');
  }
  function refresh(force) {
    const T = tables();
    sales = scanSales(T);
    clients = scanClients(T);
    const looksFtd = !sales && /bank|transaction/i.test(location.hash + location.pathname) && /transaction id/i.test(document.body ? document.body.innerText : '');
    if (watched) report(clients, force);
    reportLeads(clients);
    if (!sales && !clients && !looksFtd && !watched) { if (ui) { ui.h.remove(); ui = null; } return; }
    if (!ui) ui = build();
    render();
  }
  function result(res) {
    busy = false;
    if (!res) return setMsg('La extensión no respondió. Recargá la página.', 'err');
    if (res.err) return setMsg(escH(res.err), 'err');
    if (res.queued) return setMsg(`${plural(res.queued, 'venta')} en espera: se cargan cuando abras Vitalis.<button class="lnk" data-open>Abrir Vitalis</button>`, 'warn');
    const mes = res.mes ? ` Este mes: ${res.mes.n} FTDs, ${res.mes.usd} USD.` : '';
    if (res.added) setMsg(`${res.added === 1 ? 'Pasé 1 venta' : 'Pasé ' + res.added + ' ventas'} a Vitalis.${mes}`, 'ok', 12000);
    else setMsg(`No había nada nuevo.${mes}`, 'ok', 8000);
  }
  async function sendSales() {
    if (busy) return;
    const nuevas = (scanSales(tables()) || []).filter((s) => !isKnown(s) && !isQueued(s));
    if (!nuevas.length) return refresh();
    busy = true; msg = null; render();
    const r = await send({ type: 'crm-import', rows: nuevas });
    result(r || { err: 'La extensión se actualizó: recargá la página.' });
  }
  async function toggleWatch() {
    if (watched) await send({ type: 'crm-watch-stop' });
    else { await send({ type: 'crm-watch-start', sec: +ui.$('wint').value || 30 }); lastReport = ''; setTimeout(() => refresh(true), 300); }
  }
  function diagnostic() { // si el CRM cambia y no encuentro la tabla: copia el HTML del encabezado para poder ajustarlo
    const el = [...document.querySelectorAll('th,td,div,span')].find((e) => /^transaction id$/i.test(cellText(e)));
    let box = el; for (let i = 0; i < 6 && box && box.parentElement; i++) box = box.parentElement;
    const html = (box ? box.outerHTML : document.body.outerHTML).slice(0, 15000);
    navigator.clipboard.writeText(html).then(() => setMsg('Copiado. Mandáselo a quien mantiene Vitalis para ajustar el botón.', 'ok', 10000), () => setMsg('No pude copiar.', 'err'));
  }

  let t = null;
  const obs = new MutationObserver((muts) => {
    if (ui && muts.every((m) => ui.h.contains(m.target) || m.target === ui.h)) return;
    clearTimeout(t); t = setTimeout(refresh, 600);
  });
  const start = () => { obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); refresh(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  addEventListener('hashchange', () => setTimeout(refresh, 300));
})();
