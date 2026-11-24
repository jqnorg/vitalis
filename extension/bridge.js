// Vitalis · puente entre la página de Vitalis y la extensión.
// La página manda la agenda y los snippets (y recibe ventas, clientes new y todos los clientes vistos en el CRM) con window.postMessage en su misma ventana.
(() => { // corre en vitalis.joaquin-or24.workers.dev y en el dominio de cada mesa (vitalis-<mesa>.joaquin-or24.workers.dev), y en vitaliscrm.netlify.app mientras dure el cambio
  const isVitalis = () => !!document.querySelector('meta[name="vitalis"]');
  const post = (msg) => { try { window.postMessage(msg, location.origin); return true; } catch (e) { return false; } };
  const deliver = (cmds) => { for (const c of cmds || []) post({ type: 'ftd-agenda-cmd', v: 1, cmd: c.cmd, k: c.k, r: c.r }); };
  const waiting = {}; // pedidos de importación esperando respuesta de la página
  let alive = false;  // la página ya habló con la extensión
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!isVitalis()) return false;
    if (msg && msg.type === 'cmds') { if (alive) { deliver(msg.cmds); reply({ ok: true }); } else reply({ ok: false }); return false; }
    if (msg && msg.type === 'tick') { if (alive) post({ type: 'ftd-agenda-tick', v: 1, idle: typeof msg.idle === 'number' ? msg.idle : null }); return false; } // despierta a Vitalis en segundo plano
    if (msg && msg.type === 'leads') { // clientes new del CRM → al registro de Vitalis
      if (!alive) { reply({ noPanel: true }); return false; }
      const reqId = 'L' + Date.now() + Math.random().toString(36).slice(2);
      waiting[reqId] = reply;
      post({ type: 'ftd-agenda-leads', v: 1, reqId, rows: msg.rows });
      setTimeout(() => { if (waiting[reqId]) { waiting[reqId]({ noPanel: true }); delete waiting[reqId]; } }, 9000);
      return true;
    }
    if (msg && msg.type === 'seen') { // todos los clientes que se vieron en el CRM → al registro de clientes de Vitalis
      if (!alive) { reply({ noPanel: true }); return false; }
      const reqId = 'K' + Date.now() + Math.random().toString(36).slice(2);
      waiting[reqId] = reply;
      post({ type: 'ftd-agenda-seen', v: 1, reqId, rows: msg.rows });
      setTimeout(() => { if (waiting[reqId]) { waiting[reqId]({ noPanel: true }); delete waiting[reqId]; } }, 18000);
      return true;
    }
    if (msg && msg.type === 'tr' && typeof msg.txt === 'string') { // la mini ficha del CRM: traducir el comentario con el traductor de esta pestaña
      if (!alive) { reply({ noPanel: true }); return false; }
      const reqId = 'T' + Date.now() + Math.random().toString(36).slice(2);
      waiting[reqId] = reply;
      post({ type: 'ftd-agenda-tr', v: 1, reqId, txt: msg.txt.slice(0, 4000) });
      setTimeout(() => { if (waiting[reqId]) { waiting[reqId]({ why: 'no' }); delete waiting[reqId]; } }, 14000);
      return true;
    }
    if (msg && msg.type === 'prof' && msg.p && typeof msg.p === 'object') { // la mini ficha del CRM: el perfil del cliente → Vitalis lo guarda
      if (!alive) { reply({ noPanel: true }); return false; }
      const reqId = 'P' + Date.now() + Math.random().toString(36).slice(2), q = msg.p, s = (v, n) => (v == null ? '' : String(v).slice(0, n));
      const p = { edad: q.edad == null || q.edad === '' ? null : Number(q.edad), ocupacion: s(q.ocupacion, 120), desocupado: q.desocupado === true, desocupado_desde: s(q.desocupado_desde, 60),
        objetivo: s(q.objetivo, 200), anuncio: s(q.anuncio, 300), vio_min: q.vio_min === true ? true : q.vio_min === false ? false : null, outcome: s(q.outcome, 30) || null, motivo: s(q.motivo, 400) };
      waiting[reqId] = reply;
      post({ type: 'ftd-agenda-prof', v: 1, reqId, id: s(msg.id, 60), p });
      setTimeout(() => { if (waiting[reqId]) { waiting[reqId]({ err: 'cerrado' }); delete waiting[reqId]; } }, 14000);
      return true;
    }
    if (msg && msg.type === 'station' && Array.isArray(msg.views)) { // la estación (pestañas propias del CRM): cómo le fue con cada vista → Vitalis lo guarda
      if (!alive) { reply({ noPanel: true }); return false; }
      const t = (v, n) => (v == null ? null : String(v).slice(0, n));
      const views = msg.views.slice(0, 10).map((v) => ({ vista: t(v.vista, 8), ok: t(v.ok, 30), try: t(v.try, 30), n: Number(v.n) || 0, total: v.total == null ? null : Number(v.total) || 0, problem: t(v.problem, 12) || '',
        statuses: v.statuses && typeof v.statuses === 'object' ? Object.fromEntries(Object.entries(v.statuses).slice(0, 80).map(([k, n]) => [String(k).slice(0, 60), Number(n) || 0])) : {} }));
      post({ type: 'ftd-agenda-station', v: 1, views }); reply({ ok: true });
      return false;
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
      const res = { added: d.added || 0, dup: d.dup || 0, bad: d.bad || 0, unmatched: d.unmatched || 0, formers: d.formers || 0, ids: d.ids || [], mes: d.mes || null, err: d.err || null };
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
    if (d.type === 'ftd-agenda-seen-ack' && d.v === 1) {
      const res = { keys: Array.isArray(d.keys) ? d.keys.slice(0, 1000).map(String) : [], err: d.err || null };
      if (waiting[d.reqId]) { waiting[d.reqId](res); delete waiting[d.reqId]; }
      else if (String(d.reqId).startsWith('S') && !res.err) { try { chrome.runtime.sendMessage({ type: 'seen-done', keys: res.keys }); } catch (x) {} }
      return;
    }
    if (d.type === 'ftd-agenda-social' && d.v === 1 && d.card && typeof d.card.k === 'string') { // aviso social: tarjeta en la pestaña que estés
      const c = d.card, t = (v, n) => String(v ?? '').slice(0, n);
      const card = { k: t(c.k, 80), v: t(c.v, 60), kind: 'social', lvl: ['urg', 'imp', 'info'].includes(c.lvl) ? c.lvl : '', title: t(c.title, 60), id: t(c.id, 120), kw: t(c.kw, 200), meta: t(c.meta, 80),
        btns: (Array.isArray(c.btns) ? c.btns : []).slice(0, 4).map((b) => [t(b[0], 20), t(b[1], 30), b[2] ? 1 : 0]) };
      try { chrome.runtime.sendMessage({ type: 'social', card }); } catch (x) {}
      return;
    }
    if (d.type === 'ftd-agenda-prof-ack' && d.v === 1) {
      const res = d.ok ? { ok: true, parts: Array.isArray(d.parts) ? d.parts.slice(0, 12).map((x) => ({ es: String((x && x.es) || '').slice(0, 1500), en: String((x && x.en) || '').slice(0, 1500), free: !!(x && x.free) })) : [] }
        : { err: String(d.err || 'no').slice(0, 200) };
      if (waiting[d.reqId]) { waiting[d.reqId](res); delete waiting[d.reqId]; }
      return;
    }
    if (d.type === 'ftd-agenda-tr-ack' && d.v === 1) {
      const res = { en: String(d.en || '').slice(0, 8000), why: String(d.why || '').slice(0, 12) };
      if (waiting[d.reqId]) { waiting[d.reqId](res); delete waiting[d.reqId]; }
      return;
    }
    if (d.type === 'ftd-agenda-dock' && d.v === 1 && d.d && typeof d.d === 'object') { // la mini ficha del CRM (lo justo, y nunca más de 60 KB)
      let j = ''; try { j = JSON.stringify(d.d); } catch (x) { return; }
      if (j.length > 60000) return;
      try { chrome.runtime.sendMessage({ type: 'dock', d: JSON.parse(j) }); } catch (x) {}
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
      members: (Array.isArray(d.desk.members) ? d.desk.members : []).slice(0, 600).map((m) => ({ id: String(m.id || '').slice(0, 40), name: String(m.name || '').slice(0, 60), crm: String(m.crm || '').slice(0, 80), act: m.act !== false })) } : null;
    try {
      chrome.runtime.sendMessage({ type: 'sync', items, known, snips, leadIds, desk, url: location.origin + location.pathname, user: String(d.user || '').slice(0, 60) }, (res) => {
        if (chrome.runtime.lastError) return;
        alive = true;
        post({ type: 'ftd-agenda-ack', v: 1, scheduled: (res && res.scheduled) || 0, ver: chrome.runtime.getManifest().version });
        if (res && res.cmds && res.cmds.length) deliver(res.cmds);
        if (res && res.imports && res.imports.length) post({ type: 'ftd-agenda-import', v: 1, reqId: 'q' + Date.now(), rows: res.imports });
        if (res && res.leads && res.leads.length) post({ type: 'ftd-agenda-leads', v: 1, reqId: 'Q' + Date.now(), rows: res.leads });
        if (res && res.seen && res.seen.length) post({ type: 'ftd-agenda-seen', v: 1, reqId: 'S' + Date.now(), rows: res.seen });
      });
    } catch (err) { /* la extensión se actualizó: hay que recargar la pestaña */ }
  });
})();
