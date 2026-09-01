-- Vaarta: the community library.
--
-- Why this is separate from vaarta_preset_worlds
-- ----------------------------------------------
-- They look alike and are not alike. `vaarta_preset_worlds` is a cache: keyed
-- by (starter, language), writable by the warm token, and safe to delete at any
-- time because it can always be rebuilt. This table is a library: each row is a
-- world a person made and chose to publish, owned by them, and losing one loses
-- something. Merging the two would mean either letting a machine token write to
-- people's work or making the cache un-prunable.
--
-- Shape notes
-- -----------
-- * Art lives in Storage, not in the row. A cached preset can afford inline
--   data URLs because there are at most 18 of them; a library grows without
--   limit, and 4MB rows would make listing the gallery a download.
-- * `scenes` keeps the full SceneData shape (hotspots, obstacles, edges) with
--   `image` pointing at a Storage URL instead of holding base64.
-- * Nothing here is a fork of the preset cache's validation: the API route
--   checks the same bundle shape before any of it is uploaded.

-- ---------------------------------------------------------------------------
-- storage: public bucket, per-author write folder
-- ---------------------------------------------------------------------------
-- Public buckets serve files by URL without a SELECT policy, which is what the
-- gallery needs. The SELECT policy below is narrower on purpose: it exists so
-- an author can list and clean up their own folder, not so anyone can enumerate
-- everybody's art through the Storage API.

insert into storage.buckets (id, name, public)
values ('vaarta-worlds', 'vaarta-worlds', true)
on conflict (id) do nothing;

create policy "vaarta_worlds_author_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vaarta-worlds'
  and (storage.foldername (name))[1] = auth.uid()::text
);

create policy "vaarta_worlds_author_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'vaarta-worlds'
  and (storage.foldername (name))[1] = auth.uid()::text
);

create policy "vaarta_worlds_author_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'vaarta-worlds'
  and (storage.foldername (name))[1] = auth.uid()::text
);

create policy "vaarta_worlds_author_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'vaarta-worlds'
  and (storage.foldername (name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------------------
-- vaarta_worlds
-- ---------------------------------------------------------------------------

create table public.vaarta_worlds (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  -- The idea the author typed, kept so the gallery can say what this is.
  idea text not null default '',
  -- One sentence naming what the world makes you able to do.
  promise text not null default '',
  -- Sarvam BCP-47 code, e.g. 'mr-IN'.
  language_id text not null check (language_id ~ '^[a-z]{2}-[A-Z]{2}$'),
  language_name text not null default '',
  -- The planner's output: bible + curriculum, no art.
  plan jsonb not null,
  -- SceneData[] whose `image` fields are Storage URLs.
  scenes jsonb not null default '[]'::jsonb,
  sprite_url text,
  -- The opening screen, which is what the gallery card shows.
  thumbnail_url text not null default '',
  created_at timestamptz not null default now()
);

create index vaarta_worlds_recent on public.vaarta_worlds (created_at desc);
create index vaarta_worlds_by_author on public.vaarta_worlds (author, created_at desc);
create index vaarta_worlds_by_language on public.vaarta_worlds (language_id, created_at desc);

alter table public.vaarta_worlds enable row level security;

-- Publishing is the point: any signed-in learner can read the whole library.
create policy "vaarta_worlds_read"
on public.vaarta_worlds
for select
to authenticated
using (true);

-- Writing is not. A row can only ever be created, changed or removed by the
-- person whose work it is.
create policy "vaarta_worlds_insert_own"
on public.vaarta_worlds
for insert
to authenticated
with check (auth.uid() = author);

create policy "vaarta_worlds_update_own"
on public.vaarta_worlds
for update
to authenticated
using (auth.uid() = author)
with check (auth.uid() = author);

create policy "vaarta_worlds_delete_own"
on public.vaarta_worlds
for delete
to authenticated
using (auth.uid() = author);
