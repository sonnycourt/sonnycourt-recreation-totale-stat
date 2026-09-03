begin;

-- Les anciennes inscriptions actives recevaient leur échéance commerciale dès
-- l'inscription. On la libère uniquement si le CTA n'a jamais été vu. Le
-- replay reste accessible jusqu'à session_starts_at + 72 heures, calculé par
-- le serveur, et n'utilise plus ce champ.
update public.mc2_registrations
set offer_expires_at = null
where coalesce(saw_offer, false) = false
  and offer_expires_at is not null
  and session_starts_at is not null
  and session_starts_at + interval '72 hours' > now()
  and coalesce(statut, '') <> 'purchased'
  and coalesce(payment_status, '') not in ('paid', 'succeeded', 'active', 'complete', 'completed')
  and purchased_at is null;

commit;
