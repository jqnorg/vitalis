// Vitalis · puente entre la página de Vitalis y la extensión.
// La página manda la agenda y los snippets (y recibe ventas y clientes new del CRM) con window.postMessage en su misma ventana.
(() => {
  const isVitalis = () => !!document.querySelector('meta[name="vitalis"]');
  const post = (msg) => { try { window.postMessage(msg, location.origin); return true; } catch (e) { return false; } };
  const deliver = (cmds) => { for (const c of cmds || []) post({ type: 'ftd-agenda-cmd', v: 1, cmd: c.cmd, k: c.k, r: c.r }); };
  const waiting = {}; // pedidos de importación esperando respuesta de la página
  let alive = false;  // la página ya habló con la extensión
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!isVitalis()) return false;
    if (msg && msg.type === 'cmds') { if (alive) { deliver(msg.cmds); reply({ ok: true }); } else reply({ ok: false }); return false; }
    if (msg && msg.type === 'tick') { if (alive) post({ type: 'ftd-agenda-tick', v: 1 }); return false; } // despierta a Vitalis en segundo plano
    if (msg && msg.type === 'leads') { // clientes new del CRM → al registro de Vitalis
      if (!alive) { reply({ noPanel: true }); return false; }
      const reqId = 'L' + Date.now() + Math.random().toString(36).slice(2);
      waiting[reqId] = reply;
      post({ type: 'ftd-agenda-leads', v: 1, reqId, rows: msg.rows });
      setTimeout(() => { if (waiting[reqId]) { waiting[reqId]({ noPanel: true }); delete waiting[reqId]; } }, 9000);
      return true;
    }
    if (msg && msg.type === 'import') { // ventas del botón del CRM → a Vitalis
      if (!alive) { reply({ noPanel: true }); return false; }
      const reqId = 'r' + Date.now() + Math.random().toString(36).slice(2);
      waiting[reqId] = reply;
      post({ type: 'ftd-agenda-import', v: 1, reqId, rows: msg.rows });
      setTimeout(() => { if (waiting[reqId]) { waiting[reqId]({ noPanel: true }); delete waiting[reqId]; } }, 9000);
      return true;
    }
    return false;
  });
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin || !isVitalis()) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'ftd-agenda-test' && d.v === 1) {
      try {
        chrome.runtime.sendMessage({ type: 'test' }, (res) => {
          const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
          post({ type: 'ftd-agenda-test-ack', v: 1, ok: !err && !!(res && res.ok), err: err || (res && res.err) || null, level: res && res.level });
        });
      } catch (x) {}
      return;
    }
    if (d.type === 'ftd-agenda-import-ack' && d.v === 1) {
      const res = { added: d.added || 0, dup: d.dup || 0, bad: d.bad || 0, unmatched: d.unmatched || 0, ids: d.ids || [], mes: d.mes || null, err: d.err || null };
      if (waiting[d.reqId]) { waiting[d.reqId](res); delete waiting[d.reqId]; }
      else if (String(d.reqId).startsWith('q')) { try { chrome.runtime.sendMessage({ type: 'import-done', res }); } catch (x) {} }
      return;
    }
    if (d.type === 'ftd-agenda-leads-ack' && d.v === 1) {
      const res = { added: d.added || 0, keys: Array.isArray(d.keys) ? d.keys.slice(0, 1000).map(String) : [], err: d.err || null };
      if (waiting[d.reqId]) { waiting[d.reqId](res); delete waiting[d.reqId]; }
      else if (String(d.reqId).startsWith('Q')) { try { chrome.runtime.sendMessage({ type: 'leads-done', res }); } catch (x) {} }
      return;
    }
    if (d.type === 'ftd-agenda-social' && d.v === 1 && d.card && typeof d.card.k === 'string') { // aviso social: tarjeta en la pestaña que estés
      const c = d.card, t = (v, n) => String(v ?? '').slice(0, n);
      const card = { k: t(c.k, 80), v: t(c.v, 60), kind: 'social', title: t(c.title, 60), id: t(c.id, 120), kw: t(c.kw, 200), meta: t(c.meta, 80),
        btns: (Array.isArray(c.btns) ? c.btns : []).slice(0, 4).map((b) => [t(b[0], 20), t(b[1], 30), b[2] ? 1 : 0]) };
      try { chrome.runtime.sendMessage({ type: 'social', card }); } catch (x) {}
      return;
    }
    if (d.type === 'ftd-agenda-social-close' && d.v === 1) { try { chrome.runtime.sendMessage({ type: 'social-close', k: String(d.k || '').slice(0, 80) }); } catch (x) {} return; }
    if (d.type !== 'ftd-agenda' || d.v !== 1 || !Array.isArray(d.items)) return;
    const items = d.items
      .filter((x) => x && typeof x.k === 'string' && typeof x.due === 'number' && isFinite(x.due))
      .slice(0, 500)
      .map((x) => ({ k: x.k.slice(0, 100), n: Number(x.n) || 0, id: String(x.id ?? '').slice(0, 60), kw: String(x.kw ?? '').slice(0, 200), due: x.due }));
    const known = d.known && Array.isArray(d.known.ids) ? { ids: d.known.ids.slice(0, 50000).map(String), txs: (d.known.txs || []).slice(0, 50000).map(String) } : null;
    const snips = Array.isArray(d.snips) ? d.snips.filter((x) => x && /^[a-z0-9_-]{1,30}$/.test(x.s) && typeof x.b === 'string').slice(0, 300)
      .map((x) => ({ s: x.s, t: String(x.t || '').slice(0, 60), b: x.b.slice(0, 20000) })) : null;
    const leadIds = Array.isArray(d.leadIds) ? d.leadIds.slice(0, 50000).map(String) : null;
    const desk = d.desk && typeof d.desk === 'object' ? { role: String(d.desk.role || '').slice(0, 10), me: String(d.desk.me || '').slice(0, 40),
      members: (Array.isArray(d.desk.members) ? d.desk.members : []).slice(0, 100).map((m) => ({ id: String(m.id || '').slice(0, 40), name: String(m.name || '').slice(0, 60), crm: String(m.crm || '').slice(0, 80) })) } : null;
    try {
      chrome.runtime.sendMessage({ type: 'sync', items, known, snips, leadIds, desk, url: location.origin + location.pathname, user: String(d.user || '').slice(0, 60) }, (res) => {
        if (chrome.runtime.lastError) return;
        alive = true;
        post({ type: 'ftd-agenda-ack', v: 1, scheduled: (res && res.scheduled) || 0 });
        if (res && res.cmds && res.cmds.length) deliver(res.cmds);
        if (res && res.imports && res.imports.length) post({ type: 'ftd-agenda-import', v: 1, reqId: 'q' + Date.now(), rows: res.imports });
        if (res && res.leads && res.leads.length) post({ type: 'ftd-agenda-leads', v: 1, reqId: 'Q' + Date.now(), rows: res.leads });
      });
    } catch (err) { /* la extensión se actualizó: hay que recargar la pestaña */ }
  });
})();
