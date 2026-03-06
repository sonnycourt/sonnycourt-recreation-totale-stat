-- Video retention table (all-time aggregates)
create table if not exists public.video_retention (
  video_id text not null,
  second_watched integer not null check (second_watched >= 0),
  views_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_retention_pkey primary key (video_id, second_watched)
);

create index if not exists idx_video_retention_video_id_second
  on public.video_retention (video_id, second_watched);

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
  p_seconds integer[]
)
returns void
language sql
security definer
as $$
  insert into public.video_retention (video_id, second_watched, views_count)
  select p_video_id, s, 1
  from unnest(p_seconds) as s
  where s >= 0
  on conflict (video_id, second_watched)
  do update set
    views_count = public.video_retention.views_count + excluded.views_count,
    updated_at = now();
$$;
