-- Only accept images up to 10 MB in the public media bucket (phone photos are often 5-12 MB).
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'hnx-media';

-- Members may only upload into their own folder (<user id>/...); admins may upload anywhere.
drop policy if exists hnx_media_admin_insert on storage.objects;
drop policy if exists hnx_media_user_upload on storage.objects;
create policy hnx_media_user_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'hnx-media'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
