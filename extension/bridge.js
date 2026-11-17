// Vitalis · puente entre la página de Vitalis y la extensión.
// La página manda la agenda (y recibe ventas del CRM) con window.postMessage en su misma ventana.
(() => {
  const isVitalis = () => !!document.querySelector('meta[name="vitalis"]');
  const post = (msg) => { try { window.postMessage(msg, location.origin); return true; } catch (e) { return false; } };
  const deliver = (cmds) => { for (const c of cmds || []) post({ type: 'ftd-agenda-cmd', v: 1, cmd: c.cmd, k: c.k }); };
  const waiting = {}; // pedidos de importación esperando respuesta de la página
  let alive = false;  // la página ya habló con la extensión
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!isVitalis()) return false;
    if (msg && msg.type === 'cmds') { if (alive) { deliver(msg.cmds); reply({ ok: true }); } else reply({ ok: false }); return false; }
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
      const res = { added: d.added || 0, dup: d.dup || 0, bad: d.bad || 0, ids: d.ids || [], mes: d.mes || null, err: d.err || null };
      if (waiting[d.reqId]) { waiting[d.reqId](res); delete waiting[d.reqId]; }
      else if (String(d.reqId).startsWith('q')) { try { chrome.runtime.sendMessage({ type: 'import-done', res }); } catch (x) {} }
      return;
    }
    if (d.type !== 'ftd-agenda' || d.v !== 1 || !Array.isArray(d.items)) return;
    const items = d.items
      .filter((x) => x && typeof x.k === 'string' && typeof x.due === 'number' && isFinite(x.due))
      .slice(0, 500)
      .map((x) => ({ k: x.k.slice(0, 100), n: Number(x.n) || 0, id: String(x.id ?? '').slice(0, 60), kw: String(x.kw ?? '').slice(0, 200), due: x.due }));
    const known = d.known && Array.isArray(d.known.ids) ? { ids: d.known.ids.slice(0, 50000).map(String), txs: (d.known.txs || []).slice(0, 50000).map(String) } : null;
    try {
      chrome.runtime.sendMessage({ type: 'sync', items, known, url: location.origin + location.pathname, user: String(d.user || '').slice(0, 60) }, (res) => {
        if (chrome.runtime.lastError) return;
        alive = true;
        post({ type: 'ftd-agenda-ack', v: 1, scheduled: (res && res.scheduled) || 0 });
        if (res && res.cmds && res.cmds.length) deliver(res.cmds);
        if (res && res.imports && res.imports.length) post({ type: 'ftd-agenda-import', v: 1, reqId: 'q' + Date.now(), rows: res.imports });
      });
    } catch (err) { /* la extensión se actualizó: hay que recargar la pestaña */ }
  });
})();
