// Vitalis · en el CRM:
//   1) botón para pasar a Vitalis las ventas aprobadas que todavía no están
//   2) los clientes en "new" se anotan en el registro de Vitalis (conversión del día)
//   3) una sola pestaña del CRM (la que elegís con el botón) se actualiza cada 10 s y avisa cuando entra un cliente en "new";
//      todas las pestañas mandan al registro de Vitalis los clientes que se ven, con su status
(() => {
  // al actualizar la extensión, sw.js inyecta la copia nueva en las pestañas del CRM abiertas: la vieja se apaga sola
  const ME = {}; window.__ftdCrm = true; window.__ftdCrmMe = ME;
  const live = () => { try { return window.__ftdCrmMe === ME && !!chrome.runtime.id; } catch (e) { return false; } };

  const BRANDS = { 'crmnovaramarkets.com': 'Novara Markets', 'crmtrade24seven.com': 'Trade24Seven' };
  const host = location.hostname;
  let brand = (Object.entries(BRANDS).find(([h]) => host === h || host.endsWith('.' + h)) || [, host])[1];
  // CRMs agregados desde el ícono de la extensión ("Usar en este CRM") y datos de la mesa para el team leader
  let desk = null;
  const loadCfg = () => chrome.storage.local.get(['crmSites', 'desk']).then((st) => {
    if (st.crmSites && st.crmSites[host]) brand = st.crmSites[host];
    desk = st.desk || null;
    if (typeof render === 'function') try { render(); } catch (e) {}
  }).catch(() => {});
  loadCfg();
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.desk || ch.crmSites)) loadCfg(); }); } catch (e) {}
  const brandOf = (v) => (/novara/i.test(v) ? 'Novara Markets' : /trade\s*24|t24/i.test(v) ? 'Trade24Seven' : v);
  const z = (n) => String(n).padStart(2, '0');
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); // igual que en el panel
  const lab = (s) => norm(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const cellText = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/\s+/g, ' ').trim();
  const escH = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : (b || a + 's'));
  const VER = (() => { try { return chrome.runtime.getManifest().version; } catch (e) { return ''; } })();
  const send = (msg) => new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => res(chrome.runtime.lastError ? null : r)); } catch (e) { res(null); } });

  // lo que no se puede perder (una llamada, un cliente nuevo): si la extensión no contesta, pruebo de nuevo
  const sendSure = async (msg, tries = 3) => { for (let i = 0; i < tries; i++) { const r = await send(msg); if (r || !live()) return r; await new Promise((ok) => setTimeout(ok, 700 * (i + 1))); } return null; };

  /* ================= tablas de la página ================= */
  const match = (l, al) => al.some((a) => l === a || l.startsWith(a + ' '));
  const idxOf = (labels, al) => { // el alias más específico primero: "client id" no es el nombre aunque empiece con "client"
    for (const a of al) { const i = labels.findIndex((l) => l === a); if (i >= 0) return i; }
    for (const a of al) { const i = labels.findIndex((l) => l.startsWith(a + ' ')); if (i >= 0) return i; }
    return -1;
  };
  // la fila de filtros del CRM (Search…, Filter…, el rango de fechas) no es un cliente
  const FORM = 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea';
  const filterRow = (r, cells) => /filter/i.test(String(r.className || '')) || (r.querySelectorAll(FORM).length >= 2 && cells.filter((c) => cellText(c)).length <= Math.max(2, Math.floor(cells.length / 3)));
  const dataRow = (r, cells) => !filterRow(r, cells) && cells.filter((c) => cellText(c)).length >= 2;
  function tables() { // [{labels, rows: [[texto de cada celda]]}]
    const out = [];
    for (const t of document.querySelectorAll('table')) {
      const rows = [...t.rows];
      let hdr = null;
      for (const r of rows.slice(0, 5)) {
        const labels = [...r.cells].map((c) => lab(cellText(c)));
        if (labels.filter(Boolean).length >= 3 && !filterRow(r, [...r.cells])) { hdr = { r, labels }; break; }
      }
      if (!hdr) continue;
      const n = hdr.labels.length;
      let data = rows.filter((r) => r !== hdr.r && !(r.parentElement && r.parentElement.tagName === 'THEAD') && dataRow(r, [...r.cells]));
      if (!data.some((r) => r.cells.length >= n - 1)) { // encabezado fijo: los datos están en otra tabla al lado (la que tenga más filas)
        data = [];
        let box = t.parentElement;
        for (let i = 0; i < 6 && box && !data.length; i++, box = box.parentElement) {
          for (const t2 of box.querySelectorAll('table')) {
            if (t2 === t || t2.contains(t) || t.contains(t2)) continue;
            const rr = [...t2.rows].filter((r) => Math.abs(r.cells.length - n) <= 1 && dataRow(r, [...r.cells]));
            if (rr.length > data.length) data = rr;
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
      const rows = [...document.querySelectorAll('[role=row]')].filter((r) => r !== hr && r.querySelector('[role=gridcell],[role=cell]') && dataRow(r, [...r.querySelectorAll('[role=gridcell],[role=cell]')]));
      const ri = (r) => parseInt(r.getAttribute('aria-rowindex') || r.getAttribute('row-index'), 10);
      if (rows.length > 1 && rows.every((r) => Number.isFinite(ri(r)))) rows.sort((a, b) => ri(a) - ri(b)); // en el orden de la pantalla (la grilla reusa las filas)
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
    aff: ['affiliate', 'affiliate id', 'afiliado', 'afiliador'],
    amount: ['amount', 'monto'],
    tx: ['transaction id', 'transaction', 'tx id'],
    reg: ['registration time', 'registration date', 'registration', 'registered'],
    agent: ['agent', 'agent name', 'sales agent', 'retention agent', 'conversion agent', 'assigned agent', 'assigned to', 'owner', 'account manager', 'employee', 'sales rep', 'rep', 'agente', 'asignado', 'vendedor', 'responsable'],
    brand: ['brand', 'marca', 'platform', 'plataforma'],
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
    const b = g('brand');
    return { date: dt.date, time: dt.time, id, name: '', country: g('country'), aff: g('aff'), camp: g('camp'), amount, tx: g('tx'), reg, brand: b ? brandOf(b) : brand, agent: g('agent') };
  }
  let agentHead = '';
  function salesOf(t) {
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
  function scanSales(T) {
    const C = T.filter((x) => isFtdTable(mapFtd(x.labels)));
    if (!C.length) return null;
    let t = C[0], best = null;
    for (const x of C) { const s = salesOf(x); if (!best || s.length > best.length) { best = s; t = x; } }
    const m = mapFtd(t.labels);
    agentHead = m.agent >= 0 ? String(t.labels[m.agent] || '').replace(/\b\w/g, (c) => c.toUpperCase()) : '';
    return best;
  }

  /* ================= 2) clientes en "new" ================= */
  const CL = {
    status: ['sales status', 'retention status', 'lead status', 'status', 'estado'], // si hay "Sales Status" y "Status" (el de registro), el de venta
    id: ['client id', 'user id', 'lead id', 'customer id', 'account id', 'id', 'cid'],
    name: ['full name', 'client name', 'lead name', 'name', 'client', 'nombre'],
    first: ['first name'], last: ['last name'],
    country: ['country', 'pais'],
    created: ['registration time', 'registration date', 'created at', 'created', 'registered', 'date'],
    agent: COLS.agent, camp: ['campaign', 'user source', 'utm campaign', 'source'], aff: ['affiliate', 'affiliate id', 'afiliado', 'afiliador', 'aff id'],
    call: ['last communication time', 'last communication', 'last call time', 'last call', 'last contact', 'ultima comunicacion', 'ultimo contacto'],
    note: ['last note', 'note', 'notes', 'last comment', 'comment', 'nota', 'notas'],
    ftd: ['time of ftd', 'ftd time', 'ftd date', 'fecha ftd'], desk: ['sales desk', 'desk'],
    mod: ['modified time', 'modified at', 'modified date', 'last modified', 'modified', 'updated at', 'last update'], // la estación "Clientes": el último que cambió, arriba
  };
  // la columna "Status" de algunas pestañas es la del registro (Full Registration) o la de una transacción (Success, TimeOut…): no es su status
  const NOT_SALES = /^(full|partial)?\s*registration$|^(registered|success|successful|failure|failed|time ?out|approved|rejected|cancell?ed|pending|processing|completed|error|active|inactive|verified|unverified)$/i;
  const CANON = { nuevo: 'New', hablando: 'Talking', 'llamar de nuevo': 'Call Again', 'volver a llamar': 'Call Again', 'sin respuesta': 'No Answer', 'no contesta': 'No Answer', 'colgó': 'Hang Up', colgo: 'Hang Up', 'no interesado': 'Not Interested', 'bajo potencial': 'Low Potential', 'no llamar': 'Do Not Call', 'número inválido': 'Invalid Number', 'numero invalido': 'Invalid Number', 'pago pendiente': 'Pending Payment' }; // el CRM en español
  const canon = (st) => CANON[st.toLowerCase().replace(/\s+/g, ' ')] || st;
  let clHead = null; // la tabla de clientes que encontré (para el diagnóstico)
  function scanAll(T) { // tabla con columna de estado que no sea la de FTDs: todas las filas, con su status
    const C = T.filter((x) => idxOf(x.labels, CL.status) >= 0 && !isFtdTable(mapFtd(x.labels)) && (idxOf(x.labels, CL.id) >= 0 || idxOf(x.labels, CL.name) >= 0 || idxOf(x.labels, CL.first) >= 0));
    clHead = C.length ? C[0].labels : null;
    if (!C.length) return null;
    let best = null;
    for (const x of C) { const r = clientsOf(x); if (!r.length && r.ns) continue; if (!best || r.length > best.length) best = r; } // una tabla de transacciones o de registros no es una lista de clientes
    return best;
  }
  function clientsOf(t) {
    const ix = {}; for (const k in CL) ix[k] = idxOf(t.labels, CL[k]);
    const g = (c, k) => (ix[k] >= 0 ? c[ix[k]] || '' : '');
    const out = []; out.ns = 0; out.mod = ix.mod >= 0 ? { n: 0, bad: 0, old: '' } : null; let pm = '';
    for (const c of t.rows) {
      let status = canon(g(c, 'status').trim()); if (NOT_SALES.test(status)) { status = ''; out.ns++; }
      const name = g(c, 'name') || [g(c, 'first'), g(c, 'last')].filter(Boolean).join(' ');
      const id = g(c, 'id');
      if ((!id && !name) || !status) continue;
      if (out.mod) { const m = parseDT(g(c, 'mod')), k = m ? m.date + ' ' + m.time : ''; if (k) { if (pm && k > pm) out.mod.bad++; out.mod.n++; pm = k; out.mod.old = pm; } } // ¿de la más nueva a la más vieja? (old: la más vieja de la página)
      const r = parseDT(g(c, 'created')), lc = parseDT(g(c, 'call')), fd = parseDT(g(c, 'ftd'));
      out.push({ key: id ? 'id:' + id : 'n:' + norm(name) + '|' + g(c, 'created'), id, name, country: g(c, 'country'), created: g(c, 'created'), status,
        reg: r ? r.date + (r.time ? ' ' + r.time : '') : '', agent: g(c, 'agent'), camp: g(c, 'camp'), aff: g(c, 'aff'), brand,
        call: lc && lc.time ? lc.date + ' ' + lc.time : '', note: g(c, 'note').slice(0, 200), ftd: fd ? fd.date + (fd.time ? ' ' + fd.time : '') : '', desk: g(c, 'desk').slice(0, 80) });
    }
    return out;
  }
  const scanClients = (all) => (all ? all.filter((c) => /^new\b/i.test(c.status)) : null); // los que están en "new"
  const loginPage = () => !!document.querySelector('input[type=password]');

  /* ================= cuáles ya están en el panel ================= */
  let known = null, queued = new Set();
  const qset = (q) => new Set((q || []).map((x) => norm(x.brand) + '|' + norm(x.id)));
  const prep = () => { if (known && !known.idSet) { known.idSet = new Set(known.ids || []); known.txSet = new Set(known.txs || []); } };
  chrome.storage.local.get(['known', 'importQ', 'watches', 'station', 'stationHours']).then((s) => { known = s.known || null; queued = qset(s.importQ); setWatch(s.watches); setStation(s.station); stHoursCfg = s.stationHours || null; refresh(); }).catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.known) known = ch.known.newValue || null;
    if (ch.importQ) queued = qset(ch.importQ.newValue);
    if (ch.watches) setWatch(ch.watches.newValue);
    if (ch.station) setStation(ch.station.newValue);
    if (ch.stationHours) stHoursCfg = ch.stationHours.newValue || null;
    if (ch.known || ch.importQ || ch.watches || ch.station || ch.stationHours) refresh();
    if (ch.dockMin && TOP) { dMin = !!ch.dockMin.newValue; dockDraw(); } // minimizada en una pestaña, minimizada en todas
  });
  const isKnown = (s) => { if (!known) return false; prep(); const b = norm(s.brand); return (s.tx && known.txSet.has(b + '|' + s.tx)) || known.idSet.has(b + '|' + norm(s.id)); };
  const isQueued = (s) => queued.has(norm(s.brand) + '|' + norm(s.id));

  /* ================= vigilancia: una sola pestaña, la que se elige con el botón ================= */
  // la elegida se actualiza cada 10 s y avisa de los new; las demás quedan quietas y solo suman clientes al registro
  let myTab = null, watches = {}, watch = null, watched = false, owner = null, noTableSince = 0;
  // estación (el Chrome del team leader): esta pestaña puede ser la de una vista; la extensión la actualiza a su ritmo, solo en horario
  const SV = [['news', 'News (New y Talking)', 10], ['trx', 'Transactions', 15]]; // solo news y FTDs (24/11/2026)
  let stProb = '';
  const ST_HOURS = { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 17 * 60 + 30 };
  let station = { views: {} }, stView = '', stHoursCfg = null;
  function setStation(s) { station = s || { views: {} }; stView = myTab == null ? '' : (Object.entries(station.views || {}).find(([, c]) => c.tabId === myTab) || [''])[0]; }
  const stInHours = () => { const h = stHoursCfg || ST_HOURS, d = new Date(), m = d.getHours() * 60 + d.getMinutes(); return h.days.includes(d.getDay()) && m >= h.from && m < h.to; };
  // modo prueba (vTL / vAgente): la extensión sola, sin Vitalis. Solo lee: news, llamadas y la info de la campaña. Sin ventas, snippets ni estación.
  let trial = null; // {role, joined, name, desk, code}
  const who = () => send({ type: 'whoami' }).then((r) => { myTab = r && r.tabId; trial = (r && r.trial) || null; setWatch(watches); setStation(station); refresh(); });
  who();
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.trial) who(); }); } catch (e) {}
  const trialOff = () => !!(trial && !trial.joined); // extensión de prueba sin código: no se manda nada
  function setWatch(all) {
    watches = all || {}; watch = myTab != null ? watches[myTab] || null : null; watched = !!watch;
    owner = Object.values(watches).find((w) => w && w.tabId !== myTab) || null; // otra pestaña ya tiene la vigilancia
  }
  const multiWatch = () => !!(desk && desk.role === 'leader'); // el team leader puede tener varias pestañas actualizándose
  const nWatch = () => Object.keys(watches).length;
  function autoWatch(hasTable) { // si la elegida se queda sin tabla un rato (te fuiste a otra parte del CRM), se libera
    if (myTab == null || !watched) return;
    if (hasTable || loginPage()) { noTableSince = 0; return; } // si el CRM cerró la sesión, la pestaña sigue elegida: al volver a entrar sigue sola
    if (!noTableSince) noTableSince = Date.now();
    else if (Date.now() - noTableSince > 20000) { noTableSince = 0; send({ type: 'crm-watch-stop', auto: 1 }); }
  }
  async function watchBtn() {
    if (trialOff()) { setMsg('Primero entrá con tu código: tocá el ícono de Vitalis arriba a la derecha de Chrome.', 'warn', 8000); return; }
    if (watched) { await send({ type: 'crm-watch-stop' }); return; }
    if (owner && !multiWatch()) { await send({ type: 'crm-watch-go' }); return; }
    const r = await send({ type: 'crm-watch-start' });
    if (r && r.busy) setMsg(r.max ? `Ya se actualizan ${r.max} pestañas: es el máximo.` : 'Ya se actualiza otra pestaña del CRM.', 'warn', 6000);
    else if (!r) setMsg('La extensión se actualizó: recargá la página.', 'err');
  }
  let lastInput = 0;
  for (const ev of ['keydown', 'pointerdown', 'wheel']) addEventListener(ev, () => { lastInput = Date.now(); }, { capture: true, passive: true });
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (!live()) return false;
    if (m && m.type === 'import-result') { result(m.res); return false; }
    if (m && m.type === 'dock') { if (TOP) { dock = m.d || null; dockDraw(); } return false; } // la mini ficha: lo nuevo de Vitalis
    if (m && m.type === 'crm-refresh') { // pedido de la extensión: refrescar la lista
      if (document.hasFocus() && Date.now() - lastInput < 15000) { reply({ skipped: true }); return false; } // la estás usando: no te la muevo
      // un agente: el botón ⟳ de su CRM, si no "Search" (recarga la lista sin recargar la página), si no "Refresh".
      // El team leader: su CRM se actualiza con "Refresh" (con "Search" no anda): nunca toca "Search". Si no hay ninguno, recarga.
      const btns = [...document.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]')]
        .filter((b) => b.offsetParent !== null && !b.disabled && !(ui && ui.h.contains(b))); // los botones de Vitalis no cuentan
      const txt = (b) => cellText(b) || b.value || b.getAttribute('aria-label') || b.getAttribute('title') || '';
      const isSearch = (b) => /^\W*(search|buscar)\W*$/i.test(txt(b));
      const isRe = (b) => /^\W*(refresh|actualizar|refrescar|recargar|reload)\W*$/i.test(txt(b))
        || !!b.querySelector('.anticon-reload,.anticon-sync,[data-icon=reload],[data-icon=sync],[aria-label=reload],[aria-label=sync]');
      const rb = [...document.querySelectorAll('.refresh-btn')].map((e) => e.closest('button,a,[role=button]') || e).find((b) => b.offsetParent !== null && !b.disabled); // el botón de tu CRM
      const btn = multiWatch()
        ? (btns.find(isRe) || (rb && !isSearch(rb) ? rb : null))
        : (rb || btns.find(isSearch) || btns.find(isRe));
      refAt = Date.now();
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
    sendSure({ type: 'crm-clients', clients: clients || [], ok: !!clients, login, title: document.title }).then((r) => { if (!r && lastReport === sig) { lastReport = ''; again(); } });
  }

  // clientes en "new": van al registro de Vitalis (para la conversión del día), estés vigilando o no
  let lastLeads = '';
  function reportLeads(list) {
    if (!list || !list.length || trial) return;
    const rows = list.filter((c) => c.id || c.name).map((c) => ({ id: c.id, name: '', country: c.country, reg: c.reg }));
    const sig = rows.map((c) => c.id || c.name).join('|');
    if (sig === lastLeads) return;
    lastLeads = sig;
    sendSure({ type: 'crm-leads', clients: rows.slice(0, 300) }).then((r) => { if (!r && lastLeads === sig) { lastLeads = ''; again(); } }); // no llegó: se manda de nuevo
  }

  // todos los clientes que se ven en esta pestaña → registro de clientes de Vitalis (status, registro, agente, campaña)
  const sentSig = new Map((() => { try { return JSON.parse(sessionStorage.getItem('vitalis-seen') || '[]'); } catch (e) { return []; } })());
  const sentAt = new Map(); // cuándo lo mandé: aunque no cambie, cada 20 min va de nuevo, así Vitalis sabe que se sigue viendo (last_seen)
  const HEART = 20 * 6e4;
  const flying = new Map(); // mandados, esperando que la extensión confirme
  function reportSeen(all) {
    if (!all || !all.length || trialOff()) return;
    const rows = [], now = Date.now();
    for (const c of all) {
      if (!c.id) continue;
      const k = norm(c.brand) + '|' + norm(c.id), sig = [c.status, c.reg, c.agent, c.camp, c.aff, c.name, c.country, c.call, c.note, c.ftd, c.desk].join('|');
      if ((sentSig.get(k) === sig && now - (sentAt.get(k) || 0) < HEART) || flying.get(k) === sig) continue;
      flying.set(k, sig);
      rows.push({ k, sig, row: { id: c.id, brand: c.brand, name: '', country: c.country, status: c.status, reg: c.reg, agent: c.agent, camp: c.camp, aff: c.aff, call: c.call, note: c.note, ftd: c.ftd, desk: c.desk } });
    }
    for (let i = 0; i < rows.length; i += 300) {
      const part = rows.slice(i, i + 300);
      sendSure({ type: 'crm-seen', rows: part.map((x) => x.row) }).then((r) => {
        for (const x of part) { if (flying.get(x.k) === x.sig) flying.delete(x.k); if (r) { sentSig.set(x.k, x.sig); sentAt.set(x.k, Date.now()); } } // recién ahí cuenta como mandado
        if (r) { try { sessionStorage.setItem('vitalis-seen', JSON.stringify([...sentSig].slice(-5000))); } catch (e) {} } else again();
      });
    }
  }

  // cada toque en Omega, Gizat o Voiso (lo que va después del guión es el interno de cada agente: no se lee) = una llamada al cliente de esa ficha.
  // Se guarda solo cliente, línea y hora. La misma línea al mismo cliente en menos de 30 s cuenta una (lo resuelve la base).
  const LINE_RE = /^[^a-z0-9]*(omega|gizat|voiso)\b/i; // el ícono del teléfono adelante no importa
  const GRID_CELL = '[role=gridcell],[role=row],[role=columnheader],td,th,.ag-cell'; // una celda de una tabla (el historial de llamadas de la ficha)
  // subir y "contener" también cruzando el borde de un componente con shadow DOM (la ficha del CRM real)
  const upC = (e) => e.parentElement || (e.parentNode && e.parentNode.host) || null;
  const inC = (a, b) => { for (let e = b, k = 0; e && k < 60; e = upC(e), k++) if (e === a) return true; return false; };
  function idNear(el) { // el ID de la ficha donde está el botón (el de la ficha a la vista, si hay varias)
    const { ids } = scanCur(); for (const c of ids) c.v = onTop(c.el);
    for (let e = el, k = 0; e && k < 14; e = upC(e), k++) {
      const h = ids.filter((c) => c.v && inC(e, c.el)); if (h.length) return h.sort((a, b) => b.v - a.v)[0].id;
    }
    return '';
  }
  document.addEventListener('click', (ev) => {
    if (!live()) return;
    if (isMine(ev.target)) return;
    let t0 = (ev.composedPath && ev.composedPath()[0]) || ev.target; if (t0 && t0.nodeType !== 1) t0 = t0.parentElement; // dentro de la ficha (shadow DOM), el botón de verdad
    if (!t0 || !t0.closest || (ui && ui.h.contains(t0))) return;
    let b = t0.closest('button,a,[role=button]'), m = b && (b.textContent || '').replace(/\s+/g, ' ').match(LINE_RE);
    if (!m && t0.closest(GRID_CELL)) return; // tocar una fila del historial de llamadas ("Omega" en una celda) no es llamar
    if (!m) { // el botón puede no ser un <button>: el elemento tocado o alguno de los que lo contienen, si el texto es corto y empieza con la línea
      for (let e = t0, k = 0; e && k < 4 && !m; e = e.parentElement, k++) { const tx = (e.textContent || '').replace(/\s+/g, ' ').trim(); if (tx.length <= 40 && (m = tx.match(LINE_RE))) b = e; }
    }
    if (!m) return;
    const pc = panelClient().pick, id = idNear(b) || (pc && pc.id) || idInUrl(); if (!id || trialOff()) return;
    sendSure({ type: 'crm-seen', rows: [{ id, brand, ln: m[1].toLowerCase(), at: new Date().toISOString() }] });
    curFrom = 'panel'; sendCurrent(id, pc && pc.id === id ? pc.name : '', true); // a quien llamás es tu cliente actual
  }, true);

  // en la pestaña que se actualiza: un New o Talking que desaparece de la lista ya cambió de status en el CRM (dejó de ser new).
  // Cuenta si sigue sin estar 12 s (más de una vuelta de actualización), en la misma lista, y no lo empujaron a la página siguiente los que entraron.
  let gPrev = null; const gCand = new Map(), gSent = new Set();
  function goneCheck(all) {
    if (!watched || !all || !all.length) { if (!watched) { gPrev = null; gCand.clear(); } return; }
    const loc = location.pathname + location.hash + '|' + (clHead || []).join(','), now = Date.now();
    const keyOf = (c) => norm(c.brand) + '|' + norm(c.id);
    const L = all.filter((c) => c.id), ids = L.map(keyOf), cur = new Set(ids);
    if (gPrev && gPrev.loc === loc) {
      const added = ids.filter((k) => !gPrev.set.has(k)).length;
      gPrev.ids.forEach((k, i) => {
        if (cur.has(k) || !gPrev.talk.has(k) || gCand.has(k)) return;
        if (added && ids.length >= gPrev.ids.length && i >= gPrev.ids.length - added) return; // estaba al final: lo empujaron los nuevos
        gCand.set(k, { since: now, row: gPrev.talk.get(k) });
      });
    } else gCand.clear();
    const out = [];
    for (const [k, c] of gCand) {
      if (cur.has(k)) { gCand.delete(k); gSent.delete(k); continue; }
      if (now - c.since >= 12000) { gCand.delete(k); if (!gSent.has(k)) { gSent.add(k); sentSig.delete(k); out.push({ id: c.row.id, brand: c.row.brand, gone: 1 }); } }
    }
    for (const k of ids) gSent.delete(k);
    gPrev = { loc, ids, set: cur, talk: new Map(L.filter((c) => /^(talking|new)\b/i.test(c.status)).map((c) => [keyOf(c), c])) };
    if (out.length) send({ type: 'crm-seen', rows: out });
  }

  /* ================= de quién es cada venta (columna "Sales Rep" o similar) ================= */
  const nn = (x) => norm(x).replace(/[^a-z0-9]+/g, ' ').trim();
  function repUid(txt) { // igual que en Vitalis: primero los que están en la mesa, después los desvinculados
    const t = nn(txt), all = (desk && desk.members) || [];
    if (!t || !all.length) return null;
    const pick = (L) => {
      const m = L.find((x) => x.crm && nn(x.crm) === t) || L.find((x) => nn(x.name) === t); if (m) return m.id;
      const F = L.filter((x) => !x.crm), one = (l) => (l.length === 1 ? l[0].id : null); // al que ya tiene su nombre del CRM no se lo adivina
      const r = one(F.filter((x) => { const n = nn(x.name); return t.startsWith(n) || n.startsWith(t); })); if (r) return r;
      const [f, l] = t.split(' ');
      return one(F.filter((x) => { const [a, b] = nn(x.name).split(' '); return a === f && (!l || !b || b[0] === l[0]); }));
    };
    return pick(all.filter((x) => x.act !== false)) || pick(all.filter((x) => x.act === false));
  }
  // un nombre de verdad en la columna de vendedor (alguien que ya no está en la mesa → Vitalis lo suma como desvinculado)
  const NOREP = /^(-+|n\/?a|none|null|undefined|sin asignar|no asignado|unassigned|system|sistema|admin)$/i;
  const repName = (n) => { n = String(n || '').replace(/\s+/g, ' ').trim(); return n && !NOREP.test(n) && /[a-zà-ÿ].*[a-zà-ÿ]/i.test(n) ? n : ''; };
  const firstName = (uid) => { const m = desk && desk.members.find((x) => x.id === uid); return m ? m.name.split(/\s+/)[0] : ''; };
  // las que ya mandé solas en esta pestaña (para no repetir si Vitalis no las tomó)
  const tried = new Set((() => { try { return JSON.parse(sessionStorage.getItem('vitalis-auto') || '[]'); } catch (e) { return []; } })());
  const markTried = (list) => { for (const x of list) tried.add(norm(x.brand) + '|' + norm(x.id)); try { sessionStorage.setItem('vitalis-auto', JSON.stringify([...tried].slice(-2000))); } catch (e) {} };

  /* ================= botón ================= */
  const SEAL = '<svg class="mk" viewBox="0 0 48 48" aria-hidden="true"><rect x="2" y="2" width="44" height="44" rx="12" fill="#00875a"/><path d="M14 19 23.4 34.6" stroke="#fff" stroke-opacity=".6" stroke-width="8" stroke-linecap="round"/><path d="M23.4 34.6 34.2 13.4" stroke="#fff" stroke-width="8" stroke-linecap="round"/></svg>';
  let ui = null, busy = false, msg = null, msgT = null, sales = null, clients = null, seen = null, whoSel = '', stMsg = null, stMsgT = null;
  const isLeader = () => !!(desk && (desk.role === 'leader' || desk.role === 'admin'));
  function build() {
    const h = document.createElement('div');
    h.id = 'ftd-crm-button';
    h.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646;';
    const root = h.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .box{font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;background:#fff;color:#0f1720;border:1.5px solid #dde2e7;border-top:5px solid #00b36b;border-radius:18px;padding:12px 14px;box-shadow:0 1px 2px rgba(16,24,40,.06),0 12px 32px rgba(16,24,40,.14);min-width:272px;max-width:372px}
      .h{display:flex;align-items:center;gap:8px}
      .mk{width:20px;height:20px;flex:none}
      .tag{font-weight:700;font-size:15px;letter-spacing:-.035em}
      .vv{color:#6b7684;font-size:11px;font-weight:500;margin-left:-2px}
      .t{flex:1;color:#6b7684;font-size:12px;text-align:right}
      .x{all:unset;cursor:pointer;color:#6b7684;width:24px;height:24px;display:grid;place-items:center;border-radius:8px;font-size:15px}.x:hover{background:#eef0f3;color:#0f1720}
      .sec{margin-top:10px}[hidden]{display:none!important}
      .sec+.sec{border-top:1.5px solid #eef0f3;padding-top:10px}
      .go{all:unset;box-sizing:border-box;display:block;width:100%;text-align:center;cursor:pointer;background:#00875a;color:#fff;font-weight:700;border-radius:12px;padding:8px 12px;box-shadow:0 2px 0 #00573a}
      .go:hover{background:#006e49}
      .go[disabled]{background:#eef0f3;color:#6b7684;cursor:default;font-weight:600;box-shadow:none}
      .go.alt{background:#fff;color:#0f1720;border:1.5px solid #dde2e7;box-shadow:none}
      .go.alt:hover{border-color:#6b7684}
      .go:focus-visible,select:focus-visible,.x:focus-visible,.lnk:focus-visible{outline:2px solid #00875a;outline-offset:2px}
      .row{display:flex;gap:6px;align-items:center}
      .row .go{flex:1}
      select{font:inherit;font-size:12.5px;background:#fff;color:#0f1720;border:1.5px solid #dde2e7;border-radius:10px;padding:6px 8px;width:100%;box-sizing:border-box}
      .ids{margin-top:7px;color:#6b7684;font-size:12px;word-break:break-word}
      .ids b{color:#0f1720;font-weight:600}
      .ids:empty{display:none}
      .st{color:#6b7684;font-size:12px;margin-bottom:7px}
      .on{color:#00875a;font-weight:700}
      .msg{margin-top:8px;font-size:12.5px;font-weight:500}
      .msg:empty{display:none}
      .ok{color:#00875a}.warn{color:#c2410c}.err{color:#e11d48}
      .lnk{all:unset;cursor:pointer;color:#00875a;text-decoration:underline;margin-left:6px}
      .min .sec{display:none}
    </style><div class="box"><div class="h">${SEAL}<span class="tag">vitalis</span><span class="vv">${escH(VER)}</span><span class="t" id="t"></span><button class="x" id="min" title="Minimizar" aria-label="Minimizar">–</button></div>
      <div class="sec" id="sSales"><div class="row" id="whoRow" hidden style="margin-bottom:7px"><span class="st" style="margin:0">De</span><select id="who" style="flex:1" title="A quién se le cargan las ventas"></select></div><button class="go" id="go"></button><div class="ids" id="ids"></div><div class="msg" id="msg"></div></div>
      <div class="sec" id="sWatch"><div class="st" id="wst"></div><button class="go" id="wbtn"></button><div class="ids" id="wids"></div></div>
      <div class="sec" id="sStation" hidden><div class="st" id="stst"></div><select id="stv" aria-label="Qué vista de la estación es esta pestaña"></select><div class="ids" id="stids"></div></div></div>`;
    root.getElementById('go').addEventListener('click', () => (ui.diag ? diagnostic() : sendSales(false)));
    root.getElementById('wbtn').addEventListener('click', () => watchBtn());
    root.getElementById('stv').addEventListener('change', async (e) => { // estación: qué vista es esta pestaña
      const v = e.target.value, r = await send({ type: 'station-set', view: v });
      stMsg = !r || r.err ? ['err', (r && r.err) || 'La extensión se actualizó: recargá la página.'] : ['ok', (v ? 'Listo: la fijé y se actualiza sola, solo en horario. Si la cerrás, vuelve.' : 'Ya no es parte de la estación.')
        + (r.freed ? ` Las ${r.freed} pestañas de antes ya no hacen falta: podés cerrarlas.` : '')];
      clearTimeout(stMsgT); stMsgT = setTimeout(() => { stMsg = null; render(); }, 8000); render();
    });
    root.getElementById('who').addEventListener('change', (e) => { whoSel = e.target.value; render(); });
    root.getElementById('min').addEventListener('click', () => root.querySelector('.box').classList.toggle('min'));
    root.getElementById('wids').addEventListener('click', (e) => { if (e.target.closest('[data-diag]')) diagClients(); });
    root.getElementById('stids').addEventListener('click', (e) => { if (false) navigator.clipboard.writeText('').then(() => setMsg('Copiado (sin datos de clientes). Mandáselo a quien mantiene Vitalis.', 'ok', 10000), () => setMsg('No pude copiar.', 'err')); });
    root.getElementById('msg').addEventListener('click', (e) => { if (e.target.closest('[data-open]')) send({ type: 'open-panel' }); });
    for (const e of document.querySelectorAll('#ftd-crm-button')) e.remove(); // el panel de una copia vieja
    document.documentElement.appendChild(h);
    return { h, root, $: (id) => root.getElementById(id), diag: false };
  }
  function setMsg(html, cls, ms) { msg = { html, cls }; clearTimeout(msgT); if (ms) msgT = setTimeout(() => { msg = null; render(); }, ms); render(); }
  function render() {
    if (!ui) return;
    const $ = ui.$, head = [];
    // ventas
    const looksFtd = !trial && !sales && /bank|transaction/i.test(location.hash + location.pathname) && /transaction id/i.test(document.body ? document.body.innerText : '');
    ui.diag = looksFtd;
    if (trial) head.push(trial.joined ? trial.desk : 'Entrá con tu código (ícono de Vitalis)');
    $('sSales').hidden = !sales && !looksFtd;
    if (looksFtd) { head.push('no encuentro la tabla de FTDs'); $('go').disabled = false; $('go').textContent = 'Copiar diagnóstico'; $('ids').textContent = ''; }
    else if (sales) {
      const lead = isLeader(), hasCol = sales.some((s) => s.agent), mineOnly = !lead && hasCol && desk; // un agente que ve ventas de otros: solo las suyas
      const pool = mineOnly ? sales.filter((s) => repUid(s.agent) === desk.me) : sales;
      const n0 = pool.filter((s) => !isKnown(s)), espera = n0.filter(isQueued), nuevas = n0.filter((s) => !isQueued(s)), ya = pool.length - n0.length;
      const sinV = lead && hasCol ? nuevas.filter((s) => !repUid(s.agent) && !repName(s.agent)) : [];
      head.push(`${plural(pool.length, mineOnly ? 'tuya' : 'aprobada', mineOnly ? 'tuyas' : 'aprobadas')}${known ? ` · ${ya} ya en Vitalis` : ''}`);
      const go = $('go');
      if (busy) { go.disabled = true; go.textContent = 'Enviando…'; }
      else if (lead && hasCol) { // team leader con "Sales Rep": se pasan solas a cada vendedor
        go.disabled = !sinV.length;
        go.textContent = sinV.length ? `Asignar ${plural(sinV.length, 'venta sin vendedor', 'ventas sin vendedor')}` : espera.length ? `${espera.length} esperando que abras Vitalis` : nuevas.length ? 'Pasando a Vitalis…' : 'Ya están todas en Vitalis';
      }
      else if (!nuevas.length) { go.disabled = true; go.textContent = espera.length ? `${espera.length} esperando que abras Vitalis` : pool.length ? 'Ya están todas en Vitalis' : 'Sin ventas aprobadas'; }
      else { go.disabled = false; go.textContent = `Pasar ${plural(nuevas.length, 'venta nueva', 'ventas nuevas')} a Vitalis`; }
      const show = lead && hasCol ? sinV : nuevas;
      $('ids').innerHTML = lead && hasCol
        ? `<span class="on">Se pasan solas a cada vendedor (columna ${escH(agentHead || 'Sales Rep')}).</span>` + (sinV.length ? `<br><span class="warn">Sin vendedor: ${plural(sinV.length, 'venta')}</span>` : '') + (lead && hasCol ? '<br>Los que ya no están en la mesa entran como desvinculados.' : '')
        : show.length ? 'Nuevas: ' + show.slice(0, 12).map((s) => `<b>${escH(s.id)}</b>`).join(', ') + (show.length > 12 ? '…' : '') : '';
      // team leader sin columna de vendedor: elige de quién son (por defecto, de quien usa Vitalis)
      $('whoRow').hidden = !lead || hasCol;
      if (lead && !hasCol) {
        const opts = [[desk.me, 'Yo'], ...desk.members.filter((m) => m.id !== desk.me && m.act !== false).map((m) => [m.id, m.name])];
        if (!opts.some((o) => o[0] === whoSel)) whoSel = opts[0][0];
        const sel = $('who'), sig = opts.map((o) => o[0]).join();
        if (sel.dataset.sig !== sig) { sel.innerHTML = opts.map(([v, l]) => `<option value="${escH(v)}">${escH(l)}</option>`).join(''); sel.dataset.sig = sig; }
        sel.value = whoSel;
      }
    }
    $('msg').className = 'msg ' + (msg ? msg.cls : '');
    $('msg').innerHTML = msg ? msg.html : (sales && !known && !trial ? '<span class="warn">Abrí Vitalis una vez para saber cuáles ya están.</span>' : '');
    // vigilancia: una sola pestaña se actualiza; las demás suman clientes
    // estación: el team leader (o el admin) elige qué vista es esta pestaña; esa ya no hace falta elegirla para actualizarse
    const stOk = !trial && isLeader() && !!(sales || seen || stView);
    $('sStation').hidden = !stOk;
    if (stOk) {
      const other = new Set(Object.entries(station.views || {}).filter(([, c]) => c.tabId !== myTab).map(([k]) => k));
      const opts = [['', 'No es parte de la estación'], ...SV.map(([k, n, e]) => [k, `${n}, cada ${e < 60 ? e + ' s' : e / 60 + ' min'}${other.has(k) ? ' (ya hay una: la reemplaza)' : ''}`])];
      const sel = $('stv'), sig = opts.map((o) => o.join(':')).join('|');
      if (sel.dataset.sig !== sig) { sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${escH(l)}</option>`).join(''); sel.dataset.sig = sig; }
      sel.value = stView;
      const sv = SV.find((x) => x[0] === stView), nv = Object.keys(station.views || {}).length;
      $('stst').innerHTML = stView ? `<span class="on">Estación: la pestaña de ${escH(sv ? sv[1].replace(/ \(.*/, '') : stView)}</span>${stInHours() ? '' : ' · fuera de horario, quieta'}` : `Estación${nv ? ` · ${plural(nv, 'vista', 'vistas')}` : ''}: ¿qué vista es esta pestaña?`;
      $('stids').className = 'ids' + (stMsg ? ' ' + stMsg[0] : '');
      $('stids').innerHTML = stMsg ? escH(stMsg[1]) : stView === 'news' ? 'Fijada. Que quede filtrada en New y Talking, con la columna Sales Status y 100 por página.' : stView ? 'Fijada: se actualiza sola y, si la cerrás, vuelve.' : '';
    }
    $('sWatch').hidden = !(sales || seen) || !!stView;
    if ((sales || seen) && !stView) {
      const n = clients ? clients.length : 0, b = $('wbtn');
      if (clients && !sales) head.push(`${n} en new`);
      const tot = seen && seen.length ? ` · ${plural(seen.length, 'cliente')} a la vista` : '';
      if (watched) {
        $('wst').innerHTML = `<span class="on">Esta pestaña se actualiza sola cada 10 s</span>${multiWatch() && nWatch() > 1 ? ` · ${nWatch()} pestañas en total` : ''}${clients ? ' · ' + plural(n, 'cliente') + ' en new' : ''}${watch && watch.lastRefresh ? ' · ' + new Date(watch.lastRefresh).toTimeString().slice(0, 8) : ''}`;
        b.textContent = 'Dejar de actualizar'; b.className = 'go alt';
      } else if (owner && multiWatch()) {
        $('wst').innerHTML = `Se ${nWatch() === 1 ? 'actualiza otra pestaña' : `actualizan ${nWatch()} pestañas`}. Esta suma clientes al registro${tot}.`;
        b.textContent = 'Actualizar esta también'; b.className = 'go';
      } else if (owner) {
        $('wst').innerHTML = `Se actualiza otra pestaña${owner.title ? ` (${escH(String(owner.title).slice(0, 40))})` : ''}. Esta suma clientes al registro${tot}.`;
        b.textContent = 'Ir a esa pestaña'; b.className = 'go alt';
      } else {
        $('wst').innerHTML = `Ninguna pestaña se actualiza sola. Esta suma clientes al registro${tot}.`;
        b.textContent = 'Actualizar esta pestaña'; b.className = 'go';
      }
      $('wids').innerHTML = unread() ? '<span class="warn">Veo la tabla de clientes pero no leo las filas.</span><button class="lnk" data-diag>Copiar diagnóstico</button>'
        : watched && clients && clients.length ? 'En new: ' + clients.slice(0, 10).map((c) => `<b>${escH(c.id || c.name)}</b>`).join(', ') + (clients.length > 10 ? '…' : '') : '';
    }
    $('t').textContent = head.join(' · ');
  }
  function retire() { try { obs.disconnect(); } catch (e) {} if (ui) { ui.h.remove(); ui = null; } if (dk) { dk.h.remove(); dk = null; } clearInterval(dTimer); }
  /* ================= la mini ficha de Vitalis (abajo a la izquierda) ================= */
  // El cliente actual en corto, el siguiente new y el turno: lo manda Vitalis y acá no se escribe nada en el CRM.
  // Se minimiza (queda una pastilla, en todas las pestañas). El comentario se escribe acá y se copia solo en inglés.
  const TOP = (() => { try { return window.top === window; } catch (e) { return false; } })();
  let dock = null, dk = null, dMin = false, dPayOpen = false, dPay = { id: '', t: '', all: false }, dSkip = 0, dDrafts = {}, dTimer = null, dTicks = 0, dDraftT = null, trObj = null;
  const dEn = new Map(), DK_OLD = 3 * 6e4;
  const mmss = (ms) => { const x = Math.max(0, Math.floor(ms / 1000)); return z(Math.floor(x / 60)) + ':' + z(x % 60); };
  const brLab = (t) => (t.k ? `Descanso ${t.k}'` : 'Baño');
  const DK_CSS = `.dk{font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;color:#0f1720}
    .box{background:#fff;border:1.5px solid #dde2e7;border-top:5px solid #00b36b;border-radius:18px;box-shadow:0 1px 2px rgba(16,24,40,.06),0 12px 32px rgba(16,24,40,.14);width:320px;max-height:min(62vh,600px);display:flex;flex-direction:column;overflow:hidden}
    .h{display:flex;align-items:center;gap:8px;padding:10px 10px 8px 14px}.mk{width:20px;height:20px;flex:none}
    .tag{font-weight:700;font-size:15px;letter-spacing:-.035em}.t{flex:1;color:#6b7684;font-size:12px;text-align:right}
    .x{all:unset;cursor:pointer;color:#6b7684;width:28px;height:28px;display:grid;place-items:center;border-radius:8px;font-size:18px;font-weight:700}.x:hover{background:#eef0f3;color:#0f1720}
    .bd{overflow:auto;padding:0 14px 12px;min-height:0}.ft{flex:none;border-top:1.5px solid #eef0f3;padding:2px 14px 12px}.ft:has(#nx:empty):has(#tu:empty){display:none}#nx:empty,#tu:empty{display:none}#nx+#tu:not(:empty){margin-top:2px}[hidden]{display:none!important}
    .sec{border-top:1.5px solid #eef0f3;padding-top:4px;margin-top:12px}.sec:empty{display:none}
    .stop{font-weight:700;border-radius:10px;padding:7px 10px;margin-bottom:8px;font-size:13.5px}
    .stop.err{background:#fff1f3;color:#be123c;border:1.5px solid #f43f5e}.stop.ok{background:#ecfdf5;color:#047857;border:1.5px solid #00b36b}
    .cid{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.cid b{font-size:18px;letter-spacing:-.02em}.nm{font-weight:600}
    .meta{color:#6b7684;font-size:12px;margin:1px 0 6px}
    .kv{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid #f1f3f5;font-size:12.5px}
    .kv span{color:#6b7684;flex:none}.kv b{font-weight:600;text-align:right}.kv i{color:#6b7684;font-weight:400;font-style:normal}
    .falta{margin-top:8px;background:#fffbeb;border:1.5px solid #f59e0b;color:#92400e;border-radius:10px;padding:6px 10px;font-size:12.5px;font-weight:600}
    .lb{display:block;color:#6b7684;font-size:11.5px;font-weight:700;margin:10px 0 5px}.lb i{font-style:normal;font-weight:500}
    .coms p{margin:0 0 6px;font-size:12.5px;background:#f6f7f9;border-radius:10px;padding:6px 9px;word-break:break-word}.coms i{color:#6b7684;font-style:normal;font-size:11.5px}
    details{margin-top:12px;border:1.5px solid #dde2e7;border-radius:12px;padding:0 10px}
    summary{cursor:pointer;font-weight:700;padding:9px 0;list-style:none;display:flex;gap:7px;align-items:center}summary::-webkit-details-marker{display:none}
    summary::before{content:'';width:0;height:0;border-left:5px solid #6b7684;border-top:4px solid transparent;border-bottom:4px solid transparent;transition:transform .15s}
    details[open] summary::before{transform:rotate(90deg)}details[open]{padding-bottom:10px}#payp{color:#6b7684;font-weight:500}
    .seg{display:flex;gap:6px}.seg button{all:unset;box-sizing:border-box;flex:1;text-align:center;cursor:pointer;border:1.5px solid #dde2e7;border-radius:10px;padding:7px 6px;font-weight:600;font-size:13px}
    .seg button:hover{border-color:#6b7684}.seg button.on{border-color:#00875a;background:#e8f6ef;color:#00875a}.seg button.no{color:#9aa3ad}
    .op{border:1.5px solid #d5efe1;background:#f3fbf6;border-radius:10px;padding:6px 9px;margin-bottom:6px;font-size:12.5px}.opn{color:#4b5563;font-size:12px;margin-top:2px}
    .bad{color:#be123c;font-size:12px;margin:6px 0 0}
    textarea{box-sizing:border-box;width:100%;font:inherit;font-size:13px;border:1.5px solid #dde2e7;border-radius:10px;padding:7px 9px;resize:vertical;min-height:64px;color:#0f1720;background:#fff}
    textarea:focus{outline:none;border-color:#00875a;box-shadow:0 0 0 2px #00875a33}
    .row{display:flex;gap:8px;margin-top:6px;align-items:center}.row .go{flex:1}
    .go{all:unset;box-sizing:border-box;display:block;text-align:center;cursor:pointer;background:#00875a;color:#fff;font-weight:700;border-radius:12px;padding:9px 12px;box-shadow:0 2px 0 #00573a}
    .go:hover{background:#006e49}.go[disabled]{opacity:.6;cursor:default}.go.alt{background:#fff;color:#0f1720;border:1.5px solid #dde2e7;box-shadow:none}.go.alt:hover{border-color:#6b7684}
    .go.sm{padding:6px 10px;font-size:12.5px;flex:none}
    .lnk{all:unset;cursor:pointer;color:#00875a;font-weight:600;font-size:12.5px;text-decoration:underline;margin-top:8px;display:inline-block}
    .msg{font-size:12.5px;margin-top:6px;font-weight:600}.msg:empty{display:none}
    .en{margin-top:4px;background:#f6f7f9;border-radius:10px;padding:6px 9px;color:#0f1720;font-weight:400;max-height:96px;overflow:auto;white-space:pre-wrap}
    .ok{color:#047857}.warn{color:#b45309}.err{color:#be123c}
    .note{color:#6b7684;font-size:12.5px;margin:6px 0}.note.warn{color:#b45309}
    .nr{display:flex;align-items:center;gap:8px}.nx-o{all:unset;cursor:pointer;color:#00875a;font-weight:600;font-size:12px;margin-left:4px;text-decoration:underline}.nt{flex:1;min-width:0}.nt b{font-size:15px}.why{color:#4b5563;font-size:12px}
    .tb3{display:flex;gap:6px;margin-top:8px}.tb{all:unset;box-sizing:border-box;flex:1;text-align:center;cursor:pointer;border:1.5px solid #dde2e7;border-radius:12px;padding:9px 4px;font-weight:700;font-size:13px}
    .tb:hover{border-color:#00875a;color:#00875a}.tb[disabled]{opacity:.5}
    .trow{display:flex;align-items:center;gap:8px;margin-top:8px}.brk{flex:1;font-weight:600}.brk b{font-variant-numeric:tabular-nums;margin-left:4px}.brk b.hot{color:#be123c}
    .pill{display:none;align-items:center;gap:8px;background:#fff;border:1.5px solid #00b36b;border-radius:999px;padding:7px 13px 7px 9px;box-shadow:0 8px 24px rgba(16,24,40,.16);cursor:pointer;font-weight:600;font-size:12.5px;color:#0f1720}
    .pill .mk{width:18px;height:18px}.pill .plus{color:#6b7684;font-weight:700;font-size:15px;line-height:1}.pill.stp{border-color:#f43f5e}
    .min .pill{display:inline-flex}.min .box{display:none}
    .bdg{font-size:11.5px;font-weight:700;border-radius:999px;padding:1px 8px;border:1px solid}.bdg.w{background:#fffbeb;color:#92400e;border-color:#f59e0b}.bdg.ok{background:#ecfdf5;color:#047857;border-color:#00b36b}
    .pf label{display:block;color:#4b5563;font-size:12px;font-weight:700;margin:8px 0 3px}.pf label i{color:#be123c;font-style:normal}.pf label .o{color:#6b7684;font-weight:500}
    .pf input[type=text],.pf input[type=number],.pf select{box-sizing:border-box;width:100%;font:inherit;font-size:13px;border:1.5px solid #dde2e7;border-radius:10px;padding:7px 9px;color:#0f1720;background:#fff;height:36px}
    .pf input:focus,.pf select:focus{outline:none;border-color:#00875a;box-shadow:0 0 0 2px #00875a33}.pf textarea{min-height:48px}
    .pf label.ck{display:flex;align-items:center;gap:8px;color:#0f1720;font-size:13px;font-weight:600;cursor:pointer;margin:9px 0 2px}.pf .ck input{width:17px;height:17px;margin:0;accent-color:#00875a}
    .two{display:flex;gap:8px}.two>div:first-child{width:70px;flex:none}.two>div:last-child{flex:1;min-width:0}
    .pst{margin:5px 0 0;font-size:12.5px;color:#4b5563}.pst:empty{display:none}.pst b{color:#0f1720}
    .pf .row{margin-top:10px}
    .tr #cmt,.tr #cmt+.row,.tr #pay,.tr .lb.cm,.tr #cmsg{display:none}
    .tr .box{width:380px;max-height:min(72vh,720px)}.tr{font-size:15px}.tr .kv{font-size:15px;padding:7px 0}.tr .lb{font-size:13px;margin:12px 0 6px}.tr .cid b{font-size:22px}.tr .nm{font-size:15px;color:#6b7684}.tr .note{font-size:14px}.tr .op{font-size:14.5px}.tr .opn{font-size:14px}.tr .go{font-size:15px;padding:10px 12px}.tr .lnk{font-size:14px}.tr #nx .kv{font-size:15px}
    :focus-visible{outline:2px solid #00875a;outline-offset:2px}`;
  if (TOP) {
    chrome.storage.local.get('dockMin').then((x) => { dMin = !!x.dockMin; dockDraw(); }).catch(() => {});
    send({ type: 'dock-get' }).then((r) => { if (r) { dock = r.d || null; dDrafts = r.drafts || {}; dockDraw(); } });
  }
  const dockShow = () => !!(TOP && dock && !dock.off && !stView && document.body && !loginPage());
  // la mini ficha de la prueba: el cliente abierto, la info de su campaña (con el número del afiliador), el siguiente new y tus números de hoy
  let dCamp = { id: '', open: false };
  function dockTrialHTML(c) {
    if (!c) return `<p class="note">Abrí un cliente en el CRM (o tocá Omega/Gizat/Voiso) y acá te muestro su campaña.</p>`;
    const camps = c.camps, mine = camps ? camps.find((x) => x.mine) : null, others = camps ? camps.filter((x) => !x.mine) : [];
    const ed = dCamp.id === c.id && dCamp.open;
    let h = `<div class="cid"><b>${escH(c.id)}</b>${c.country ? `<span class="nm">${escH(c.country)}</span>` : ''}</div>
      <span class="lb">Campaña</span>`;
    if (!c.aff && !c.camp) h += `<p class="note">No sé de qué campaña es: cuando aparezca en tu lista de news lo aprendo.</p>`;
    else {
      h += `<div class="kv"><span>Afiliado</span><b>${c.aff ? escH(c.aff) : '<i>?</i>'}</b></div><div class="kv"><span>Campaña</span><b>${c.camp ? escH(c.camp) : '<i>?</i>'}</b></div>`;
      if (camps == null) h += `<p class="note warn">No pude traer la info de la campaña: ¿hay internet?</p>`;
      else if (ed) h += `<div class="pf"><label for="cmin">Monto mínimo del anuncio</label><input id="cmin" type="text" maxlength="60" value="${escH(mine && mine.min ? mine.min : '')}" placeholder="250 USD">
        <label for="cad">¿Qué ve la persona en el anuncio?</label><textarea id="cad" rows="3" maxlength="2000" placeholder="Invertí desde 250 USD con el banco…">${escH(mine && mine.ad ? mine.ad : '')}</textarea>
        <div class="row"><button class="go" data-cs="1">Guardar</button><button class="go alt sm" data-cx="1">Cancelar</button></div><div class="msg" id="csmsg"></div></div>`;
      else if (mine && (mine.min || mine.ad)) h += `<div class="op"><b>${mine.min ? 'Mínimo ' + escH(mine.min) : 'Sin monto mínimo cargado'}</b>${mine.ad ? `<div class="opn">${escH(mine.ad)}</div>` : ''}</div><button class="lnk" data-ce="1" style="margin-top:2px">Editar</button>`;
      else h += `<p class="note">Todavía no sabemos el monto mínimo ni qué ve en el anuncio. ${c.camp ? '<button class="lnk" data-ce="1" style="margin:0">Agregar</button>' : ''}</p>`;
      if (others.length) h += `<p class="note">Otras de ${escH(c.aff || '?')}${c.country ? ' en ' + escH(c.country) : ''}: ${others.map((x) => `<b>${escH(x.camp)}</b>${x.min ? ' (mín. ' + escH(x.min) + ')' : ''}`).join(', ')}</p>`;
    }
    return h;
  }
  const dockStatsHTML = (s) => (!s ? '' : `<span class="lb">Tus news de hoy</span><div class="kv"><span>Te llegaron</span><b>${s.news}</b></div><div class="kv"><span>Llamados</span><b>${s.called} de ${s.news}</b></div><div class="kv"><span>Al new en</span><b>${s.med == null ? '<i>—</i>' : (Math.round(s.med) + ' min') + (s.slow ? ` <i>· ${s.slow} pasaron de 5</i>` : '')}</b></div><span class="lb">Llamadas de hoy</span><div class="kv"><span>Llamadas</span><b>${s.calls}</b></div>`);
  function dockTrialDraw(cl) {
    const $ = dk.$;
    $('dk').classList.add('tr'); $('cl').hidden = false;
    const a = dk.root.activeElement, keep = !!(a && (a.id === 'cmin' || a.id === 'cad'));
    if (!keep) $('clh').innerHTML = dockTrialHTML(cl) + dockStatsHTML(dock.stats);
    $('clc').innerHTML = ''; $('payb').innerHTML = '';
    if (dk.clId !== (cl ? cl.id : '')) { dk.clId = cl ? cl.id : ''; dCamp = { id: '', open: false }; }
  }
  async function dockCampSave() {
    const c = dock && dock.cl; if (!c || !dk || !dk.$('cmin')) return;
    const b = dk.root.querySelector('[data-cs]'), m = dk.$('csmsg'); b.disabled = true; b.textContent = 'Guardando…';
    const r = await send({ type: 'dock-camp-set', aff: c.aff, camp: c.camp, country: c.country || '', min: dk.$('cmin').value.trim(), ad: dk.$('cad').value.trim() });
    if (!r || !r.ok) { b.disabled = false; b.textContent = 'Guardar'; m.className = 'msg err'; m.textContent = (r && r.err) || 'No pude guardarlo.'; return; }
    dCamp = { id: c.id, open: false }; dockDraw(); // la extensión ya mandó la ficha de nuevo con lo guardado
  }
  function dockVis() { if (dockShow() !== !!dk) dockDraw(); } // la pestaña pasó a ser de la estación, o el CRM pidió login
  function dockBuild() {
    for (const e of document.querySelectorAll('#vitalis-dock')) e.remove(); // la de una copia vieja
    const h = document.createElement('div');
    h.id = 'vitalis-dock';
    h.style.cssText = 'all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483645;';
    const root = h.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${DK_CSS}</style><div class="dk" id="dk">
      <div class="pill" id="pill" role="button" tabindex="0" aria-label="Abrir la ficha de Vitalis">${SEAL}<b class="tag">vitalis</b><span id="pt"></span><span class="plus" aria-hidden="true">+</span></div>
      <div class="box" id="box"><div class="h">${SEAL}<span class="tag">vitalis</span><span class="t" id="ht"></span><button class="x" id="dmin" title="Minimizar" aria-label="Minimizar">–</button></div>
        <div class="bd"><div id="info"></div>
          <div id="cl"><div id="clh"></div>
            <span class="lb cm">Comentario para el CRM</span><textarea id="cmt" rows="3" maxlength="2000" placeholder="Escribilo en español: se copia en inglés" aria-label="Comentario para el CRM"></textarea>
            <div class="row"><button class="go" id="cpen">Copiar en inglés</button><button class="lnk" id="cclr" style="margin:0">Borrar</button></div><div class="msg" id="cmsg"></div>
            <details id="pay"><summary>Depósito <span id="payp"></span></summary><div id="payb"></div></details>
            <div id="clc"></div></div></div>
        <div class="ft" id="ft"><div id="nx"></div><div id="tu"></div></div></div></div>`;
    const $ = (id) => root.getElementById(id);
    // las teclas que se escriben acá no le llegan al CRM (sus atajos); espacio, Tab y Enter sí, para los snippets
    root.addEventListener('keydown', (e) => { if (!/^( |Tab|Enter)$/.test(e.key)) e.stopPropagation(); });
    for (const ev of ['keyup', 'keypress']) root.addEventListener(ev, (e) => e.stopPropagation());
    $('pay').addEventListener('toggle', () => { dPayOpen = $('pay').open; });
    $('pill').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dockMin(false); } });
    $('cmt').addEventListener('input', () => {
      const c = dock && dock.cl; if (!c) return;
      dDrafts[c.id] = $('cmt').value; $('cmsg').textContent = '';
      clearTimeout(dDraftT); dDraftT = setTimeout(() => send({ type: 'dock-draft', id: c.id, txt: $('cmt').value }), 600);
    });
    root.addEventListener('click', (e) => dockClick(e));
    document.documentElement.appendChild(h);
    return { h, root, $, clId: '' };
  }
  function dockMin(v) { dMin = v; try { chrome.storage.local.set({ dockMin: v }); } catch (e) {} dockDraw(); }
  function dockDraw() {
    if (!TOP || !live()) return;
    if (!dockShow()) { if (dk) { dk.h.remove(); dk = null; } clearInterval(dTimer); dTimer = null; return; }
    if (!dk || !dk.h.isConnected) dk = dockBuild();
    const $ = dk.$, now = Date.now(), old = now - (dock.at || 0) > DK_OLD, lk = !!dock.locked, cl = lk ? null : dock.cl || null, tu = dock.tu || {};
    $('dk').classList.toggle('min', dMin);
    $('pill').classList.toggle('stp', !!(cl && cl.stop === 'dnc'));
    $('pt').textContent = lk ? '· tapado' : cl ? `· ${cl.id}${cl.stop === 'dnc' ? ' · No llamar' : ''}` : '';
    $('ht').textContent = lk ? 'tapado' : old ? 'Vitalis no contesta' : '';
    $('info').innerHTML = lk ? '<p class="note">Vitalis está tapado: poné tu PIN para ver al cliente.</p><button class="go alt" data-a="abrir">Abrir Vitalis</button>'
      : old ? `<p class="note warn">Vitalis no contesta desde hace ${Math.round((now - dock.at) / 6e4)} min: esto puede estar viejo.</p><button class="go alt" data-a="abrir">Abrir Vitalis</button>` : '';
    if (dock.trial) { $('ht').textContent = dock.me ? `${dock.me.desk} · ${dock.me.name}` : ''; $('info').innerHTML = ''; dockTrialDraw(cl); dockNext(cl, false); $('tu').innerHTML = ''; return; }
    $('cl').hidden = !cl;
    if (!cl && dk.clId) { dk.clId = ''; $('clh').innerHTML = ''; $('clc').innerHTML = ''; $('payb').innerHTML = ''; $('cmt').value = ''; $('cmsg').textContent = ''; } // tapado o sin cliente: nada del cliente queda en la página
    if (cl) {
      $('clh').innerHTML = dockClHTML(cl); $('clc').innerHTML = dockComsHTML(cl);
      if (dk.clId !== cl.id) { dk.clId = cl.id; $('cmt').value = dDrafts[cl.id] || ''; $('cmsg').textContent = ''; dPayOpen = false; }
      $('pay').open = dPayOpen;
      dockPay(cl);
    }
    dockNext(cl, lk);
    dockTurno(tu, lk || old);
    if (!dTimer) dTimer = setInterval(() => { if (!live()) return; dockTick(); if (++dTicks % 20 === 0) dockDraw(); }, 1000);
    dockTick();
  }
  function dockClHTML(c) {
    return `${c.stop === 'dnc' ? '<div class="stop err">No llamar: es Do Not Call</div>' : c.stop === 'paid' ? `<div class="stop ok">Ya depositó${c.paid ? ' · ' + escH(c.paid) : ''}</div>` : ''}
      <div class="cid"><b>${escH(c.id)}</b>${c.name ? `<span class="nm">${escH(c.name)}</span>` : ''}</div>
      <div class="meta">${[c.pais ? escH(c.pais) : '', c.hora ? `allá son las ${escH(c.hora)}` : ''].filter(Boolean).join(' · ') || '&nbsp;'}</div>
      <div class="kv"><span>Status</span><b>${c.st ? escH(c.st) : '<i>todavía no se vio en el CRM</i>'}</b></div>
      <div class="kv"><span>Palabra clave</span><b>${c.kw ? escH(c.kw) : '<i>sin asignar</i>'}</b></div>
      ${c.ag && c.ag.length ? `<div class="kv"><span>Agenda</span><b>${escH(c.ag.join(', '))}</b></div>` : ''}
`;
  }
  const dockComsHTML = (c) => `${c.coms && c.coms.length ? `<span class="lb">Comentarios de la mesa</span><div class="coms">${c.coms.map((x) => `<p><b>${escH(x.w)}</b> <i>${escH(x.t)}</i><br>${escH(x.x)}</p>`).join('')}</div>` : ''}
      <button class="lnk" data-a="ver">Ver la ficha en Vitalis</button>
      <p class="note" style="margin-top:8px">¿No es el que tenés abierto en el CRM? <button class="lnk" data-diag style="margin:0">Copiar diagnóstico</button></p>`;
  // el camino del depósito, como en la ficha de Vitalis: ¿efectivo o digital? → ¿tarjeta o transferencia? → qué ofrecerle
  function dockPay(c) {
    const P = c.pay, $ = dk.$;
    $('payp').textContent = P ? P.pais : c.pais || '';
    if (dPay.id !== c.id) dPay = { id: c.id, t: '', all: false };
    if (!P) { $('payb').innerHTML = `<p class="note">${c.pais ? `No hay métodos cargados para ${escH(c.pais)}.` : 'No sé de qué país es.'}</p>`; return; }
    const has = (k) => !!(P.k[k] && P.k[k].ok.length), t = dPay.t, dig = ['digital', 'transferencia', 'tarjeta'].includes(t), fin = ['efectivo', 'transferencia', 'tarjeta'].includes(t);
    const seg = (lab, items) => `<span class="lb">${lab}</span><div class="seg">${items.map(([k, l, on, ok]) => `<button data-pt="${k}" class="${on ? 'on' : ''}${ok ? '' : ' no'}"${ok ? '' : ' title="No hay nada que ande ahora"'}>${l}</button>`).join('')}</div>`;
    let h = seg('¿Paga en efectivo o digital?', [['efectivo', 'Efectivo', t === 'efectivo', has('efectivo')], ['digital', 'Digital', dig, has('transferencia') || has('tarjeta')]]);
    if (dig) h += seg('¿Con tarjeta o transferencia?', [['tarjeta', 'Tarjeta', t === 'tarjeta', has('tarjeta')], ['transferencia', 'Transferencia', t === 'transferencia', has('transferencia')]]);
    if (fin) {
      const o = P.k[t] || { ok: [], bad: [] }, L = dPay.all ? o.ok : o.ok.slice(0, 4);
      h += '<span class="lb">Ofrecele:</span>' + (o.ok.length ? L.map((x) => `<div class="op"><b>${escH(x.m)}</b> con ${escH(x.p)}${x.n ? `<div class="opn">${escH(x.n)}</div>` : ''}</div>`).join('')
        + (o.ok.length > L.length ? `<button class="lnk" data-pall style="margin-top:2px">Ver las ${o.ok.length} que andan</button>` : '') : '<p class="note">Ahora no anda ninguno: probá con otra forma de pago.</p>')
        + (o.bad.length ? `<p class="bad"><b>No ofrecer ahora (fallan):</b> ${o.bad.map(escH).join(', ')}</p>` : '');
    }
    $('payb').innerHTML = h;
  }
  function dockNext(cl, lk) {
    const L = lk ? [] : (dock.next || []).filter((x) => !cl || x.id !== cl.id), el = dk.$('nx');
    if (!L.length) { el.innerHTML = ''; return; }
    const i = dSkip % L.length, x = L[i];
    el.innerHTML = `<span class="lb">Siguiente${L.length > 1 ? ` <i>· ${i + 1} de ${L.length}</i><button class="nx-o" data-skip>Ver otro</button>` : ''}</span><div class="nr"><div class="nt"><b>${escH(x.id)}</b>${x.name ? ` <span class="nm">${escH(x.name)}</span>` : ''}<div class="why">${escH(x.why || '')}</div></div><button class="go sm" data-cp="${escH(x.id)}">Copiar ID</button></div>`;
  }
  function dockTurno(tu, off) {
    const el = dk.$('tu');
    if (off) { el.innerHTML = ''; return; }
    if (tu.st === 'br') el.innerHTML = `<div class="trow"><span class="brk">${brLab(tu)}<b id="tuT"></b></span><button class="go" data-t="vuelta">Volví</button></div>`;
    else if (tu.st === 'in') el.innerHTML = '<div class="tb3"><button class="tb" data-t="bano">Baño</button><button class="tb" data-t="d10">10 min</button><button class="tb" data-t="d30">30 min</button></div>';
    else el.innerHTML = `<p class="note">${tu.st === 'out' ? 'Ya marcaste la salida de hoy.' : 'Marcá la entrada en Vitalis para poder marcar el baño y los descansos.'}</p>`;
  }
  function dockTick() { // el reloj del baño o del descanso
    const tu = dock && dock.tu; if (!dk || !tu || tu.st !== 'br' || dock.locked) return;
    const now = Date.now(), left = tu.k ? tu.s + tu.k * 6e4 - now : 0, hot = !!tu.k && left < 0, txt = tu.k ? (hot ? '+' : '') + mmss(Math.abs(left)) : mmss(now - tu.s);
    const el = dk.$('tuT'); if (el) { el.textContent = txt; el.classList.toggle('hot', hot); }
    if (dMin) dk.$('pt').textContent = [dock.cl ? '· ' + dock.cl.id : '', `· ${brLab(tu)} ${txt}`].filter(Boolean).join(' ');
  }
  async function dockCopy(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
    try { const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;left:-9999px;top:0'; dk.root.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; }
  }
  // al inglés: el traductor de Chrome acá mismo (el toque deja bajar el idioma la primera vez); si no anda, el de la pestaña de Vitalis
  async function dockEn(txt) {
    if (dEn.has(txt)) return { en: dEn.get(txt) };
    const here = async () => {
      if (!self.Translator) return '';
      const o = { sourceLanguage: 'es', targetLanguage: 'en' };
      if ((await Translator.availability(o)) === 'unavailable') return '';
      if (!trObj) trObj = await Translator.create(o);
      return String((await trObj.translate(txt)) || '').trim();
    };
    const r0 = await Promise.race([here().catch(() => { trObj = null; return ''; }), new Promise((ok) => setTimeout(() => ok(''), 6000))]); // si baja el idioma y tarda, pruebo con Vitalis
    if (r0) { dEn.set(txt, r0); return { en: r0 }; }
    const r = await send({ type: 'dock-tr', txt });
    if (r && r.en) { dEn.set(txt, r.en); return { en: r.en }; }
    return { why: (r && r.why) || 'no' };
  }
  const cmsg = (cls, html) => { if (!dk) return; const m = dk.$('cmsg'); m.className = 'msg ' + cls; m.innerHTML = html; };
  async function dockClick(e) {
    const b = e.target.closest('button,#pill'); if (!b || !dk) return;
    const cl = dock && !dock.locked ? dock.cl : null;
    if (b.id === 'pill') return dockMin(false);
    if (b.id === 'dmin') return dockMin(true);
    if (b.dataset.a) { const r = await send({ type: 'dock-act', a: b.dataset.a }); if (!r || !r.ok) cmsg('err', 'Abrí Vitalis.'); return; }
    if (b.dataset.t) { // baño, 10 min, 30 min, Volví: lo marca Vitalis (si está abierto)
      for (const x of dk.root.querySelectorAll('[data-t]')) x.disabled = true;
      const r = await send({ type: 'dock-act', a: b.dataset.t });
      if (!r || !r.ok) { dockDraw(); dk.$('tu').insertAdjacentHTML('beforeend', '<p class="note warn">Abrí Vitalis para marcarlo.</p>'); }
      else setTimeout(() => { if (dk) for (const x of dk.root.querySelectorAll('[data-t]')) x.disabled = false; }, 2500);
      return;
    }
    if (b.hasAttribute('data-ce') && cl) { dCamp = { id: cl.id, open: true }; dockDraw(); const i = dk.$('cmin'); if (i) i.focus(); return; }
    if (b.hasAttribute('data-cx')) { dCamp = { id: '', open: false }; dockDraw(); return; }
    if (b.hasAttribute('data-cs')) return dockCampSave();
    if (b.dataset.cp) { const ok = await dockCopy(b.dataset.cp); b.textContent = ok ? 'Copiado' : 'No pude'; setTimeout(() => { if (b.isConnected) b.textContent = 'Copiar ID'; }, 1800); return; }
    if (b.hasAttribute('data-diag')) { reportCurrent(true); const ok = await dockCopy(diagCur()); b.textContent = ok ? 'Copiado: mandáselo a quien mantiene Vitalis' : 'No pude copiar'; return; }
    if (b.hasAttribute('data-skip')) { dSkip++; dockNext(cl, !!(dock && dock.locked)); return; }
    if (b.dataset.pt && cl) { dPay.t = b.dataset.pt; dPay.all = false; dockPay(cl); return; }
    if (b.hasAttribute('data-pall') && cl) { dPay.all = true; dockPay(cl); return; }
    if (b.id === 'cclr' && cl) { dk.$('cmt').value = ''; dDrafts[cl.id] = ''; send({ type: 'dock-draft', id: cl.id, txt: '' }); cmsg('', ''); dk.$('cmt').focus(); return; }
    if (b.id === 'cpen' && cl) {
      const txt = dk.$('cmt').value.trim();
      if (!txt) { cmsg('warn', 'Escribí el comentario primero.'); dk.$('cmt').focus(); return; }
      b.disabled = true; b.textContent = 'Traduciendo…';
      const r = await dockEn(txt);
      b.disabled = false; b.textContent = 'Copiar en inglés';
      if (!r.en) return cmsg('err', r.why === 'bajando' ? 'Chrome está bajando el traductor: probá de nuevo en un minuto.' : r.why === 'cerrado' ? 'No pude traducirlo: abrí Vitalis y probá de nuevo.' : 'Este Chrome no tiene el traductor: hay que actualizar Chrome. No copié nada.');
      const ok = await dockCopy(r.en);
      cmsg(ok ? 'ok' : 'err', (ok ? 'Copiado en inglés. Pegalo en el CRM:' : 'No pude copiarlo: tocá de nuevo.') + `<div class="en">${escH(r.en)}</div>`);
    }
  }
  // ---- el cliente actual: la ficha abierta en el CRM ----
  // La ficha (panel arriba de la lista o página propia) tiene el nombre, "ID 68636" y los botones para llamar (Omega/Gizat/Voiso).
  // Gana el ID que está junto a esos botones y a la vista. Si hay varias fichas (una vieja escondida, un cajón abajo de otro), la que
  // está arriba de todo y, si no se sabe, la que apareció última. La dirección (/user/123) cuenta solo cuando cambia: si quedó vieja,
  // no le gana a la ficha abierta ni hace volver a un cliente de hace rato.
  let curSent = '', curName = '', curFrom = '', urlSeen = '', curMs = 0, missAt = 0, diagAt = 0;
  const ID_RE = /^\s*(?:client|user|lead)?\s*id\s*[:#.]?\s*#?\s*(\d{4,9})(?!\d)/i; // "ID 68636", "ID: 68636", "ID68636" (el número puede estar en otro elemento)
  const ID_LBL = /^\s*(?:client|user|lead)?\s*id\s*[:#.]?\s*$/i, ID_NUM = /^\s*#?\s*(\d{4,9})\s*$/, ID_LINE = /^(?:client |user |lead )?id\s*[:#.]?\s*#?\s*\d{4,9}$/i;
  const NO_TXT = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|OPTION|TITLE)$/;
  function idInUrl() {
    const m = (location.pathname + ' ' + location.hash).match(/\/users?\/(?:user\/)?(\d{3,})(?=[/?#\s]|$)/i)
      || (location.search + ' ' + location.hash).match(/[?&#](?:user_?id|client_?id|lead_?id)=(\d{3,})/i);
    return m ? m[1] : '';
  }
  const isMine = (e) => !!(e && ((ui && (e === ui.h || ui.h.contains(e))) || e.id === 'vitalis-cur-pill' || e.id === 'ftd-agenda-overlay' || e.id === 'vitalis-dock'));
  function onTop(el) { // 0 no se ve · 1 está pero fuera de la pantalla · 2 tapado por otra cosa · 3 a la vista
    if (!el || !el.isConnected) return 0;
    try { if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true })) return 0; } catch (e) {}
    const r = el.getBoundingClientRect(); if (r.width < 1 && r.height < 1) return 0;
    const W = innerWidth, H = innerHeight;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= H || r.left >= W) return 1;
    const x = Math.min(W - 1, Math.max(0, r.left + Math.min(r.width / 2, 12))), y = Math.min(H - 1, Math.max(0, r.top + r.height / 2));
    const rt = el.getRootNode(), e = (rt && rt !== document && rt.elementFromPoint ? rt : document).elementFromPoint(x, y); // dentro de un shadow root, el de adentro
    return !e || e === el || el.contains(e) || e.contains(el) || isMine(e) ? 3 : 2;
  }
  // La ficha del CRM real vive dentro de un componente con shadow DOM (<client-card>, en el cajón de la derecha): el texto de adentro
  // no aparece recorriendo la página común, y los cambios de adentro no los ve el observador. Se recorre también por dentro.
  const shadowOf = (el) => { if (el.shadowRoot) return el.shadowRoot; try { return chrome.dom && chrome.dom.openOrClosedShadowRoot ? chrome.dom.openOrClosedShadowRoot(el) : null; } catch (e) { return null; } };
  const watchedRoots = new WeakSet();
  function* textNodes(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 1) {
        const sr = n.shadowRoot || (n.tagName.includes('-') ? shadowOf(n) : null); // los componentes tienen guion en el nombre
        if (sr && !isMine(n)) {
          if (!watchedRoots.has(sr)) { watchedRoots.add(sr); try { obs.observe(sr, { childList: true, subtree: true, characterData: true }); } catch (e) {} } // así se entera cuando cambia la ficha
          yield* textNodes(sr);
        }
        continue;
      }
      yield n;
    }
  }
  // una sola pasada por el texto de la página: los "ID 12345", los botones para llamar y los números sueltos
  function scanCur() {
    const ids = [], lines = [], nums = [], root = document.body; if (!root) return { ids, lines, nums };
    let lbl = null;
    const pair = (a, n) => { for (let e = a, k = 0; e && k < 3; e = e.parentElement, k++) { if (/^(TABLE|TBODY|THEAD|TFOOT)$/.test(e.tagName) || /^(table|grid|rowgroup)$/.test(e.getAttribute('role') || '')) return false; if (e.contains(n)) return true; } return false; };
    for (const n of textNodes(root)) {
      const t = (n.nodeValue || '').trim(); if (!t) continue; // sin la sangría: el CRM real deja "\n            ID 70759\n          "
      if (t.length > 60) { lbl = null; continue; }
      const p0 = n.parentElement; if (!p0 || NO_TXT.test(p0.tagName) || isMine(p0)) { lbl = null; continue; }
      const nm = t.match(ID_NUM);
      if (lbl && nm && pair(lbl, n)) { ids.push({ id: nm[1], el: p0 }); lbl = null; continue; } // "ID" en una celda y el número en la de al lado (no el encabezado de una lista)
      lbl = null;
      if (nm) { if (nums.length < 400) nums.push({ id: nm[1], el: p0 }); continue; }
      if (/(^|[^a-z])id([^a-z]|$)/i.test(t)) {
        let hit = null;
        for (let el = p0, k = 0; el && k < 3 && !hit; k++, el = el.parentElement) {
          const tx = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (tx.length > 48) break;
          const m = tx.match(ID_RE); if (m) hit = { id: m[1], el };
        }
        if (hit) { if (ids.length < 300) ids.push(hit); } else if (ID_LBL.test(t)) lbl = p0;
        continue;
      }
      if (/omega|gizat|voiso/i.test(t)) {
        const bb = p0.closest('button,a,[role=button]');
        if (!bb && p0.closest(GRID_CELL)) continue; // el historial de llamadas (una tabla con "Omega" en una celda) no es un botón para llamar
        const b = bb || p0;
        if (lines.some((x) => x.el === b)) continue;
        const tx = (b.textContent || '').replace(/\s+/g, ' ').trim();
        if (tx.length <= 60 && LINE_RE.test(tx)) lines.push({ el: b, v: onTop(b) });
      }
    }
    return { ids, lines, nums };
  }
  const pseudoId = (el) => { // el "ID" lo pone el estilo (::before), no está en el texto
    try {
      for (let e = el, k = 0; e && k < 2; e = e.parentElement, k++) for (const ps of ['::before', '::after']) if (/(^|[^a-z])id([^a-z]|$)/i.test(getComputedStyle(e, ps).content || '')) return true;
      const p = el.previousElementSibling; return !!(p && ID_LBL.test(cellText(p) || (getComputedStyle(p, '::before').content || '').replace(/["']/g, '')));
    } catch (e) { return false; }
  };
  const firstSeen = new Map(); // ID → cuándo apareció su ficha en esta pestaña
  function panelClient() {
    const { ids, lines, nums } = scanCur(), B = lines.filter((b) => b.v >= 1), now = Date.now();
    for (const c of ids) c.v = onTop(c.el);
    const C = ids.filter((c) => c.v), here = new Set(C.map((c) => c.id));
    for (const k of [...firstSeen.keys()]) if (!here.has(k)) firstSeen.delete(k);
    for (const k of here) if (!firstSeen.has(k)) firstSeen.set(k, now);
    const fs = (c) => firstSeen.get(c.id) || 0;
    // la ficha de cada botón es lo más cerca que tenga un ID, y la de cada ID lo más cerca que tenga un botón: van juntos si se eligen los dos
    // (así un botón de la ficha abierta no se queda con el ID de una ficha vieja que está en otra parte de la página)
    const nearest = (el, list) => { for (let e = upC(el), k = 0; e && k < 14; e = upC(e), k++) { const h = list.filter((x) => inC(e, x.el)); if (h.length) return h; } return []; };
    const nb = new Map();
    for (const c of C) c.near = 0;
    for (const b of B) for (const c of nearest(b.el, C)) { if (!nb.has(c)) nb.set(c, nearest(c.el, B)); if (nb.get(c).includes(b)) c.near = Math.max(c.near, b.v); }
    const rank = (L) => L.sort((a, b) => (b.near * 10 + b.v) - (a.near * 10 + a.v) || fs(b) - fs(a))[0] || null;
    // lo simple primero: un renglón que dice solo "ID 70759" (el de debajo del nombre en la ficha) y está a la vista. Si es uno solo, es ese.
    const solo = C.filter((c) => c.v === 3 && ID_LINE.test((c.el.textContent || '').replace(/\s+/g, ' ').trim())), sd = [...new Set(solo.map((c) => c.id))];
    let pick = sd.length === 1 ? solo[0] : rank(C.filter((c) => c.near && Math.max(c.near, c.v) >= 2)); // la ficha o sus botones tienen que estar a la vista (no una ficha vieja fuera de la pantalla)
    if (!pick && B.some((b) => b.v >= 2)) { // hay botones para llamar pero el ID no dice "ID" al lado: un número solo arriba de los botones
      for (const b of B.filter((x) => x.v >= 2)) {
        for (let e = b.el.parentElement, k = 0; e && k < 8 && !pick; e = e.parentElement, k++) {
          const h = nums.filter((x) => e.contains(x.el) && !B.some((y) => y.el.contains(x.el)) && (x.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING));
          if (!h.length) continue;
          if (h.length > 6 || B.filter((y) => e.contains(y.el)).length > 9) break; // ya es la página entera (la lista), no la ficha
          const x = h.find((y) => pseudoId(y.el)) || h[0], v = onTop(x.el); if (v) pick = { id: x.id, el: x.el, v, near: b.v };
          break;
        }
        if (pick) break;
      }
    }
    if (!pick && !B.some((b) => b.v >= 2)) { // sin botones a la vista: el único ID de la página o, si hay varios, el que apareció último
      const vis = C.filter((c) => c.v >= 2), L = vis.length ? vis : B.length ? [] : C, ds = [...new Set(L.map((c) => c.id))];
      if (ds.length === 1) pick = L[0];
      else if (ds.length > 1) { L.sort((a, b) => fs(b) - fs(a)); const o = L.find((c) => c.id !== L[0].id); if (fs(L[0]) > fs(o)) pick = L[0]; }
    }
    return { pick: pick ? { id: pick.id, name: nameNear(pick.el) } : null, calls: B.some((b) => b.v >= 2) };
  }
  const NOT_NAME = /^(server|status|estado|id|phone|tel[eé]fono|email|e-mail|country|pa[ií]s|language|idioma|source|apx|time|balance|desk|campaign|affiliate|individual|corporate)\b/i;
  const nameOk = (t) => !!t && t.length >= 3 && t.length <= 60 && /\p{L}{2}/u.test(t) && !/\d{3,}|[:@/]/.test(t) && !NOT_NAME.test(t) && !LINE_RE.test(t);
  const noIcon = (t) => t.split(' ').filter((w) => !/^[a-z]+(?:_[a-z]+)+$/.test(w)).join(' ').trim(); // los íconos de Material vienen como texto ("radio_button_checked")
  function nameNear(el) { // el nombre que está arriba del ID en la ficha
    for (let e = el, k = 0; e && k < 5; k++, e = e.parentElement) { const u = e.querySelector && e.querySelector('.user-name'); if (u) { const t = noIcon(cellText(u)); if (nameOk(t)) return t; } } // la ficha del CRM real lo marca así
    for (let e = el, k = 0; e && k < 4; k++, e = e.parentElement) {
      for (let p = e.previousElementSibling, j = 0; p && j < 2; p = p.previousElementSibling, j++) {
        const t = noIcon(cellText(p)); if (nameOk(t)) return t; if (t) break;
      }
    }
    return '';
  }
  // el cliente actual sale de las pestañas donde el agente trabaja y llama, nunca de la que se actualiza sola para los news
  function reportCurrent(force) {
    if ((watched && !trial) || document.visibilityState !== 'visible' || !document.body) return;
    const t0 = performance.now();
    try {
      const uid = idInUrl(), { pick, calls } = panelClient(), urlNew = !!uid && uid !== urlSeen; urlSeen = uid;
      if (!calls || pick) missAt = 0;
      if (pick) { curFrom = 'panel'; return sendCurrent(pick.id, pick.name, force); }
      if (uid && (urlNew || (force && curFrom === 'url' && curSent === uid))) { curFrom = 'url'; return sendCurrent(uid, document.title && !/crm|novara|trade|login|users/i.test(document.title) ? document.title.trim().slice(0, 120) : '', force); }
      if (calls && Date.now() - diagAt > 600000) { // hay una ficha con botones para llamar pero no encuentro su ID: a los 3 s, el aviso para copiar el diagnóstico
        if (!missAt) { missAt = Date.now(); setTimeout(() => { if (live() && missAt) reportCurrent(); }, 3200); }
        else if (Date.now() - missAt >= 3000) { missAt = 0; diagAt = Date.now(); curPill('', { diag: 1 }); }
      }
    } finally { curMs = performance.now() - t0; }
  }
  function sendCurrent(id, name, force) {
    if ((watched && !trial) || !id) return;
    if (!force && id === curSent && (curName || !name)) return; // ya lo mandé (salvo que recién aparezca el nombre)
    curName = name || (id === curSent ? curName : ''); curSent = id;
    send({ type: 'crm-current', id, name: '', brand }).then((r) => curPill(id, r)); // aviso chico para saber que Vitalis lo tomó
  }
  function diagCur() { // solo la forma de la ficha (etiquetas, clases y textos tapados): ningún dato del cliente
    const S = scanCur(), b = S.lines.find((x) => x.v >= 2) || S.ids.find((x) => onTop(x.el) >= 2)
      || (() => { const e = [...document.querySelectorAll('button,a,[role=button]')].find((x) => LINE_RE.test((x.textContent || '').replace(/\s+/g, ' ').trim())); return e ? { el: e } : null; })();
    let box = b ? b.el : document.body; if (!box) return '';
    if (b) for (let i = 0; i < 7 && box.parentElement && box.parentElement !== document.body; i++) box = box.parentElement;
    const P = panelClient(), info = { ids: S.ids.map((x) => onTop(x.el)), lines: S.lines.map((x) => x.v), pick: !!P.pick, same: !!P.pick && P.pick.id === curSent, frames: document.querySelectorAll('iframe').length, shadow: [...document.querySelectorAll('body *')].slice(0, 4000).filter((e) => shadowOf(e) && !isMine(e)).map((e) => e.tagName.toLowerCase()).slice(0, 10), watched, stView: !!stView };
    const cl = box.cloneNode(true), O = [box, ...box.querySelectorAll('*')].slice(0, 800), K = [cl, ...cl.querySelectorAll('*')].slice(0, 800);
    O.forEach((o, i) => { try { const c = getComputedStyle(o, '::before').content; if (c && !/^(none|normal|""|'')$/.test(c)) K[i].setAttribute('data-before', c.slice(0, 30)); } catch (e) {} });
    for (const s of cl.querySelectorAll('script,style,svg,img')) s.replaceWith(document.createElement(s.tagName.toLowerCase()));
    const w = document.createTreeWalker(cl, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) n.nodeValue = n.nodeValue.replace(/[\p{L}\d]+/gu, (s) => /^(id|omega|gizat|voiso|latam|server)$/i.test(s) ? s : s.replace(/\p{L}/gu, 'x').replace(/\d/g, '9'));
    for (const e of [cl, ...cl.querySelectorAll('*')]) for (const a of [...e.attributes]) { if (!/^(class|role|id|data-before)$/i.test(a.name)) e.removeAttribute(a.name); else if (a.name !== 'data-before') e.setAttribute(a.name, a.value.replace(/\d/g, '9').slice(0, 120)); }
    return JSON.stringify({ v: VER, page: location.pathname.replace(/\d/g, '9'), info, html: cl.outerHTML.slice(0, 14000) });
  }
  let pillT = null;
  function curPill(id, r) {
    if (dk && r && r.sent && !(r && r.diag)) return; // la mini ficha ya lo muestra
    let h = document.getElementById('vitalis-cur-pill');
    if (!h) { h = document.createElement('div'); h.id = 'vitalis-cur-pill'; h.attachShadow({ mode: 'open' }); document.documentElement.appendChild(h); }
    const diag = r && r.diag, ok = r && r.sent;
    const txt = diag ? 'no encuentro el ID de esta ficha' : !r ? 'la extensión se actualizó: recargá la página' : ok ? `cliente actual: ${id}` : `abrí Vitalis para ver a ${id}`;
    h.shadowRoot.innerHTML = `<style>div{position:fixed;left:16px;bottom:16px;z-index:2147483646;font:500 12.5px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;background:#fff;color:#0f1720;border:1.5px solid ${ok ? '#00b36b' : '#f59e0b'};padding:7px 12px 7px 11px;${dk ? `bottom:${Math.round(dk.h.getBoundingClientRect().height) + 26}px;` : ''}border-radius:999px;box-shadow:0 8px 24px rgba(16,24,40,.16);display:flex;gap:8px;align-items:center}i{width:9px;height:9px;border-radius:50%;background:${ok ? '#00b36b' : '#f59e0b'};flex:none}b{font-weight:700;letter-spacing:-.03em}button{font:inherit;font-weight:700;color:#0f1720;background:#fff;border:1.5px solid #dde2e7;border-radius:999px;padding:3px 10px;cursor:pointer}button:hover{border-color:#6b7684}</style><div><i></i><span><b>vitalis</b> · ${txt.replace(/[<>&]/g, '')}</span>${diag ? '<button type="button">Copiar diagnóstico</button>' : ''}</div>`;
    const btn = h.shadowRoot.querySelector('button');
    if (btn) btn.onclick = () => navigator.clipboard.writeText(diagCur()).then(() => { btn.textContent = 'Copiado: mandáselo a quien mantiene Vitalis'; }, () => { btn.textContent = 'No pude copiar'; });
    clearTimeout(pillT); pillT = setTimeout(() => h.remove(), diag ? 20000 : 4500);
  }
  // la ficha cambió: lo miro enseguida (aparte de la lectura de la lista, que espera a que la página se quede quieta), como mucho ~1 vez por segundo
  let curT = null, curLast = 0;
  function schedCur() {
    if ((watched && !trial) || stView || curT || document.visibilityState !== 'visible') return; // en la prueba la pestaña de news también manda el cliente abierto
    curT = setTimeout(() => { curT = null; curLast = Date.now(); if (live()) reportCurrent(); }, Math.max(120, Math.max(700, curMs * 25) - (Date.now() - curLast)));
  }
  document.addEventListener('visibilitychange', () => { if (live() && document.visibilityState === 'visible' && !stView) { reportCurrent(true); } });
  for (const ev of ['transitionend', 'animationend']) addEventListener(ev, () => { if (live()) schedCur(); }, { capture: true, passive: true }); // la ficha terminó de entrar
  const poll = () => setTimeout(() => { if (!live()) return; if ((!watched || trial) && !stView && document.visibilityState === 'visible') reportCurrent(); poll(); }, Math.max(1500, curMs * 30)); // y cada 1,5 s, por las dudas
  poll();
  let lastMs = 0, againT = null, refAt = Date.now(), lastRead = 0; // refAt: el último ⟳ de la estación (al cargar la página cuenta como uno)
  const again = () => { clearTimeout(againT); againT = setTimeout(() => { if (live()) refresh(); }, 3000); }; // algo no llegó a la extensión: vuelvo a leer y lo mando
  function refresh(force) {
    if (!live()) return retire();
    const t0 = performance.now(); lastRead = Date.now();
    try { refresh0(force); } finally { lastMs = performance.now() - t0; }
  }
  function refresh0(force) {
    schedCur();
    for (const e of document.querySelectorAll('#ftd-crm-button')) if (!ui || e !== ui.h) e.remove(); // paneles de copias viejas
    const T = tables();
    sales = trial ? null : scanSales(T); // en la prueba no se pasan ventas
    seen = scanAll(T);
    clients = scanClients(seen);
    const looksFtd = !sales && /bank|transaction/i.test(location.hash + location.pathname) && /transaction id/i.test(document.body ? document.body.innerText : '');
    autoWatch(!!(sales || seen));
    if (watched) report(clients, force);
    reportLeads(clients);
    reportSeen(seen);
    goneCheck(seen);
    if (stView) stReport();
    dockVis();
    if (!sales && !seen && !looksFtd) { if (ui) { ui.h.remove(); ui = null; } return; }
    if (!ui) ui = build();
    render();
    autoSales();
  }
  // team leader con columna de vendedor: las ventas nuevas se pasan solas a cada uno (las que no son de nadie de la mesa, no)
  let autoT = null;
  function autoSales() {
    clearTimeout(autoT);
    if (!sales || !isLeader() || !known || busy || !sales.some((s) => s.agent)) return;
    autoT = setTimeout(() => {
      const rows = (scanSales(tables()) || []).filter((s) => s.agent && !isKnown(s) && !isQueued(s) && !tried.has(norm(s.brand) + '|' + norm(s.id)) && (repUid(s.agent) || repName(s.agent)));
      if (rows.length && !busy) sendSales(rows);
    }, 1500); // espero a que la tabla termine de cargar
  }
  function result(res) {
    busy = false;
    if (!res) return setMsg('La extensión no respondió. Recargá la página.', 'err');
    if (res.err) return setMsg(escH(res.err), 'err');
    if (res.queued) return setMsg(`${plural(res.queued, 'venta')} en espera: se cargan cuando abras Vitalis.<button class="lnk" data-open>Abrir Vitalis</button>`, 'warn');
    const mes = res.mes && !isLeader() ? ` Este mes: ${res.mes.n} FTDs, ${res.mes.usd} USD.` : '';
    const sin = res.unmatched ? ` ${plural(res.unmatched, 'quedó sin vendedor', 'quedaron sin vendedor')}: asignalas en Vitalis.` : '';
    const fm = res.formers ? ` ${res.formers === 1 ? 'Sumé 1 desvinculado' : 'Sumé ' + res.formers + ' desvinculados'} (ya no están en la mesa).` : '';
    if (res.added) setMsg(`${res.added === 1 ? 'Pasé 1 venta' : 'Pasé ' + res.added + ' ventas'} a Vitalis.${mes}${fm}${sin}`, sin ? 'warn' : 'ok', 12000);
    else setMsg(sin ? sin.trim() : `No había nada nuevo.${mes}`, sin ? 'warn' : 'ok', 8000);
  }
  async function sendSales(auto) {
    if (busy) return;
    const all = (scanSales(tables()) || []).filter((s) => !isKnown(s) && !isQueued(s)), hasCol = all.some((s) => s.agent) || (sales || []).some((s) => s.agent);
    let nuevas = Array.isArray(auto) ? auto : all;
    if (!Array.isArray(auto) && isLeader() && hasCol) nuevas = all.filter((s) => !repUid(s.agent)); // el botón del team leader: las que no son de nadie de la mesa (las asigna en Vitalis)
    if (!isLeader() && hasCol && desk) nuevas = nuevas.filter((s) => repUid(s.agent) === desk.me); // un agente: solo las suyas
    if (!nuevas.length) return refresh();
    busy = true; if (!Array.isArray(auto)) msg = null; render();
    if (isLeader() && !hasCol && whoSel) for (const s of nuevas) s.uid = whoSel; // sin columna de vendedor: a quien eligió
    if (isLeader() && hasCol) for (const s of nuevas) s.rep = 1; // la tabla tiene columna de vendedor: si está vacía, queda para asignar
    if (Array.isArray(auto)) markTried(nuevas);
    const r = await send({ type: 'crm-import', rows: nuevas });
    result(r || { err: 'La extensión se actualizó: recargá la página.' });
  }
  // hay filas en la página pero no saqué ningún cliente (la tabla del CRM cambió)
  const unread = () => !!(seen && !seen.length && [...document.querySelectorAll('tr')].filter((r) => r.cells.length >= 4 && dataRow(r, [...r.cells])).length >= 3);
  function diagClients() { // solo la forma de las tablas (encabezados, clases, cantidad de celdas): ningún dato de clientes
    const sh = (r) => { const cs = r.cells ? [...r.cells] : [...r.querySelectorAll('[role=gridcell],[role=cell]')];
      return { cls: String(r.className || '').slice(0, 80), role: r.getAttribute('role') || '', cells: cs.length, ctl: r.querySelectorAll(FORM).length, txt: cs.filter((c) => cellText(c)).length }; };
    const out = { v: VER, page: location.pathname, head: clHead, roleRows: document.querySelectorAll('[role=row]').length,
      headers: [...document.querySelectorAll('[role=columnheader]')].slice(0, 25).map((c) => lab(cellText(c))),
      tables: [...document.querySelectorAll('table')].slice(0, 12).map((t) => ({ cls: String(t.className || '').slice(0, 80), box: String((t.parentElement && t.parentElement.className) || '').slice(0, 80), rows: t.rows.length, first: [...t.rows].slice(0, 4).map(sh) })) };
    navigator.clipboard.writeText(JSON.stringify(out)).then(() => setMsg('Copiado (sin datos de clientes). Mandáselo a quien mantiene Vitalis.', 'ok', 10000), () => setMsg('No pude copiar.', 'err'));
  }
  function diagnostic() { // si el CRM cambia y no encuentro la tabla: copia el HTML del encabezado para poder ajustarlo
    const el = [...document.querySelectorAll('th,td,div,span')].find((e) => /^transaction id$/i.test(cellText(e)));
    let box = el; for (let i = 0; i < 6 && box && box.parentElement; i++) box = box.parentElement;
    const html = (box ? box.outerHTML : document.body.outerHTML).slice(0, 15000);
    navigator.clipboard.writeText(html).then(() => setMsg('Copiado. Mandáselo a quien mantiene Vitalis para ajustar el botón.', 'ok', 10000), () => setMsg('No pude copiar.', 'err'));
  }

  // ---- estación: lo que vio esta pestaña al leer (filas, status de cada una, si hay sesión, el total que dice el CRM) ----
  let stLast = '', stLastAt = 0;
  function stReport() {
    const trx = stView === 'trx', list = trx ? sales : seen, statuses = {};
    if (!trx && seen) for (const c of seen) { const k = String(c.status || '').slice(0, 60); if (k) statuses[k] = (statuses[k] || 0) + 1; }
    const m = { type: 'station-scan', login: loginPage(), table: !!list, n: list ? list.length : 0, total: pagerTotal(), statuses };
    const sig = JSON.stringify([m.login, m.table, m.n, m.total, statuses]);
    if (sig === stLast && Date.now() - stLastAt < 8000) return;
    stLast = sig; stLastAt = Date.now();
    send(m).then((r) => { const p = (r && r.problem) || ''; if (p !== stProb) { stProb = p; if (ui) render(); } });
  }
  function pagerTotal() { // el total que dice el CRM debajo de la lista ("Page 1 of 7 (634 items)", "1-100 of 634", "Total: 634")
    const els = [...document.querySelectorAll('.dx-info,.dx-pages,.ant-pagination-total-text,.ant-pagination,[class*=pager],[class*=pagination],[class*=total]')].slice(0, 30);
    for (const e of els) {
      if (isMine(e)) continue;
      const t = (e.textContent || '').replace(/\s+/g, ' ').slice(0, 200);
      const m = t.match(/\((\d[\d.,]*)\s*(?:items|registros|elementos|filas|results|resultados|entries)\)/i)
        || (!/p[aá]g/i.test(t) && t.match(/\b(?:of|de)\s+(\d[\d.,]*)\b/i)) || t.match(/total\s*:?\s*(\d[\d.,]*)/i);
      if (m) { const n = parseInt(m[1].replace(/[.,]/g, ''), 10); if (n >= 0 && n < 1e7) return n; }
    }
    return null;
  }

  // la página cambió: leo de nuevo cuando se queda quieta 0,6 s, y como mucho a los 2 s aunque no pare de moverse (un reloj, una animación).
  // Si leer la lista tarda (tablas muy grandes), espero más entre lecturas para no trabar el CRM.
  let t = null, firstMut = 0;
  const mine = (n) => { const h = n && n.nodeType === 1 ? n : n && n.parentElement; return !!(h && ((ui && (h === ui.h || ui.h.contains(h))) || h.id === 'vitalis-cur-pill' || h.id === 'ftd-agenda-overlay' || h.id === 'vitalis-dock')); };
  const obs = new MutationObserver((muts) => {
    if (muts.every((m) => mine(m.target) || (m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].length > 0 && [...m.addedNodes, ...m.removedNodes].every(mine)))) return; // lo que cambió es de Vitalis
    const now = Date.now(), quiet = Math.min(3000, Math.max(600, lastMs * 4)), cap = Math.max(2000, quiet * 2);
    if (stView && now - refAt > 12000 && now - lastRead < 30000) return; // la estación lee después de su ⟳ (y cada 30 s por las dudas), no con cada cambio de la página
    schedCur();
    if (!firstMut) firstMut = now;
    clearTimeout(t);
    t = setTimeout(() => { firstMut = 0; refresh(); }, Math.max(0, Math.min(quiet, firstMut + cap - now)));
  });
  const start = () => { obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); refresh(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  addEventListener('hashchange', () => setTimeout(refresh, 300));
  addEventListener('popstate', () => schedCur());
})();
