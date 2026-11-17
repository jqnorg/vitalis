
/* ============================================================
   Entrada: conexión con Supabase, login, registro con código y recuperación de contraseña
   ============================================================ */
const LOGO = String.raw`██╗   ██╗██╗████████╗ █████╗ ██╗     ██╗███████╗
██║   ██║██║╚══██╔══╝██╔══██╗██║     ██║██╔════╝
██║   ██║██║   ██║   ███████║██║     ██║███████╗
╚██╗ ██╔╝██║   ██║   ██╔══██║██║     ██║╚════██║
 ╚████╔╝ ██║   ██║   ██║  ██║███████╗██║███████║
  ╚═══╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝╚══════╝`;

function supaConfig() {
  const c = window.VITALIS_CONFIG || {};
  if (c.url && c.key) return c;
  const l = local.get('supabase', null);
  return l && l.url && l.key ? l : null;
}
async function start() {
  const c = supaConfig();
  if (!c) return authScreen('setup');
  if (!window.supabase || !window.supabase.createClient) return authScreen('error', 'No se pudo cargar la librería de la base de datos. Revisá tu conexión y recargá.');
  sb = window.supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'vitalis-auth' } });
  let recovering = /type=recovery/.test(location.hash + location.search);
  sb.auth.onAuthStateChange((ev) => {
    if (ev === 'PASSWORD_RECOVERY') { recovering = true; authScreen('recovery'); }
    else if (ev === 'SIGNED_OUT' && ready) location.reload();
  });
  let session = null;
  try { session = (await sb.auth.getSession()).data.session; } catch (e) {}
  if (recovering) return authScreen('recovery');
  if (!session) return authScreen('login');
  me = session.user.id;
  authScreen('loading');
  connect();
}

function authMsg(e) {
  const m = String((e && (e.message || e.msg)) || e || '');
  if (/invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/email not confirmed/i.test(m)) return 'Tenés que confirmar tu email: revisá tu correo.';
  if (/already registered|already been registered|user already exists/i.test(m)) return 'Ese email ya tiene cuenta. Entrá con tu contraseña.';
  if (/database error saving new user|INVITE_INVALID/i.test(m)) return 'Código de invitación inválido. Pedíselo al administrador de la mesa.';
  if (/password should be at least|weak password/i.test(m)) return 'La contraseña tiene que tener al menos 6 caracteres.';
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos seguidos. Esperá unos minutos.';
  if (/valid email|invalid email|unable to validate email/i.test(m)) return 'Ese email no es válido.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión con la base de datos.';
  return m || 'Algo salió mal.';
}

