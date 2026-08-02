-- À exécuter dans Supabase après coaching_wallet_memberships.sql.
-- Bucket public limité aux images, 5 Mo maximum. Chaque utilisateur ne peut
-- écrire que dans son propre dossier auth.uid().

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coaching-avatars', 'coaching-avatars', true, 5242880, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists coaching_avatar_insert_own on storage.objects;
create policy coaching_avatar_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'coaching-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists coaching_avatar_update_own on storage.objects;
create policy coaching_avatar_update_own on storage.objects for update to authenticated
using (bucket_id = 'coaching-avatars' and owner_id = auth.uid()::text)
with check (bucket_id = 'coaching-avatars' and owner_id = auth.uid()::text);

drop policy if exists coaching_avatar_delete_own on storage.objects;
create policy coaching_avatar_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'coaching-avatars' and owner_id = auth.uid()::text);
