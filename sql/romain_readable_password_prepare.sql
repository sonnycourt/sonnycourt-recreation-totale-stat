-- À exécuter par Sonny. Prépare le nouveau mot de passe, SANS changer l'accès actif.
-- Exception demandée explicitement : Romain uniquement, stockage en clair.
-- Le secret aléatoire est généré en base, jamais inclus dans le dépôt / frontend.
begin;
create table if not exists public.closer_readable_credentials (
  closer_id bigint primary key check (closer_id=22),
  email text not null unique check (email='2romainorfila@gmail.com'),
  password_plaintext text not null check (length(password_plaintext) between 20 and 128),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.closer_readable_credentials enable row level security;
revoke all on public.closer_readable_credentials from public,anon,authenticated;
-- Le serveur ne peut que lire. Toute modification est faite par l'administrateur Supabase.
grant select on public.closer_readable_credentials to service_role;
do $$
begin
  if not exists (select 1 from public.closer_access_codes where id=22 and lower(email)='2romainorfila@gmail.com' and active) then
    raise exception 'Compte Romain actif introuvable : préparation annulée';
  end if;
end $$;
insert into public.closer_readable_credentials(closer_id,email,password_plaintext)
values(22,'2romainorfila@gmail.com','SC-' || encode(extensions.gen_random_bytes(12),'hex') || '!')
on conflict (closer_id) do nothing;
commit;
-- Consultable dans Supabase, ne pas diffuser / ajouter à un fichier partagé.
select email,password_plaintext,active from public.closer_readable_credentials where closer_id=22;
