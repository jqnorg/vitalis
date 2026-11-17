/* ============================================================
   Entrada: código de la mesa (una vez por computadora) → tu nombre → tu PIN.
   La primera vez el PIN es 0000 y después creás el tuyo.
   ============================================================ */
function supaConfig() {
  const c = window.VITALIS_CONFIG || {};
  if (c.url && c.key) return c;
  const l = local.get('supabase', null);
  return l && l.url && l.key ? l : null;
}
const deskCode = () => (local.get('desk', null) || {}).code || '';

async function start() {
  const c = supaConfig();
  if (!c) return authScreen('setup');
  if (!window.supabase || !window.supabase.createClient) return authScreen('error', 'No se pudo cargar la librería de la base de datos. Revisá tu conexión y recargá.');
  sb = window.supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'vitalis-auth' } });
  // link de entrada: https://…/#mesa=CODIGO
  const m = (location.hash || '').match(/mesa=([A-Za-z0-9-]{3,40})/);
  if (m) { local.set('desk', { code: m[1].toUpperCase() }); try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && ready) location.reload(); });
  let session = null;
  try { session = (await sb.auth.getSession()).data.session; } catch (e) {}
  if (!session) return authScreen(deskCode() ? 'who' : 'code');
  me = session.user.id;
  authScreen('loading');
  connect();
}

function authErr(e) {
  const m = String((e && (e.message || e.msg)) || e || '');
  const k = m.match(/^(?:[A-Z_]+):\s*(.*)$/); if (k) return k[1];
  if (/Failed to fetch|NetworkError|fetch failed/i.test(m)) return 'Sin conexión con la base de datos.';
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos seguidos. Esperá unos minutos.';
  if (/invalid login credentials/i.test(m)) return 'No se pudo abrir la sesión. Probá de nuevo.';
  return m || 'Algo salió mal.';
}

let authPerson = null, roster = null;
async function loadRoster(code) {
  const { data, error } = await sb.rpc('team_roster', { code });
  if (error) throw error;
  return data; // null = código equivocado
}

function authScreen(mode, msg) {
  document.body.classList.add('auth');
  let A = $('#auth');
  if (!A) { A = document.createElement('div'); A.id = 'auth'; document.body.appendChild(A); }
  const team = (local.get('desk', null) || {}).team || (roster && roster.team) || '';
  A.innerHTML = `<div class="aside"><div class="brand"><svg class="mark" aria-hidden="true"><use href="#mate"/></svg><span class="word">vitalis</span></div>
      <div class="slogan">Siempre con el mate listo.<small>El asistente de ventas de ${team ? esc(team) : 'la mesa'}: tus ventas, tu sueldo, tu agenda y tus snippets en un solo lugar.</small></div>
      <svg class="big-mate" aria-hidden="true"><use href="#mate"/></svg></div>
    <div class="main"><div class="abox" id="abox"></div></div>`;
  const box = A.querySelector('#abox');
  (AUTH[mode] || AUTH.error)(box, msg);
}

