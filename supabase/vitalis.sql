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

-- ---------- fechas de modificación ----------
create or replace function public.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists sales_touch on public.sales;
create trigger sales_touch before update on public.sales for each row execute function public.touch();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings for each row execute function public.touch();

-- ---------- registro con código de invitación ----------
-- El primero que se registra en una mesa queda como administrador.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  t  uuid;
  nm text;
begin
  select id into t from public.teams
   where upper(invite_code) = upper(trim(coalesce(new.raw_user_meta_data->>'invite', '')));
  if t is null then
    raise exception 'INVITE_INVALID: código de invitación inválido';
  end if;
  nm := nullif(trim(coalesce(new.raw_user_meta_data->>'name', '')), '');
  insert into public.profiles (id, team_id, name, email, role)
  values (new.id, t, coalesce(nm, split_part(new.email, '@', 1)), new.email,
          case when exists (select 1 from public.profiles where team_id = t) then 'agent' else 'admin' end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Solo el administrador cambia roles, mesa o si alguien sigue activo.
create or replace function public.guard_profile() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
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

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.sales, public.settings, public.adjustments, public.agenda, public.shifts to authenticated;
grant select, update on public.teams, public.profiles to authenticated;
grant execute on function public.my_team(), public.my_role() to authenticated;

-- ---------- cambios en vivo ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['sales','agenda','settings','adjustments','shifts','profiles'] loop
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

-- Para ver el código de invitación:
select name as mesa, invite_code as codigo_de_invitacion from public.teams;
