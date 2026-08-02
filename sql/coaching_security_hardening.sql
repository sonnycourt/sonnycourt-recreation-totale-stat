-- Correctif post-installation : Supabase accorde par défaut EXECUTE aux rôles
-- API lors de la création d'une fonction. On retire explicitement ces droits
-- avant de réaccorder uniquement les appels nécessaires au portail connecté.

revoke all on function public.coaching_current_role() from public, anon, authenticated;
revoke all on function public.coaching_current_client_id() from public, anon, authenticated;
revoke all on function public.coaching_current_coach_id() from public, anon, authenticated;
revoke all on function public.coaching_can_access_client(uuid) from public, anon, authenticated;
revoke all on function public.coaching_credit_balance(uuid) from public, anon, authenticated;
revoke all on function public.coaching_replace_my_availability_rules(smallint[], time, time, integer, integer, text) from public, anon, authenticated;
revoke all on function public.coaching_book_session(uuid, text) from public, anon, authenticated;
revoke all on function public.coaching_cancel_session(uuid, text) from public, anon, authenticated;
revoke all on function public.coaching_complete_session(uuid) from public, anon, authenticated;

grant execute on function public.coaching_current_role() to authenticated;
grant execute on function public.coaching_current_client_id() to authenticated;
grant execute on function public.coaching_current_coach_id() to authenticated;
grant execute on function public.coaching_can_access_client(uuid) to authenticated;
grant execute on function public.coaching_credit_balance(uuid) to authenticated;
grant execute on function public.coaching_replace_my_availability_rules(smallint[], time, time, integer, integer, text) to authenticated;
grant execute on function public.coaching_book_session(uuid, text) to authenticated;
grant execute on function public.coaching_cancel_session(uuid, text) to authenticated;
grant execute on function public.coaching_complete_session(uuid) to authenticated;

revoke all on function public.coaching_handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.coaching_record_spiffy_order(text, text, text, text, text, integer, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.coaching_refund_spiffy_order(text) from public, anon, authenticated;
revoke all on function public.coaching_assign_role_by_email(text, text, text) from public, anon, authenticated;
revoke all on function public.hold_coach_diagnostic_slot(bigint, text, text) from public, anon, authenticated;

grant execute on function public.coaching_record_spiffy_order(text, text, text, text, text, integer, integer, text, text, jsonb) to service_role;
grant execute on function public.coaching_refund_spiffy_order(text) to service_role;
grant execute on function public.coaching_assign_role_by_email(text, text, text) to service_role;
grant execute on function public.hold_coach_diagnostic_slot(bigint, text, text) to service_role;
