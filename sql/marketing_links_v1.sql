-- À exécuter par Sonny dans le SQL Editor Supabase.
-- Ajout uniquement : aucune modification des tables ou règles du funnel MC2.
-- Réexécutable. Aucun contact, lien ou événement de démonstration n'est inséré.
begin;

create table if not exists public.marketing_contents (
  id uuid primary key,
  title text not null check (char_length(title) between 1 and 160),
  format text not null check (format in ('short','long','email','sms','post','bio','other')),
  topic text not null default '' check (char_length(topic) <= 120),
  angle text not null default '' check (char_length(angle) <= 240),
  created_at timestamptz not null default now()
);
create table if not exists public.marketing_publications (
  id uuid primary key,
  content_id uuid not null references public.marketing_contents(id),
  label text not null default '' check (char_length(label) <= 160),
  channel text not null check (channel in ('instagram','facebook','youtube','tiktok','email','sms','meta_ads')),
  created_at timestamptz not null default now()
);
create table if not exists public.marketing_links (
  id uuid primary key,
  publication_id uuid not null references public.marketing_publications(id),
  code text not null unique check (code ~ '^[a-f0-9]{12}$'),
  channel text not null check (channel in ('instagram','facebook','youtube','tiktok','email','sms','meta_ads')),
  placement text not null check (placement in ('dm','description','comment','bio','button','body','signature','story','related_video')),
  campaign text not null check (campaign ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  destination text not null check (destination in ('mc2','meta_mc2','delta','papa')),
  created_at timestamptz not null default now()
);
create table if not exists public.marketing_touchpoints (
  id uuid primary key,
  link_id uuid not null references public.marketing_links(id),
  visitor_id uuid, -- uniquement si la mesure persistante a été acceptée
  occurred_at timestamptz not null default now(), -- horodatage serveur
  kind text not null default 'landing_visible' check (kind = 'landing_visible')
);
create table if not exists public.marketing_mc2_attribution (
  touchpoint_id uuid primary key references public.marketing_touchpoints(id) on delete cascade,
  registration_id bigint not null references public.mc2_registrations(id) on delete cascade,
  linked_at timestamptz not null default now(),
  method text not null check (method in ('registration_receipt','consented_browser_history'))
);
create index if not exists marketing_publications_content_idx on public.marketing_publications(content_id);
create index if not exists marketing_links_created_idx on public.marketing_links(created_at desc);
create index if not exists marketing_touchpoints_link_idx on public.marketing_touchpoints(link_id);
create index if not exists marketing_touchpoints_visitor_idx on public.marketing_touchpoints(visitor_id, occurred_at) where visitor_id is not null;
create index if not exists marketing_mc2_registration_idx on public.marketing_mc2_attribution(registration_id);

alter table public.marketing_contents enable row level security;
alter table public.marketing_publications enable row level security;
alter table public.marketing_links enable row level security;
alter table public.marketing_touchpoints enable row level security;
alter table public.marketing_mc2_attribution enable row level security;
revoke all on public.marketing_contents, public.marketing_publications, public.marketing_links, public.marketing_touchpoints, public.marketing_mc2_attribution from public, anon, authenticated;
grant select, insert on public.marketing_contents, public.marketing_publications, public.marketing_links, public.marketing_touchpoints, public.marketing_mc2_attribution to service_role;
grant update(visitor_id) on public.marketing_touchpoints to service_role;

-- Une opération = contenu (s'il est nouveau), publication et lien dans une transaction.
-- Le même identifiant rejoué après une coupure réseau ne crée aucun doublon.
create or replace function public.marketing_create_link(p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_id uuid := (p_input->>'id')::uuid;
  v_content uuid := (p_input->>'content_id')::uuid;
  v_link public.marketing_links;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_id::text, 0));
  select * into v_link from public.marketing_links where id = v_id;
  if found then return to_jsonb(v_link); end if;
  insert into public.marketing_contents(id,title,format,topic,angle)
    values(v_content,p_input->>'title',p_input->>'format',coalesce(p_input->>'topic',''),coalesce(p_input->>'angle',''))
    on conflict (id) do nothing;
  insert into public.marketing_publications(id,content_id,label,channel)
    values(v_id,v_content,coalesce(p_input->>'publication_label',''),p_input->>'channel');
  insert into public.marketing_links(id,publication_id,code,channel,placement,campaign,destination)
    values(v_id,v_id,left(replace(v_id::text,'-',''),12),p_input->>'channel',p_input->>'placement',p_input->>'campaign',p_input->>'destination')
    returning * into v_link;
  return to_jsonb(v_link);
end;
$$;

create or replace function public.marketing_record_arrival(p_event_id uuid, p_link_id uuid, p_visitor_id uuid)
returns setof public.marketing_touchpoints language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  insert into public.marketing_touchpoints(id,link_id,visitor_id)
    values(p_event_id,p_link_id,p_visitor_id) on conflict (id) do nothing;
  -- Consentement donné après l'arrivée : compléter seulement l'identifiant,
  -- sans déplacer le passage, changer sa source ou remplacer une identité.
  if p_visitor_id is not null then
    update public.marketing_touchpoints set visitor_id=p_visitor_id
      where id=p_event_id and link_id=p_link_id and visitor_id is null;
  end if;
  return query select * from public.marketing_touchpoints where id=p_event_id;
end;
$$;

-- Appel exclusivement serveur après une inscription MC2 réellement confirmée.
-- Le navigateur ne fournit ni l'email cible ni un identifiant d'inscription à fusionner.
create or replace function public.marketing_link_mc2_registration(p_token text, p_event_id uuid, p_code text, p_visitor_id uuid)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_registration bigint; v_point public.marketing_touchpoints;
begin
  select id into v_registration from public.mc2_registrations
    where token=p_token and registration_completed_at is not null;
  if v_registration is null then return false; end if;
  if p_event_id is not null then
    select t.* into v_point from public.marketing_touchpoints t
      join public.marketing_links l on l.id=t.link_id where t.id=p_event_id and l.code=p_code;
  elsif p_visitor_id is not null then
    select * into v_point from public.marketing_touchpoints
      where visitor_id=p_visitor_id and occurred_at >= now() - interval '90 days'
      order by occurred_at desc limit 1;
  end if;
  if v_point.id is null then return false; end if;
  insert into public.marketing_mc2_attribution(touchpoint_id,registration_id,method)
    values(v_point.id,v_registration,'registration_receipt') on conflict (touchpoint_id) do nothing;
  -- Un appareil peut être partagé : ne jamais réattribuer un passage déjà lié.
  if p_visitor_id is not null and v_point.visitor_id=p_visitor_id then
    insert into public.marketing_mc2_attribution(touchpoint_id,registration_id,method)
      select t.id,v_registration,'consented_browser_history' from public.marketing_touchpoints t
      where t.visitor_id=v_point.visitor_id and t.occurred_at <= v_point.occurred_at
        and t.occurred_at >= v_point.occurred_at - interval '90 days'
      on conflict (touchpoint_id) do nothing;
  end if;
  return true;
end;
$$;

create or replace function public.marketing_links_overview()
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'contents', (select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb)
      from (select * from public.marketing_contents order by created_at desc limit 500) x),
    'links', (select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from (
      select l.*,p.content_id,p.label as publication_label,c.title,c.format,c.topic,c.angle,
        (select count(*) from public.marketing_touchpoints t where t.link_id=l.id) as arrivals,
        (select count(distinct a.registration_id) from public.marketing_mc2_attribution a
          join public.marketing_touchpoints t on t.id=a.touchpoint_id
          join public.mc2_registrations r on r.id=a.registration_id
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
        join public.marketing_touchpoints t on t.id=a.touchpoint_id
        join public.mc2_registrations r on r.id=a.registration_id where t.occurred_at <= r.registration_completed_at)
    ), 'generated_at',now()
  );
$$;

revoke all on function public.marketing_create_link(jsonb) from public, anon, authenticated;
revoke all on function public.marketing_record_arrival(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.marketing_link_mc2_registration(text,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.marketing_links_overview() from public, anon, authenticated;
grant execute on function public.marketing_create_link(jsonb) to service_role;
grant execute on function public.marketing_record_arrival(uuid,uuid,uuid) to service_role;
grant execute on function public.marketing_link_mc2_registration(text,uuid,text,uuid) to service_role;
grant execute on function public.marketing_links_overview() to service_role;

comment on table public.marketing_touchpoints is 'Arrivées visibles observées, pas des vues de contenu ni des clics humains certifiés. Identité persistante uniquement avec consentement statistiques.';
comment on table public.marketing_mc2_attribution is 'Contacts ayant précédé une inscription, sans modèle causal. Les assistances par lien ne s’additionnent pas en personnes uniques.';
commit;

-- Vérification finale : 5 tables doivent être listées.
select tablename, rowsecurity from pg_tables where schemaname='public'
  and tablename in ('marketing_contents','marketing_publications','marketing_links','marketing_touchpoints','marketing_mc2_attribution')
  order by tablename;
