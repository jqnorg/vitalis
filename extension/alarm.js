// Ventanita de aviso: se usa cuando la pestaña activa no admite la tarjeta (página nueva, chrome://, etc.)
async function render() {
  const { live = [] } = await chrome.storage.session.get('live');
  if (!live.length) return window.close();
  const main = document.getElementById('list');
  main.textContent = '';
  for (const d of live) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<div class="h"><span class="tag">VITALIS</span><span class="t"></span></div><div class="id"></div><div class="kw"></div><div class="m"></div><div class="b"></div>';
    c.querySelector('.t').textContent = d.title || '⏰ CONTACTAR';
    c.querySelector('.id').textContent = d.id;
    c.querySelector('.kw').textContent = d.kw;
    c.querySelector('.m').textContent = d.meta || '';
    const btns = d.btns || [['done', '✔ hecho', 1], ['snooze', '+15 min'], ['open', 'abrir Vitalis']];
    for (const [a, l, p] of [...btns.filter((x) => x[0] !== 'close'), ['close', 'cerrar']]) { const b = document.createElement('button'); b.dataset.a = a; b.textContent = l; if (p) b.className = 'p'; c.querySelector('.b').appendChild(b); }
    c.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) chrome.runtime.sendMessage({ type: 'overlay', a: b.dataset.a, k: d.k }); });
    main.appendChild(c);
  }
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'session' && ch.live) render(); });
render();
