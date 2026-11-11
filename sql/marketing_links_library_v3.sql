-- À exécuter par Sonny dans Supabase. Réexécutable, aucune donnée modifiée.
-- Recherche sur tout l'historique ; les tailles de page ne limitent jamais le total.
begin;
create index if not exists marketing_links_cursor_idx on public.marketing_links(created_at desc,id desc);
create index if not exists marketing_contents_cursor_idx on public.marketing_contents(created_at desc,id desc);

create or replace function public.marketing_library_page(
  p_kind text default 'links', p_search text default '', p_channel text default '',
  p_before_at timestamptz default null, p_before_id uuid default null, p_take integer default 24
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb; v_search text := lower(btrim(coalesce(p_search,'')));
begin
  if p_kind not in ('links','contents','summary') or p_kind is null
    or p_take is null or p_take<1 or p_take>100 or char_length(v_search)>200
    or (p_before_at is null)<>(p_before_id is null)
    or coalesce(p_channel,'') not in ('','instagram','facebook','youtube','tiktok','email','sms','meta_ads')
    then raise exception 'Invalid library query'; end if;
  if p_kind='summary' then
    return jsonb_build_object('schema_version',2,'library_version',3,'totals',jsonb_build_object(
      'contents',(select count(*) from public.marketing_contents),
      'links',(select count(*) from public.marketing_links),
      'arrivals',(select count(*) from public.marketing_touchpoints),
      'consented_arrivals',(select count(*) from public.marketing_touchpoints where visitor_id is not null),
      'registrations',(select count(distinct a.registration_id) from public.marketing_mc2_attribution a
        join public.marketing_touchpoints t on t.id=a.touchpoint_id
        join public.mc2_registrations r on r.id=a.registration_id where t.occurred_at<=r.registration_completed_at)
    ));
  elsif p_kind='contents' then
    with matches as (
      select c.* from public.marketing_contents c
      where v_search='' or strpos(lower(concat_ws(' ',c.title,c.topic,c.angle,c.format)),v_search)>0
    ), candidates as (
      select * from matches where p_before_at is null or (created_at,id)<(p_before_at,p_before_id)
      order by created_at desc,id desc limit p_take+1
    ), page as (select * from candidates order by created_at desc,id desc limit p_take)
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc) from page p),'[]'::jsonb),
      'total',(select count(*) from matches),
      'next_cursor',case when (select count(*) from candidates)>p_take then
        (select jsonb_build_object('at',created_at,'id',id) from page order by created_at,id limit 1) else null end)
      into v_result;
  else
    with matches as (
      select l.*,p.content_id,p.label as publication_label,p.published_on,p.publication_url,c.title,c.format,c.topic,c.angle
      from public.marketing_links l join public.marketing_publications p on p.id=l.publication_id
      join public.marketing_contents c on c.id=p.content_id
      where (coalesce(p_channel,'')='' or l.channel=p_channel)
        and (v_search='' or strpos(lower(concat_ws(' ',c.title,c.topic,c.angle,p.label,l.campaign,l.code)),v_search)>0)
    ), candidates as (
      select * from matches where p_before_at is null or (created_at,id)<(p_before_at,p_before_id)
      order by created_at desc,id desc limit p_take+1
    ), page as (select * from candidates order by created_at desc,id desc limit p_take),
    decorated as (
      select page.*,
        (select count(*) from public.marketing_touchpoints t where t.link_id=page.id) as arrivals,
        (select count(distinct a.registration_id) from public.marketing_mc2_attribution a
          join public.marketing_touchpoints t on t.id=a.touchpoint_id
          join public.mc2_registrations r on r.id=a.registration_id
          where t.link_id=page.id and t.occurred_at<=r.registration_completed_at) as registrations
      from page
    )
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc,d.id desc) from decorated d),'[]'::jsonb),
      'total',(select count(*) from matches),
      'next_cursor',case when (select count(*) from candidates)>p_take then
        (select jsonb_build_object('at',created_at,'id',id) from page order by created_at,id limit 1) else null end)
      into v_result;
  end if;
  return v_result;
end;
$$;
revoke all on function public.marketing_library_page(text,text,text,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.marketing_library_page(text,text,text,timestamptz,uuid,integer) to service_role;
commit;

-- Vérification en lecture seule.
select proname from pg_proc join pg_namespace n on n.oid=pronamespace
where n.nspname='public' and proname='marketing_library_page';
