-- Link Studio : canaux et destinations personnalisés.
begin;
alter table public.marketing_links add column if not exists custom_channel text;
alter table public.marketing_links add column if not exists destination_url text;

alter table public.marketing_publications drop constraint if exists marketing_publications_channel_check;
alter table public.marketing_publications add constraint marketing_publications_channel_check
  check (channel in ('instagram', 'facebook', 'youtube', 'tiktok', 'email', 'sms', 'meta_ads', 'other'));
alter table public.marketing_links drop constraint if exists marketing_links_channel_check;
alter table public.marketing_links add constraint marketing_links_channel_check
  check (channel in ('instagram', 'facebook', 'youtube', 'tiktok', 'email', 'sms', 'meta_ads', 'other'));
alter table public.marketing_links drop constraint if exists marketing_links_destination_check;
alter table public.marketing_links add constraint marketing_links_destination_check
  check (destination in ('mc2', 'meta_mc2', 'delta', 'papa', 'other'));
alter table public.marketing_links drop constraint if exists marketing_links_custom_channel_check;
alter table public.marketing_links add constraint marketing_links_custom_channel_check
  check ((channel = 'other' and custom_channel is not null and char_length(trim(custom_channel)) between 1 and 80) or (channel <> 'other' and custom_channel is null));
alter table public.marketing_links drop constraint if exists marketing_links_destination_url_check;
alter table public.marketing_links add constraint marketing_links_destination_url_check
  check ((destination = 'other' and destination_url is not null and destination_url ~ '^https://' and char_length(destination_url) <= 2048) or (destination <> 'other' and destination_url is null));

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
  insert into public.marketing_links(id,publication_id,code,channel,placement,campaign,destination,custom_channel,destination_url)
    values(v_id,v_id,left(replace(v_id::text,'-',''),12),p_input->>'channel',p_input->>'placement',p_input->>'campaign',p_input->>'destination',p_input->>'custom_channel',p_input->>'destination_url') returning * into v_link;
  return to_jsonb(v_link);
end;
$$;

create or replace function public.marketing_library_page(
  p_kind text default 'links', p_search text default '', p_channel text default '',
  p_before_at timestamptz default null, p_before_id uuid default null, p_take integer default 24
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb; v_search text := lower(btrim(coalesce(p_search,'')));
begin
  if p_kind not in ('links','contents','summary') or p_kind is null
    or p_take is null or p_take<1 or p_take>100 or char_length(v_search)>200
    or (p_before_at is null)<>(p_before_id is null)
    or coalesce(p_channel,'') not in ('','instagram','facebook','youtube','tiktok','email','sms','meta_ads','other')
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
        and (v_search='' or strpos(lower(concat_ws(' ',c.title,c.topic,c.angle,p.label,l.campaign,l.code,l.custom_channel,l.destination_url)),v_search)>0)
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
