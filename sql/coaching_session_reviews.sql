-- Avis post-séance Coaching Sonny Court
-- Migration additive et idempotente. Aucun objet existant n'est supprimé.

create table if not exists public.coaching_session_reviews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.coaching_sessions(id) on delete cascade,
  client_id uuid not null references public.coaching_clients(id) on delete cascade,
  coach_id uuid not null references public.coaching_coaches(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (comment is null or char_length(comment) <= 1500)
);

create index if not exists coaching_session_reviews_coach_idx
  on public.coaching_session_reviews(coach_id, submitted_at desc);
create index if not exists coaching_session_reviews_client_idx
  on public.coaching_session_reviews(client_id, submitted_at desc);

drop trigger if exists coaching_session_reviews_updated_at on public.coaching_session_reviews;
create trigger coaching_session_reviews_updated_at
before update on public.coaching_session_reviews
for each row execute function public.coaching_set_updated_at();

alter table public.coaching_session_reviews enable row level security;

drop policy if exists coaching_reviews_read on public.coaching_session_reviews;
create policy coaching_reviews_read on public.coaching_session_reviews
for select to authenticated
using (
  client_id = public.coaching_current_client_id()
  or coach_id = public.coaching_current_coach_id()
  or public.coaching_current_role() = 'owner'
);

-- Toutes les écritures passent par la fonction contrôlée ci-dessous.
revoke all on public.coaching_session_reviews from anon, authenticated;
grant select on public.coaching_session_reviews to authenticated;
grant all on public.coaching_session_reviews to service_role;

create or replace function public.coaching_submit_session_review(
  p_session_id uuid,
  p_rating smallint,
  p_comment text default null
)
returns table(review_id uuid, rating smallint, submitted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid := public.coaching_current_client_id();
  v_session public.coaching_sessions%rowtype;
  v_review public.coaching_session_reviews%rowtype;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  if public.coaching_current_role() <> 'client' or v_client_id is null then
    raise exception 'client_required';
  end if;
  if p_rating not between 1 and 5 then raise exception 'invalid_rating'; end if;
  if v_comment is not null and char_length(v_comment) > 1500 then raise exception 'comment_too_long'; end if;

  select session.* into v_session
  from public.coaching_sessions session
  where session.id = p_session_id
    and session.client_id = v_client_id
    and session.status in ('confirmed', 'completed')
    and session.ends_at <= now()
  for update;

  if v_session.id is null then raise exception 'session_not_reviewable'; end if;

  insert into public.coaching_session_reviews(session_id, client_id, coach_id, rating, comment)
  values (v_session.id, v_session.client_id, v_session.coach_id, p_rating, v_comment)
  on conflict (session_id) do nothing
  returning * into v_review;

  if v_review.id is null then raise exception 'review_already_submitted'; end if;

  update public.coaching_sessions
  set status = 'completed', completed_at = coalesce(completed_at, now())
  where id = v_session.id and status = 'confirmed';

  insert into public.coaching_activity_log(actor_user_id, event_type, entity_type, entity_id, client_id, metadata)
  values (
    auth.uid(), 'review.submitted', 'session_review', v_review.id, v_session.client_id,
    jsonb_build_object('session_id', v_session.id, 'rating', p_rating)
  );

  return query select v_review.id, v_review.rating, v_review.submitted_at;
end;
$$;

revoke all on function public.coaching_submit_session_review(uuid, smallint, text) from public, anon, authenticated;
grant execute on function public.coaching_submit_session_review(uuid, smallint, text) to authenticated;

