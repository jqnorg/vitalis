drop policy if exists campaign_info_read on public.campaign_info;
create policy campaign_info_read on public.campaign_info for select to authenticated using (true);
create or replace function public.teams_list() returns json
  language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'active', t.active,
    'people', (select count(*) from public.profiles p where p.team_id = t.id and p.active and not p.bot and not p.global),
    'leader', (select string_agg(p.name, ', ') from public.profiles p where p.team_id = t.id and p.active and p.role = 'leader'),
    'mine', t.id = public.my_team()) order by t.created_at), '[]'::json)
  from public.teams t where public.is_global() and t.slug is distinct from 'pruebas' $$;
-- ---------- la extensión de prueba (el dueño, 24/11/2026): "los agentes de otras mesas demoran demasiado en llamar a los news" ----------
-- Una mesa de prueba entra con un código (lo crea el dueño en Gerencia) y cada persona con su nombre tal como aparece en el CRM.
-- La extensión no tiene cuenta: llama a estas funciones con la clave pública y el código es la llave. Guarda solo news (New y Talking),
-- cuándo dejaron de serlo, las llamadas (toques en Omega/Gizat/Voiso) y la info de la campaña, que se comparte entre todas las mesas.
create table if not exists public.trial_desks (
  code       text primary key check (code ~ '^[A-Z0-9]{6}$'),
  name       text not null check (length(btrim(name)) between 2 and 40),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  active     boolean not null default true
);
create table if not exists public.trial_people (
  desk       text not null references public.trial_desks(code) on delete cascade,
  name       text not null check (length(btrim(name)) between 2 and 80),
  role       text not null default 'agent' check (role in ('agent', 'tl')),
  device     text,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (desk, name)
);
create table if not exists public.trial_news (
  desk          text not null references public.trial_desks(code) on delete cascade,
  brand         text not null default 'Novara Markets',
  client_id     text not null,
  name          text,
  country       text,
  reg           text,            -- AAAA-MM-DD HH:MM, como en el CRM
  agent         text,            -- el Sales Rep del CRM (el nombre con el que entra el agente)
  camp          text,
  aff           text,
  status        text,            -- New o Talking
  first_seen    timestamptz not null default now(),
  first_seen_by text,
  last_seen     timestamptz not null default now(),
  left_new_at   timestamptz,     -- dejó de ser new (otro status, o desapareció de la lista)
  first_call_at timestamptz,     -- la primera llamada que se vio (toque, o paso a Talking)
  first_call_by text,
  primary key (desk, brand, client_id)
);
create index if not exists trial_news_reg on public.trial_news (desk, reg);
create table if not exists public.trial_calls (
  id        bigserial primary key,
  desk      text not null references public.trial_desks(code) on delete cascade,
  agent     text not null,
  brand     text not null default 'Novara Markets',
  client_id text not null,
  line      text not null check (line in ('omega', 'gizat', 'voiso')),
  at        timestamptz not null
);
create index if not exists trial_calls_day on public.trial_calls (desk, at);
alter table public.trial_desks enable row level security;
alter table public.trial_people enable row level security;
alter table public.trial_news enable row level security;
alter table public.trial_calls enable row level security;
-- nadie lee las tablas directo: todo por funciones (el dueño y los directores ven el resumen con trial_desks_list)
drop policy if exists trial_desks_read on public.trial_desks;
create policy trial_desks_read on public.trial_desks for select to authenticated using ((select public.is_global()) or coalesce((select public.my_role()), '') = 'director');

-- la mesa "Pruebas": dueña de la info de campaña que cargan las mesas de prueba (compartida con todas)
insert into public.teams (name, invite_code, slug, active) select 'Pruebas', 'PRUEBAS-' || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 5)), 'pruebas', false
  where not exists (select 1 from public.teams where slug = 'pruebas');

create or replace function public._trial_desk(cd text) returns text language sql stable security definer set search_path = public
  as $$ select d.code from public.trial_desks d where d.code = upper(btrim(coalesce(cd, ''))) and d.active $$;
