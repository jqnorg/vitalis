// Toca el sonido de los avisos (los service workers no pueden reproducir audio).
let ctx = null;
function beep(times = 3) {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime + 0.05;
  for (let i = 0; i < times; i++) {
    [[0, 880], [0.16, 1320]].forEach(([d, f]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), s = t + i * 0.45 + d;
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.12, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.14);
      o.connect(g).connect(ctx.destination); o.start(s); o.stop(s + 0.15);
    });
  }
}
function chime() { // clientes nuevos: arpegio ascendente, distinto al de la agenda
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime + 0.05;
  for (let r = 0; r < 2; r++) [523, 659, 784, 1047].forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), s = t + r * 0.9 + i * 0.12;
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.22, s + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.35);
    o.connect(g).connect(ctx.destination); o.start(s); o.stop(s + 0.36);
  });
}
function pop() { // social: dos notas cortas y suaves
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime + 0.05;
  [[0, 660], [0.12, 990]].forEach(([d, f]) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), s = t + d;
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.25, s + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.25);
    o.connect(g).connect(ctx.destination); o.start(s); o.stop(s + 0.26);
  });
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.target === 'offscreen' && msg.type === 'play') { if (msg.tone === 'crm') chime(); else if (msg.tone === 'social') pop(); else beep(3); }
});
