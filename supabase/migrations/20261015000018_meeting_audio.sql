-- Meeting audio: each section's speech, kept after it is first generated so
-- listening again neither waits for the provider nor pays it twice.
--
-- Path convention: <user_id>/<meeting_id>/<section index>.mp3. The index is
-- stable because a meeting's transcript is never rewritten after import, and
-- deleting the meeting removes the folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meeting-audio', 'meeting-audio', false, 10485760, array['audio/mpeg'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "meeting_audio_objects_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "meeting_audio_objects_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "meeting_audio_objects_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
