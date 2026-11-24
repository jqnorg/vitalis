-- Una vez (24/11/2026): la mañana del 24 una columna "Status" mal leída mandó a New a clientes que eran FTD, Pending, Call Again, Low
-- Potential, Not Interested… ("es imposible que un new vuelva a New"). Cada cliente vuelve a su status anterior, se borran esos cambios del
-- historial y las rotaciones que vinieron en la misma lectura (la fila venía corrida). Re-ejecutable: si no hay nada que arreglar, no toca nada.
do $$
declare r record;
begin
  for r in select l.* from public.crm_status_log l where public.crm_key(l.new_status) = 'new' and l.old_status is not null and public.crm_key(l.old_status) <> 'new' order by l.seen_at desc loop
    update public.crm_clients c set status = r.old_status, status_group = public.crm_group(r.old_status, r.team_id),
      status_since = coalesce((select max(p.seen_at) from public.crm_status_log p where p.team_id = r.team_id and p.brand = r.brand and p.client_id = r.client_id and p.seen_at < r.seen_at), c.status_since)
      where c.team_id = r.team_id and c.brand = r.brand and c.client_id = r.client_id and public.crm_key(c.status) = 'new';
    update public.crm_clients c set crm_agent = a.old_agent from public.crm_agent_log a
      where a.team_id = r.team_id and a.brand = r.brand and a.client_id = r.client_id and a.seen_at between r.seen_at - interval '2 minutes' and r.seen_at + interval '2 minutes'
        and c.team_id = a.team_id and c.brand = a.brand and c.client_id = a.client_id and lower(c.crm_agent) = lower(a.new_agent);
    delete from public.crm_agent_log a where a.team_id = r.team_id and a.brand = r.brand and a.client_id = r.client_id and a.seen_at between r.seen_at - interval '2 minutes' and r.seen_at + interval '2 minutes';
    delete from public.crm_status_log where id = r.id;
  end loop;
end $$;
