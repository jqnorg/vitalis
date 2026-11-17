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
  invite_code text not null unique,
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

-- PIN de cada uno (solo lo tocan las funciones de abajo: nadie lo puede leer desde la app)
create table if not exists public.pins (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  pin_hash     text not null,
  secret       text not null,          -- contraseña interna de la cuenta, larga y al azar; cambia en cada ingreso
  fails        integer not null default 0,
  locked_until timestamptz
);
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

-- la lista de nombres para la pantalla de entrada (hace falta el código de la mesa)
create or replace function public.team_roster(code text) returns json
  language sql stable security definer set search_path = public as $$
  select json_build_object('team', t.name, 'people', coalesce((
    select json_agg(json_build_object('id', p.id, 'name', p.name, 'role', p.role, 'pin_set', p.pin_set) order by p.name)
      from public.profiles p where p.team_id = t.id and p.active and p.login is not null), '[]'::json))
  from public.teams t where upper(t.invite_code) = upper(trim(coalesce(code, ''))) $$;

-- PIN correcto → datos para abrir la sesión. 5 errores seguidos → 15 minutos bloqueado.
create or replace function public.pin_login(code text, uid uuid, pin text) returns json
  language plpgsql security definer set search_path = public, extensions as $$
declare
  p   record;
  s   record;
  sec text;
begin
  select pr.id, pr.login, pr.pin_set into p from public.profiles pr join public.teams t on t.id = pr.team_id
   where pr.id = uid and pr.active and pr.login is not null and upper(t.invite_code) = upper(trim(coalesce(code, '')));
  if p.id is null then return json_build_object('ok', false, 'error', 'nouser'); end if;
  select * into s from public.pins where user_id = uid for update;
  if s.user_id is null then return json_build_object('ok', false, 'error', 'nouser'); end if;
  if s.locked_until is not null and s.locked_until > now() then
    return json_build_object('ok', false, 'error', 'locked', 'minutes', ceil(extract(epoch from s.locked_until - now()) / 60)::int);
  end if;
  if pin is null or pin !~ '^[0-9]{4}$' or s.pin_hash <> crypt(pin, s.pin_hash) then
    update public.pins set fails = case when s.fails + 1 >= 5 then 0 else s.fails + 1 end,
                           locked_until = case when s.fails + 1 >= 5 then now() + interval '15 minutes' else null end
     where user_id = uid;
    if s.fails + 1 >= 5 then return json_build_object('ok', false, 'error', 'locked', 'minutes', 15); end if;
    return json_build_object('ok', false, 'error', 'wrong', 'left', 4 - s.fails);
  end if;
  sec := encode(gen_random_bytes(24), 'hex');
  update public.pins set fails = 0, locked_until = null, secret = sec where user_id = uid;
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
  update public.pins set pin_hash = crypt('0000', gen_salt('bf')), fails = 0, locked_until = null where user_id = uid;
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

revoke all on function public.team_roster(text), public.pin_login(text, uuid, text), public.set_pin(text, text),
  public.reset_pin(uuid), public.add_member(text, text) from public;
grant execute on function public.team_roster(text), public.pin_login(text, uuid, text) to anon, authenticated;
grant execute on function public.set_pin(text, text), public.reset_pin(uuid), public.add_member(text, text) to authenticated;
revoke execute on function public.set_pin(text, text), public.reset_pin(uuid), public.add_member(text, text) from anon;

-- Solo el administrador cambia roles, mesa o si alguien sigue activo. La cuenta y el PIN no se tocan desde la app.
-- (Sin "security definer": así sabe si el cambio viene de la app o de las funciones de arriba.)
create or replace function public.guard_profile() returns trigger
  language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.login is distinct from old.login or new.pin_set is distinct from old.pin_set or new.id is distinct from old.id then
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

drop policy if exists team_read on public.teams;
create policy team_read on public.teams for select to authenticated using (id = public.my_team());
drop policy if exists team_admin on public.teams;
create policy team_admin on public.teams for update to authenticated using (id = public.my_team() and public.my_role() = 'admin');

drop policy if exists prof_read on public.profiles;
create policy prof_read on public.profiles for select to authenticated using (id = auth.uid() or team_id = public.my_team());
drop policy if exists prof_update on public.profiles;
create policy prof_update on public.profiles for update to authenticated
  using (id = auth.uid() or (team_id = public.my_team() and public.my_role() = 'admin'));

drop policy if exists sales_read on public.sales;
create policy sales_read on public.sales for select to authenticated using (team_id = public.my_team());
drop policy if exists sales_insert on public.sales;
create policy sales_insert on public.sales for insert to authenticated with check (team_id = public.my_team() and user_id = auth.uid());
drop policy if exists sales_update on public.sales;
create policy sales_update on public.sales for update to authenticated
  using (team_id = public.my_team() and (user_id = auth.uid() or public.my_role() in ('admin','leader')))
  with check (team_id = public.my_team());
drop policy if exists sales_delete on public.sales;
create policy sales_delete on public.sales for delete to authenticated
  using (team_id = public.my_team() and (user_id = auth.uid() or public.my_role() in ('admin','leader')));

drop policy if exists own_settings on public.settings;
create policy own_settings on public.settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_adjustments on public.adjustments;
create policy own_adjustments on public.adjustments for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_agenda on public.agenda;
create policy own_agenda on public.agenda for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_shifts on public.shifts;
create policy own_shifts on public.shifts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists snip_read on public.snippets;
create policy snip_read on public.snippets for select to authenticated using (user_id = auth.uid() or (shared and team_id = public.my_team()));
drop policy if exists snip_insert on public.snippets;
create policy snip_insert on public.snippets for insert to authenticated with check (user_id = auth.uid() and team_id = public.my_team());
drop policy if exists snip_update on public.snippets;
create policy snip_update on public.snippets for update to authenticated
  using (user_id = auth.uid() or (shared and team_id = public.my_team() and public.my_role() in ('admin','leader')))
  with check (team_id = public.my_team());
drop policy if exists snip_delete on public.snippets;
create policy snip_delete on public.snippets for delete to authenticated
  using (user_id = auth.uid() or (shared and team_id = public.my_team() and public.my_role() in ('admin','leader')));

drop policy if exists leads_read on public.leads;
create policy leads_read on public.leads for select to authenticated using (team_id = public.my_team());
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated with check (team_id = public.my_team() and user_id = auth.uid());
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (team_id = public.my_team() and (user_id = auth.uid() or public.my_role() in ('admin','leader')))
  with check (team_id = public.my_team());
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using (team_id = public.my_team() and (user_id = auth.uid() or public.my_role() in ('admin','leader')));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.sales, public.settings, public.adjustments, public.agenda, public.shifts, public.snippets, public.leads to authenticated;
grant select, update on public.teams, public.profiles to authenticated;
grant execute on function public.my_team(), public.my_role() to authenticated;
-- las funciones internas no se llaman desde la app sin sesión
revoke execute on function public.my_team(), public.my_role() from public, anon;
revoke execute on function public.handle_new_user(), public.guard_profile(), public.touch() from public, anon, authenticated;

-- ---------- cambios en vivo ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['sales','agenda','settings','adjustments','shifts','profiles','snippets','leads'] loop
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

-- Para ver el código de la mesa (se pide una vez en cada computadora):
select name as mesa, invite_code as codigo_de_la_mesa from public.teams;