create or replace function public._trial_now_mvd() returns text language sql stable set search_path = ''
  as $$ select to_char(now() at time zone 'America/Montevideo', 'YYYY-MM-DD') $$;

-- el dueño crea una mesa de prueba: devuelve el código (6 letras y números)
create or replace function public.trial_desk_create(nm text) returns json
  language plpgsql security definer set search_path = public as $$
declare c text; n text := public._clip(nm, 40);
begin
  if not public.is_global() or coalesce(public.my_role(), '') <> 'admin' then raise exception 'Solo el dueño'; end if;
  if n is null or length(n) < 2 then raise exception 'NOMBRE: falta el nombre de la mesa'; end if;
  loop
    c := upper(translate(substr(encode(gen_random_bytes(6), 'base64'), 1, 6), '+/=0O1Il', 'ABCDEFGH'));
    exit when not exists (select 1 from public.trial_desks where code = c);
  end loop;
  insert into public.trial_desks (code, name, created_by) values (c, n, auth.uid());
  return json_build_object('ok', true, 'code', c, 'name', n);
end $$;
revoke all on function public.trial_desk_create(text) from public, anon;
grant execute on function public.trial_desk_create(text) to authenticated;

-- entrar con el código y el nombre (el que aparece en el CRM como Sales Rep)
create or replace function public.trial_join(code text, nm text, rl text, device text) returns json
  language plpgsql security definer set search_path = public as $$
declare d text := public._trial_desk(code); n text := public._clip(nm, 80); r text := case when rl = 'tl' then 'tl' else 'agent' end;
begin
  if d is null then return json_build_object('ok', false, 'err', 'Ese código no existe'); end if;
  if n is null or length(n) < 2 then return json_build_object('ok', false, 'err', 'Falta tu nombre (como aparece en el CRM)'); end if;
  insert into public.trial_people (desk, name, role, device) values (d, n, r, public._clip(device, 80))
    on conflict (desk, name) do update set role = excluded.role, device = excluded.device, last_seen = now();
  return json_build_object('ok', true, 'desk', (select k.name from public.trial_desks k where k.code = d), 'code', d, 'name', n, 'role', r);
end $$;

-- lo que vio la extensión: solo news (New y Talking) y FTD; cualquier otro status (o desaparecer de la lista) = dejó de ser new. Y las llamadas (ln).
-- Devuelve los news nuevos de este agente (fresh), para avisarle
create or replace function public.trial_seen(code text, nm text, rows jsonb) returns json
  language plpgsql security definer set search_path = public as $$
declare d text := public._trial_desk(code); n text := public._clip(nm, 80); r jsonb; cid text; br text; st text; k text; rg text; ag text; cur record;
  n_new int := 0; n_chg int := 0; fresh jsonb := '[]'::jsonb; ln text; at_ timestamptz; fa text;
