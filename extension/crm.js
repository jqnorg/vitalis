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
    return { date: dt.date, time: dt.time, id, name: g('name'), country: g('country'), aff: g('aff'), camp: g('camp'), amount, tx: g('tx'), reg, brand: b ? brandOf(b) : brand, agent: g('agent') };
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
    status: ['status', 'estado', 'sales status', 'lead status', 'retention status'],
    id: ['client id', 'user id', 'lead id', 'customer id', 'account id', 'id', 'cid'],
    name: ['full name', 'client name', 'lead name', 'name', 'client', 'nombre'],
    first: ['first name'], last: ['last name'],
    country: ['country', 'pais'],
    created: ['registration time', 'registration date', 'created at', 'created', 'registered', 'date'],
    agent: COLS.agent, camp: ['campaign', 'user source', 'utm campaign', 'source'], aff: ['affiliate', 'affiliate id', 'afiliado', 'aff id'],
    call: ['last communication time', 'last communication', 'last call time', 'last call', 'last contact', 'ultima comunicacion', 'ultimo contacto'],
    note: ['last note', 'note', 'notes', 'last comment', 'comment', 'nota', 'notas'],
    ftd: ['time of ftd', 'ftd time', 'ftd date', 'fecha ftd'], desk: ['sales desk', 'desk'],
  };
  let clHead = null; // la tabla de clientes que encontré (para el diagnóstico)
  function scanAll(T) { // tabla con columna de estado que no sea la de FTDs: todas las filas, con su status
    const C = T.filter((x) => idxOf(x.labels, CL.status) >= 0 && !isFtdTable(mapFtd(x.labels)) && (idxOf(x.labels, CL.id) >= 0 || idxOf(x.labels, CL.name) >= 0 || idxOf(x.labels, CL.first) >= 0));
    clHead = C.length ? C[0].labels : null;
    if (!C.length) return null;
    let best = null;
    for (const x of C) { const r = clientsOf(x); if (!best || r.length > best.length) best = r; }
    return best;
  }
  function clientsOf(t) {
    const ix = {}; for (const k in CL) ix[k] = idxOf(t.labels, CL[k]);
    const g = (c, k) => (ix[k] >= 0 ? c[ix[k]] || '' : '');
    const out = [];
    for (const c of t.rows) {
      const status = g(c, 'status').trim();
      const name = g(c, 'name') || [g(c, 'first'), g(c, 'last')].filter(Boolean).join(' ');
      const id = g(c, 'id');
      if ((!id && !name) || !status) continue;
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
  chrome.storage.local.get(['known', 'importQ', 'watches']).then((s) => { known = s.known || null; queued = qset(s.importQ); setWatch(s.watches); refresh(); }).catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.known) known = ch.known.newValue || null;
    if (ch.importQ) queued = qset(ch.importQ.newValue);
    if (ch.watches) setWatch(ch.watches.newValue);
    if (ch.known || ch.importQ || ch.watches) refresh();
  });
  const isKnown = (s) => { if (!known) return false; prep(); const b = norm(s.brand); return (s.tx && known.txSet.has(b + '|' + s.tx)) || known.idSet.has(b + '|' + norm(s.id)); };
  const isQueued = (s) => queued.has(norm(s.brand) + '|' + norm(s.id));

  /* ================= vigilancia: una sola pestaña, la que se elige con el botón ================= */
  // la elegida se actualiza cada 10 s y avisa de los new; las demás quedan quietas y solo suman clientes al registro
  let myTab = null, watches = {}, watch = null, watched = false, owner = null, noTableSince = 0;
  send({ type: 'whoami' }).then((r) => { myTab = r && r.tabId; setWatch(watches); refresh(); });
  function setWatch(all) {
    watches = all || {}; watch = myTab != null ? watches[myTab] || null : null; watched = !!watch;
    owner = Object.values(watches).find((w) => w && w.tabId !== myTab) || null; // otra pestaña ya tiene la vigilancia
  }
  const multiWatch = () => !!(desk && desk.role === 'leader'); // el team leader puede tener varias pestañas actualizándose
  const nWatch = () => Object.keys(watches).length;
  function autoWatch(hasTable) { // si la elegida se queda sin tabla un rato (te fuiste a otra parte del CRM), se libera
    if (myTab == null || !watched) return;
    if (hasTable) { noTableSince = 0; return; }
    if (!noTableSince) noTableSince = Date.now();
    else if (Date.now() - noTableSince > 20000) { noTableSince = 0; send({ type: 'crm-watch-stop' }); }
  }
  async function watchBtn() {
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
    const rows = list.filter((c) => c.id || c.name).map((c) => ({ id: c.id, name: c.name, country: c.country, reg: c.reg }));
    const sig = rows.map((c) => c.id || c.name).join('|');
    if (sig === lastLeads) return;
    lastLeads = sig;
    send({ type: 'crm-leads', clients: rows.slice(0, 300) });
  }

  // todos los clientes que se ven en esta pestaña → registro de clientes de Vitalis (status, registro, agente, campaña)
  const sentSig = new Map((() => { try { return JSON.parse(sessionStorage.getItem('vitalis-seen') || '[]'); } catch (e) { return []; } })());
  function reportSeen(all) {
    if (!all || !all.length) return;
    const rows = [];
    for (const c of all) {
      if (!c.id) continue;
      const k = norm(c.brand) + '|' + norm(c.id), sig = [c.status, c.reg, c.agent, c.camp, c.aff, c.name, c.country, c.call, c.note, c.ftd, c.desk].join('|');
      if (sentSig.get(k) === sig) continue;
      sentSig.set(k, sig);
      rows.push({ id: c.id, brand: c.brand, name: c.name, country: c.country, status: c.status, reg: c.reg, agent: c.agent, camp: c.camp, aff: c.aff, call: c.call, note: c.note, ftd: c.ftd, desk: c.desk });
    }
    if (!rows.length) return;
    try { sessionStorage.setItem('vitalis-seen', JSON.stringify([...sentSig].slice(-5000))); } catch (e) {}
    for (let i = 0; i < rows.length; i += 300) send({ type: 'crm-seen', rows: rows.slice(i, i + 300) });
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
  let ui = null, busy = false, msg = null, msgT = null, sales = null, clients = null, seen = null, whoSel = '';
  const isLeader = () => !!(desk && (desk.role === 'leader' || desk.role === 'admin'));
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
      .sec{margin-top:9px}[hidden]{display:none!important}
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
      .vv{color:#5b685f;font-size:11px;font-weight:600;margin-left:-3px}
    </style><div class="box"><div class="h"><img class="mk" src="${chrome.runtime.getURL('icons/48.png')}" alt=""><span class="tag">vitalis</span><span class="vv">${escH(VER)}</span><span class="t" id="t"></span><button class="x" id="min" title="Minimizar">–</button></div>
      <div class="sec" id="sSales"><div class="row" id="whoRow" hidden style="margin-bottom:7px"><span class="st" style="margin:0">De</span><select id="who" style="flex:1" title="A quién se le cargan las ventas"></select></div><button class="go" id="go"></button><div class="ids" id="ids"></div><div class="msg" id="msg"></div></div>
      <div class="sec" id="sWatch"><div class="st" id="wst"></div><button class="go" id="wbtn"></button><div class="ids" id="wids"></div></div></div>`;
    root.getElementById('go').addEventListener('click', () => (ui.diag ? diagnostic() : sendSales(false)));
    root.getElementById('wbtn').addEventListener('click', () => watchBtn());
    root.getElementById('who').addEventListener('change', (e) => { whoSel = e.target.value; render(); });
    root.getElementById('min').addEventListener('click', () => root.querySelector('.box').classList.toggle('min'));
    root.getElementById('wids').addEventListener('click', (e) => { if (e.target.closest('[data-diag]')) diagClients(); });
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
    const looksFtd = !sales && /bank|transaction/i.test(location.hash + location.pathname) && /transaction id/i.test(document.body ? document.body.innerText : '');
    ui.diag = looksFtd;
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
    $('msg').innerHTML = msg ? msg.html : (sales && !known ? '<span class="warn">Abrí Vitalis una vez para saber cuáles ya están.</span>' : '');
    // vigilancia: una sola pestaña se actualiza; las demás suman clientes
    $('sWatch').hidden = !(sales || seen);
    if (sales || seen) {
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
  function retire() { try { obs.disconnect(); } catch (e) {} if (ui) { ui.h.remove(); ui = null; } }
  // el cliente que tenés abierto en el CRM (su ficha: /user/123 o #/users/user/123): en Vitalis queda como "cliente actual"
  let curSent = '';
  function currentClient() {
    const m = location.pathname.match(/\/user\/(\d{3,})/) || location.hash.match(/\/users\/user\/(\d{3,})/);
    // si la ficha se abre como panel adentro de otra página: el "ID 12345" de su encabezado
    const hd = m ? null : [...document.querySelectorAll('body *')].find((e) => !e.children.length && e.offsetParent && /^ID:?\s*\d{4,}$/.test((e.textContent || '').trim()));
    if (!m && !hd) return null;
    const id = m ? m[1] : hd.textContent.match(/\d{4,}/)[0];
    let name = '';
    const el = hd || [...document.querySelectorAll('body *')].find((e) => !e.children.length && /^ID:?\s*\d{3,}$/.test((e.textContent || '').trim()) && (e.textContent.match(/\d{3,}/) || [])[0] === id);
    if (el) { const p = el.previousElementSibling || (el.parentElement && el.parentElement.previousElementSibling); if (p) name = cellText(p).replace(/\s+/g, ' ').trim().slice(0, 120); }
    if (!name && document.title && !/crm|novara|login|users/i.test(document.title)) name = document.title.trim().slice(0, 120);
    return { id, name };
  }
  function reportCurrent(force) {
    if (document.visibilityState !== 'visible') return;
    const c = currentClient(); if (!c) return;
    const sig = c.id + '|' + c.name; if (!force && sig === curSent) return; curSent = sig;
    send({ type: 'crm-current', id: c.id, name: c.name, brand }).then((r) => curPill(c.id, r)); // aviso chico para saber que Vitalis lo tomó
  }
  let pillT = null;
  function curPill(id, r) {
    let h = document.getElementById('vitalis-cur-pill');
    if (!h) { h = document.createElement('div'); h.id = 'vitalis-cur-pill'; h.attachShadow({ mode: 'open' }); document.documentElement.appendChild(h); }
    const ok = r && r.sent, txt = !r ? 'la extensión se actualizó: recargá la página' : ok ? `cliente actual: ${id}` : `abrí Vitalis para ver a ${id}`;
    h.shadowRoot.innerHTML = `<style>div{position:fixed;left:16px;bottom:16px;z-index:2147483646;font:600 12.5px system-ui,sans-serif;background:${ok ? '#1f7a4d' : '#8a5a1c'};color:#fff;padding:7px 12px;border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.25)}b{font-weight:800}</style><div><b>vitalis</b> · ${txt.replace(/[<>&]/g, '')}</div>`;
    clearTimeout(pillT); pillT = setTimeout(() => h.remove(), 4500);
  }
  document.addEventListener('visibilitychange', () => { if (live() && document.visibilityState === 'visible') reportCurrent(true); });
  function refresh(force) {
    if (!live()) return retire();
    reportCurrent();
    for (const e of document.querySelectorAll('#ftd-crm-button')) if (!ui || e !== ui.h) e.remove(); // paneles de copias viejas
    const T = tables();
    sales = scanSales(T);
    seen = scanAll(T);
    clients = scanClients(seen);
    const looksFtd = !sales && /bank|transaction/i.test(location.hash + location.pathname) && /transaction id/i.test(document.body ? document.body.innerText : '');
    autoWatch(!!(sales || seen));
    if (watched) report(clients, force);
    reportLeads(clients);
    reportSeen(seen);
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

  let t = null;
  const obs = new MutationObserver((muts) => {
    if (ui && muts.every((m) => ui.h.contains(m.target) || m.target === ui.h)) return;
    clearTimeout(t); t = setTimeout(refresh, 600);
  });
  const start = () => { obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); refresh(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  addEventListener('hashchange', () => setTimeout(refresh, 300));
})();
