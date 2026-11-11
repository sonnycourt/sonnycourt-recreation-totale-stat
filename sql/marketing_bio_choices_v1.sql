-- À exécuter par Sonny. Additif, réexécutable, aucune donnée existante modifiée.
-- Une visite = un chargement visible de /links ; aucun identifiant persistant.
begin;
create table if not exists public.marketing_bio_visits (
  id uuid primary key,
  link_id uuid references public.marketing_links(id),
  source text not null check (source in ('tiktok','youtube','instagram','facebook','email','sms','meta_ads','direct','other')),
  seen_at timestamptz not null default now(),
  choice text check (choice in ('mc2','delta')),
  choice_at timestamptz,
  check ((choice is null) = (choice_at is null))
);
create index if not exists marketing_bio_visits_seen_idx on public.marketing_bio_visits(seen_at desc);
create index if not exists marketing_bio_visits_link_idx on public.marketing_bio_visits(link_id,seen_at desc);
alter table public.marketing_bio_visits enable row level security;
revoke all on public.marketing_bio_visits from public,anon,authenticated;
grant select,insert on public.marketing_bio_visits to service_role;
grant update(choice,choice_at) on public.marketing_bio_visits to service_role;

create or replace function public.marketing_record_bio_visit(
  p_id uuid, p_code text default null, p_source text default 'direct', p_choice text default null
) returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_link uuid; v_source text; v_count integer;
begin
  if p_id is null or p_source is null or p_source not in ('tiktok','youtube','instagram','facebook','email','sms','meta_ads','direct','other')
    or (p_choice is not null and p_choice not in ('mc2','delta')) then raise exception 'Invalid bio event'; end if;
  if p_code is not null then
    select id,channel into v_link,v_source from public.marketing_links where code=p_code;
    if v_link is null then return false; end if;
  else v_source:=p_source; end if;
  insert into public.marketing_bio_visits as visits(id,link_id,source,choice,choice_at)
    values(p_id,v_link,v_source,p_choice,case when p_choice is not null then now() end)
    on conflict(id) do update set
      choice=coalesce(visits.choice,excluded.choice),
      choice_at=coalesce(visits.choice_at,excluded.choice_at)
    where visits.link_id is not distinct from excluded.link_id and visits.source=excluded.source;
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;

create or replace function public.marketing_bio_report(p_days integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if p_days is null or p_days not in (0,7,30) then raise exception 'Invalid period'; end if;
  with visits as (
    select * from public.marketing_bio_visits where p_days=0 or seen_at>=now()-make_interval(days=>p_days)
  ), totals as (
    select count(*) as visits,count(*) filter(where choice is not null) as choices,
      count(*) filter(where choice='mc2') as mc2,count(*) filter(where choice='delta') as delta,
      count(*) filter(where choice is null) as no_choice from visits
  ), sources as (
    select source,count(*) as visits,count(*) filter(where choice is not null) as choices,
      count(*) filter(where choice='mc2') as mc2,count(*) filter(where choice='delta') as delta,
      count(*) filter(where choice is null) as no_choice from visits group by source
  ), links as (
    select l.code,l.channel,count(*) as visits,count(*) filter(where v.choice is not null) as choices,
      count(*) filter(where v.choice='mc2') as mc2,count(*) filter(where v.choice='delta') as delta,
      count(*) filter(where v.choice is null) as no_choice
    from visits v join public.marketing_links l on l.id=v.link_id
    where l.code in ('e7dd5eb52276','d70aca695f3c') group by l.code,l.channel
  )
  select jsonb_build_object('version',1,'days',p_days,'generated_at',now(),
    'first_observed_at',(select min(seen_at) from public.marketing_bio_visits),
    'totals',(select to_jsonb(t) from totals t),
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.visits desc,s.source) from sources s),'[]'::jsonb),
    'bio_links',coalesce((select jsonb_agg(to_jsonb(l) order by l.channel) from links l),'[]'::jsonb)) into v_result;
  return v_result;
end;
$$;
revoke all on function public.marketing_record_bio_visit(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.marketing_bio_report(integer) from public,anon,authenticated;
grant execute on function public.marketing_record_bio_visit(uuid,text,text,text) to service_role;
grant execute on function public.marketing_bio_report(integer) to service_role;
comment on table public.marketing_bio_visits is 'Mesure anonyme par chargement visible de /links. Premier choix uniquement. Ni personnes uniques, ni IP, ni cookie, ni email. Une visite sans choix peut être encore en cours.';
commit;
select table_name from information_schema.tables where table_schema='public' and table_name='marketing_bio_visits';