begin
  if d is null then return json_build_object('ok', false, 'err', 'Ese código no existe'); end if;
  if rows is null or jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 500 then raise exception 'BAD: de a 500'; end if;
  update public.trial_people set last_seen = now() where desk = d and name = n;
  for r in select * from jsonb_array_elements(rows) loop
    cid := public._clip(r->>'id', 60); if cid is null then continue; end if;
    br := coalesce(public._clip(r->>'brand', 40), 'Novara Markets');
    ln := r->>'ln';
    if ln in ('omega', 'gizat', 'voiso') then -- una llamada
      at_ := case when r->>'at' ~ '^\d{4}-\d\d-\d\dT' then least((r->>'at')::timestamptz, now() + interval '1 minute') else now() end;
      if not exists (select 1 from public.trial_calls c where c.desk = d and c.agent = n and c.client_id = cid and c.line = ln and abs(extract(epoch from c.at - at_)) < 30) then
        insert into public.trial_calls (desk, agent, brand, client_id, line, at) values (d, n, br, cid, ln, at_);
        update public.trial_news set first_call_at = least(coalesce(first_call_at, at_), at_), first_call_by = coalesce(first_call_by, n) where desk = d and brand = br and client_id = cid;
      end if;
      continue;
    end if;
    if coalesce(r->>'gone', '') in ('1', 'true') then
      update public.trial_news set left_new_at = now() where desk = d and brand = br and client_id = cid and left_new_at is null;
      if found then n_chg := n_chg + 1; end if;
      continue;
    end if;
    st := public.crm_canon(public._clip(r->>'status', 60));
    if public.crm_not_sales(st) then st := null; end if;
    k := public.crm_key(st);
    fa := public._clip(r->>'ftd', 16);
    rg := public._clip(r->>'reg', 16);
    if rg is not null and rg !~ '^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$' then rg := null; end if;
    ag := public._clip(r->>'agent', 80);
    select * into cur from public.trial_news where desk = d and brand = br and client_id = cid for update;
    if st is not null and not (k like 'new%' or k = 'talking') or fa is not null then -- otro status o depositó: dejó de ser new
      if found and cur.left_new_at is null then
        update public.trial_news set left_new_at = now(), last_seen = now(), agent = coalesce(ag, agent), status = case when fa is not null then 'FTD' else status end,
          first_call_at = coalesce(first_call_at, now()), first_call_by = coalesce(first_call_by, ag, agent) where desk = d and brand = br and client_id = cid;
        n_chg := n_chg + 1;
      end if;
      continue;
    end if;
    if st is null then continue; end if;
    if not found then
      insert into public.trial_news (desk, brand, client_id, name, country, reg, agent, camp, aff, status, first_seen_by, first_call_at, first_call_by)
        values (d, br, cid, public._clip(r->>'name', 120), public._clip(r->>'country', 60), rg, ag, public._clip(r->>'camp', 120), public._clip(r->>'aff', 60), st, n,
                case when k = 'talking' then now() end, case when k = 'talking' then coalesce(ag, n) end)
        on conflict do nothing;
      n_new := n_new + 1;
      if k like 'new%' and ag is not null and lower(ag) = lower(n) then fresh := fresh || jsonb_build_object('id', cid, 'name', public._clip(r->>'name', 120), 'country', public._clip(r->>'country', 60), 'reg', rg); end if;
    else
      if cur.left_new_at is not null then -- new una sola vez: la fila se toma, el status no
        update public.trial_news set last_seen = now(), agent = coalesce(ag, agent), name = coalesce(public._clip(r->>'name', 120), name) where desk = d and brand = br and client_id = cid;
        continue;
      end if;
      update public.trial_news set name = coalesce(public._clip(r->>'name', 120), name), country = coalesce(public._clip(r->>'country', 60), country), reg = coalesce(rg, reg),
        agent = coalesce(ag, agent), camp = coalesce(public._clip(r->>'camp', 120), camp), aff = coalesce(public._clip(r->>'aff', 60), aff), status = st, last_seen = now(),
        first_call_at = case when k = 'talking' then coalesce(first_call_at, now()) else first_call_at end,
        first_call_by = case when k = 'talking' then coalesce(first_call_by, ag, agent) else first_call_by end
        where desk = d and brand = br and client_id = cid;
      if st is distinct from cur.status then n_chg := n_chg + 1; end if;
    end if;
  end loop;
  return json_build_object('ok', true, 'new', n_new, 'changed', n_chg, 'fresh', fresh);
end $$;

-- el tablero de la mesa de prueba: los que siguen en New (y hace cuánto), y la velocidad al new de hoy por agente
create or replace function public.trial_board(code text) returns json
  language plpgsql stable security definer set search_path = public as $$
