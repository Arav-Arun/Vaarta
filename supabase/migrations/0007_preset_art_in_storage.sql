-- Vaarta: move cached starter art out of the row and into Storage.
--
-- Why
-- ---
-- `vaarta_preset_worlds` stored every painted frame inline as a base64 data
-- URL. That works locally and fails in production: a serverless response body
-- is capped at 4.5MB, and nine of the eighteen cached worlds measured between
-- 4.5MB and 5.4MB. Half the starter journeys would have returned
-- FUNCTION_PAYLOAD_TOO_LARGE the moment they were deployed, while behaving
-- perfectly on a laptop.
--
-- So the art goes where the community library already keeps its art. The row
-- keeps the plan and the scene metadata and points at Storage for the frames,
-- which drops a response from ~5MB to ~50KB and lets the browser cache the
-- images across visits instead of re-downloading them inside a JSON blob.
--
-- Access
-- ------
-- This bucket carries the same deliberate trade-off as the table it serves,
-- stated in 0004: the preset cache is written by whoever generates a starter
-- first, and that is usually not a signed-in person (it is `npm run warm`).
-- The API route validates the bundle's shape before anything is uploaded, and
-- the (starter, language) key bounds the whole thing to eighteen worlds.

insert into storage.buckets (id, name, public)
values ('vaarta-presets', 'vaarta-presets', true)
on conflict (id) do nothing;

drop policy if exists "vaarta_presets_read" on storage.objects;
create policy "vaarta_presets_read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'vaarta-presets');

drop policy if exists "vaarta_presets_write" on storage.objects;
create policy "vaarta_presets_write"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'vaarta-presets');

drop policy if exists "vaarta_presets_update" on storage.objects;
create policy "vaarta_presets_update"
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'vaarta-presets')
with check (bucket_id = 'vaarta-presets');

drop policy if exists "vaarta_presets_delete" on storage.objects;
create policy "vaarta_presets_delete"
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'vaarta-presets');
