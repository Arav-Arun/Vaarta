-- Vaarta: cached worlds for the starter journeys.
--
-- Why this exists
-- ---------------
-- Building a world costs roughly eleven model calls: one to write the world and
-- its ladder, three to paint/trace/read the opening screen, one for the
-- character, and two per room. For a journey the learner *chose off a fixed
-- list*, paying that again on every visit is pure waste: "The Last Bus Out" in
-- Marathi is the same world every time.
--
-- So a starter journey is generated once per (starter, language) and reused.
-- Custom worlds, which are unique by definition, are never cached.
--
-- Shape notes
-- -----------
-- * Images live inline as data URLs inside `scenes`. That makes a row a few
--   megabytes, which is why the table is deliberately bounded: three starters
--   times six languages is at most 18 rows, and rows only appear for
--   combinations somebody actually played. The engine's traced "vision" frames
--   are stripped before caching, since they are a debug overlay and would
--   roughly double the size.
-- * Scenes are merged, not replaced, so rooms painted later in a run join the
--   same row.

create table public.vaarta_preset_worlds (
  -- Matches a `Starter.id` in lib/vaarta/starters.ts.
  starter_id text not null check (starter_id ~ '^[a-z0-9-]{1,40}$'),
  -- Sarvam BCP-47 code, e.g. 'mr-IN'.
  language_id text not null check (language_id ~ '^[a-z]{2}-[A-Z]{2}$'),
  -- The world document plus the can-do ladder, exactly as the planner wrote it.
  plan jsonb not null,
  -- SceneData[], keyed by scene id when merged.
  scenes jsonb not null default '[]'::jsonb,
  -- The player character, as a data URL.
  sprite text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (starter_id, language_id)
);

alter table public.vaarta_preset_worlds enable row level security;

-- Readable by everyone, including signed-out learners: the whole point is that
-- the first person to walk a starter journey pays for it and nobody else does.
create policy "vaarta_preset_worlds_read"
on public.vaarta_preset_worlds
for select
to anon, authenticated
using (true);

-- Writable by everyone too, because Vaarta has no account wall and the run that
-- fills the cache is usually anonymous.
--
-- TRADE-OFF, stated plainly: this is a shared cache that any client can write
-- to. The API route validates the payload's shape before it lands (three rooms,
-- three characters, a usable ladder, data-URL images under a size cap), and the
-- primary key bounds the table to 18 rows, but a determined caller could still
-- seed a poor-quality world for a starter/language pair. The blast radius is
-- one preset that looks wrong until deleted; the alternative is charging every
-- learner eleven model calls for a fixed journey. Delete a bad row to reset it:
--   delete from public.vaarta_preset_worlds where starter_id = '...';
create policy "vaarta_preset_worlds_insert"
on public.vaarta_preset_worlds
for insert
to anon, authenticated
with check (true);

create policy "vaarta_preset_worlds_update"
on public.vaarta_preset_worlds
for update
to anon, authenticated
using (true)
with check (true);
