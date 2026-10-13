-- À exécuter par Sonny dans Supabase avant la publication de la page.
-- Réexécutable : aucune suppression, aucun changement des cadeaux existants.
-- Prénom et email sont enregistrés dans la même transaction que l'invitation.
begin;
create or replace function public.dv_gift_assign(p_order uuid,p_recipients jsonb)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.dv_gift_orders; g public.dv_gifts; item jsonb; e text; recipient_first_name text; n integer:=0;
begin
  select * into strict o from public.dv_gift_orders where id=p_order for update;
  if o.status<>'paid' then raise exception 'order_revoked'; end if;
  if jsonb_typeof(p_recipients)<>'array' or jsonb_array_length(p_recipients) not between 1 and o.pack_count then raise exception 'invalid_recipients'; end if;
  for item in select * from jsonb_array_elements(p_recipients) loop
    e:=lower(trim(item->>'email'));
    if e is null or e !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or length(e)>254 then raise exception 'invalid_email'; end if;
    recipient_first_name:=null;
    -- Une ancienne page déjà ouverte peut encore transmettre uniquement l'email.
    if item ? 'firstName' then
      recipient_first_name:=trim(item->>'firstName');
      if jsonb_typeof(item->'firstName')<>'string' or recipient_first_name is null
        or length(recipient_first_name) not between 1 and 100
        or (item->>'firstName') ~ '[<>[:cntrl:]]' then raise exception 'invalid_name'; end if;
    end if;
    select * into strict g from public.dv_gifts where order_id=o.id and slot=(item->>'slot')::integer for update;
    if g.recipient_email=e and g.state in ('assigned','activating','active') then continue; end if;
    if g.state<>'available' then raise exception 'gift_already_assigned'; end if;
    update public.dv_gifts set recipient_email=e,recipient_name=recipient_first_name,state='assigned',assigned_at=now() where id=g.id;
    insert into public.dv_gift_jobs(job_key,kind,order_id,gift_id) values('invitation:'||g.id,'gift_email',o.id,g.id) on conflict(job_key) do nothing;
    n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function public.dv_gift_assign(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dv_gift_assign(uuid,jsonb) to service_role;
commit;
select position('recipient_name=recipient_first_name' in pg_get_functiondef('public.dv_gift_assign(uuid,jsonb)'::regprocedure))>0 as recipient_name_ready;
