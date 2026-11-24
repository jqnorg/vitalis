-- =====================================================================
--  VITALIS · base de datos (Supabase)
--  Pegar entero en Supabase → SQL Editor → New query → Run.
--  Se puede volver a correr: no borra datos.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- mesas y personas ----------
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,      -- ya no se usa (Vitalis es para una sola mesa)
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  team_id    uuid not null references public.teams(id),
  name       text not null,
  email      text,
  role       text not null default 'agent' check (role in ('agent','leader','admin')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists login text unique;                    -- cuenta interna para entrar con PIN
alter table public.profiles add column if not exists pin_set boolean not null default false; -- ya cambió el 0000
alter table public.profiles add column if not exists former boolean not null default false;  -- desvinculado: se creó al cargar ventas del CRM de alguien que ya no está

-- PIN de cada uno (solo lo tocan las funciones de abajo: nadie lo puede leer desde la app)
create table if not exists public.pins (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  pin_hash     text not null,
  secret       text not null,          -- contraseña interna de la cuenta, larga y al azar; cambia en cada ingreso
  fails        integer not null default 0,
  locked_until timestamptz
);
alter table public.pins add column if not exists locks integer not null default 0; -- bloqueos seguidos: cada uno dura el doble
alter table public.profiles add column if not exists crm_name text;          -- cómo figura en el CRM (para la carga del team leader)
alter table public.profiles add column if not exists quiet_until timestamptz; -- avisos sociales silenciados hasta
alter table public.pins enable row level security;
revoke all on public.pins from anon, authenticated;

-- quién soy (security definer: evita que las reglas se llamen a sí mismas)
create or replace function public.my_team() returns uuid
  language sql stable security definer set search_path = public
  as $$ select team_id from public.profiles where id = auth.uid() and active $$;
create or replace function public.my_role() returns text
  language sql stable security definer set search_path = public
  as $$ select role from public.profiles where id = auth.uid() and active $$;

-- ---------- ventas: compartidas dentro de la mesa ----------
create table if not exists public.sales (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null default public.my_team() references public.teams(id),
  user_id    uuid not null default auth.uid() references public.profiles(id),
  n          integer,
  date       date not null,
  time       text,
  client_id  text not null,
  country    text,
  name       text,
  aff        text,
  camp       text,
  amount     numeric(12,2) not null,
  tx         text,
  reg        text,
  brand      text not null default 'Novara Markets',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_team_brand_tx on public.sales (team_id, lower(brand), tx) where tx is not null and tx <> '';
create index if not exists sales_team_date on public.sales (team_id, date);
create index if not exists sales_user_date on public.sales (user_id, date);

-- ---------- datos privados de cada uno ----------
create table if not exists public.settings (
  user_id    uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  cfg        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.adjustments ( -- FTDs del mes sin detalle
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  ym      text not null,
  n       integer not null,
  primary key (user_id, ym)
);
create table if not exists public.agenda (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  n          integer,
  client_id  text not null,
  kw         text,
  due        text not null,             -- 'AAAA-MM-DDTHH:MM' hora local
  notified   boolean not null default false,
  done       boolean not null default false,
  done_at    timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.shifts ( -- turnos
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  date    date not null,
  data    jsonb not null,
  primary key (user_id, date)
);

-- ---------- snippets: textos que se pegan con /atajo (propios o compartidos con la mesa) ----------
create table if not exists public.snippets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  team_id    uuid not null default public.my_team() references public.teams(id),
  shortcut   text not null check (shortcut ~ '^[a-z0-9_-]{1,30}$'),
  title      text,
  body       text not null check (length(body) <= 20000),
  shared     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, shortcut)
);

-- ---------- clientes new: el registro de cada día para medir conversión ----------
create table if not exists public.leads (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null default public.my_team() references public.teams(id),
  user_id    uuid not null default auth.uid() references public.profiles(id),
  client_id  text not null,
  name       text,
  country    text,
  date       date not null default (now() at time zone 'America/Montevideo')::date,
  source     text not null default 'crm' check (source in ('crm','manual')),
  created_at timestamptz not null default now(),
  unique (team_id, client_id)
);
create index if not exists leads_team_date on public.leads (team_id, date);

-- ---------- social: pedir un mate, salir a los 10 o a la media, mensajes ----------
create table if not exists public.pings (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null default public.my_team() references public.teams(id),
  from_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  to_id      uuid references public.profiles(id) on delete cascade,   -- vacío = toda la mesa
  kind       text not null check (kind in ('mate','d10','d30','msg')),
  body       text check (length(body) <= 140),
  reply      text check (reply in ('si','no','luego')),
  reply_by   uuid references public.profiles(id) on delete set null,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pings_team_created on public.pings (team_id, created_at desc);
alter table public.pings drop constraint if exists pings_kind_check;  -- 'toque': un toque a alguien desde su perfil
alter table public.pings add constraint pings_kind_check check (kind in ('mate','d10','d30','msg','toque','ayuda')); -- 'ayuda': el agente le pide ayuda al team leader y a los administradores

-- ---------- chat: toda la mesa, grupos y privados ----------
create table if not exists public.chats (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null default public.my_team() references public.teams(id),
  kind       text not null default 'group' check (kind in ('team','group','dm')),
  name       text check (name is null or length(name) between 1 and 40),
  created_by uuid references public.profiles(id) on delete set null,
  dm_key     text,                       -- privados: 'idA:idB' ordenado, para no repetirlos
  created_at timestamptz not null default now()
);
create unique index if not exists chats_team_one on public.chats (team_id) where kind = 'team';
create unique index if not exists chats_dm_key on public.chats (team_id, dm_key) where dm_key is not null;
create table if not exists public.chat_members (  -- grupos y privados (el de toda la mesa no necesita)
  chat_id  uuid not null references public.chats(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index if not exists chat_members_user on public.chat_members (user_id);
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.chats(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_chat_created on public.messages (chat_id, created_at desc);
alter table public.messages add column if not exists reply_to uuid references public.messages(id) on delete set null; -- respuesta a otro mensaje del mismo chat
-- reacciones a los mensajes (un emoji de la lista, una vez cada uno por persona)
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  chat_id    uuid not null references public.chats(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🧉')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists message_reactions_chat on public.message_reactions (chat_id, created_at desc);
create index if not exists messages_created on public.messages (created_at desc);
-- target individual del mes (lo fija el team leader o el admin; lo ven esa persona y los que lo fijan)
create table if not exists public.user_targets (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  ym         text not null check (ym ~ '^\d{4}-\d{2}$'),
  ftds       integer not null check (ftds between 1 and 10000),
  set_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id, ym)
);

-- imágenes del chat (se pegan o se eligen; la app las achica antes de mandarlas). El mensaje las nombra con [img:id:AnchoxAlto]
create table if not exists public.chat_files (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.chats(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  mime       text not null check (mime in ('image/webp', 'image/jpeg', 'image/png')),
  w          integer check (w between 1 and 6000),
  h          integer check (h between 1 and 6000),
  data       text not null check (length(data) between 16 and 1400000),  -- base64
  created_at timestamptz not null default now()
);
create index if not exists chat_files_chat on public.chat_files (chat_id, created_at desc);
-- un aviso: lo manda el team leader o un administrador; a todos los del chat les queda hasta que lo cierren, aunque lo tengan silenciado
alter table public.messages add column if not exists aviso boolean not null default false;
-- datos compartidos en el chat: una foto de una tarjeta de Vitalis (HTML que la app limpia al mandarlo y otra vez al mostrarlo).
-- El mensaje la nombra con [card:id] y lleva el título, así el aviso se lee sin abrirla
create table if not exists public.chat_cards (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.chats(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title      text not null check (length(title) between 1 and 120),
  html       text not null check (length(html) between 1 and 90000),
  created_at timestamptz not null default now()
);
create index if not exists chat_cards_chat on public.chat_cards (chat_id, created_at desc);

-- foto de perfil (la app la recorta cuadrada y la achica); la ve toda la mesa, la cambia cada uno
create table if not exists public.avatars (
  user_id    uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  mime       text not null check (mime in ('image/webp', 'image/jpeg', 'image/png')),
  data       text not null check (length(data) between 16 and 300000),  -- base64
  updated_at timestamptz not null default now()
);

-- target de FTDs de la mesa por mes (lo fija el team leader o el admin; lo ven todos)
create table if not exists public.targets (
  team_id    uuid not null default public.my_team() references public.teams(id),
  ym         text not null check (ym ~ '^\d{4}-\d{2}$'),
  ftds       integer not null check (ftds between 1 and 100000),
  set_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (team_id, ym)
);

-- snippets globales: los crea y edita solo el admin, a todos les funcionan solos
alter table public.snippets add column if not exists global boolean not null default false;

-- ---------- tareas: el team leader (o el admin) las manda, cada uno la marca como hecha ----------
create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null default public.my_team() references public.teams(id),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  what       text not null check (length(what) between 1 and 120),   -- qué hacer: "Repasar"
  campaigns  text[] not null default '{}',
  affiliates text[] not null default '{}',
  date_from  date,
  date_to    date,
  status     text check (status is null or length(status) <= 60),  -- status en el CRM
  notes      text check (notes is null or length(notes) <= 2000),
  due        date,
  created_at timestamptz not null default now()
);
create index if not exists tasks_team_created on public.tasks (team_id, created_at desc);
create table if not exists public.task_people (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  done_at timestamptz,
  primary key (task_id, user_id)
);
create index if not exists task_people_user on public.task_people (user_id);

create table if not exists public.chat_reads (    -- hasta dónde leí cada chat y si lo silencié (privado de cada uno)
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  read_at timestamptz not null default now(),
  muted   boolean not null default false,
  primary key (user_id, chat_id)
);

-- ---------- fechas de modificación ----------
create or replace function public.touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists sales_touch on public.sales;
create trigger sales_touch before update on public.sales for each row execute function public.touch();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings for each row execute function public.touch();
drop trigger if exists snippets_touch on public.snippets;
create trigger snippets_touch before update on public.snippets for each row execute function public.touch();

-- ---------- cuentas: se entra eligiendo tu nombre + PIN ----------
-- Nadie se registra solo: las cuentas las crea esta base (la lista de la mesa) o el administrador.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_app_meta_data->>'vitalis_seat', '') = 'true' then return new; end if;
  raise exception 'SIGNUP_DISABLED: en Vitalis se entra eligiendo tu nombre y tu PIN';
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- crea la cuenta de una persona de la mesa, con PIN 0000
create or replace function public._new_seat(t uuid, nm text, rl text) returns uuid
  language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := gen_random_uuid();
  em  text := uid::text || '@pin.vitaliscrm.netlify.app';
  sec text := encode(gen_random_bytes(24), 'hex');
  c   text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em, crypt(sec, gen_salt('bf')), now(),
          jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'vitalis_seat', true),
          jsonb_build_object('name', nm), now(), now());
  -- la API de Supabase espera textos vacíos (no NULL) en estas columnas
  for c in select column_name from information_schema.columns
            where table_schema = 'auth' and table_name = 'users'
              and column_name in ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                                  'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token') loop
    execute format('update auth.users set %I = coalesce(%I, %L) where id = $1', c, c, '') using uid;
  end loop;
  insert into auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid, uid::text, jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true), 'email', now(), now(), now());
  insert into public.profiles (id, team_id, name, role, login) values (uid, t, nm, rl, em);
  insert into public.pins (user_id, pin_hash, secret) values (uid, crypt('0000', gen_salt('bf')), sec);
  return uid;
end $$;
revoke all on function public._new_seat(uuid, text, text) from public, anon, authenticated;

-- Vitalis es para una sola mesa: la lista de nombres y el PIN no piden código.
drop function if exists public.team_roster(text);
drop function if exists public.pin_login(text, uuid, text);

-- la lista de nombres para la pantalla de entrada
create or replace function public.roster() returns json
  language sql stable security definer set search_path = public as $$
  select json_build_object('team', t.name, 'people', coalesce((
    select json_agg(json_build_object('id', p.id, 'name', p.name, 'role', p.role, 'pin_set', p.pin_set) order by p.name)
      from public.profiles p where p.team_id = t.id and p.active and p.login is not null), '[]'::json))
  from (select * from public.teams order by created_at limit 1) t $$;

-- PIN correcto → datos para abrir la sesión.
-- 5 errores seguidos → bloqueado 15 minutos; cada bloqueo seguido dura el doble (hasta 24 h). Entrar bien lo resetea.
create or replace function public.pin_login(uid uuid, pin text) returns json
  language plpgsql security definer set search_path = public, extensions as $$
declare
  p   record;
  s   record;
  sec text;
  lk  interval;
begin
  select pr.id, pr.login, pr.pin_set into p from public.profiles pr where pr.id = uid and pr.active and pr.login is not null;
  if p.id is null then return json_build_object('ok', false, 'error', 'nouser'); end if;
  select * into s from public.pins where user_id = uid for update;
  if s.user_id is null then return json_build_object('ok', false, 'error', 'nouser'); end if;
  if s.locked_until is not null and s.locked_until > now() then
    return json_build_object('ok', false, 'error', 'locked', 'minutes', ceil(extract(epoch from s.locked_until - now()) / 60)::int);
  end if;
  if pin is null or pin !~ '^[0-9]{4}$' or s.pin_hash <> crypt(pin, s.pin_hash) then
    if s.fails + 1 >= 5 then
      lk := least(interval '24 hours', interval '15 minutes' * power(2, least(s.locks, 10)));
      update public.pins set fails = 0, locks = s.locks + 1, locked_until = now() + lk where user_id = uid;
      return json_build_object('ok', false, 'error', 'locked', 'minutes', ceil(extract(epoch from lk) / 60)::int);
    end if;
    update public.pins set fails = s.fails + 1 where user_id = uid;
    return json_build_object('ok', false, 'error', 'wrong', 'left', 4 - s.fails);
  end if;
  sec := encode(gen_random_bytes(24), 'hex');
  update public.pins set fails = 0, locks = 0, locked_until = null, secret = sec where user_id = uid;
  update auth.users set encrypted_password = crypt(sec, gen_salt('bf')), updated_at = now() where id = uid;
  return json_build_object('ok', true, 'email', p.login, 'password', sec, 'pin_set', p.pin_set);
end $$;

-- crear o cambiar mi PIN. El primero de la mesa que crea su PIN queda como administrador.
create or replace function public.set_pin(new_pin text, old_pin text default null) returns json
  language plpgsql security definer set search_path = public, extensions as $$
declare
  p record;
  s record;
begin
  select * into p from public.profiles where id = auth.uid() and active;
  if p.id is null then raise exception 'NO_SESSION: volvé a entrar'; end if;
  if coalesce(new_pin, '') !~ '^[0-9]{4}$' then raise exception 'PIN_FORMAT: el PIN son 4 números'; end if;
  if new_pin = '0000' then raise exception 'PIN_FORMAT: elegí otro, 0000 es el de la primera vez'; end if;
  select * into s from public.pins where user_id = p.id;
  if s.user_id is null then raise exception 'NO_PIN: tu usuario no entra con PIN'; end if;
  if p.pin_set and (old_pin is null or s.pin_hash <> crypt(old_pin, s.pin_hash)) then
    raise exception 'PIN_OLD: el PIN actual no es ese';
  end if;
  update public.pins set pin_hash = crypt(new_pin, gen_salt('bf')), fails = 0, locked_until = null where user_id = p.id;
  update public.profiles set pin_set = true where id = p.id;
  if not exists (select 1 from public.profiles where team_id = p.team_id and role = 'admin' and active and login is not null) then
    update public.profiles set role = 'admin' where id = p.id;
  end if;
  return json_build_object('ok', true, 'role', (select role from public.profiles where id = p.id));
end $$;

-- el administrador vuelve el PIN de alguien a 0000
create or replace function public.reset_pin(uid uuid) returns json
  language plpgsql security definer set search_path = public, extensions as $$
begin
  if coalesce(public.my_role(), '') <> 'admin'
     or not exists (select 1 from public.profiles where id = uid and team_id = public.my_team()) then
    raise exception 'Solo el administrador puede resetear un PIN';
  end if;
  update public.pins set pin_hash = crypt('0000', gen_salt('bf')), fails = 0, locks = 0, locked_until = null where user_id = uid;
  update public.profiles set pin_set = false where id = uid;
  return json_build_object('ok', true);
end $$;

-- el administrador suma a alguien a la mesa
create or replace function public.add_member(nm text, rl text default 'agent') returns json
  language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid;
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'Solo el administrador puede sumar gente'; end if;
  nm := regexp_replace(trim(coalesce(nm, '')), '\s+', ' ', 'g');
  if nm = '' or length(nm) > 40 then raise exception 'NAME: escribí un nombre (hasta 40 letras)'; end if;
  if rl not in ('agent', 'leader', 'admin') then raise exception 'ROLE: rol inválido'; end if;
  if exists (select 1 from public.profiles where team_id = public.my_team() and lower(name) = lower(nm) and active) then
    raise exception 'NAME_TAKEN: ya hay alguien con ese nombre';
  end if;
  uid := public._new_seat(public.my_team(), nm, rl);
  return json_build_object('ok', true, 'id', uid);
end $$;

-- ¿esa persona es de mi mesa?
create or replace function public.in_my_team(uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = uid and team_id = public.my_team()) $$;

-- team leader / admin: cómo figura cada uno en el CRM (para pasar las ventas de toda la mesa)
create or replace function public.set_crm_name(uid uuid, nm text) returns json
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') not in ('admin', 'leader') or not public.in_my_team(uid) then
    raise exception 'Solo el team leader o el administrador';
  end if;
  update public.profiles set crm_name = nullif(left(trim(coalesce(nm, '')), 80), '') where id = uid;
  return json_build_object('ok', true);
end $$;

-- team leader / admin: alguien del CRM que ya no está en la mesa → queda como desvinculado (no entra, no figura en la lista)
-- y sus ventas cuentan para la mesa. Si ya existe (por nombre o por nombre en el CRM), devuelve ese.
create or replace function public.add_former(nm text) returns json
  language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid; t uuid := public.my_team(); crm text;
begin
  if coalesce(public.my_role(), '') not in ('admin', 'leader') then raise exception 'Solo el team leader o el administrador'; end if;
  crm := left(regexp_replace(btrim(coalesce(nm, '')), '\s+', ' ', 'g'), 80);
  nm := btrim(left(crm, 40));
  if nm !~ '[[:alpha:]].*[[:alpha:]]' then raise exception 'NAME: nombre inválido'; end if;
  select id into uid from public.profiles
   where team_id = t and (lower(name) = lower(nm) or lower(crm_name) = lower(crm)) order by active desc, created_at limit 1;
  if uid is not null then return json_build_object('ok', true, 'id', uid, 'new', false); end if;
  if (select count(*) from public.profiles where team_id = t and former and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'SLOW: demasiados desvinculados nuevos, esperá un rato';
  end if;
  uid := public._new_seat(t, nm, 'agent');
  update public.profiles set active = false, former = true, crm_name = crm where id = uid;
  return json_build_object('ok', true, 'id', uid, 'new', true);
end $$;

-- varios de una (una carga grande desde el CRM)
create or replace function public.add_formers(nms text[]) returns json
  language plpgsql security definer set search_path = public as $$
declare n text; r json; out json[] := '{}';
begin
  if coalesce(public.my_role(), '') not in ('admin', 'leader') then raise exception 'Solo el team leader o el administrador'; end if;
  if coalesce(array_length(nms, 1), 0) > 300 then raise exception 'MANY: hasta 300 por vez'; end if;
  foreach n in array coalesce(nms, '{}') loop
    begin r := public.add_former(n); out := out || jsonb_build_object('name', n, 'id', r->>'id', 'new', (r->>'new')::boolean)::json;
    exception when others then out := out || jsonb_build_object('name', n, 'error', sqlerrm)::json; end;
  end loop;
  return coalesce(array_to_json(out), '[]'::json);
end $$;

-- era alguien de la mesa: sus ventas pasan a esa persona (con números nuevos) y el desvinculado se borra
create or replace function public.merge_former(src uuid, dst uuid) returns json
  language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team(); nxt integer; moved integer; c text;
begin
  if coalesce(public.my_role(), '') not in ('admin', 'leader') then raise exception 'Solo el team leader o el administrador'; end if;
  if not exists (select 1 from public.profiles where id = src and team_id = t and former and not pin_set) then
    raise exception 'FORMER: solo se pueden unir desvinculados que se crearon desde el CRM';
  end if;
  if src = dst or not exists (select 1 from public.profiles where id = dst and team_id = t) then raise exception 'NO_MEMBER: elegí a alguien de la mesa'; end if;
  select coalesce(max(n), 0) into nxt from public.sales where user_id = dst;
  with s as (select id, row_number() over (order by date, time, created_at) rn from public.sales where user_id = src)
  update public.sales x set user_id = dst, n = nxt + s.rn from s where x.id = s.id;
  get diagnostics moved = row_count;
  select crm_name into c from public.profiles where id = src;
  update public.profiles set crm_name = coalesce(crm_name, c) where id = dst;
  begin delete from auth.users where id = src; -- la cuenta vacía (y su perfil)
  exception when others then delete from public.profiles where id = src; end;
  return json_build_object('ok', true, 'moved', moved);
end $$;

revoke all on function public.roster(), public.pin_login(uuid, text), public.set_pin(text, text),
  public.reset_pin(uuid), public.add_member(text, text), public.in_my_team(uuid), public.set_crm_name(uuid, text) from public;
grant execute on function public.roster(), public.pin_login(uuid, text) to anon, authenticated;
grant execute on function public.set_pin(text, text), public.reset_pin(uuid), public.add_member(text, text),
  public.in_my_team(uuid), public.set_crm_name(uuid, text) to authenticated;
revoke all on function public.add_former(text), public.add_formers(text[]), public.merge_former(uuid, uuid) from public, anon;
grant execute on function public.add_former(text), public.add_formers(text[]), public.merge_former(uuid, uuid) to authenticated;
revoke execute on function public.set_pin(text, text), public.reset_pin(uuid), public.add_member(text, text),
  public.in_my_team(uuid), public.set_crm_name(uuid, text) from anon;

-- pedidos sociales: cada tipo tiene su espera (mate 20 min) y se borran solos a la semana
create or replace function public.ping_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  last timestamptz;
  wait interval;
  left_s int;
begin
  new.reply := null; new.reply_by := null; new.replied_at := null; new.created_at := now();
  if new.kind = 'msg' then
    new.body := nullif(left(trim(coalesce(new.body, '')), 140), '');
    if new.body is null then raise exception 'PING_EMPTY: escribí el mensaje'; end if;
  else new.body := null; end if;
  if new.kind = 'toque' and new.to_id is null then raise exception 'PING_TO: el toque es para alguien'; end if;
  wait := case new.kind when 'mate' then interval '20 minutes' when 'msg' then interval '15 seconds' when 'toque' then interval '2 minutes' when 'ayuda' then interval '1 minute' else interval '3 minutes' end;
  select max(created_at) into last from public.pings
   where from_id = new.from_id and kind = new.kind and (new.kind = 'mate' or to_id is not distinct from new.to_id);
  if last is not null and last > now() - wait then
    left_s := ceil(extract(epoch from last + wait - now()))::int;
    raise exception 'COOLDOWN: %', case new.kind when 'mate' then 'ya pediste un mate, podés volver a pedir en ' when 'toque' then 'ya le diste un toque, podés de nuevo en ' when 'ayuda' then 'ya pediste ayuda (ya les llegó), podés de nuevo en ' else 'ya lo mandaste, esperá ' end
      || case when left_s >= 60 then ceil(left_s / 60.0)::int || ' min' else left_s || ' segundos' end;
  end if;
  if (select count(*) from public.pings where from_id = new.from_id and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'COOLDOWN: muchos pedidos en la última hora, esperá un rato';
  end if;
  delete from public.pings where created_at < now() - interval '7 days';
  return new;
end $$;
drop trigger if exists pings_guard on public.pings;
create trigger pings_guard before insert on public.pings for each row execute function public.ping_guard();

-- responder un pedido: el primero que contesta se lo lleva
create or replace function public.reply_ping(pid uuid, r text) returns json
  language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if coalesce(r, '') not in ('si', 'no', 'luego') then raise exception 'REPLY: respuesta inválida'; end if;
  select * into p from public.pings where id = pid and team_id = public.my_team() for update;
  if p.id is null then raise exception 'PING_GONE: ese pedido ya no está'; end if;
  if p.from_id = auth.uid() then raise exception 'PING_OWN: el pedido es tuyo'; end if;
  if p.to_id is not null and p.to_id <> auth.uid() then raise exception 'PING_NOT_YOURS: no es para vos'; end if;
  -- un mate se queda con el primer "sí": un "ahora no" no lo cierra ni le llega al que pidió
  if p.kind = 'mate' and r <> 'si' then return json_build_object('ok', true, 'skip', true); end if;
  if p.reply is not null then return json_build_object('ok', false, 'taken', true, 'by', p.reply_by, 'reply', p.reply); end if;
  update public.pings set reply = r, reply_by = auth.uid(), replied_at = now() where id = pid;
  return json_build_object('ok', true);
end $$;
revoke all on function public.reply_ping(uuid, text) from public, anon;
grant execute on function public.reply_ping(uuid, text) to authenticated;

-- ---------- chat ----------
-- ¿puedo ver/escribir en este chat? (el de la mesa: todos; grupos y privados: sus integrantes)
create or replace function public.in_chat(cid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chats c where c.id = cid and c.team_id = public.my_team()
    and (c.kind = 'team' or exists (select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = auth.uid()))) $$;

-- cada mensaje: sin espacios de más, con la hora del servidor y sin inundar el chat
create or replace function public.msg_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.body := left(btrim(coalesce(new.body, ''), E' \t\r\n'), 2000);
  if new.body = '' then raise exception 'MSG_EMPTY: escribí algo'; end if;
  if new.reply_to is not null and not exists (select 1 from public.messages r where r.id = new.reply_to and r.chat_id = new.chat_id) then
    new.reply_to := null; -- solo se responde a un mensaje del mismo chat
  end if;
  if new.body like '[img:%' and not exists (select 1 from public.chat_files f
       where f.id::text = substring(new.body from '^\[img:([0-9a-f-]{36})') and f.chat_id = new.chat_id and f.user_id = new.user_id) then
    raise exception 'IMG: la imagen no se subió, probá de nuevo';
  end if;
  if new.body like '[card:%' and not exists (select 1 from public.chat_cards k
       where k.id::text = substring(new.body from '^\[card:([0-9a-f-]{36})') and k.chat_id = new.chat_id and k.user_id = new.user_id) then
    raise exception 'CARD: los datos no se subieron, probá de nuevo';
  end if;
  if new.aviso and coalesce((select role from public.profiles where id = new.user_id), '') not in ('leader', 'admin') then
    raise exception 'AVISO: los avisos los manda el team leader o un administrador';
  end if;
  new.created_at := now();
  if (select count(*) from public.messages where user_id = new.user_id and created_at > now() - interval '30 seconds') >= 15 then
    raise exception 'SLOW: vas muy rápido, esperá unos segundos';
  end if;
  return new;
end $$;
drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before insert on public.messages for each row execute function public.msg_guard();
-- editar el propio mensaje hasta 1 minuto después (lo pidió el dueño): solo cambia el texto; la imagen o los datos compartidos quedan
alter table public.messages add column if not exists edited_at timestamptz;
create or replace function public.msg_edit_guard() returns trigger
  language plpgsql set search_path = public as $$ -- sin security definer: current_user es quien edita
declare pre_o text; pre_n text;
begin
  if (select auth.uid()) is null or current_user not in ('authenticated') then return new; end if; -- sin sesión o SQL del administrador (arreglos): no es una edición
  if old.user_id <> (select auth.uid()) then raise exception 'EDIT: solo el que lo escribió'; end if;
  if now() - old.created_at > interval '70 seconds' then raise exception 'EDIT_LATE: ya pasó el minuto para editarlo'; end if;
  if new.chat_id <> old.chat_id or new.user_id <> old.user_id or new.reply_to is distinct from old.reply_to or new.aviso <> old.aviso or new.created_at <> old.created_at then
    raise exception 'EDIT: solo se cambia el texto';
  end if;
  new.body := left(btrim(coalesce(new.body, ''), E' \t\r\n'), 2000);
  pre_o := substring(old.body from '^\[(?:img|card):[^\]]*\]');
  pre_n := substring(new.body from '^\[(?:img|card):[^\]]*\]');
  if pre_o is distinct from pre_n then raise exception 'EDIT: la imagen o los datos no se cambian'; end if;
  if new.body = '' or (pre_o is null and new.body = old.body) then raise exception 'MSG_EMPTY: escribí algo'; end if;
  new.edited_at := now();
  return new;
end $$;
drop trigger if exists messages_edit_guard on public.messages;
create trigger messages_edit_guard before update on public.messages for each row execute function public.msg_edit_guard();
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update to authenticated
  using (user_id = (select auth.uid()) and created_at > now() - interval '70 seconds') with check (user_id = (select auth.uid()));
grant update on public.messages to authenticated;
-- quién leyó: hasta dónde leyó cada miembro del chat (sin el silencio, que es privado)
create or replace function public.chat_reads_of(cid uuid) returns table (user_id uuid, read_at timestamptz)
  language sql security definer stable set search_path = public as $$
  select r.user_id, r.read_at from public.chat_reads r where r.chat_id = cid and public.in_chat(cid);
$$;
revoke all on function public.chat_reads_of(uuid), public.msg_edit_guard() from public, anon;
grant execute on function public.chat_reads_of(uuid) to authenticated;
-- al borrar un mensaje con imagen, se borra la imagen
create or replace function public.msg_gone() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.body like '[img:%' then delete from public.chat_files where id::text = substring(old.body from '^\[img:([0-9a-f-]{36})'); end if;
  if old.body like '[card:%' then delete from public.chat_cards where id::text = substring(old.body from '^\[card:([0-9a-f-]{36})'); end if;
  return old;
end $$;
drop trigger if exists messages_gone on public.messages;
create trigger messages_gone after delete on public.messages for each row execute function public.msg_gone();
create or replace function public.file_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  if new.data !~ '^[A-Za-z0-9+/]+=*$' then raise exception 'IMG: la imagen no es válida'; end if;
  if (select count(*) from public.chat_files where user_id = new.user_id and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'SLOW: muchas imágenes seguidas, esperá unos minutos';
  end if;
  return new;
end $$;
create or replace function public.avatar_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.data !~ '^[A-Za-z0-9+/]+=*$' then raise exception 'IMG: la foto no es válida'; end if;
  return new;
end $$;
drop trigger if exists avatars_guard on public.avatars;
create trigger avatars_guard before insert or update on public.avatars for each row execute function public.avatar_guard();
create or replace function public.react_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.chat_id := (select chat_id from public.messages where id = new.message_id); -- el chat sale del mensaje
  new.created_at := now();
  if (select count(*) from public.message_reactions where user_id = new.user_id and created_at > now() - interval '1 minute') >= 60 then
    raise exception 'SLOW: muchas reacciones seguidas';
  end if;
  return new;
end $$;
drop trigger if exists message_reactions_guard on public.message_reactions;
create trigger message_reactions_guard before insert on public.message_reactions for each row execute function public.react_guard();
drop trigger if exists chat_files_guard on public.chat_files;
create trigger chat_files_guard before insert on public.chat_files for each row execute function public.file_guard();
create or replace function public.card_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  new.title := left(btrim(new.title), 120);
  if (select count(*) from public.chat_cards where user_id = new.user_id and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'SLOW: compartiste mucho seguido, esperá unos minutos';
  end if;
  return new;
end $$;
drop trigger if exists chat_cards_guard on public.chat_cards;
create trigger chat_cards_guard before insert on public.chat_cards for each row execute function public.card_guard();
revoke all on function public.card_guard() from public, anon, authenticated; -- es de un trigger: nadie la llama

-- crear un grupo con gente de la mesa (quien lo crea queda adentro)
create or replace function public.chat_create(nm text, people uuid[]) returns uuid
  language plpgsql security definer set search_path = public as $$
declare cid uuid; t uuid := public.my_team();
begin
  if t is null then raise exception 'NO_SESSION: volvé a entrar'; end if;
  nm := regexp_replace(btrim(coalesce(nm, '')), '\s+', ' ', 'g');
  if nm = '' or length(nm) > 40 then raise exception 'NAME: ponele un nombre al grupo (hasta 40 letras)'; end if;
  if (select count(*) from public.chats where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'SLOW: muchos grupos nuevos, esperá un rato';
  end if;
  insert into public.chats (team_id, kind, name, created_by) values (t, 'group', nm, auth.uid()) returning id into cid;
  insert into public.chat_members (chat_id, user_id, added_by) values (cid, auth.uid(), auth.uid());
  insert into public.chat_members (chat_id, user_id, added_by)
    select cid, p.id, auth.uid() from public.profiles p
     where p.id = any(coalesce(people, '{}'::uuid[])) and p.team_id = t and p.active and p.id <> auth.uid()
    on conflict do nothing;
  return cid;
end $$;

-- sumar gente a un grupo (cualquiera que esté adentro)
create or replace function public.chat_add(cid uuid, people uuid[]) returns json
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from public.chats c where c.id = cid and c.kind = 'group' and c.team_id = public.my_team())
     or not exists (select 1 from public.chat_members where chat_id = cid and user_id = auth.uid()) then
    raise exception 'CHAT: no estás en ese grupo';
  end if;
  insert into public.chat_members (chat_id, user_id, added_by)
    select cid, p.id, auth.uid() from public.profiles p
     where p.id = any(coalesce(people, '{}'::uuid[])) and p.team_id = public.my_team() and p.active
    on conflict do nothing;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'added', n);
end $$;

-- salir de un grupo, o sacar a alguien (solo quien lo creó). Si queda vacío, se borra.
create or replace function public.chat_leave(cid uuid, uid uuid default null) returns json
  language plpgsql security definer set search_path = public as $$
declare c record; target uuid := coalesce(uid, auth.uid());
begin
  select * into c from public.chats where id = cid and team_id = public.my_team();
  if c.id is null or c.kind <> 'group' then raise exception 'CHAT: solo se puede salir de un grupo'; end if;
  if not exists (select 1 from public.chat_members where chat_id = cid and user_id = auth.uid()) then raise exception 'CHAT: no estás en ese grupo'; end if;
  if target <> auth.uid() and c.created_by is distinct from auth.uid() then raise exception 'CHAT: solo quien creó el grupo puede sacar gente'; end if;
  delete from public.chat_members where chat_id = cid and user_id = target;
  if not exists (select 1 from public.chat_members where chat_id = cid) then delete from public.chats where id = cid; end if;
  return json_build_object('ok', true);
end $$;

-- cambiarle el nombre a un grupo (cualquiera que esté adentro)
create or replace function public.chat_rename(cid uuid, nm text) returns json
  language plpgsql security definer set search_path = public as $$
begin
  nm := regexp_replace(btrim(coalesce(nm, '')), '\s+', ' ', 'g');
  if nm = '' or length(nm) > 40 then raise exception 'NAME: ponele un nombre al grupo (hasta 40 letras)'; end if;
  if not exists (select 1 from public.chats c join public.chat_members m on m.chat_id = c.id and m.user_id = auth.uid()
                  where c.id = cid and c.kind = 'group' and c.team_id = public.my_team()) then
    raise exception 'CHAT: no estás en ese grupo';
  end if;
  update public.chats set name = nm where id = cid;
  return json_build_object('ok', true);
end $$;

-- chat privado con alguien de la mesa (lo crea la primera vez)
create or replace function public.chat_dm(uid uuid) returns uuid
  language plpgsql security definer set search_path = public as $$
declare cid uuid; t uuid := public.my_team(); k text;
begin
  if t is null then raise exception 'NO_SESSION: volvé a entrar'; end if;
  if uid is null or uid = auth.uid() or not exists (select 1 from public.profiles where id = uid and team_id = t and active) then
    raise exception 'CHAT: esa persona no está en la mesa';
  end if;
  k := least(auth.uid()::text, uid::text) || ':' || greatest(auth.uid()::text, uid::text);
  select id into cid from public.chats where team_id = t and dm_key = k;
  if cid is null then
    begin
      insert into public.chats (team_id, kind, created_by, dm_key) values (t, 'dm', auth.uid(), k) returning id into cid;
    exception when unique_violation then
      select id into cid from public.chats where team_id = t and dm_key = k;
    end;
  end if;
  insert into public.chat_members (chat_id, user_id, added_by) values (cid, auth.uid(), auth.uid()), (cid, uid, auth.uid())
    on conflict do nothing;
  return cid;
end $$;

revoke all on function public.in_chat(uuid), public.chat_create(text, uuid[]), public.chat_add(uuid, uuid[]),
  public.chat_leave(uuid, uuid), public.chat_rename(uuid, text), public.chat_dm(uuid) from public, anon;
grant execute on function public.in_chat(uuid), public.chat_create(text, uuid[]), public.chat_add(uuid, uuid[]),
  public.chat_leave(uuid, uuid), public.chat_rename(uuid, text), public.chat_dm(uuid) to authenticated;

-- ---------- tareas ----------
-- ¿puedo ver esta tarea? (team leader y admin: todas; los demás: las que les mandaron o mandaron)
create or replace function public.can_see_task(tid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tasks t where t.id = tid and t.team_id = public.my_team()
    and (public.my_role() in ('admin', 'leader') or t.created_by = auth.uid()
         or exists (select 1 from public.task_people p where p.task_id = t.id and p.user_id = auth.uid()))) $$;

-- limpia una lista: sin vacíos ni repetidos, hasta 30 de 80 letras
create or replace function public._clean_list(a text[]) returns text[]
  language sql immutable set search_path = public as $$
  select coalesce(array_agg(v order by o), '{}') from (
    select distinct on (lower(v)) v, o from (
      select left(regexp_replace(btrim(x), '\s+', ' ', 'g'), 80) v, o from unnest(coalesce(a, '{}')) with ordinality u(x, o)) q
     where v <> '' order by lower(v), o) d $$;

-- mandar una tarea (team leader o admin). Sin gente elegida: a toda la mesa menos quien la manda.
create or replace function public.task_create(what text, campaigns text[] default '{}', affiliates text[] default '{}',
    dfrom date default null, dto date default null, st text default null, notes text default null, due date default null,
    people uuid[] default null) returns uuid
  language plpgsql security definer set search_path = public as $$
declare tid uuid; t uuid := public.my_team(); c text[] := public._clean_list(campaigns); a text[] := public._clean_list(affiliates); n int;
begin
  if coalesce(public.my_role(), '') not in ('admin', 'leader') then raise exception 'TASK: solo el team leader manda tareas'; end if;
  what := regexp_replace(btrim(coalesce(what, '')), '\s+', ' ', 'g');
  if what = '' or length(what) > 120 then raise exception 'TASK: escribí qué hay que hacer (hasta 120 letras)'; end if;
  if array_length(c, 1) > 30 or array_length(a, 1) > 30 then raise exception 'TASK: hasta 30 campañas y 30 afiliadores'; end if;
  if dfrom is not null and dto is not null and dfrom > dto then raise exception 'TASK: la fecha desde es después de la fecha hasta'; end if;
  if (select count(*) from public.tasks where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'SLOW: muchas tareas en la última hora, esperá un rato';
  end if;
  insert into public.tasks (team_id, created_by, what, campaigns, affiliates, date_from, date_to, status, notes, due)
  values (t, auth.uid(), what, c, a, dfrom, dto, nullif(left(btrim(coalesce(st, '')), 60), ''), nullif(left(btrim(coalesce(notes, '')), 2000), ''), due)
  returning id into tid;
  insert into public.task_people (task_id, user_id)
    select tid, p.id from public.profiles p
     where p.team_id = t and p.active and p.login is not null
       and (case when people is null or cardinality(people) = 0 then p.id <> auth.uid() else p.id = any(people) end);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'TASK: elegí al menos a una persona de la mesa'; end if;
  return tid;
end $$;

-- marcar (o desmarcar) como hecha una tarea mía
create or replace function public.task_done(tid uuid, done boolean default true) returns json
  language plpgsql security definer set search_path = public as $$
begin
  update public.task_people p set done_at = case when done then coalesce(p.done_at, now()) else null end
   where p.task_id = tid and p.user_id = auth.uid()
     and exists (select 1 from public.tasks t where t.id = tid and t.team_id = public.my_team());
  if not found then raise exception 'TASK: esa tarea no es para vos'; end if;
  return json_build_object('ok', true);
end $$;

-- el team leader ve los días de cada uno (faltas, días laborables y libres), sin nada del sueldo
create or replace function public.team_days() returns table (user_id uuid, faltas jsonb, laborables jsonb, libres jsonb)
  language sql stable security definer set search_path = public as $$
  select s.user_id, coalesce(s.cfg->'faltas', '[]'::jsonb), s.cfg->'laborables', s.cfg->'libres'
    from public.settings s join public.profiles p on p.id = s.user_id
   where p.team_id = public.my_team() and public.my_role() in ('admin', 'leader') $$;
revoke all on function public.team_days() from public, anon;
grant execute on function public.team_days() to authenticated;

revoke all on function public.can_see_task(uuid), public._clean_list(text[]),
  public.task_create(text, text[], text[], date, date, text, text, date, uuid[]), public.task_done(uuid, boolean) from public, anon;
grant execute on function public.can_see_task(uuid), public.task_create(text, text[], text[], date, date, text, text, date, uuid[]),
  public.task_done(uuid, boolean) to authenticated;

-- Solo el administrador cambia roles, mesa o si alguien sigue activo. La cuenta y el PIN no se tocan desde la app.
-- (Sin "security definer": así sabe si el cambio viene de la app o de las funciones de arriba.)
create or replace function public.guard_profile() returns trigger
  language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.login is distinct from old.login or new.pin_set is distinct from old.pin_set or new.id is distinct from old.id or new.former is distinct from old.former then
    raise exception 'Eso no se puede cambiar desde la app';
  end if;
  if (new.role is distinct from old.role or new.team_id is distinct from old.team_id or new.active is distinct from old.active)
     and coalesce(public.my_role(), '') <> 'admin' then
    raise exception 'Solo el administrador puede cambiar roles o dar de baja';
  end if;
  if new.id = auth.uid() and (new.role <> 'admin' or not new.active) and old.role = 'admin'
     and not exists (select 1 from public.profiles where team_id = old.team_id and role = 'admin' and active and id <> old.id) then
    raise exception 'Tiene que quedar al menos un administrador';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile();

-- ---------- reglas de acceso (RLS) ----------
alter table public.teams       enable row level security;
alter table public.profiles    enable row level security;
alter table public.sales       enable row level security;
alter table public.settings    enable row level security;
alter table public.adjustments enable row level security;
alter table public.agenda      enable row level security;
alter table public.shifts      enable row level security;
alter table public.snippets    enable row level security;
alter table public.leads       enable row level security;
alter table public.pings       enable row level security;
alter table public.chats        enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages     enable row level security;
alter table public.chat_reads   enable row level security;
alter table public.tasks        enable row level security;
alter table public.task_people  enable row level security;
alter table public.targets      enable row level security;
alter table public.chat_files   enable row level security;
alter table public.chat_cards   enable row level security;
alter table public.avatars      enable row level security;
alter table public.message_reactions enable row level security;
alter table public.user_targets enable row level security;

drop policy if exists team_read on public.teams;
create policy team_read on public.teams for select to authenticated using (id = (select public.my_team()));
drop policy if exists team_admin on public.teams;
create policy team_admin on public.teams for update to authenticated using (id = (select public.my_team()) and (select public.my_role()) = 'admin');

drop policy if exists prof_read on public.profiles;
create policy prof_read on public.profiles for select to authenticated using (id = (select auth.uid()) or team_id = (select public.my_team()));
drop policy if exists prof_update on public.profiles;
create policy prof_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (team_id = (select public.my_team()) and (select public.my_role()) = 'admin'));

drop policy if exists sales_read on public.sales;
create policy sales_read on public.sales for select to authenticated using (team_id = (select public.my_team()));
drop policy if exists sales_insert on public.sales;
create policy sales_insert on public.sales for insert to authenticated with check (team_id = (select public.my_team())
  and (user_id = (select auth.uid()) or ((select public.my_role()) in ('admin','leader') and public.in_my_team(user_id)))); -- el team leader carga para la mesa
drop policy if exists sales_update on public.sales;
create policy sales_update on public.sales for update to authenticated
  using (team_id = (select public.my_team()) and (user_id = (select auth.uid()) or (select public.my_role()) in ('admin','leader')))
  with check (team_id = (select public.my_team()) and (user_id = (select auth.uid()) or ((select public.my_role()) in ('admin','leader') and public.in_my_team(user_id))));
drop policy if exists sales_delete on public.sales;
create policy sales_delete on public.sales for delete to authenticated
  using (team_id = (select public.my_team()) and (user_id = (select auth.uid()) or (select public.my_role()) in ('admin','leader')));

drop policy if exists own_settings on public.settings;
create policy own_settings on public.settings for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists own_adjustments on public.adjustments;
create policy own_adjustments on public.adjustments for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists own_agenda on public.agenda;
create policy own_agenda on public.agenda for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists own_shifts on public.shifts;
create policy own_shifts on public.shifts for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- el team leader (y el admin) ven la agenda, los turnos y los "sin detalle" de toda la mesa (solo leer; el sueldo no)
drop policy if exists lead_agenda on public.agenda;
create policy lead_agenda on public.agenda for select to authenticated using ((select public.my_role()) in ('admin','leader') and public.in_my_team(user_id));
drop policy if exists lead_shifts on public.shifts;
create policy lead_shifts on public.shifts for select to authenticated using ((select public.my_role()) in ('admin','leader') and public.in_my_team(user_id));
drop policy if exists lead_adjustments on public.adjustments;
create policy lead_adjustments on public.adjustments for select to authenticated using ((select public.my_role()) in ('admin','leader') and public.in_my_team(user_id));
drop policy if exists targets_read on public.targets;
create policy targets_read on public.targets for select to authenticated using (team_id = (select public.my_team()));
drop policy if exists targets_write on public.targets;
create policy targets_write on public.targets for all to authenticated
  using (team_id = (select public.my_team()) and (select public.my_role()) in ('admin','leader'))
  with check (team_id = (select public.my_team()) and (select public.my_role()) in ('admin','leader'));

drop policy if exists snip_read on public.snippets;
create policy snip_read on public.snippets for select to authenticated using (user_id = (select auth.uid()) or ((shared or global) and team_id = (select public.my_team())));
drop policy if exists snip_insert on public.snippets;
create policy snip_insert on public.snippets for insert to authenticated
  with check (user_id = (select auth.uid()) and team_id = (select public.my_team()) and (not global or (select public.my_role()) = 'admin'));
drop policy if exists snip_update on public.snippets;
create policy snip_update on public.snippets for update to authenticated   -- los globales, solo el admin
  using ((user_id = (select auth.uid()) and not global) or (team_id = (select public.my_team()) and (select public.my_role()) = 'admin' and (global or shared))
         or (shared and not global and team_id = (select public.my_team()) and (select public.my_role()) = 'leader'))
  with check (team_id = (select public.my_team()) and (not global or (select public.my_role()) = 'admin'));
drop policy if exists snip_delete on public.snippets;
create policy snip_delete on public.snippets for delete to authenticated
  using ((user_id = (select auth.uid()) and not global) or (team_id = (select public.my_team()) and (select public.my_role()) = 'admin' and (global or shared))
         or (shared and not global and team_id = (select public.my_team()) and (select public.my_role()) = 'leader'));

-- tareas: se ven si te las mandaron (team leader y admin ven todas); se crean y marcan con las funciones
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated using (team_id = (select public.my_team()) and public.can_see_task(id));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (team_id = (select public.my_team()) and (created_by = (select auth.uid()) or (select public.my_role()) = 'admin'));
drop policy if exists task_people_read on public.task_people;
create policy task_people_read on public.task_people for select to authenticated using (public.can_see_task(task_id));

drop policy if exists leads_read on public.leads;
create policy leads_read on public.leads for select to authenticated using (team_id = (select public.my_team()));
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated with check (team_id = (select public.my_team()) and user_id = (select auth.uid()));
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (team_id = (select public.my_team()) and (user_id = (select auth.uid()) or (select public.my_role()) in ('admin','leader')))
  with check (team_id = (select public.my_team()));
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using (team_id = (select public.my_team()) and (user_id = (select auth.uid()) or (select public.my_role()) in ('admin','leader')));

drop policy if exists pings_read on public.pings;
create policy pings_read on public.pings for select to authenticated
  using (team_id = (select public.my_team()) and (to_id is null or to_id = (select auth.uid()) or from_id = (select auth.uid())));
drop policy if exists pings_insert on public.pings;
create policy pings_insert on public.pings for insert to authenticated
  with check (team_id = (select public.my_team()) and from_id = (select auth.uid()) and (to_id is null or (to_id <> (select auth.uid()) and public.in_my_team(to_id))));
drop policy if exists pings_delete on public.pings;
create policy pings_delete on public.pings for delete to authenticated using (from_id = (select auth.uid()));

-- chat: se lee y se escribe donde estás; grupos y privados se arman con las funciones de arriba
drop policy if exists chats_read on public.chats;
create policy chats_read on public.chats for select to authenticated using (team_id = (select public.my_team()) and public.in_chat(id));
drop policy if exists chat_members_read on public.chat_members;
create policy chat_members_read on public.chat_members for select to authenticated using (public.in_chat(chat_id));
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (public.in_chat(chat_id));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check (user_id = (select auth.uid()) and public.in_chat(chat_id));
drop policy if exists ut_read on public.user_targets;
create policy ut_read on public.user_targets for select to authenticated
  using (user_id = (select auth.uid()) or ((select public.my_role()) in ('admin','leader') and public.in_my_team(user_id)));
drop policy if exists ut_write on public.user_targets;
create policy ut_write on public.user_targets for all to authenticated
  using ((select public.my_role()) in ('admin','leader') and public.in_my_team(user_id))
  with check ((select public.my_role()) in ('admin','leader') and public.in_my_team(user_id));
drop policy if exists reactions_read on public.message_reactions;
create policy reactions_read on public.message_reactions for select to authenticated using (public.in_chat(chat_id));
drop policy if exists reactions_insert on public.message_reactions;
create policy reactions_insert on public.message_reactions for insert to authenticated with check (user_id = (select auth.uid()) and public.in_chat(chat_id));
drop policy if exists reactions_delete on public.message_reactions;
create policy reactions_delete on public.message_reactions for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists avatars_read on public.avatars;
create policy avatars_read on public.avatars for select to authenticated using (public.in_my_team(user_id));
drop policy if exists avatars_own on public.avatars;
create policy avatars_own on public.avatars for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists files_read on public.chat_files;
create policy files_read on public.chat_files for select to authenticated using (public.in_chat(chat_id));
drop policy if exists files_insert on public.chat_files;
create policy files_insert on public.chat_files for insert to authenticated with check (user_id = (select auth.uid()) and public.in_chat(chat_id));
drop policy if exists files_delete on public.chat_files;
create policy files_delete on public.chat_files for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists cards_read on public.chat_cards;
create policy cards_read on public.chat_cards for select to authenticated using (public.in_chat(chat_id));
drop policy if exists cards_insert on public.chat_cards;
create policy cards_insert on public.chat_cards for insert to authenticated with check (user_id = (select auth.uid()) and public.in_chat(chat_id));
drop policy if exists cards_delete on public.chat_cards;
create policy cards_delete on public.chat_cards for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists chat_reads_own on public.chat_reads;
create policy chat_reads_own on public.chat_reads for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.in_chat(chat_id));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.sales, public.settings, public.adjustments, public.agenda, public.shifts, public.snippets, public.leads to authenticated;
grant select, update on public.teams, public.profiles to authenticated;
grant select, insert, delete on public.pings to authenticated;
revoke update on public.pings from authenticated;
grant select on public.chats, public.chat_members to authenticated;
revoke insert, update, delete on public.chats, public.chat_members from authenticated;
grant select, insert, delete, update on public.messages to authenticated; -- update: solo el propio texto y hasta 1 minuto (messages_update + msg_edit_guard)
grant select, insert, delete on public.chat_files to authenticated;
revoke update on public.chat_files from authenticated;
revoke all on public.chat_files from anon;
grant select, insert, delete on public.chat_cards to authenticated;
revoke update on public.chat_cards from authenticated;
revoke all on public.chat_cards from anon;
grant select, insert, update, delete on public.avatars to authenticated;
grant select, insert, delete on public.message_reactions to authenticated;
grant select, insert, update, delete on public.user_targets to authenticated;
revoke all on public.user_targets from anon;
revoke update on public.message_reactions from authenticated;
revoke all on public.message_reactions from anon;
revoke all on public.avatars from anon;
grant select, insert, update, delete on public.chat_reads to authenticated;
revoke all on public.chats, public.chat_members, public.messages, public.chat_reads from anon;
grant select, delete on public.tasks to authenticated;
revoke insert, update on public.tasks from authenticated;
grant select on public.task_people to authenticated;
revoke insert, update, delete on public.task_people from authenticated;
revoke all on public.tasks, public.task_people from anon;
grant select, insert, update, delete on public.targets to authenticated;
revoke all on public.targets from anon;
grant execute on function public.my_team(), public.my_role() to authenticated;
-- las funciones internas no se llaman desde la app sin sesión
revoke execute on function public.my_team(), public.my_role() from public, anon;
revoke execute on function public.handle_new_user(), public.guard_profile(), public.touch(), public.ping_guard(), public.msg_guard(), public.msg_gone(), public.file_guard(), public.avatar_guard(), public.react_guard() from public, anon, authenticated;

-- ---------- clientes del CRM: todos los que se ven, con su status (no solo los new) ----------
-- La extensión manda cada fila que ve en cualquier pestaña del CRM; se guarda la última foto y cada cambio de status.
-- Se escribe solo con crm_seen() (así cualquiera actualiza un cliente que vio primero otro). Fuera del tiempo real: son muchas filas.
alter table public.teams add column if not exists queue_cap integer not null default 60; -- grupo 3 de la cola: hasta cuántos se llaman todos

create table if not exists public.crm_clients (
  team_id       uuid not null default public.my_team() references public.teams(id),
  brand         text not null,
  client_id     text not null,
  name          text,
  country       text,
  reg           text,                -- 'AAAA-MM-DD HH:MM' como lo muestra el CRM (igual que sales.reg)
  status        text,                -- tal como lo escribe el CRM
  status_group  text not null default 'otro',
  crm_agent     text,
  camp          text,
  aff           text,
  first_seen    timestamptz not null default now(),
  first_seen_by uuid references public.profiles(id) on delete set null,
  last_seen     timestamptz not null default now(),
  last_seen_by  uuid references public.profiles(id) on delete set null,
  status_since  timestamptz not null default now(),  -- la primera vez que se vio en este status
  primary key (team_id, brand, client_id)
);
create index if not exists crm_clients_grp on public.crm_clients (team_id, status_group);
create index if not exists crm_clients_reg on public.crm_clients (team_id, reg);
create index if not exists crm_clients_seen on public.crm_clients (team_id, first_seen);
create index if not exists crm_clients_camp on public.crm_clients (team_id, camp);
alter table public.crm_clients add column if not exists last_call text; -- "Last Communication Time" del CRM (AAAA-MM-DD HH:MM)
alter table public.crm_clients add column if not exists note text;      -- "Last Note" del CRM
alter table public.crm_clients add column if not exists ftd_at text;    -- "Time of FTD" del CRM (AAAA-MM-DD HH:MM): ya depositó
alter table public.crm_clients add column if not exists desk text;      -- "Sales Desk" del CRM
-- el primero que lo llamó (el Sales Rep cuando se lo vio contactado por primera vez): a ese le suma la conversión del new
alter table public.crm_clients add column if not exists first_agent text;
alter table public.crm_clients add column if not exists first_call_at timestamptz;
-- un Talking que desapareció de la lista que se actualiza: ya cambió de status en el CRM (cuál, se sabe cuando aparezca en otra pestaña)
alter table public.crm_clients add column if not exists left_new_at timestamptz;
-- lo tiene otra mesa: no apareció en el pase completo de la pestaña de Clientes de la estación (station_sweep); vuelve a null al verlo de nuevo
alter table public.crm_clients add column if not exists gone_at timestamptz;
create table if not exists public.crm_status_log ( -- cada cambio de status que se vio (no la hora exacta del cambio en el CRM)
  id         bigserial primary key,
  team_id    uuid not null references public.teams(id),
  brand      text not null,
  client_id  text not null,
  old_status text,
  new_status text,
  new_group  text,
  seen_at    timestamptz not null default now(),
  seen_by    uuid references public.profiles(id) on delete set null
);
create index if not exists crm_status_log_cl on public.crm_status_log (team_id, client_id, seen_at);
-- rotaciones: cada cambio de agente (Sales Rep) que se vio en el CRM
create table if not exists public.crm_agent_log (
  id         bigserial primary key,
  team_id    uuid not null references public.teams(id),
  brand      text not null,
  client_id  text not null,
  old_agent  text,
  new_agent  text,
  status     text,
  seen_at    timestamptz not null default now(),
  seen_by    uuid references public.profiles(id) on delete set null
);
create index if not exists crm_agent_log_cl on public.crm_agent_log (team_id, client_id, seen_at);
create index if not exists crm_agent_log_at on public.crm_agent_log (team_id, seen_at);
create table if not exists public.crm_status_map ( -- status que el admin clasificó a mano
  team_id    uuid not null references public.teams(id),
  status_key text not null,
  grp        text not null check (grp in ('new','na','callback','call_again','hang_up','low_potential','not_interested','pending','failed','ftd','dnc','invalid','crm','otro')),
  primary key (team_id, status_key)
);

alter table public.crm_status_map drop constraint if exists crm_status_map_grp_check;
alter table public.crm_status_map add constraint crm_status_map_grp_check check (grp in ('new','na','callback','call_again','hang_up','low_potential','not_interested','pending','failed','ftd','dnc','invalid','crm','otro'));

create or replace function public.crm_key(st text) returns text language sql immutable set search_path = ''
  as $$ select lower(regexp_replace(coalesce(st, ''), '[^A-Za-z0-9]', '', 'g')) $$;
create or replace function public._clip(v text, n integer) returns text language sql immutable set search_path = ''
  as $$ select nullif(left(btrim(regexp_replace(coalesce(v, ''), '\s+', ' ', 'g')), n), '') $$;
-- lo que no es un status de venta: el de registro (Full Registration) o el de una transacción (Success, Failure, TimeOut, Approved…).
-- Algunas pestañas del CRM tienen una columna "Status" que es eso: no le cambia el status a nadie (si no, el cliente va y viene)
create or replace function public.crm_not_sales(st text) returns boolean language sql immutable set search_path = ''
  as $$ select public.crm_key(st) in ('fullregistration', 'partialregistration', 'registration', 'registered', 'success', 'successful', 'failure', 'failed',
    'timeout', 'approved', 'rejected', 'canceled', 'cancelled', 'pending', 'processing', 'completed', 'error', 'active', 'inactive', 'verified', 'unverified') $$;
-- el CRM en español dice lo mismo con otro nombre: se guarda con el de la tabla de la mesa (si no, cambia de status sin cambiar)
create or replace function public.crm_canon(st text) returns text language sql immutable set search_path = ''
  as $$ select case public.crm_key(st)
    when 'nuevo' then 'New' when 'hablando' then 'Talking' when 'llamardenuevo' then 'Call Again' when 'volverallamar' then 'Call Again'
    when 'sinrespuesta' then 'No Answer' when 'nocontesta' then 'No Answer' when 'colgo' then 'Hang Up' when 'nointeresado' then 'Not Interested'
    when 'bajopotencial' then 'Low Potential' when 'nollamar' then 'Do Not Call' when 'numeroinvalido' then 'Invalid Number' when 'pagopendiente' then 'Pending Payment'
    else st end $$;
-- grupo de cada status: new · na (No Answer, NA - DAY2…DAY5, NA-2…) · call_again · hang_up · low_potential · not_interested · dnc (Do Not Call) · otro
create or replace function public.crm_group(st text, t uuid) returns text
  language plpgsql stable security definer set search_path = public as $$
declare k text := public.crm_key(st); g text;
begin
  if k = '' then return 'otro'; end if;
  select grp into g from public.crm_status_map where team_id = t and status_key = k;
  if g is not null then return g; end if;
  return case
    -- la tabla de status de la mesa: Talking es el new en llamada; CallBack tiene cita; POTENTIAL NO KYC es el Call Again viejo
    when k like 'new%' or k = 'talking' then 'new'
    when k in ('na', 'noanswer', 'noresponse') or k ~ '^(na|noanswer)(day)?[0-9]{1,2}$' then 'na'
    when k = 'callback' then 'callback'
    when k in ('callagain', 'callagainlater', 'potentialnokyc') then 'call_again'
    when k in ('hangup', 'hungup') then 'hang_up'
    when k in ('lowpotential', 'lowpotencial') then 'low_potential'
    when k = 'notinterested' then 'not_interested'
    when k = 'pendingpayment' then 'pending'
    when k in ('faileddeposit', 'bankblock', 'declined') then 'failed'
    when k = 'ftd' then 'ftd'
    when k in ('donotcall', 'dnc', 'dontcall') then 'dnc'
    when k = 'invalidnumber' or k like 'languagebarrier%' then 'invalid'
    when k in ('reassign', 'reshuffle', 'test', 'fake', 'duplicate') then 'crm'
    else 'otro' end;
end $$;

-- lo que vio la extensión (hasta 500 filas): completa o actualiza cada cliente y anota el cambio de status
create or replace function public.crm_seen(rows jsonb) returns json
  language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.my_team();
  r jsonb; cid text; br text; st text; g text; rg text; lc text; nt text; fa text; ag text; hit boolean; cur record;
  n_new integer := 0; n_chg integer := 0; fresh text[] := '{}';
begin
  if t is null then raise exception 'NO_SESSION: volvé a entrar'; end if;
  if rows is null or jsonb_typeof(rows) <> 'array' then raise exception 'BAD: se esperaba una lista'; end if;
  if jsonb_array_length(rows) > 500 then raise exception 'TOO_MANY: de a 500'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    cid := public._clip(r->>'id', 60);
    if cid is null then continue; end if;
    br := coalesce(public._clip(r->>'brand', 40), 'Novara Markets');
    if coalesce(r->>'gone', '') in ('1', 'true') then -- salió de Talking: deja de ser new hasta que se lo vuelva a ver
      update public.crm_clients set left_new_at = now()
        where team_id = t and brand = br and client_id = cid and status_group = 'new' and public.crm_key(status) = 'talking' and left_new_at is null;
      if found then n_chg := n_chg + 1; end if;
      continue;
    end if;
    st := public.crm_canon(public._clip(r->>'status', 60));
    if public.crm_not_sales(st) then st := null; end if; -- la columna "Status" de registro o de una transacción: no es su status
    rg := public._clip(r->>'reg', 16);
    if rg is not null and (rg !~ '^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$' or left(rg, 10) > to_char((now() at time zone 'America/Montevideo') + interval '1 day', 'YYYY-MM-DD')) then rg := null; end if;
    lc := public._clip(r->>'call', 16);
    if lc is not null and (lc !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' or left(lc, 10) > to_char((now() at time zone 'America/Montevideo') + interval '1 day', 'YYYY-MM-DD')) then lc := null; end if;
    nt := public._clip(r->>'note', 200);
    fa := public._clip(r->>'ftd', 16);
    if fa is not null and (fa !~ '^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$' or left(fa, 10) > to_char((now() at time zone 'America/Montevideo') + interval '1 day', 'YYYY-MM-DD')) then fa := null; end if;
    ag := public._clip(r->>'agent', 80);
    g := public.crm_group(st, t);
    hit := public.crm_key(st) = 'talking' or (st is not null and g <> 'new') or lc is not null; -- ya lo contactaron
    select * into cur from public.crm_clients where team_id = t and brand = br and client_id = cid for update;
    if not found and st is null then continue; end if; -- sin su status de venta, se lo anota cuando se lo vea en la lista que lo tiene
    if not found then
      insert into public.crm_clients (team_id, brand, client_id, name, country, reg, status, status_group, crm_agent, camp, aff, last_call, note, ftd_at, desk, first_agent, first_seen_by, last_seen_by)
      values (t, br, cid, public._clip(r->>'name', 120), public._clip(r->>'country', 60), rg, st, g,
              ag, public._clip(r->>'camp', 120), public._clip(r->>'aff', 60), lc, nt, fa, public._clip(r->>'desk', 80), case when hit then ag end, auth.uid(), auth.uid())
      on conflict do nothing;
      if st is not null then
        insert into public.crm_status_log (team_id, brand, client_id, old_status, new_status, new_group, seen_by) values (t, br, cid, null, st, g, auth.uid());
      end if;
      n_new := n_new + 1;
      if g = 'new' then fresh := fresh || cid; end if;
    else
      update public.crm_clients set
        name = coalesce(public._clip(r->>'name', 120), name),
        country = coalesce(public._clip(r->>'country', 60), country),
        reg = coalesce(rg, reg),
        crm_agent = coalesce(ag, crm_agent),
        camp = coalesce(public._clip(r->>'camp', 120), camp),
        aff = coalesce(public._clip(r->>'aff', 60), aff),
        last_call = coalesce(lc, last_call),
        note = coalesce(nt, note),
        ftd_at = coalesce(fa, ftd_at),
        desk = coalesce(public._clip(r->>'desk', 80), desk),
        first_agent = case when first_agent is null and hit then coalesce(ag, cur.crm_agent) else first_agent end,
        first_call_at = case when first_agent is null and hit and coalesce(ag, cur.crm_agent) is not null then now() else first_call_at end,
        status = coalesce(st, status),
        status_group = case when st is null then status_group else g end,
        status_since = case when st is not null and st is distinct from cur.status then now() else status_since end,
        left_new_at = case when st is null then left_new_at end, -- se lo vio con su status: vale lo que se ve
        gone_at = null, -- se lo ve: está en la mesa
        last_seen = now(), last_seen_by = auth.uid()
      where team_id = t and brand = br and client_id = cid;
      if ag is not null and cur.crm_agent is not null and lower(ag) <> lower(cur.crm_agent) then -- lo rotaron
        insert into public.crm_agent_log (team_id, brand, client_id, old_agent, new_agent, status, seen_by) values (t, br, cid, cur.crm_agent, ag, coalesce(st, cur.status), auth.uid());
      end if;
      if st is not null and st is distinct from cur.status then
        insert into public.crm_status_log (team_id, brand, client_id, old_status, new_status, new_group, seen_by) values (t, br, cid, cur.status, st, g, auth.uid());
        n_chg := n_chg + 1;
      end if;
    end if;
  end loop;
  return json_build_object('ok', true, 'new', n_new, 'changed', n_chg, 'fresh', to_json(fresh));
end $$;

-- una vez: el status de registro o de transacción que se coló (Full Registration, Success…) y los nombres en español.
-- Se sacan del historial los cambios a esos status, se arregla el "de" de los que venían de ahí, se borran los que quedan sin cambio,
-- y cada cliente vuelve a su último status de venta con la hora en que entró en él. Re-ejecutable: si no hay nada que arreglar, no toca nada.
do $$
begin
  update public.crm_status_log set new_status = public.crm_canon(new_status) where new_status is distinct from public.crm_canon(new_status);
  update public.crm_status_log set old_status = public.crm_canon(old_status) where old_status is distinct from public.crm_canon(old_status);
  update public.crm_clients set status = public.crm_canon(status) where status is distinct from public.crm_canon(status);
  drop table if exists _ruido;
  create temp table _ruido on commit drop as
    select distinct team_id, brand, client_id from public.crm_status_log where public.crm_not_sales(new_status) or public.crm_not_sales(old_status)
    union select team_id, brand, client_id from public.crm_status_log group by 1, 2, 3 having count(*) filter (where old_status is not distinct from new_status) > 0;
  if not exists (select 1 from _ruido) then return; end if;
  delete from public.crm_status_log where public.crm_not_sales(new_status);
  update public.crm_status_log l set old_status = (select p.new_status from public.crm_status_log p
      where p.team_id = l.team_id and p.brand = l.brand and p.client_id = l.client_id and (p.seen_at, p.id) < (l.seen_at, l.id) order by p.seen_at desc, p.id desc limit 1)
    where public.crm_not_sales(l.old_status);
  delete from public.crm_status_log l using _ruido r
    where l.team_id = r.team_id and l.brand = r.brand and l.client_id = r.client_id and l.old_status is not distinct from l.new_status;
  update public.crm_clients c set status = x.new_status, status_group = public.crm_group(x.new_status, c.team_id), status_since = x.seen_at
    from (select distinct on (team_id, brand, client_id) team_id, brand, client_id, new_status, seen_at from public.crm_status_log
          order by team_id, brand, client_id, seen_at desc, id desc) x, _ruido r
    where x.team_id = c.team_id and x.brand = c.brand and x.client_id = c.client_id
      and r.team_id = c.team_id and r.brand = c.brand and r.client_id = c.client_id
      and (public.crm_not_sales(c.status) or c.status = x.new_status);
end $$;
update public.crm_clients c set status_group = public.crm_group(c.status, c.team_id)
  where c.status is not null and c.status_group is distinct from public.crm_group(c.status, c.team_id);

-- el admin clasifica un status que no se reconoce (y se reclasifican los clientes que lo tienen)
-- los que quedaron en "otro" con una versión vieja de crm_group (p. ej. NA - DAY3) pasan a su grupo
update public.crm_clients c set status_group = public.crm_group(c.status, c.team_id)
  where c.status is not null and c.status_group is distinct from public.crm_group(c.status, c.team_id);
-- los ya contactados sin primer agente: si lo rotaron estando contactado, lo llamó el de antes; si no, el actual
update public.crm_clients c set first_agent = coalesce((select case when public.crm_group(l.status, c.team_id) = 'new' and public.crm_key(l.status) <> 'talking' then null else l.old_agent end
    from public.crm_agent_log l where l.team_id = c.team_id and l.brand = c.brand and l.client_id = c.client_id order by l.seen_at limit 1), c.crm_agent)
  where c.first_agent is null and (c.status_group <> 'new' or public.crm_key(c.status) = 'talking' or c.last_call is not null);

create or replace function public.crm_map_status(st text, grp text) returns json
  language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team(); k text := public.crm_key(st); n integer;
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'Solo el administrador clasifica status'; end if;
  if k = '' then raise exception 'STATUS: falta el status'; end if;
  if grp not in ('new','na','callback','call_again','hang_up','low_potential','not_interested','pending','failed','ftd','dnc','invalid','crm','otro') then raise exception 'GRP: grupo inválido'; end if;
  insert into public.crm_status_map (team_id, status_key, grp) values (t, k, grp)
    on conflict (team_id, status_key) do update set grp = excluded.grp;
  update public.crm_clients set status_group = grp where team_id = t and public.crm_key(status) = k;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'clientes', n);
end $$;

-- team leader o admin: hasta cuántos del grupo 3 se llaman todos (si hay más, solo los registrados en el mes)
create or replace function public.set_queue_cap(n integer) returns json
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') not in ('admin', 'leader') then raise exception 'Solo el team leader o el administrador'; end if;
  if n is null or n < 1 or n > 1000 then raise exception 'CAP: entre 1 y 1000'; end if;
  update public.teams set queue_cap = n where id = public.my_team();
  return json_build_object('ok', true, 'cap', n);
end $$;

-- ---------- registro de accesos: exportaciones y cambios a ventas ajenas (lo ven team leader y admin) ----------
create table if not exists public.audit_log (
  id      bigserial primary key,
  team_id uuid not null references public.teams(id),
  user_id uuid references public.profiles(id) on delete set null,
  at      timestamptz not null default now(),
  action  text not null,
  detail  jsonb
);
create index if not exists audit_log_team_at on public.audit_log (team_id, at desc);
create or replace function public.audit_sales() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if; -- cambios hechos a mano en la base
  if tg_op = 'DELETE' and old.user_id <> auth.uid() then
    insert into public.audit_log (team_id, user_id, action, detail)
    values (old.team_id, auth.uid(), 'venta ajena borrada', jsonb_build_object('client_id', old.client_id, 'brand', old.brand, 'de', old.user_id, 'date', old.date));
  elsif tg_op = 'UPDATE' and (old.user_id <> auth.uid() or new.user_id <> old.user_id) then
    insert into public.audit_log (team_id, user_id, action, detail)
    values (new.team_id, auth.uid(), 'venta ajena editada', jsonb_build_object('client_id', new.client_id, 'brand', new.brand, 'de', old.user_id, 'a', new.user_id,
      'campos', (select coalesce(jsonb_agg(e.k), '[]'::jsonb) from jsonb_each(to_jsonb(new)) as e(k, v) where e.k not in ('updated_at', 'created_at') and to_jsonb(old) -> e.k is distinct from e.v)));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists sales_audit on public.sales;
create trigger sales_audit after update or delete on public.sales for each row execute function public.audit_sales();
create or replace function public.audit_note(act text, detail jsonb default null) returns json
  language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team();
begin
  if t is null then raise exception 'NO_SESSION: volvé a entrar'; end if;
  if act not in ('exportó ventas', 'exportó respaldo', 'exportó clientes') then raise exception 'ACT: acción desconocida'; end if;
  insert into public.audit_log (team_id, user_id, action, detail) values (t, auth.uid(), act, detail);
  return json_build_object('ok', true);
end $$;

alter table public.crm_clients    enable row level security;
alter table public.crm_status_log enable row level security;
alter table public.crm_status_map enable row level security;
alter table public.audit_log      enable row level security;
drop policy if exists crm_clients_read on public.crm_clients;
create policy crm_clients_read on public.crm_clients for select to authenticated using (team_id = (select public.my_team()));
drop policy if exists crm_log_read on public.crm_status_log;
create policy crm_log_read on public.crm_status_log for select to authenticated using (team_id = (select public.my_team()));
drop policy if exists crm_agent_log_read on public.crm_agent_log;
create policy crm_agent_log_read on public.crm_agent_log for select to authenticated using (team_id = (select public.my_team()));
alter table public.crm_agent_log enable row level security;
drop policy if exists crm_map_read on public.crm_status_map;
create policy crm_map_read on public.crm_status_map for select to authenticated using (team_id = (select public.my_team()));
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (team_id = (select public.my_team()) and (select public.my_role()) in ('admin', 'leader'));
grant select on public.crm_clients, public.crm_status_log, public.crm_agent_log, public.crm_status_map, public.audit_log to authenticated;
revoke insert, update, delete, truncate on public.crm_clients, public.crm_status_log, public.crm_agent_log, public.crm_status_map, public.audit_log from authenticated;
revoke all on public.crm_clients, public.crm_status_log, public.crm_agent_log, public.crm_status_map, public.audit_log from anon;
revoke all on function public.crm_seen(jsonb), public.crm_map_status(text, text), public.set_queue_cap(integer), public.audit_note(text, jsonb) from public, anon;
grant execute on function public.crm_seen(jsonb), public.crm_map_status(text, text), public.set_queue_cap(integer), public.audit_note(text, jsonb) to authenticated;
revoke execute on function public.crm_group(text, uuid), public.audit_sales() from public, anon, authenticated;

-- ---------- banking: procesadores, sus métodos de pago y bancos con su flujo recomendado ----------
-- los métodos se repiten entre procesadores (por eso van aparte); países vacíos = todos
create table if not exists public.pay_methods (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null default public.my_team() references public.teams(id),
  name       text not null check (length(btrim(name)) between 1 and 60),
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  unique (team_id, name)
);
create table if not exists public.processors (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null default public.my_team() references public.teams(id),
  name        text not null check (length(btrim(name)) between 1 and 60),
  countries   text[] not null default '{}',
  notes       text check (length(notes) <= 4000),
  status      text not null default 'ok' check (status in ('ok', 'falla')),
  status_note text check (length(status_note) <= 1000),
  status_at   timestamptz,
  status_by   uuid references public.profiles(id) on delete set null,
  active      boolean not null default true,
  sort        integer not null default 0,
  updated_at  timestamptz not null default now(),
  unique (team_id, name)
);
create table if not exists public.processor_methods (
  processor_id uuid not null references public.processors(id) on delete cascade,
  method_id    uuid not null references public.pay_methods(id) on delete cascade,
  team_id      uuid not null default public.my_team() references public.teams(id),
  countries    text[] not null default '{}', -- vacío: los del procesador
  status       text not null default 'ok' check (status in ('ok', 'falla')),
  status_note  text check (length(status_note) <= 1000),
  status_at    timestamptz,
  status_by    uuid references public.profiles(id) on delete set null,
  primary key (processor_id, method_id)
);
create table if not exists public.banks (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null default public.my_team() references public.teams(id),
  name       text not null check (length(btrim(name)) between 1 and 80),
  country    text not null default '' check (length(country) <= 40),
  steps      jsonb not null default '[]' check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 30),
  use_pm     jsonb not null default '[]' check (jsonb_typeof(use_pm) = 'array' and jsonb_array_length(use_pm) <= 20),   -- [{p: procesador|null, m: método|null}] recomendado
  avoid_pm   jsonb not null default '[]' check (jsonb_typeof(avoid_pm) = 'array' and jsonb_array_length(avoid_pm) <= 20), -- lo que no conviene
  notes      text check (length(notes) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  unique (team_id, name, country)
);
-- cada falla o vuelta (avisa a toda la mesa en vivo); se escribe solo con pay_report()
create table if not exists public.pay_incidents (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id),
  processor_id uuid not null references public.processors(id) on delete cascade,
  method_id    uuid references public.pay_methods(id) on delete set null,
  kind         text not null check (kind in ('falla', 'vuelve')),
  note         text check (length(note) <= 1000),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists pay_incidents_at on public.pay_incidents (team_id, created_at desc);
-- fotos de procesadores, bancos y fallas (webp achicado por la app)
create table if not exists public.pay_files (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null default public.my_team() references public.teams(id),
  ref_kind   text not null check (ref_kind in ('processor', 'bank', 'incident')),
  ref_id     uuid not null,
  mime       text not null check (mime in ('image/webp', 'image/jpeg', 'image/png')),
  data       text not null check (length(data) <= 1400000),
  w          integer, h integer,
  caption    text check (length(caption) <= 200),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists pay_files_ref on public.pay_files (team_id, ref_kind, ref_id);
-- nota de cada método en cada procesador (cómo se usa, qué pide…): se abre con la ⓘ de la tarjeta verde
alter table public.processor_methods add column if not exists note text check (length(note) <= 1000);
-- el paso anterior: cómo paga el cliente (efectivo, o digital: transferencia o tarjeta)
alter table public.pay_methods add column if not exists kind text check (kind in ('efectivo', 'transferencia', 'tarjeta'));
update public.pay_methods set kind = case
    when name ~* 'transf|spei|pse|khipu|wire' then 'transferencia'
    when name ~* 'tarjeta|card|cr[eé]dito|d[eé]bito|visa|master' then 'tarjeta'
    when name ~* 'efectivo|boleto|cash|oxxo|efecty|baloto|pagoefectivo|servipag' then 'efectivo' end
  where kind is null and name ~* 'transf|spei|pse|khipu|wire|tarjeta|card|cr[eé]dito|d[eé]bito|visa|master|efectivo|boleto|cash|oxxo|efecty|baloto|pagoefectivo|servipag';

create or replace function public.pay_editor() returns boolean language sql stable security definer set search_path = public
  as $$ select coalesce(public.my_role(), '') in ('admin', 'leader') $$;
-- reportar que un procesador (o uno de sus métodos) falla o volvió a andar
-- una falla puede ser en todos los países (fail_countries vacío) o solo en algunos
alter table public.processors add column if not exists fail_countries text[] not null default '{}';
alter table public.processor_methods add column if not exists fail_countries text[] not null default '{}';
alter table public.pay_incidents add column if not exists countries text[] not null default '{}'; -- a qué países tocó el aviso (vacío: todos)
drop function if exists public.pay_report(uuid, uuid, boolean, text);
create or replace function public.pay_report(pid uuid, mid uuid, falla boolean, note text default null, cs text[] default null) returns json
  language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.my_team(); n text := nullif(left(btrim(coalesce(note, '')), 1000), ''); iid uuid;
  c text[] := coalesce((select array_agg(distinct btrim(x) order by btrim(x)) from unnest(coalesce(cs, '{}')) x where btrim(x) <> ''), '{}');
  st text; fc text[]; scope text[]; nf text[]; nst text;
begin
  if not public.pay_editor() then raise exception 'Solo el administrador o el team leader'; end if;
  if not exists (select 1 from public.processors where id = pid and team_id = t) then raise exception 'PROC: no existe ese procesador'; end if;
  if mid is null then
    select status, fail_countries, countries into st, fc, scope from public.processors where id = pid;
  else
    select pm.status, pm.fail_countries, case when cardinality(pm.countries) > 0 then pm.countries else p.countries end into st, fc, scope
      from public.processor_methods pm join public.processors p on p.id = pm.processor_id where pm.processor_id = pid and pm.method_id = mid;
    if not found then raise exception 'METODO: ese procesador no tiene ese método'; end if;
  end if;
  if cardinality(scope) = 0 then scope := array['Colombia','México','Chile','Panamá','Guatemala','Costa Rica','Perú']; end if; -- sin países: los de la mesa
  if falla then
    nst := 'falla';
    if cardinality(c) = 0 or (st = 'falla' and cardinality(fc) = 0) then nf := '{}';                 -- en todos
    elsif st = 'falla' then nf := (select array_agg(distinct x order by x) from unnest(fc || c) x);  -- suma países
    else nf := c; end if;
    if cardinality(nf) > 0 and scope <@ nf then nf := '{}'; end if;                                 -- falla en todos donde está
  elsif cardinality(c) = 0 or st <> 'falla' then
    nst := 'ok'; nf := '{}';                                                                          -- volvió en todos
  else
    nf := (select coalesce(array_agg(x order by x), '{}') from unnest(case when cardinality(fc) = 0 then scope else fc end) x where x <> all (c));
    nst := case when cardinality(nf) = 0 then 'ok' else 'falla' end;                                 -- volvió en algunos
  end if;
  if mid is null then
    update public.processors set status = nst, fail_countries = nf, status_note = case when falla then case when st = 'falla' then coalesce(n, status_note) else n end when nst = 'falla' then status_note end,
      status_at = now(), status_by = auth.uid(), updated_at = now() where id = pid;
  else
    update public.processor_methods set status = nst, fail_countries = nf, status_note = case when falla then case when st = 'falla' then coalesce(n, status_note) else n end when nst = 'falla' then status_note end,
      status_at = now(), status_by = auth.uid() where processor_id = pid and method_id = mid;
  end if;
  insert into public.pay_incidents (team_id, processor_id, method_id, kind, note, countries, created_by)
  values (t, pid, mid, case when falla then 'falla' else 'vuelve' end, n, c, auth.uid()) returning id into iid;
  return json_build_object('ok', true, 'id', iid, 'fail_countries', nf, 'status', nst);
end $$;

do $$
declare t text;
begin
  foreach t in array array['pay_methods','processors','processor_methods','banks','pay_files'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (team_id = (select public.my_team()))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (team_id = (select public.my_team()) and (select public.pay_editor())) with check (team_id = (select public.my_team()) and (select public.pay_editor()))', t || '_write', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
alter table public.pay_incidents enable row level security;
drop policy if exists pay_incidents_read on public.pay_incidents;
create policy pay_incidents_read on public.pay_incidents for select to authenticated using (team_id = (select public.my_team()));
grant select on public.pay_incidents to authenticated;
revoke insert, update, delete, truncate on public.pay_incidents from authenticated;
revoke all on public.pay_incidents from anon;
revoke all on function public.pay_report(uuid, uuid, boolean, text, text[]), public.pay_editor() from public, anon;
grant execute on function public.pay_report(uuid, uuid, boolean, text, text[]), public.pay_editor() to authenticated;

-- ---------- la ficha del cliente: campañas (monto mínimo y qué ve la persona en el anuncio) y comentarios ----------
-- por afiliado + campaña + país; la carga cualquiera de la mesa si falta; la cambian admin y team leader (los agentes piden el cambio)
create table if not exists public.campaign_info (
  team_id    uuid not null default public.my_team() references public.teams(id),
  aff        text not null check (length(btrim(aff)) between 1 and 60),
  camp       text not null check (length(btrim(camp)) between 1 and 120),
  country    text not null default '' check (length(country) <= 60),
  min_amount text check (length(min_amount) <= 60),
  ad_text    text check (length(ad_text) <= 2000),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (team_id, aff, camp, country)
);
create table if not exists public.campaign_requests (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null default public.my_team() references public.teams(id),
  aff        text not null, camp text not null, country text not null default '',
  body       text not null check (length(btrim(body)) between 1 and 1000),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  done       boolean not null default false,
  done_by    uuid references public.profiles(id) on delete set null,
  done_at    timestamptz
);
create index if not exists campaign_requests_open on public.campaign_requests (team_id, done, created_at);
create table if not exists public.client_comments (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null default public.my_team() references public.teams(id),
  brand      text not null default 'Novara Markets' check (length(brand) <= 40),
  client_id  text not null check (length(btrim(client_id)) between 1 and 60),
  body       text not null check (length(btrim(body)) between 1 and 1000),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists client_comments_cl on public.client_comments (team_id, client_id, created_at);
alter table public.campaign_info enable row level security;
alter table public.campaign_requests enable row level security;
alter table public.client_comments enable row level security;
drop policy if exists campaign_info_read on public.campaign_info;
create policy campaign_info_read on public.campaign_info for select to authenticated using (team_id = (select public.my_team()));
drop policy if exists campaign_info_add on public.campaign_info;
create policy campaign_info_add on public.campaign_info for insert to authenticated with check (team_id = (select public.my_team()) and created_by = (select auth.uid()));
drop policy if exists campaign_info_edit on public.campaign_info;
create policy campaign_info_edit on public.campaign_info for update to authenticated using (team_id = (select public.my_team()) and (select public.pay_editor())) with check (team_id = (select public.my_team()));
drop policy if exists campaign_info_del on public.campaign_info;
create policy campaign_info_del on public.campaign_info for delete to authenticated using (team_id = (select public.my_team()) and (select public.pay_editor()));
drop policy if exists campaign_req_read on public.campaign_requests;
create policy campaign_req_read on public.campaign_requests for select to authenticated using (team_id = (select public.my_team()) and (created_by = (select auth.uid()) or (select public.pay_editor())));
drop policy if exists campaign_req_add on public.campaign_requests;
create policy campaign_req_add on public.campaign_requests for insert to authenticated with check (team_id = (select public.my_team()) and created_by = (select auth.uid()) and not done);
drop policy if exists campaign_req_done on public.campaign_requests;
create policy campaign_req_done on public.campaign_requests for update to authenticated using (team_id = (select public.my_team()) and (select public.pay_editor())) with check (team_id = (select public.my_team()));
drop policy if exists client_comments_read on public.client_comments;
create policy client_comments_read on public.client_comments for select to authenticated using (team_id = (select public.my_team()));
drop policy if exists client_comments_add on public.client_comments;
create policy client_comments_add on public.client_comments for insert to authenticated with check (team_id = (select public.my_team()) and created_by = (select auth.uid()));
drop policy if exists client_comments_del on public.client_comments;
create policy client_comments_del on public.client_comments for delete to authenticated using (team_id = (select public.my_team()) and (created_by = (select auth.uid()) or (select public.pay_editor())));
grant select, insert, update, delete on public.campaign_info, public.campaign_requests, public.client_comments to authenticated;
revoke update on public.client_comments from authenticated;
revoke all on public.campaign_info, public.campaign_requests, public.client_comments from anon;

-- perfil del cliente: lo que la gerencia exige saber de cada uno (edad, ocupación, objetivo) + si tiene el dinero y por qué no depositó.
-- Lo ve toda la mesa; se escribe solo por prof_save (un perfil por cliente). Sirve para armar el comentario estándar que se pega en el CRM.
create table if not exists public.client_profiles (
  team_id          uuid not null default public.my_team() references public.teams(id),
  brand            text not null default 'Novara Markets' check (length(brand) <= 40),
  client_id        text not null check (length(btrim(client_id)) between 1 and 60),
  edad             integer check (edad is null or edad between 16 and 110),
  ocupacion        text check (ocupacion is null or length(ocupacion) <= 120),
  desocupado       boolean not null default false,
  desocupado_desde text check (desocupado_desde is null or length(desocupado_desde) <= 60),
  objetivo         text check (objetivo is null or length(objetivo) <= 200),
  anuncio          text check (anuncio is null or length(anuncio) <= 300),  -- qué vio en el anuncio
  vio_min          boolean,                                                 -- vio el monto mínimo (null = no se sabe)
  outcome          text check (outcome is null or length(outcome) <= 30),   -- cómo terminó la llamada (sugiere el status del CRM)
  motivo           text check (motivo is null or length(motivo) <= 400),    -- detalle de la llamada
  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (team_id, brand, client_id)
);
create index if not exists client_profiles_cl on public.client_profiles (team_id, client_id);
alter table public.client_profiles enable row level security;
drop policy if exists client_profiles_read on public.client_profiles;
create policy client_profiles_read on public.client_profiles for select to authenticated using (team_id = (select public.my_team()));
grant select on public.client_profiles to authenticated;
revoke insert, update, delete, truncate on public.client_profiles from authenticated;
revoke all on public.client_profiles from anon;
-- se escribe solo por acá: un perfil por cliente, de la mesa de quien lo guarda
create or replace function public.prof_save(p_client text, p_brand text, p_data jsonb) returns text
  language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team();
begin
  if t is null then raise exception 'sin mesa'; end if;
  if length(btrim(coalesce(p_client,''))) = 0 then raise exception 'sin cliente'; end if;
  insert into public.client_profiles as cp
    (team_id, brand, client_id, edad, ocupacion, desocupado, desocupado_desde, objetivo, anuncio, vio_min, outcome, motivo, updated_by, updated_at)
  values (t, coalesce(nullif(btrim(p_brand), ''), 'Novara Markets'), btrim(p_client),
    nullif(p_data->>'edad', '')::integer,
    nullif(btrim(p_data->>'ocupacion'), ''),
    coalesce((p_data->>'desocupado')::boolean, false),
    nullif(btrim(p_data->>'desocupado_desde'), ''),
    nullif(btrim(p_data->>'objetivo'), ''),
    nullif(btrim(p_data->>'anuncio'), ''),
    (p_data->>'vio_min')::boolean,
    nullif(btrim(p_data->>'outcome'), ''),
    nullif(btrim(p_data->>'motivo'), ''),
    auth.uid(), now())
  on conflict (team_id, brand, client_id) do update set
    edad = excluded.edad, ocupacion = excluded.ocupacion, desocupado = excluded.desocupado,
    desocupado_desde = excluded.desocupado_desde, objetivo = excluded.objetivo, anuncio = excluded.anuncio,
    vio_min = excluded.vio_min, outcome = excluded.outcome, motivo = excluded.motivo,
    updated_by = auth.uid(), updated_at = now();
  return 'ok';
end $$;
revoke all on function public.prof_save(text, text, jsonb) from public, anon;
grant execute on function public.prof_save(text, text, jsonb) to authenticated;

-- palabra clave de confidencialidad del cliente: la acuerda el agente con el cliente para verificarlo en las próximas llamadas.
-- Es un dato propio del cliente (uno por cliente), lo ve y edita la mesa. Empieza sin palabra clave; se agrega/edita/borra por client_kw_set.
create table if not exists public.client_keywords (
  team_id    uuid not null default public.my_team() references public.teams(id),
  brand      text not null default 'Novara Markets' check (length(brand) <= 40),
  client_id  text not null check (length(btrim(client_id)) between 1 and 60),
  kw         text not null check (length(btrim(kw)) between 1 and 80),
  set_by     uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (team_id, brand, client_id)
);
create index if not exists client_keywords_cl on public.client_keywords (team_id, client_id);
alter table public.client_keywords enable row level security;
drop policy if exists client_keywords_read on public.client_keywords;
create policy client_keywords_read on public.client_keywords for select to authenticated using (team_id = (select public.my_team()));
grant select on public.client_keywords to authenticated;
revoke insert, update, delete, truncate on public.client_keywords from authenticated;
revoke all on public.client_keywords from anon;
-- agregar / editar / borrar (kw vacía borra) la palabra clave de un cliente
create or replace function public.client_kw_set(p_client text, p_brand text, p_kw text) returns json
  language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team(); cid text := btrim(coalesce(p_client, '')); br text := coalesce(nullif(btrim(p_brand), ''), 'Novara Markets'); k text := nullif(btrim(coalesce(p_kw, '')), '');
begin
  if t is null then raise exception 'sin mesa'; end if;
  if cid = '' then raise exception 'sin cliente'; end if;
  if k is null then delete from public.client_keywords where team_id = t and brand = br and client_id = cid; return json_build_object('ok', true, 'kw', null); end if;
  k := left(k, 80);
  insert into public.client_keywords (team_id, brand, client_id, kw, set_by, updated_at) values (t, br, cid, k, auth.uid(), now())
    on conflict (team_id, brand, client_id) do update set kw = excluded.kw, set_by = auth.uid(), updated_at = now();
  return json_build_object('ok', true, 'kw', k);
end $$;
revoke all on function public.client_kw_set(text, text, text) from public, anon;
grant execute on function public.client_kw_set(text, text, text) to authenticated;

-- ---------- llamadas: cada toque en Omega, Gizat o Voiso desde la ficha del cliente en el CRM (estimado) ----------
-- solo agente, cliente, línea y hora (ni teléfonos ni internos). Dos toques a la misma línea y cliente en menos de 30 s cuentan uno.
alter table public.teams add column if not exists min_calls integer not null default 250; -- llamadas mínimas por día (lo fija team leader/admin)
create table if not exists public.calls (
  id        bigserial primary key,
  team_id   uuid not null default public.my_team() references public.teams(id),
  user_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  brand     text not null default 'Novara Markets' check (length(brand) <= 40),
  client_id text not null check (length(btrim(client_id)) between 1 and 60),
  line      text not null check (line in ('omega', 'gizat', 'voiso')),
  at        timestamptz not null default now()
);
create index if not exists calls_day on public.calls (team_id, at);
create index if not exists calls_cl on public.calls (team_id, client_id, at);
alter table public.calls enable row level security;
drop policy if exists calls_read on public.calls;
create policy calls_read on public.calls for select to authenticated using (team_id = (select public.my_team()));
grant select on public.calls to authenticated;
revoke insert, update, delete, truncate on public.calls from authenticated;
revoke all on public.calls from anon;
-- ---------- RMO por día: la historia del ritmo de cada uno (lo pidió el dueño, auditoría 23/11) ----------
-- Lo calcula la app (ritmo) y lo guarda cada 5 min: el propio agente lo suyo, y el team leader/admin lo de todos. La mesa lo lee (Equipo y Turnos).
create table if not exists public.rmo_days (
  team_id    uuid not null default public.my_team() references public.teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  date       date not null,
  n          integer not null default 0,      -- llamadas
  talk_ms    integer not null default 0,      -- hablado
  dead_ms    integer not null default 0,      -- tiempo muerto
  req        integer,                         -- llamadas requeridas ese día
  q          smallint check (q between 1 and 3),
  open       boolean not null default true,   -- la jornada seguía abierta al guardar
  updated_at timestamptz not null default now(),
  primary key (user_id, date));
create index if not exists rmo_days_team on public.rmo_days (team_id, date);
alter table public.rmo_days enable row level security;
drop policy if exists rmo_read on public.rmo_days;
create policy rmo_read on public.rmo_days for select to authenticated using (team_id = (select public.my_team()));
grant select on public.rmo_days to authenticated;
revoke insert, update, delete, truncate on public.rmo_days from authenticated;
revoke all on public.rmo_days from anon;
create or replace function public.rmo_save(rows jsonb) returns json
  language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team(); r jsonb; u uuid; d date; n int := 0; lead boolean := coalesce(public.my_role(), '') in ('admin', 'leader');
begin
  if t is null then raise exception 'sin mesa'; end if;
  if rows is null or jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 50 then raise exception 'BAD: lista de hasta 50'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    u := case when r->>'uid' ~ '^[0-9a-f-]{36}$' then (r->>'uid')::uuid else auth.uid() end;
    if u <> auth.uid() and not lead then continue; end if; -- lo de otro solo lo guarda el team leader o el admin
    if not exists (select 1 from public.profiles p where p.id = u and p.team_id = t) then continue; end if;
    d := case when r->>'date' ~ '^\d{4}-\d\d-\d\d$' then (r->>'date')::date else current_date end;
    if d > current_date or d < current_date - 2 then continue; end if; -- solo hoy y los dos días anteriores
    insert into public.rmo_days (team_id, user_id, date, n, talk_ms, dead_ms, req, q, open, updated_at)
      values (t, u, d, greatest(0, least(100000, coalesce((r->>'n')::int, 0))), greatest(0, least(86400000, coalesce((r->>'talk')::int, 0))), greatest(0, least(86400000, coalesce((r->>'dead')::int, 0))),
        case when r->>'req' ~ '^\d{1,6}$' then (r->>'req')::int end, case when r->>'q' in ('1','2','3') then (r->>'q')::smallint end, coalesce(r->>'open', 'true') = 'true', now())
      on conflict (user_id, date) do update set n = excluded.n, talk_ms = excluded.talk_ms, dead_ms = excluded.dead_ms, req = excluded.req, q = excluded.q, open = excluded.open, updated_at = now();
    n := n + 1;
  end loop;
  return json_build_object('ok', true, 'n', n);
end $$;
revoke all on function public.rmo_save(jsonb) from public, anon;
grant execute on function public.rmo_save(jsonb) to authenticated;

-- se escriben solo por acá: de a 500, con la hora del toque (la extensión las guarda si Vitalis está cerrado)
create or replace function public.calls_add(rows jsonb) returns json
  language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.my_team(); u uuid := auth.uid();
  r jsonb; cid text; br text; ln text; ts timestamptz; n integer := 0;
begin
  if t is null or u is null then raise exception 'NO_SESSION: volvé a entrar'; end if;
  if rows is null or jsonb_typeof(rows) <> 'array' then raise exception 'BAD: se esperaba una lista'; end if;
  if jsonb_array_length(rows) > 500 then raise exception 'TOO_MANY: de a 500'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    cid := public._clip(r->>'id', 60); ln := lower(coalesce(r->>'line', ''));
    if cid is null or ln not in ('omega', 'gizat', 'voiso') then continue; end if;
    br := coalesce(public._clip(r->>'brand', 40), 'Novara Markets');
    begin ts := (r->>'at')::timestamptz; exception when others then ts := null; end;
    if ts is null or ts > now() + interval '1 minute' or ts < now() - interval '2 days' then ts := now(); end if;
    if exists (select 1 from public.calls c where c.team_id = t and c.user_id = u and c.client_id = cid and c.line = ln and c.at between ts - interval '30 seconds' and ts + interval '30 seconds') then continue; end if;
    insert into public.calls (team_id, user_id, brand, client_id, line, at) values (t, u, br, cid, ln, ts);
    n := n + 1;
  end loop;
  return json_build_object('ok', true, 'added', n);
end $$;
create or replace function public.set_min_calls(n integer) returns json
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') not in ('admin', 'leader') then raise exception 'Solo el team leader o el administrador'; end if;
  if n is null or n < 1 or n > 2000 then raise exception 'MIN: entre 1 y 2000'; end if;
  update public.teams set min_calls = n where id = public.my_team();
  return json_build_object('ok', true, 'min', n);
end $$;
revoke all on function public.calls_add(jsonb), public.set_min_calls(integer) from public, anon;
grant execute on function public.calls_add(jsonb), public.set_min_calls(integer) to authenticated;

-- ---------- estación: el Chrome del team leader con una pestaña propia por vista del CRM ----------
-- todo (Clientes: todos los status, ordenada por Modified Time, el último que cambió arriba: con esta y trx alcanza) · trx (depósitos).
-- Las de antes, por grupo de status: news (New y Talking) · cola (NA, Call Again, Hang Up) · agen (CallBack, Pending, Low Potential, Failed) · cerr (cerrados).
-- La extensión de la estación avisa cada 30 s (en horario) cómo le fue con cada vista; Vitalis muestra hace cuánto se leyó cada una
-- y avisa si la estación se calla, queda sin sesión del CRM o una vista perdió su filtro (aparecen status que no son de esa vista).
create table if not exists public.station_state (
  team_id    uuid not null references public.teams(id) on delete cascade,
  vista      text not null,
  last_ok    timestamptz,                    -- última lectura buena de esa vista
  last_try   timestamptz,                    -- último intento
  n          integer not null default 0,     -- filas que vio (clientes, o depósitos en trx)
  total      integer,                        -- el total que dice el CRM, si lo muestra
  off_pct    integer,                        -- % de clientes que no son de esa vista
  problem    text not null default '',       -- '' · login · sin-tabla · cerrada · filtro · orden (la de Clientes sin el último que cambió arriba)
  by_user    uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (team_id, vista));
-- el pase completo de la pestaña de Clientes (todas las páginas, una vez por hora): cuándo, cuántos vio, páginas, cuánto tardó, y si no encuentra el paginado
alter table public.station_state add column if not exists sweep_at timestamptz;
alter table public.station_state add column if not exists sweep_n integer;
alter table public.station_state add column if not exists sweep_pages integer;
alter table public.station_state add column if not exists sweep_ms integer;
alter table public.station_state add column if not exists sweep_err text not null default '';
alter table public.station_state add column if not exists sweep_gone integer;
alter table public.station_state add column if not exists pager text not null default '';
alter table public.station_state drop constraint if exists station_state_vista_check;
alter table public.station_state add constraint station_state_vista_check check (vista in ('todo', 'news', 'trx', 'cola', 'agen', 'cerr'));
alter table public.station_state enable row level security;
drop policy if exists station_read on public.station_state;
create policy station_read on public.station_state for select to authenticated using (team_id = public.my_team());
-- p = todas las vistas de la estación (las que no vienen ya no son parte de ella)
create or replace function public.station_beat(p jsonb) returns json
  language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team(); r jsonb; v text; want text[]; prob text; off int; tot int; bad int; k text; c text; got text[] := '{}'; nv int := 0;
  ts_ok timestamptz; ts_try timestamptz;
begin
  if t is null then raise exception 'sin mesa'; end if;
  if coalesce(public.my_role(), '') not in ('admin', 'leader') then raise exception 'Solo el team leader o el administrador'; end if;
  for r in select x from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x limit 10 loop
    v := r->>'vista';
    if v is null or v not in ('todo', 'news', 'trx', 'cola', 'agen', 'cerr') or v = any(got) then continue; end if;
    got := got || v;
    want := case v when 'news' then array['new'] when 'cola' then array['na', 'call_again', 'hang_up']
      when 'agen' then array['callback', 'pending', 'low_potential', 'failed'] when 'cerr' then array['not_interested', 'dnc', 'invalid', 'ftd', 'crm', 'otro'] end;
    prob := case when r->>'problem' in ('login', 'sin-tabla', 'cerrada') or (v = 'todo' and r->>'problem' = 'orden') then r->>'problem' else '' end;
    ts_ok := case when r->>'ok' ~ '^\d{4}-\d\d-\d\dT[0-9:.]+Z$' then least((r->>'ok')::timestamptz, now()) end;
    ts_try := case when r->>'try' ~ '^\d{4}-\d\d-\d\dT[0-9:.]+Z$' then least((r->>'try')::timestamptz, now()) end;
    off := null;
    if want is not null and jsonb_typeof(r->'statuses') = 'object' then
      tot := 0; bad := 0;
      for k, c in select key, value from jsonb_each_text(r->'statuses') limit 80 loop
        if c !~ '^\d{1,6}$' then continue; end if;
        tot := tot + c::int;
        if not (public.crm_group(k, t) = any(want)) then bad := bad + c::int; end if;
      end loop;
      if tot > 0 then off := round(100.0 * bad / tot); end if;
      if prob = '' and tot >= 5 and off > 30 then prob := 'filtro'; end if;
    end if;
    insert into public.station_state (team_id, vista, last_ok, last_try, n, total, off_pct, problem, by_user, updated_at)
      values (t, v, ts_ok, ts_try, case when r->>'n' ~ '^\d{1,6}$' then (r->>'n')::int else 0 end,
        case when r->>'total' ~ '^\d{1,7}$' then (r->>'total')::int end, off, prob, auth.uid(), now())
      on conflict (team_id, vista) do update set last_ok = coalesce(excluded.last_ok, station_state.last_ok), last_try = coalesce(excluded.last_try, station_state.last_try),
        n = excluded.n, total = excluded.total, off_pct = excluded.off_pct, problem = excluded.problem, by_user = excluded.by_user, updated_at = now();
    if v = 'todo' and jsonb_typeof(r->'sweep') = 'object' then
      update public.station_state set pager = case when r->'sweep'->>'pager' = 'no' then 'no' else '' end,
        sweep_err = case when r->'sweep'->>'busy' = 'true' then 'busy' else public._clip(r->'sweep'->>'err', 20) end
        where team_id = t and vista = v;
    end if;
    nv := nv + 1;
  end loop;
  delete from public.station_state where team_id = t and not (vista = any(got));
  return json_build_object('ok', true, 'n', nv);
end $$;
revoke all on function public.station_beat(jsonb) from public, anon;
grant execute on function public.station_beat(jsonb) to authenticated;
-- el pase completo: p = {started, ended, n, total, pages, bounded, cutoff, brand, ids}. Los clientes de la mesa que no están en ids
-- los tiene otra mesa (gone_at); si el pase se cortó por fecha (bounded), solo los vistos desde cutoff (los más viejos no se recorrieron).
-- Frenos: un pase con menos del 80% del total del CRM, o que dejaría fuera a más de la mitad de la mesa, no marca a nadie.
create or replace function public.station_sweep(p jsonb) returns json
  language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team(); ids text[]; br text; nn int; tot int; bounded boolean; cutoff timestamptz; ng int := 0; nb int := 0; live int; ts_s timestamptz; ts_e timestamptz;
begin
  if t is null then raise exception 'sin mesa'; end if;
  if coalesce(public.my_role(), '') not in ('admin', 'leader') then raise exception 'Solo el team leader o el administrador'; end if;
  if jsonb_typeof(p->'ids') <> 'array' or jsonb_array_length(p->'ids') > 20000 then raise exception 'BAD: ids'; end if;
  select array_agg(public._clip(x, 60)) into ids from jsonb_array_elements_text(p->'ids') x where x <> '';
  nn := coalesce(array_length(ids, 1), 0);
  br := coalesce(public._clip(p->>'brand', 40), 'Novara Markets');
  tot := case when p->>'total' ~ '^\d{1,7}$' then (p->>'total')::int end;
  bounded := coalesce(p->>'bounded', '') = 'true';
  cutoff := case when bounded and p->>'cutoff' ~ '^\d{4}-\d\d-\d\d$' then (p->>'cutoff')::date::timestamptz end;
  ts_s := case when p->>'started' ~ '^\d{4}-\d\d-\d\dT[0-9:.]+Z$' then least((p->>'started')::timestamptz, now()) end;
  ts_e := case when p->>'ended' ~ '^\d{4}-\d\d-\d\dT[0-9:.]+Z$' then least((p->>'ended')::timestamptz, now()) else now() end;
  if bounded and cutoff is null then raise exception 'BAD: cutoff'; end if;
  select count(*) into live from public.crm_clients where team_id = t and brand = br and gone_at is null;
  if nn < 1 or (tot is not null and not bounded and nn < tot * 0.8) or (live > 20 and nn < live * 0.5) then
    update public.station_state set sweep_at = ts_e, sweep_n = nn, sweep_pages = case when p->>'pages' ~ '^\d{1,5}$' then (p->>'pages')::int end,
      sweep_ms = case when p->>'ms' ~ '^\d{1,9}$' then (p->>'ms')::int end, sweep_err = 'incompleto', sweep_gone = 0, updated_at = now() where team_id = t and vista = 'todo';
    return json_build_object('ok', false, 'err', 'incompleto', 'n', nn, 'total', tot, 'live', live);
  end if;
  update public.crm_clients set gone_at = null where team_id = t and brand = br and gone_at is not null and client_id = any(ids);
  get diagnostics nb = row_count;
  update public.crm_clients set gone_at = now()
    where team_id = t and brand = br and gone_at is null and not (client_id = any(ids)) and (cutoff is null or last_seen >= cutoff);
  get diagnostics ng = row_count;
  update public.station_state set sweep_at = ts_e, sweep_n = nn, sweep_pages = case when p->>'pages' ~ '^\d{1,5}$' then (p->>'pages')::int end,
    sweep_ms = case when p->>'ms' ~ '^\d{1,9}$' then (p->>'ms')::int end, sweep_err = '', sweep_gone = ng, updated_at = now() where team_id = t and vista = 'todo';
  return json_build_object('ok', true, 'n', nn, 'gone', ng, 'back', nb, 'started', ts_s);
end $$;
revoke all on function public.station_sweep(jsonb) from public, anon;
grant execute on function public.station_sweep(jsonb) to authenticated;

-- ---------- cambios en vivo ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['sales','agenda','settings','adjustments','shifts','profiles','snippets','leads','pings','chats','chat_members','messages','tasks','task_people','targets','avatars','message_reactions','user_targets','processors','processor_methods','pay_incidents','banks','pay_methods','client_comments','campaign_info','campaign_requests','calls','teams'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- la mesa ----------
insert into public.teams (name, invite_code)
select 'Team Matías', 'MATIAS-' || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 5))
where not exists (select 1 from public.teams);

-- La lista de la mesa (se carga una sola vez; después se maneja desde Vitalis → Ajustes → Mesa).
-- Todos entran con PIN 0000 la primera vez. El primero que crea su PIN queda como administrador.
do $$
declare
  t uuid;
  n text;
begin
  select id into t from public.teams order by created_at limit 1;
  if exists (select 1 from public.profiles where team_id = t and login is not null) then return; end if;
  foreach n in array array['Alfonso Ro', 'Arlette Ga', 'Dahiana Le', 'Elias Me', 'Elisabet An', 'Joaquín Or', 'Martín Pe',
                           'Mateo He', 'Matias Me', 'Mauricio Mo', 'Melany Go', 'Sofía Ar', 'Valentín So'] loop
    perform public._new_seat(t, n, case when n = 'Matias Me' then 'leader' else 'agent' end);
  end loop;
end $$;

-- el chat de toda la mesa
insert into public.chats (team_id, kind, name)
select t.id, 'team', 'Toda la mesa' from public.teams t
 where not exists (select 1 from public.chats c where c.team_id = t.id and c.kind = 'team');

select name as mesa, (select count(*) from public.profiles where team_id = teams.id and active) as personas from public.teams;

-- ============================================================================
-- Vitalis: el compañero ficticio del chat de la mesa (con la foto del excompañero que le dio el nombre, con su visto bueno;
-- la foto se cargó directo en la base, en avatars, y no está en el repo).
-- Cuando alguien de la mesa hace una venta de hoy, felicita en "Toda la mesa".
-- No entra a Vitalis (sin PIN, inactivo, fuera de la lista de nombres) y no cuenta como agente.
-- ============================================================================
alter table public.profiles add column if not exists bot boolean not null default false;
create or replace function public.vitalis_bot(t uuid) returns uuid
  language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid;
begin
  select id into uid from public.profiles where team_id = t and bot order by created_at limit 1;
  if uid is null then
    uid := public._new_seat(t, 'Vitalis', 'agent');
    update public.profiles set active = false, bot = true, login = null where id = uid;
  end if;
  return uid;
end $$;
revoke all on function public.vitalis_bot(uuid) from public, anon, authenticated;
update public.profiles set name = 'Vitalis' where bot and name = 'Joaquín Vitalis'; -- se llamaba así al principio

create or replace function public.sale_cheer() returns trigger
  language plpgsql security definer set search_path = public, extensions as $$
declare
  b uuid; c uuid; nm text; k int; body text;
  hoy date := ((now() at time zone 'UTC') - interval '3 hours')::date; -- el día en Uruguay
  msgs text[] := array[
    '¡Vamo arriba, {n}! 🧉 Otra venta pa la mesa.',
    '¡Qué crack, {n}! Venta adentro. Así da gusto, bo.',
    '¡Tremendo, {n}! 🔥 Venta nueva. Felicitaciones.',
    '¡Grande, {n}! Venta cerrada. A cebar un mate para festejar 🧉',
    '¡Golazo de {n}! ⚽ Venta confirmada. Felicitaciones.',
    '¡De más, {n}! Venta nueva. Estás en llamas 🔥',
    '¡Aplausos para {n}! 👏 Otra venta. Ta, impecable.',
    '¡Bien ahí, {n}! Venta adentro. La mesa te banca.',
    '¡Impecable, {n}! Venta cerrada. Vamo que vamo 🚀',
    '¡Bo, {n} no para! Otra venta. Felicitaciones 👏',
    '¡Salú, {n}! 🧉 Venta nueva. Seguí así.',
    '¡Notable, {n}! Venta confirmada. Un lujo.',
    '¡Espectacular, {n}! 🎉 Otra venta pa la mesa. Felicitaciones.',
    '¡Epa, {n}! Venta adentro. Se festeja con bizcochos 🥐'];
begin
  begin
    if new.date < hoy or new.date > hoy + 1 then return new; end if; -- solo las de hoy: cargar historia no llena el chat
    select split_part(btrim(name), ' ', 1) into nm from public.profiles where id = new.user_id and active and not bot;
    if coalesce(nm, '') = '' then return new; end if;
    select id into c from public.chats where team_id = new.team_id and kind = 'team' limit 1;
    if c is null then return new; end if;
    b := public.vitalis_bot(new.team_id);
    if (select count(*) from public.messages where user_id = b and created_at > now() - interval '30 seconds') >= 10 then return new; end if;
    select count(*) into k from public.sales where user_id = new.user_id and to_char(date, 'YYYY-MM') = to_char(new.date, 'YYYY-MM');
    body := replace(msgs[1 + floor(random() * array_length(msgs, 1))::int], '{n}', nm)
      || case when k = 1 then ' Primera del mes.' when k > 1 then ' Va ' || k || ' este mes.' else '' end;
    insert into public.messages (chat_id, user_id, body) values (c, b, body);
  exception when others then null; -- felicitar nunca traba una venta
  end;
  return new;
end $$;
drop trigger if exists sales_cheer on public.sales;
create trigger sales_cheer after insert on public.sales for each row execute function public.sale_cheer();
revoke all on function public.sale_cheer() from public, anon, authenticated; -- es de un trigger: nadie la llama
create index if not exists messages_user on public.messages (user_id, created_at);

-- el admin o el team leader mandan un mensaje por Vitalis (comando /vitalis en el chat). Solo texto.
create or replace function public.vitalis_say(txt text, cid uuid default null) returns json
  language plpgsql security definer set search_path = public, extensions as $$
declare t uuid := public.my_team(); b uuid; c uuid; mid uuid;
begin
  if coalesce(public.my_role(), '') not in ('admin', 'leader') then raise exception 'Solo el administrador o el team leader manda mensajes por Vitalis'; end if;
  txt := left(btrim(coalesce(txt, '')), 2000);
  if txt = '' then raise exception 'Escribí el mensaje'; end if;
  if txt like '[img:%' or txt like '[card:%' then raise exception 'Vitalis manda solo texto'; end if;
  if cid is not null then select id into c from public.chats where id = cid and team_id = t and public.in_chat(id); end if;
  if c is null then select id into c from public.chats where team_id = t and kind = 'team' limit 1; end if; -- por defecto, a toda la mesa
  if c is null then raise exception 'No encontré el chat'; end if;
  b := public.vitalis_bot(t);
  if (select count(*) from public.messages where user_id = b and created_at > now() - interval '30 seconds') >= 8 then raise exception 'Muchos mensajes seguidos por Vitalis, esperá unos segundos'; end if;
  insert into public.messages (chat_id, user_id, body) values (c, b, txt) returning id into mid;
  return json_build_object('ok', true, 'id', mid, 'chat', c);
end $$;
grant execute on function public.vitalis_say(text, uuid) to authenticated;
revoke all on function public.vitalis_say(text, uuid) from public, anon;

-- El cierre del día (pedido del dueño, noviembre 2026): a las 17:35 el Vitalis del team leader o del admin arma el resumen de la
-- mesa y lo manda con day_close: queda en day_closes (uno por día: el primero que llega lo manda, los demás reciben dup) y Vitalis
-- lo escribe en el privado de cada team leader y admin (el chat con Vitalis se crea acá: chat_dm no deja, porque Vitalis está inactivo).
create table if not exists public.day_closes (
  team_id uuid not null references public.teams(id),
  date    date not null,
  body    text not null,
  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz not null default now(),
  primary key (team_id, date)
);
alter table public.day_closes enable row level security;
drop policy if exists day_closes_read on public.day_closes;
create policy day_closes_read on public.day_closes for select to authenticated using (team_id = public.my_team());
grant select on public.day_closes to authenticated;
create or replace function public.day_close(d date, txt text) returns json
  language plpgsql security definer set search_path = public, extensions as $$
declare t uuid := public.my_team(); b uuid; p record; c uuid; k text; n int := 0;
begin
  if coalesce(public.my_role(), '') not in ('admin', 'leader') then raise exception 'Solo el team leader o el administrador manda el cierre'; end if;
  txt := left(btrim(coalesce(txt, '')), 2000);
  if txt = '' then raise exception 'Vacío'; end if;
  if d is null or d > current_date + 1 or d < current_date - 3 then raise exception 'Fecha fuera de rango'; end if;
  begin
    insert into public.day_closes (team_id, date, body, sent_by) values (t, d, txt, auth.uid());
  exception when unique_violation then return json_build_object('ok', true, 'dup', true);
  end;
  b := public.vitalis_bot(t);
  for p in select id from public.profiles where team_id = t and active and not bot and role in ('leader', 'admin') loop
    k := least(b::text, p.id::text) || ':' || greatest(b::text, p.id::text);
    select id into c from public.chats where team_id = t and dm_key = k;
    if c is null then insert into public.chats (team_id, kind, created_by, dm_key) values (t, 'dm', b, k) returning id into c; end if;
    insert into public.chat_members (chat_id, user_id, added_by) values (c, b, b), (c, p.id, b) on conflict do nothing;
    insert into public.messages (chat_id, user_id, body) values (c, b, txt);
    n := n + 1;
  end loop;
  return json_build_object('ok', true, 'n', n);
end $$;
grant execute on function public.day_close(date, text) to authenticated;
revoke all on function public.day_close(date, text) from public, anon;

-- Privacidad: tras idle_min minutos sin usar la compu, Vitalis se tapa y pide el PIN (por detrás sigue andando);
-- el chat pide el PIN si hace chat_lock_min minutos que no lo mirás. Los cambia el administrador.
alter table public.teams add column if not exists idle_min integer not null default 15;
alter table public.teams add column if not exists chat_lock_min integer not null default 10;
do $$ begin alter table public.teams add constraint teams_idle_min check (idle_min between 5 and 240); exception when duplicate_object then null; end $$;
do $$ begin alter table public.teams add constraint teams_chat_lock_min check (chat_lock_min between 1 and 240); exception when duplicate_object then null; end $$;
create or replace function public.set_locks(idle integer, chat integer) returns json
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'Solo el administrador'; end if;
  if idle is null or idle < 5 or idle > 240 then raise exception 'LOCK: Vitalis se cierra entre los 5 y los 240 minutos'; end if;
  if chat is null or chat < 1 or chat > 240 then raise exception 'LOCK: el chat pide el PIN entre 1 y 240 minutos'; end if;
  update public.teams set idle_min = idle, chat_lock_min = chat where id = public.my_team();
  return json_build_object('ok', true, 'idle', idle, 'chat', chat);
end $$;
revoke all on function public.set_locks(integer, integer) from public, anon;
grant execute on function public.set_locks(integer, integer) to authenticated;