const AUTH = {
  loading(box) { box.innerHTML = `<div class="aload"><svg aria-hidden="true"><use href="#mate"/></svg>Cebando…</div>`; },

  setup(box) {
    box.innerHTML = `<h2>Conectar la base de datos</h2><p class="lead">Pegá los datos de tu proyecto de Supabase (Project Settings → API).</p>
      <form novalidate><label class="fld"><span>Project URL</span><input name="url" type="url" placeholder="https://xxxx.supabase.co" autofocus></label>
      <label class="fld" style="margin-top:12px"><span>Clave pública (publishable)</span><input name="key" autocomplete="off"></label>
      <div class="ebox" id="aErr"></div><button class="btn pri big" type="submit">Conectar</button></form>`;
    box.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const url = box.querySelector('[name=url]').value.trim().replace(/\/+$/, ''), key = box.querySelector('[name=key]').value.trim();
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) return (box.querySelector('#aErr').textContent = 'La URL tiene que ser como https://xxxx.supabase.co');
      if (key.length < 20) return (box.querySelector('#aErr').textContent = 'Falta la clave pública.');
      local.set('supabase', { url, key }); location.reload();
    };
    focusFirst(box);
  },

  code(box, msg) {
    box.innerHTML = `<h2>¿De qué mesa sos?</h2><p class="lead">Escribí el código de la mesa. Se pide una sola vez en esta computadora.</p>
      <form novalidate><label class="fld"><span>Código de la mesa</span><input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="MATIAS-XXXXX" style="text-transform:uppercase" autofocus></label>
      <div class="ebox" id="aErr">${esc(msg || '')}</div><button class="btn pri big" type="submit">Seguir</button></form>`;
    const f = box.querySelector('form'), err = (t) => (box.querySelector('#aErr').textContent = t);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const code = f.code.value.trim().toUpperCase();
      if (!code) return err('Escribí el código.');
      const b = f.querySelector('button'); b.disabled = true;
      try {
        const r = await loadRoster(code);
        if (!r) return err('Ese código no es de ninguna mesa. Pedíselo al administrador.');
        roster = r; local.set('desk', { code, team: r.team }); authScreen('who');
      } catch (x) { err(authErr(x)); } finally { b.disabled = false; }
    };
    focusFirst(box);
  },

  async who(box) {
    box.innerHTML = `<div class="aload"><svg aria-hidden="true"><use href="#mate"/></svg>Buscando a la mesa…</div>`;
    try { roster = await loadRoster(deskCode()); }
    catch (x) { box.innerHTML = `<h2>No se pudo conectar</h2><p class="lead">${esc(authErr(x))}</p><button class="btn pri big" type="button" id="aRe">Reintentar</button>`; box.querySelector('#aRe').onclick = () => authScreen('who'); return; }
    if (!roster) { local.set('desk', null); return authScreen('code', 'El código de la mesa cambió. Pedile el nuevo al administrador.'); }
    local.set('desk', { code: deskCode(), team: roster.team });
    const lastU = local.get('lastUser', '');
    const people = roster.people || [];
    box.innerHTML = `<h2>¿Quién sos?</h2><p class="lead">${esc(roster.team)} · elegí tu nombre.</p>
      <div class="people">${people.map((p) => `<button type="button" class="person${p.id === lastU ? ' last' : ''}" data-id="${esc(p.id)}">${avatar(p.name)}<span class="nm">${esc(p.name)}${p.role === 'leader' ? '<small>Team leader</small>' : p.role === 'admin' ? '<small>Administrador</small>' : p.id === lastU ? '<small>La última vez</small>' : ''}</span></button>`).join('')}</div>
      ${people.length ? '' : '<p class="p-empty">Todavía no hay nadie en la mesa.</p>'}
      <div class="alinks"><button type="button" class="alink" id="aOtra">Es otra mesa</button></div>`;
    box.querySelector('.people').addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]'); if (!b) return;
      authPerson = people.find((p) => p.id === b.dataset.id); authScreen('pin');
    });
    box.querySelector('#aOtra').onclick = () => { local.set('desk', null); authScreen('code'); };
    const lb = box.querySelector('.person.last') || box.querySelector('.person'); if (lb) lb.focus();
  },

  pin(box) {
    const p = authPerson; if (!p) return authScreen('who');
    pinPad(box, {
      head: `<div class="who-big">${avatar(p.name)}<div><h2>${esc(p.name.split(/\s+/)[0])}</h2><p class="lead" style="margin:0">Tu PIN de 4 números</p></div></div>`,
      hint: p.pin_set ? '' : 'Primera vez: tu PIN es <b>0000</b>. Después creás el tuyo.',
      back: ['Volver', () => authScreen('who')],
      async done(pin, ui) {
        ui.busy(true);
        try {
          for (let i = 0; i < 2; i++) {
            const { data, error } = await sb.rpc('pin_login', { code: deskCode(), uid: p.id, pin });
            if (error) throw error;
            if (!data || !data.ok) {
              if (data && data.error === 'locked') return ui.fail(`Demasiados intentos. Probá de nuevo en ${plural(data.minutes, 'minuto')}.`, true);
              if (data && data.error === 'nouser') { local.set('desk', null); return authScreen('code', 'Ya no estás en la lista de la mesa. Hablá con el administrador.'); }
              return ui.fail(data && data.left <= 2 ? `PIN incorrecto. ${data.left === 1 ? 'Te queda 1 intento.' : `Te quedan ${data.left} intentos.`}` : 'PIN incorrecto.');
            }
            const r = await sb.auth.signInWithPassword({ email: data.email, password: data.password });
            if (!r.error) { me = r.data.user.id; local.set('lastUser', p.id); authScreen('loading'); connect(); return; }
            if (!/invalid login credentials/i.test(r.error.message || '')) throw r.error;
          }
          ui.fail('No se pudo abrir la sesión. Probá de nuevo.');
        } catch (x) { ui.fail(authErr(x)); } finally { ui.busy(false); }
      },
    });
  },

  newpin(box) {
    let first = '';
    const draw = () => pinPad(box, {
      head: `<h2>${first ? 'Repetilo' : 'Creá tu PIN'}</h2><p class="lead">${first ? 'Una vez más para confirmar.' : `Hola ${esc(profile ? profile.name.split(/\s+/)[0] : '')}. Elegí 4 números que te acuerdes (no 0000).`}</p>`,
      back: ['Salir', async () => { try { await sb.auth.signOut(); } catch (e) {} location.reload(); }],
      async done(pin, ui) {
        if (!first) {
          if (pin === '0000') return ui.fail('0000 es el de la primera vez. Elegí otro.');
          first = pin; return setTimeout(draw, 150);
        }
        if (pin !== first) { first = ''; draw(); return setTimeout(() => { const m = box.querySelector('.amsg'); m.className = 'amsg err'; m.textContent = 'No coinciden. Empezá de nuevo.'; }, 0); }
        ui.busy(true);
        try {
          const { data, error } = await sb.rpc('set_pin', { new_pin: pin, old_pin: null });
          if (error) throw error;
          const wasAdmin = profile.role === 'admin';
          profile.pin_set = true; if (data && data.role) profile.role = data.role;
          const m = members.find((x) => x.id === me); if (m) Object.assign(m, { pin_set: true, role: profile.role });
          enter();
          toast(`PIN creado. Desde ahora entrás con tu nombre y ese PIN.${!wasAdmin && profile.role === 'admin' ? '<br>Sos el administrador de la mesa: en Ajustes manejás la gente y el código.' : ''}`, 'ok', { ms: 9000 });
        } catch (x) { first = ''; draw(); setTimeout(() => { const mm = box.querySelector('.amsg'); mm.className = 'amsg err'; mm.textContent = authErr(x); }, 0); }
        finally { ui.busy(false); }
      },
    });
    draw();
  },

  inactive(box) { simple(box, 'Usuario dado de baja', 'Tu usuario fue dado de baja de la mesa. Si es un error, hablá con el administrador.', 'Salir', true); },
  noprofile(box) { simple(box, 'Sin mesa', 'Tu usuario no está en ninguna mesa. Hablá con el administrador.', 'Salir', true); },
  error(box, msg) { simple(box, 'No se pudo conectar', msg || 'Algo salió mal.', 'Reintentar', false); },
};

