-- À exécuter par Sonny. Ajout ciblé, transactionnel et réexécutable.
-- Ne modifie ni les notes existantes, ni les achats, ni aucun message client.
begin;
alter table public.onboarding_events drop constraint if exists onboarding_events_kind_check;
alter table public.onboarding_events add constraint onboarding_events_kind_check
  check(kind in ('updated','call_no_answer','sms_sent','whatsapp_sent','contacted','completed','note','call_answered','unreachable','whatsapp_received'));
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.onboarding_save_case_v2(bigint,uuid,integer,uuid,jsonb,text,text,timestamp with time zone)'::regprocedure);
  if strpos(definition,'''whatsapp_received''')=0 then
    -- Refuser si la fonction a évolué : ne jamais écraser une autre modification.
    if strpos(definition,'''note'',''call_answered'',''unreachable'')')=0
      or strpos(definition,'elsif p_kind in (''contacted'',''call_answered'') then')=0 then
      raise exception 'Version onboarding inattendue : migration annulée, contacter Sonny';
    end if;
    definition:=replace(definition,'''note'',''call_answered'',''unreachable'')','''note'',''call_answered'',''unreachable'',''whatsapp_received'')');
    definition:=replace(definition,'elsif p_kind in (''contacted'',''call_answered'') then',
      'elsif p_kind=''whatsapp_received'' then
    if v_saved.status not in (''booked'',''done'',''paused'') then
      v_saved.status:=''contacted''; v_saved.next_action:=''onboarding''; v_saved.followup_at:=null;
    end if;
  elsif p_kind in (''contacted'',''call_answered'') then');
    execute definition;
  end if;
end $migration$;
notify pgrst, 'reload schema';
commit;
