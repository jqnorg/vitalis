// Ventanita de aviso: se usa cuando la pestaña activa no admite la tarjeta (página nueva, chrome://, etc.)
const IC = { // los mismos íconos de trazo que la tarjeta en la pestaña
  campana: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5zM10.5 20.5a1.8 1.8 0 0 0 3 0"/>',
  cliente: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.9-3.7 3.7-5.6 7-5.6s6.1 1.9 7 5.6"/>',
  tareas: '<path d="M9 4.5H7.5A2.5 2.5 0 0 0 5 7v11.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V7a2.5 2.5 0 0 0-2.5-2.5H15"/><rect x="9" y="3" width="6" height="3.2" rx="1.2"/><path d="m9 13.5 2.2 2.2L15.5 11"/>',
  chat: '<path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h8a2.5 2.5 0 0 1 2.5 2.5v5A2.5 2.5 0 0 1 14 14H9.5L6 17v-3a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M19.6 8.6a2.4 2.4 0 0 1 .9 1.9v5a2.5 2.5 0 0 1-2.5 2.5v3l-3.5-3h-3.2a2.5 2.5 0 0 1-2-1"/>',
  banking: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10.5h18M7 15h3"/>',
  alerta: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17v.1"/>',
  social: '<path d="M6.6 9.5h10.8c.3 4.6-.7 8.5-2.6 10.4-.7.7-1.6 1.1-2.8 1.1s-2.1-.4-2.8-1.1C7.3 18 6.3 14.1 6.6 9.5z"/><path d="M6 9.5h12M13.5 9.2 15.6 4c.3-.6.7-.9 1.4-.9h1"/>',
};
const icOf = (d) => /^crm:(login|stlogin|nowatch)|^so:st:/.test(d.k) ? 'alerta' : /^crm:/.test(d.k) ? 'cliente' : /^so:t:/.test(d.k) ? 'tareas' : /^so:c:/.test(d.k) ? 'chat' : /^so:b:/.test(d.k) ? 'banking' : d.kind === 'social' ? 'social' : 'campana';
async function render() {
  const live = ((await chrome.storage.session.get('live')).live || []).filter((x) => !x.exp); // los mensajes del chat se van solos: acá no van
  if (!live.length) return window.close();
  const main = document.getElementById('list');
  main.textContent = '';
  for (const d of live) {
    const lvl = d.lvl || (d.kind === 'crm' ? 'imp' : d.kind === 'social' ? (/^so:t:/.test(d.k) ? 'imp' : 'info') : 'urg'); // igual que la tarjeta en la pestaña
    const c = document.createElement('div'); c.className = 'card ' + lvl + (d.kind ? ' ' + d.kind : '');
    c.innerHTML = `<div class="h"><img class="mk" src="icons/48.png" alt=""><span class="tag">vitalis</span><span class="t"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[icOf(d)]}</svg><span></span></span></div><div class="id"></div><div class="kw"></div><div class="m"></div><div class="b"></div>`;
    c.querySelector('.t span').textContent = d.title || 'Contactar';
    c.querySelector('.id').textContent = d.id;
    c.querySelector('.kw').textContent = d.kw;
    c.querySelector('.m').textContent = d.meta || '';
    const btns = d.btns || [['done', 'Hecho', 1], ['snooze', '+15 min'], ['open', 'Abrir Vitalis']];
    for (const [a, l, p] of [...btns.filter((x) => x[0] !== 'close'), ['close', 'Cerrar']]) { const b = document.createElement('button'); b.dataset.a = a; b.textContent = l; if (p) b.className = 'p'; c.querySelector('.b').appendChild(b); }
    c.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) chrome.runtime.sendMessage({ type: 'overlay', a: b.dataset.a, k: d.k }); });
    main.appendChild(c);
  }
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'session' && ch.live) render(); });
render();