function simple(box, t, text, btn, out) {
  box.innerHTML = `<h2>${esc(t)}</h2><p class="lead">${esc(text)}</p><button class="btn pri big" type="button" id="aGo">${esc(btn)}</button>
    ${out ? '' : '<div class="alinks"><button type="button" class="alink" id="aOut">Salir</button></div>'}`;
  const bye = async () => { try { await sb.auth.signOut(); } catch (e) {} location.reload(); };
  box.querySelector('#aGo').onclick = out ? bye : () => location.reload();
  const o = box.querySelector('#aOut'); if (o) o.onclick = bye;
}
function focusFirst(box) { setTimeout(() => { const i = box.querySelector('[autofocus]'); if (i) i.focus(); }, 0); }

// teclado de PIN: 4 puntos, teclado en pantalla y teclado físico
let padKeys = null;
function pinPad(box, o) {
  let v = '', busy = false;
  box.classList.add('pinbox');
  box.innerHTML = `${o.head}<div class="dots" aria-live="polite" aria-label="PIN">${'<i></i>'.repeat(4)}</div>
    <div class="amsg" role="status"></div>${o.hint ? `<div class="hint">${o.hint}</div>` : ''}
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
      <button type="button" class="fn" data-k="back">${esc(o.back[0])}</button><button type="button" data-k="0">0</button><button type="button" class="fn" data-k="del" aria-label="Borrar">Borrar</button></div>`;
  const dots = box.querySelector('.dots'), msg = box.querySelector('.amsg');
  const draw = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < v.length));
  const ui = {
    busy(b) { busy = b; box.querySelectorAll('.pad button').forEach((x) => (x.disabled = b)); },
    fail(t, keep) { msg.className = 'amsg err'; msg.textContent = t; v = ''; draw(); dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); },
    note(t) { msg.className = 'amsg'; msg.textContent = t; },
  };
  const press = (k) => {
    if (busy) return;
    if (k === 'back') return o.back[1]();
    if (k === 'del') { v = v.slice(0, -1); draw(); return; }
    if (!/^\d$/.test(k) || v.length >= 4) return;
    if (!v) { msg.textContent = ''; msg.className = 'amsg'; }
    v += k; draw();
    if (v.length === 4) { const pin = v; setTimeout(() => o.done(pin, ui), 120); }
  };
  box.querySelector('.pad').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  if (padKeys) document.removeEventListener('keydown', padKeys);
  padKeys = (e) => {
    if (!document.body.contains(box) || !box.querySelector('.pad')) { document.removeEventListener('keydown', padKeys); padKeys = null; return; }
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
    else if (e.key === 'Escape') { e.preventDefault(); press('back'); }
  };
  document.addEventListener('keydown', padKeys);
  draw();
}
