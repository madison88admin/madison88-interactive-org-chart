-- Create public bucket for org photos
insert into storage.buckets (id, name, public)
values ('org-photos', 'org-photos', true)
on conflict (id) do update set public = true;

-- Allow public read of files
drop policy if exists "org_photos_public_read" on storage.objects;
create policy "org_photos_public_read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'org-photos');

-- Allow upload/update/delete for app users (anon/auth)
drop policy if exists "org_photos_insert_all" on storage.objects;
create policy "org_photos_insert_all"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'org-photos');

drop policy if exists "org_photos_update_all" on storage.objects;
create policy "org_photos_update_all"
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'org-photos')
with check (bucket_id = 'org-photos');

drop policy if exists "org_photos_delete_all" on storage.objects;
create policy "org_photos_delete_all"
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'org-photos');

