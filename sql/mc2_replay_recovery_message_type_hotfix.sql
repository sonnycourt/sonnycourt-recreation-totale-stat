-- Correctif idempotent pour la production MC2.
-- Ajoute uniquement le champ attendu par le code de récupération replay.
-- À exécuter manuellement dans l'éditeur SQL Supabase.

begin;

alter table public.mc2_replay_recovery_jobs
  add column if not exists message_type text;

update public.mc2_replay_recovery_jobs
set message_type = case segment
  when 'no_show' then 'no_show_initial'
  when 'left_before_cta' then 'left_before_cta_initial'
  when 'offer_seen_no_purchase' then 'offer_expired_downsell'
end
where message_type is null;

do $$
begin
  if exists (
    select 1
    from public.mc2_replay_recovery_jobs
    where message_type is null
  ) then
    raise exception 'MC2 replay hotfix interrompu : un segment inconnu empêche le remplissage de message_type.';
  end if;
end;
$$;

alter table public.mc2_replay_recovery_jobs
  alter column message_type set not null;

alter table public.mc2_replay_recovery_jobs
  drop constraint if exists mc2_replay_recovery_jobs_message_type_check;

alter table public.mc2_replay_recovery_jobs
  add constraint mc2_replay_recovery_jobs_message_type_check check (message_type in (
    'no_show_initial',
    'left_before_cta_initial',
    'offer_expired_downsell',
    'replay_24h',
    'replay_4h'
  ));

commit;
