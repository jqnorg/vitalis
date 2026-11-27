-- 27/11/2026: las pestañas del team leader listan los news de todo el piso y Vitalis se llenó de news de otras mesas
-- ("sin agente", "sin gestionar hace 2 días"). Desde hoy crm_seen no los deja entrar y marca como "dejó de ser new"
-- lo que nadie vio en 3 h. Esto limpia lo que ya estaba (lo mismo que hará crm_seen solo, pero de una). Se corre en SQL Editor → Run.
with m as (
  select lower(name) n from public.profiles where team_id = (select id from public.teams where slug = 'matias') and active
  union select lower(crm_name) from public.profiles where team_id = (select id from public.teams where slug = 'matias') and active and crm_name is not null)
update public.crm_clients set left_new_at = last_seen
 where team_id = (select id from public.teams where slug = 'matias') and status_group = 'new' and left_new_at is null and ftd_at is null
   and ((coalesce(crm_agent, '') <> '' and lower(crm_agent) not in (select n from m)) or last_seen < now() - interval '3 hours');
