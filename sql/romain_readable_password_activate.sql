-- SONNY UNIQUEMENT. NE PAS EXÉCUTER AVANT PUBLICATION du nouveau closer-login.
-- À ce moment seulement : remplace le mot de passe actif sur les DEUX espaces.
-- L'ancien hash est retiré et remplacé par un marqueur non secret de compatibilité.
begin;
do $$
begin
  if not exists (select 1 from public.closer_readable_credentials where closer_id=22 and email='2romainorfila@gmail.com')
    or not exists (select 1 from public.closer_access_codes where id=22 and lower(email)='2romainorfila@gmail.com' and active) then
    raise exception 'Préparation / compte Romain absent : activation annulée';
  end if;
end $$;
update public.closer_readable_credentials set active=true where closer_id=22;
update public.closer_access_codes set password_hash='managed-readable:romain:22'
where id=22 and lower(email)='2romainorfila@gmail.com';
commit;
