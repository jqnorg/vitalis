// Vitalis · snippets: escribís /atajo en cualquier campo y se reemplaza por el texto guardado en Vitalis.
// Si otro atajo empieza igual (por ejemplo /kyc y /kyc2), espera a que toques espacio, Tab o Enter.
(() => {
  if (window.__vitalisSnip) return;
  window.__vitalisSnip = true;
  let map = new Map(), me = '', busy = false;
  const load = (s) => { map = new Map((s.snips || []).filter((x) => x && x.s && typeof x.b === 'string').map((x) => [String(x.s).toLowerCase(), x.b])); me = s.me || ''; };
  const get = () => chrome.storage.local.get(['snips', 'me']).then(load).catch(() => {});
  get();
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.snips || ch.me)) get(); }); } catch (e) {}

  const z = (n) => String(n).padStart(2, '0');
  function fill(body) {
    const d = new Date();
    return body.replace(/\{fecha\}/g, `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()}`)
      .replace(/\{hora\}/g, `${z(d.getHours())}:${z(d.getMinutes())}`).replace(/\{yo\}/g, me);
  }
  const TOKEN = /(?:^|[\s([{"'¿¡>])\/([a-z0-9_-]{1,30})$/i;
  const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', '']);
  const blocked = (el) => !el || (el.closest && el.closest('[data-vitalis-nosnip]')) || el.readOnly || el.disabled;
  const isField = (el) => el && ((el.tagName === 'TEXTAREA') || (el.tagName === 'INPUT' && TEXT_TYPES.has((el.getAttribute('type') || '').toLowerCase())));

  // dónde está el /atajo: {kind, el, node, start, end, key}
  function find(target) {
    if (!map.size) return null;
    if (isField(target)) {
      if (blocked(target) || target.selectionStart == null || target.selectionStart !== target.selectionEnd) return null;
      const pos = target.selectionStart, before = target.value.slice(Math.max(0, pos - 40), pos), m = before.match(TOKEN);
      if (!m) return null;
      return { kind: 'field', el: target, start: pos - m[1].length - 1, end: pos, key: m[1].toLowerCase() };
    }
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode || sel.anchorNode.nodeType !== 3) return null;
    const node = sel.anchorNode, host = node.parentElement;
    if (!host || !host.isContentEditable || blocked(host)) return null;
    const pos = sel.anchorOffset, before = node.data.slice(Math.max(0, pos - 40), pos), m = before.match(TOKEN);
    if (!m) return null;
    return { kind: 'edit', el: host, node, start: pos - m[1].length - 1, end: pos, key: m[1].toLowerCase() };
  }
  const longer = (key) => { for (const k of map.keys()) if (k !== key && k.startsWith(key)) return true; return false; };

  function expand(t) {
    let text = fill(map.get(t.key));
    const cur = text.indexOf('{cursor}');
    text = text.replace(/\{cursor\}/g, '');
    busy = true;
    try {
      if (t.kind === 'field') {
        const el = t.el;
        el.focus();
        el.setSelectionRange(t.start, t.end);
        const was = el.value;
        const done = document.execCommand('insertText', false, text);
        if (!done || el.value === was) { el.setRangeText(text, t.start, t.end, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); }
        if (cur >= 0) { const p = t.start + cur; el.setSelectionRange(p, p); }
      } else {
        const sel = window.getSelection(), r = document.createRange();
        r.setStart(t.node, t.start); r.setEnd(t.node, t.end);
        sel.removeAllRanges(); sel.addRange(r);
        let handled = false;
        if (text.includes('\n')) { // editores ricos (WhatsApp, Gmail, etc.): como si fuera un pegado
          try {
            const dt = new DataTransfer(); dt.setData('text/plain', text);
            const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
            t.node.parentElement.dispatchEvent(ev);
            handled = ev.defaultPrevented;
          } catch (e) {}
        }
        if (!handled) document.execCommand('insertText', false, text);
        if (cur >= 0) { const back = text.length - cur; const s2 = window.getSelection(); for (let i = 0; i < back && s2.modify; i++) s2.modify('move', 'backward', 'character'); }
      }
    } catch (e) {} finally { setTimeout(() => { busy = false; }, 0); }
  }

  document.addEventListener('input', (e) => {
    if (busy || e.isComposing || !map.size) return;
    const t = find(e.target);
    if (t && map.has(t.key) && !longer(t.key)) expand(t);
  }, true);
  document.addEventListener('keydown', (e) => { // atajo que otro más largo también empieza: se completa con espacio, Tab o Enter
    if (busy || e.isComposing || !map.size || !(e.key === ' ' || e.key === 'Tab' || e.key === 'Enter') || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = find(e.target);
    if (!t || !map.has(t.key)) return;
    e.preventDefault(); e.stopPropagation();
    expand(t);
  }, true);
})();
