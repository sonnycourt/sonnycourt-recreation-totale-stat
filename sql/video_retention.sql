-- Video retention table (all-time aggregates)
create table if not exists public.video_retention (
  video_id text not null,
  second_watched integer not null check (second_watched >= 0),
  variant text not null default 'original',
  views_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_retention_pkey primary key (video_id, second_watched, variant)
);

alter table public.video_retention
  add column if not exists variant text not null default 'original';

update public.video_retention
set variant = 'original'
where variant is null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'video_retention_pkey'
      and conrelid = 'public.video_retention'::regclass
  ) then
    alter table public.video_retention drop constraint video_retention_pkey;
  end if;
exception
  when undefined_table then
    null;
end $$;

alter table public.video_retention
  add constraint video_retention_pkey primary key (video_id, second_watched, variant);

create index if not exists idx_video_retention_video_id_second
  on public.video_retention (video_id, second_watched);

create index if not exists idx_video_retention_video_variant_second
  on public.video_retention (video_id, variant, second_watched);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_video_retention_updated_at on public.video_retention;
create trigger trg_video_retention_updated_at
before update on public.video_retention
for each row
execute function public.set_updated_at();

-- Atomic increment function used by Netlify Function /api/video-retention
create or replace function public.increment_video_retention(
  p_video_id text,
  p_seconds integer[],
  p_variant text default 'original'
)
returns void
language sql
security definer
as $$
  insert into public.video_retention (video_id, second_watched, variant, views_count)
  select p_video_id, s, coalesce(nullif(trim(p_variant), ''), 'original'), 1
  from unnest(p_seconds) as s
  where s >= 0
  on conflict (video_id, second_watched, variant)
  do update set
    views_count = public.video_retention.views_count + excluded.views_count,
    updated_at = now();
$$;
