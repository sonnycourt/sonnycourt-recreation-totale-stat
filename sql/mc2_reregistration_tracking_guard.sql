-- À exécuter par Sonny. Complément aux deux prérequis de réinscription.
-- Aucun historique effacé, aucun message envoyé, aucune session déplacée.
-- Ferme la course : lecture de génération -> réinscription -> insertion CTA.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.mc2_tracking_session_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare current_generation integer; supplied_generation text;
begin
  -- SHARE bloque la transition FOR UPDATE jusqu'au commit du tracking.
  -- KEY SHARE (verrou FK habituel) n'est pas suffisant pour cette règle.
  select session_generation into current_generation
    from public.mc2_registrations where token = new.token for share;
  if not found then raise exception 'registration_missing'; end if;
  supplied_generation := new.metadata->>'session_generation';
  if supplied_generation is null and current_generation = 0 then
    return new; -- compatibilité avec les lecteurs déjà ouverts
  end if;
  if supplied_generation is null
     or supplied_generation <> current_generation::text then
    raise exception 'session_changed';
  end if;
  return new;
end;
$$;
revoke all on function public.mc2_tracking_session_guard() from public,anon,authenticated;
drop trigger if exists mc2_tracking_session_guard on public.mc2_tracking_events_v2;
create trigger mc2_tracking_session_guard
  before insert on public.mc2_tracking_events_v2
  for each row execute function public.mc2_tracking_session_guard();
commit;

select exists (
  select 1 from pg_trigger
  where tgrelid = 'public.mc2_tracking_events_v2'::regclass
    and tgname = 'mc2_tracking_session_guard' and not tgisinternal
    and tgenabled = 'O'
) as tracking_guard_ready;