declare d text := public._trial_desk(code); te text := public._trial_now_mvd(); out json;
begin
  if d is null then return json_build_object('ok', false, 'err', 'Ese código no existe'); end if;
  select json_build_object('ok', true, 'desk', (select k.name from public.trial_desks k where k.code = d), 'day', te,
    'news', coalesce((select json_agg(json_build_object('id', x.client_id, 'name', x.name, 'country', x.country, 'agent', x.agent, 'reg', x.reg, 'since', x.first_seen,
        'talking', public.crm_key(x.status) = 'talking', 'called', x.first_call_at is not null, 'min', round(extract(epoch from now() - coalesce(
          case when x.reg ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' then (x.reg || ':00')::timestamp at time zone 'America/Montevideo' end, x.first_seen)) / 60)) order by x.first_seen desc)
      from public.trial_news x where x.desk = d and x.left_new_at is null and x.last_seen > now() - interval '2 days'), '[]'::json),
    'agents', coalesce((select json_agg(json_build_object('name', a.name, 'role', a.role, 'news', a.news, 'called', a.called, 'calls', a.calls, 'med', a.med, 'p90', a.p90, 'slow', a.slow, 'last', a.last) order by a.news desc, a.name)
      from (select p.name, p.role,
          (select count(*) from public.trial_news x where x.desk = d and lower(x.agent) = lower(p.name) and left(x.reg, 10) = te) news,
          (select count(*) from public.trial_news x where x.desk = d and lower(x.agent) = lower(p.name) and left(x.reg, 10) = te and x.first_call_at is not null) called,
          (select count(*) from public.trial_calls c where c.desk = d and c.agent = p.name and c.at >= (te || ' 00:00')::timestamp at time zone 'America/Montevideo') calls,
          (select percentile_cont(0.5) within group (order by m) from (select extract(epoch from x.first_call_at - ((x.reg || ':00')::timestamp at time zone 'America/Montevideo')) / 60 m
             from public.trial_news x where x.desk = d and lower(x.agent) = lower(p.name) and left(x.reg, 10) = te and x.reg ~ ':' and x.first_call_at is not null) q where m between 0 and 1440) med,
          (select percentile_cont(0.9) within group (order by m) from (select extract(epoch from x.first_call_at - ((x.reg || ':00')::timestamp at time zone 'America/Montevideo')) / 60 m
             from public.trial_news x where x.desk = d and lower(x.agent) = lower(p.name) and left(x.reg, 10) = te and x.reg ~ ':' and x.first_call_at is not null) q where m between 0 and 1440) p90,
          (select count(*) from public.trial_news x where x.desk = d and lower(x.agent) = lower(p.name) and left(x.reg, 10) = te and x.reg ~ ':' and x.first_call_at is not null
             and extract(epoch from x.first_call_at - ((x.reg || ':00')::timestamp at time zone 'America/Montevideo')) / 60 > 5) slow,
          (select max(c.at) from public.trial_calls c where c.desk = d and c.agent = p.name) last
        from public.trial_people p where p.desk = d) a), '[]'::json)) into out;
  return out;
end $$;

-- la info de la campaña del cliente (compartida entre todas las mesas): la suya y las otras del afiliador en su país
drop function if exists public.trial_camp(text, text, text, text);
create or replace function public.trial_camp(code text, aff_ text, camp_ text, country_ text, cid_ text default null) returns json
  language plpgsql stable security definer set search_path = public as $$
declare d text := public._trial_desk(code); a text := public._clip(aff_, 60); c text := public._clip(camp_, 120); p text := public._clip(country_, 60); x record; cl json := null;
begin
  if d is null then return json_build_object('ok', false, 'err', 'Ese código no existe'); end if;
  if cid_ is not null then -- lo que la mesa sabe del cliente (si lo vio en una lista): completa lo que no vino
    select * into x from public.trial_news n where n.desk = d and n.client_id = public._clip(cid_, 60) order by n.last_seen desc limit 1;
    if found then a := coalesce(a, x.aff); c := coalesce(c, x.camp); p := coalesce(p, x.country);
      cl := json_build_object('name', x.name, 'country', x.country, 'aff', x.aff, 'camp', x.camp, 'agent', x.agent, 'status', case when x.left_new_at is not null then 'Dejó de ser new' else x.status end, 'reg', x.reg, 'called', x.first_call_at is not null); end if;
  end if;
  if a is null then return json_build_object('ok', true, 'camps', '[]'::json, 'cl', cl); end if;
  return json_build_object('ok', true, 'aff', a, 'camp', c, 'country', p, 'cl', cl, 'camps', coalesce((select json_agg(json_build_object('camp', y.camp, 'min', y.min_amount, 'ad', y.ad_text, 'mine', lower(y.camp) = lower(coalesce(c, ''))) order by (lower(y.camp) = lower(coalesce(c, ''))) desc, y.camp)
    from (select distinct on (lower(i.camp)) i.camp, i.min_amount, i.ad_text from public.campaign_info i where lower(i.aff) = lower(a) and (p is null or lower(i.country) = lower(p) or i.country = '')
          order by lower(i.camp), (i.min_amount is not null) desc, i.updated_at desc) y), '[]'::json));
end $$;
create or replace function public.trial_camp_set(code text, nm text, aff_ text, camp_ text, country_ text, min_ text, ad_ text) returns json
  language plpgsql security definer set search_path = public as $$
declare d text := public._trial_desk(code); t uuid; a text := public._clip(aff_, 60); c text := public._clip(camp_, 120); p text := coalesce(public._clip(country_, 60), '');
begin
  if d is null then return json_build_object('ok', false, 'err', 'Ese código no existe'); end if;
  if a is null or c is null then return json_build_object('ok', false, 'err', 'Falta el afiliador o la campaña'); end if;
  select id into t from public.teams where slug = 'pruebas';
  insert into public.campaign_info (team_id, aff, camp, country, min_amount, ad_text, created_by, updated_by)
    values (t, a, c, p, public._clip(min_, 60), public._clip(ad_, 2000), null, null)
    on conflict (team_id, aff, camp, country) do update set min_amount = excluded.min_amount, ad_text = excluded.ad_text, updated_at = now();
  return json_build_object('ok', true);
end $$;

-- la página de invitación: quién invita (el dueño, con su foto)
create or replace function public.trial_invite() returns json
  language sql stable security definer set search_path = public as $$
  select json_build_object('name', p.name, 'mime', a.mime, 'data', a.data)
  from public.profiles p left join public.avatars a on a.user_id = p.id
  where p.global and p.role = 'admin' order by p.created_at limit 1 $$;

-- el dueño y los directores: las mesas de prueba con su gente y su velocidad al new de hoy
create or replace function public.trial_desks_list() returns json
  language sql stable security definer set search_path = public as $$
  select case when public.is_global() or coalesce(public.my_role(), '') = 'director' then coalesce((select json_agg(json_build_object(
      'code', d.code, 'name', d.name, 'created_at', d.created_at, 'people', (select count(*) from public.trial_people p where p.desk = d.code),
      'news_today', (select count(*) from public.trial_news x where x.desk = d.code and left(x.reg, 10) = public._trial_now_mvd()),
      'in_new', (select count(*) from public.trial_news x where x.desk = d.code and x.left_new_at is null and x.last_seen > now() - interval '2 days'),
      'med', (select percentile_cont(0.5) within group (order by m) from (select extract(epoch from x.first_call_at - ((x.reg || ':00')::timestamp at time zone 'America/Montevideo')) / 60 m
         from public.trial_news x where x.desk = d.code and left(x.reg, 10) = public._trial_now_mvd() and x.reg ~ ':' and x.first_call_at is not null) q where m between 0 and 1440),
      'last', (select max(p.last_seen) from public.trial_people p where p.desk = d.code)) order by d.created_at desc) from public.trial_desks d where d.active), '[]'::json)
    else '[]'::json end $$;
revoke all on function public.trial_desks_list() from public, anon;
grant execute on function public.trial_desks_list() to authenticated;
-- las de la extensión: con la clave pública (el código es la llave)
grant execute on function public.trial_join(text, text, text, text), public.trial_seen(text, text, jsonb), public.trial_board(text), public.trial_camp(text, text, text, text, text), public.trial_camp_set(text, text, text, text, text, text, text), public.trial_invite() to anon, authenticated;
revoke all on function public._trial_desk(text) from public, anon;