function authScreen(mode, msg) {
  document.body.classList.add('auth');
  let A = $('#auth');
  if (!A) { A = document.createElement('div'); A.id = 'auth'; document.body.appendChild(A); }
  const f = (name, label, type = 'text', extra = '') => `<label class="fld"><span>${label}</span><input name="${name}" type="${type}" ${extra}></label>`;
  const link = (m, t) => `<button type="button" class="alink" data-m="${m}">${t}</button>`;
  const V2 = {
    loading: { t: 'conectando…', body: '<div class="p-empty">Cargando tus datos…</div>' },
    login: { t: 'entrar', body: f('email', 'Email', 'email', 'autocomplete="username" autofocus') + f('pass', 'Contraseña', 'password', 'autocomplete="current-password"'),
      go: 'entrar', foot: link('signup', 'crear cuenta') + link('forgot', 'olvidé mi contraseña') },
    signup: { t: 'crear cuenta', body: f('name', 'Nombre', 'text', 'autocomplete="name" maxlength="40" autofocus') + f('email', 'Email', 'email', 'autocomplete="username"') +
      f('pass', 'Contraseña (mínimo 6)', 'password', 'autocomplete="new-password"') + f('invite', 'Código de invitación de la mesa', 'text', 'autocomplete="off" style="text-transform:uppercase"'),
      go: 'crear cuenta', foot: link('login', 'ya tengo cuenta') },
    forgot: { t: 'recuperar contraseña', body: f('email', 'Email', 'email', 'autocomplete="username" autofocus'), go: 'mandarme el link', foot: link('login', 'volver') },
    recovery: { t: 'nueva contraseña', body: f('pass', 'Nueva contraseña (mínimo 6)', 'password', 'autocomplete="new-password" autofocus') + f('pass2', 'Repetila', 'password', 'autocomplete="new-password"'), go: 'guardar' },
    inactive: { t: 'usuario dado de baja', body: '<p class="mp">Tu usuario fue dado de baja de la mesa. Si es un error, hablá con el administrador.</p>', go: 'salir' },
    noprofile: { t: 'sin mesa', body: '<p class="mp">Tu usuario no está en ninguna mesa. Registrate de nuevo con el código de invitación o hablá con el administrador.</p>', go: 'salir' },
    error: { t: 'no se pudo conectar', body: `<p class="mp err">${esc(msg || '')}</p>`, go: 'reintentar', foot: link('logout', 'salir') },
    setup: { t: 'conectar la base de datos', body: '<p class="mp dim">Pegá los datos de tu proyecto de Supabase (Project Settings → API).</p>' + f('url', 'Project URL', 'url', 'placeholder="https://xxxx.supabase.co" autofocus') + f('key', 'Clave pública (anon / publishable)', 'text', 'autocomplete="off"'), go: 'conectar' },
  }[mode];
  A.innerHTML = `<div class="abox"><pre class="logo" aria-label="Vitalis">${LOGO}</pre><div class="atag">asistente de ventas de la mesa</div>
    <form class="aform" novalidate><div class="ah"><span class="u">vitalis</span>:<span class="w">~</span>$ ${esc(V2.t)}<span class="caret"></span></div>${V2.body}
    <div class="ebox" id="aErr">${mode === 'error' ? '' : esc(msg || '')}</div>${V2.go ? `<button type="submit" class="btn pri big">${esc(V2.go)}</button>` : ''}<div class="afoot">${V2.foot || ''}</div></form></div>`;
  const form = A.querySelector('form'), err = (t) => { A.querySelector('#aErr').className = 'ebox'; A.querySelector('#aErr').textContent = t; }, okm = (t) => { A.querySelector('#aErr').className = 'ebox ok'; A.querySelector('#aErr').textContent = t; };
  const v = (n) => (form.querySelector(`[name=${n}]`) || {}).value || '';
  A.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.m === 'logout') { try { await sb.auth.signOut(); } catch (e) {} location.reload(); return; }
    authScreen(b.dataset.m);
  }));
  setTimeout(() => { const i = A.querySelector('[autofocus]'); if (i) i.focus(); }, 0);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]'); if (btn) btn.disabled = true;
    try {
      if (mode === 'setup') {
        const url = v('url').trim().replace(/\/+$/, ''), key = v('key').trim();
        if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) return err('La URL tiene que ser como https://xxxx.supabase.co');
        if (key.length < 20) return err('Falta la clave pública.');
        local.set('supabase', { url, key }); location.reload(); return;
      }
      if (mode === 'login') {
        if (!v('email') || !v('pass')) return err('Completá email y contraseña.');
        const { data, error } = await sb.auth.signInWithPassword({ email: v('email').trim(), password: v('pass') });
        if (error) return err(authMsg(error));
        me = data.user.id; authScreen('loading'); connect(); return;
      }
      if (mode === 'signup') {
        const name = v('name').trim(), email = v('email').trim(), pass = v('pass'), invite = v('invite').trim().toUpperCase();
        if (!name) return err('Escribí tu nombre.');
        if (!email) return err('Escribí tu email.');
        if (pass.length < 6) return err('La contraseña tiene que tener al menos 6 caracteres.');
        if (!invite) return err('Falta el código de invitación.');
        const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { name, invite }, emailRedirectTo: location.origin + location.pathname } });
        if (error) return err(authMsg(error));
        if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) return err('Ese email ya tiene cuenta. Entrá con tu contraseña.');
        if (!data.session) { okm('Listo. Te mandamos un email para confirmar la cuenta; después entrá desde acá.'); return; }
        me = data.user.id; authScreen('loading'); connect(); return;
      }
      if (mode === 'forgot') {
        if (!v('email')) return err('Escribí tu email.');
        const { error } = await sb.auth.resetPasswordForEmail(v('email').trim(), { redirectTo: location.origin + location.pathname });
        if (error) return err(authMsg(error));
        okm('Si ese email tiene cuenta, te llega un link para elegir una contraseña nueva.'); return;
      }
      if (mode === 'recovery') {
        if (v('pass').length < 6) return err('Tiene que tener al menos 6 caracteres.');
        if (v('pass') !== v('pass2')) return err('No coinciden.');
        const { data, error } = await sb.auth.updateUser({ password: v('pass') });
        if (error) return err(authMsg(error));
        try { history.replaceState(null, '', location.pathname); } catch (x) {}
        me = data.user.id; authScreen('loading'); connect(); return;
      }
      if (mode === 'inactive' || mode === 'noprofile') { try { await sb.auth.signOut(); } catch (x) {} location.reload(); return; }
      if (mode === 'error') { location.reload(); return; }
    } catch (ex) { err(authMsg(ex)); }
    finally { if (btn) btn.disabled = false; }
  });
}
