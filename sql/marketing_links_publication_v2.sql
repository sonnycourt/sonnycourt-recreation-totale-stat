-- À exécuter par Sonny après marketing_links_v1.sql.
-- Deux champs facultatifs. Aucun lien, UTM ou événement existant n'est modifié.
begin;
alter table public.marketing_publications add column if not exists published_on date;
alter table public.marketing_publications add column if not exists publication_url text;
grant update(published_on,publication_url) on public.marketing_publications to service_role;

create or replace function public.marketing_create_link(p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_id uuid := (p_input->>'id')::uuid; v_content uuid := (p_input->>'content_id')::uuid; v_link public.marketing_links;
begin
  if char_length(coalesce(p_input->>'publication_url','')) > 2048
    or (coalesce(p_input->>'publication_url','') <> '' and p_input->>'publication_url' !~ '^https://') then raise exception 'Invalid publication URL'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_id::text,0));
  select * into v_link from public.marketing_links where id=v_id;
  if found then return to_jsonb(v_link); end if;
  insert into public.marketing_contents(id,title,format,topic,angle)
    values(v_content,p_input->>'title',p_input->>'format',coalesce(p_input->>'topic',''),coalesce(p_input->>'angle','')) on conflict(id) do nothing;
  insert into public.marketing_publications(id,content_id,label,channel,published_on,publication_url)
    values(v_id,v_content,coalesce(p_input->>'publication_label',''),p_input->>'channel',nullif(p_input->>'published_on','')::date,nullif(p_input->>'publication_url',''));
  insert into public.marketing_links(id,publication_id,code,channel,placement,campaign,destination)
    values(v_id,v_id,left(replace(v_id::text,'-',''),12),p_input->>'channel',p_input->>'placement',p_input->>'campaign',p_input->>'destination') returning * into v_link;
  return to_jsonb(v_link);
end;
$$;

create or replace function public.marketing_update_publication(p_id uuid,p_published_on date,p_publication_url text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_publication public.marketing_publications;
begin
  if char_length(coalesce(p_publication_url,'')) > 2048
    or (coalesce(p_publication_url,'') <> '' and p_publication_url !~ '^https://') then raise exception 'Invalid publication URL'; end if;
  update public.marketing_publications set published_on=p_published_on,publication_url=nullif(p_publication_url,'')
    where id=p_id returning * into v_publication;
  if not found then return null; end if;
  return to_jsonb(v_publication);
end;
$$;

create or replace function public.marketing_links_overview()
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object('schema_version',2,
    'contents',(select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb)
      from (select * from public.marketing_contents order by created_at desc limit 500) x),
    'links',(select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from (
      select l.*,p.content_id,p.label as publication_label,p.published_on,p.publication_url,c.title,c.format,c.topic,c.angle,
        (select count(*) from public.marketing_touchpoints t where t.link_id=l.id) as arrivals,
        (select count(distinct a.registration_id) from public.marketing_mc2_attribution a
          join public.marketing_touchpoints t on t.id=a.touchpoint_id join public.mc2_registrations r on r.id=a.registration_id
          where t.link_id=l.id and t.occurred_at <= r.registration_completed_at) as registrations
      from public.marketing_links l join public.marketing_publications p on p.id=l.publication_id
      join public.marketing_contents c on c.id=p.content_id order by l.created_at desc limit 200
    ) x),
    'totals',jsonb_build_object(
      'contents',(select count(*) from public.marketing_contents),
      'links',(select count(*) from public.marketing_links),
      'arrivals',(select count(*) from public.marketing_touchpoints),
      'consented_arrivals',(select count(*) from public.marketing_touchpoints where visitor_id is not null),
      'registrations',(select count(distinct a.registration_id) from public.marketing_mc2_attribution a
        join public.marketing_touchpoints t on t.id=a.touchpoint_id join public.mc2_registrations r on r.id=a.registration_id
        where t.occurred_at <= r.registration_completed_at)
    ),'generated_at',now());
$$;

revoke all on function public.marketing_create_link(jsonb) from public,anon,authenticated;
revoke all on function public.marketing_update_publication(uuid,date,text) from public,anon,authenticated;
revoke all on function public.marketing_links_overview() from public,anon,authenticated;
grant execute on function public.marketing_create_link(jsonb) to service_role;
grant execute on function public.marketing_update_publication(uuid,date,text) to service_role;
grant execute on function public.marketing_links_overview() to service_role;
commit;

select column_name,data_type from information_schema.columns where table_schema='public'
  and table_name='marketing_publications' and column_name in ('published_on','publication_url') order by column_name;
