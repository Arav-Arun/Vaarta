-- ============================================================
-- Vaarta setup, for projects without the Supabase CLI.
--
-- Paste this whole file into the SQL Editor and press Run:
--   Dashboard > SQL Editor > New query > paste > Run
--
-- SAFE TO RE-RUN. Every statement here is idempotent: tables use
-- IF NOT EXISTS, policies are dropped before being recreated, and the
-- maintenance deletes match nothing once they have run. So it does not
-- matter which migrations you have already applied, or in what order.
--
-- GENERATED from supabase/migrations/, which is the source of truth. If you
-- change a migration, regenerate this rather than editing it.
-- ============================================================


-- ==================== 0003_vaarta_learning.sql ====================

-- Vaarta: learner progress, can-do evidence, and the word bank.
--
-- Design notes
-- ------------
-- * Everything here is owned by one learner and readable only by them. A
--   language record is more personal than a saved game, so nothing in this
--   schema is readable by "any authenticated user"; every policy is owner-only.
-- * Evidence is stored UNCOLLAPSED. `vaarta_objective_progress` keeps
--   first-try clears, coached recoveries, voice attempts, and typed attempts
--   as separate columns rather than one score, because "I got it cold" and "I
--   got it after help" are different skills and a learner wants to watch them
--   move independently.
-- * `vaarta_turns` is append-only. It is the audit trail behind every number
--   the dashboard shows; without it a mastery percentage is just an assertion.
-- * A run is keyed by `world_key`, a stable id the client derives from the
--   world's title and story goal. Worlds are generated per run and are not rows
--   in any table, so there is deliberately no foreign key here: language
--   progress must not depend on world storage existing at all.

-- ---------------------------------------------------------------------------
-- vaarta_learners — one row per user
-- ---------------------------------------------------------------------------

create table if not exists public.vaarta_learners (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  -- Sarvam BCP-47 code, e.g. 'mr-IN'. Text, not an enum: the catalogue in
  -- lib/vaarta/languages.ts is the source of truth and it will grow.
  language_id text not null default 'hi-IN',
  support_language text not null default 'English',
  streak integer not null default 0,
  last_played_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vaarta_learners enable row level security;

drop policy if exists "vaarta_learners_select_own" on public.vaarta_learners;
create policy "vaarta_learners_select_own"
on public.vaarta_learners
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "vaarta_learners_insert_own" on public.vaarta_learners;
create policy "vaarta_learners_insert_own"
on public.vaarta_learners
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "vaarta_learners_update_own" on public.vaarta_learners;
create policy "vaarta_learners_update_own"
on public.vaarta_learners
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- vaarta_runs — one learner's pass through one world
-- ---------------------------------------------------------------------------

create table if not exists public.vaarta_runs (
  id uuid primary key default gen_random_uuid(),
  learner uuid not null references auth.users (id) on delete cascade,
  -- Stable per world, derived by the client from the world's own identity.
  world_key text not null,
  world_title text not null default 'Untitled world',
  language_id text not null,
  support_language text not null default 'English',
  -- The curriculum snapshot this run was scored against. Kept verbatim so a
  -- resumed run is graded by the ladder it started with, not a regenerated one.
  curriculum jsonb not null,
  clues_found boolean[] not null default array[false, false, false],
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One run per learner per world, so replaying a world continues its record
-- rather than starting a second one beside it.
create unique index if not exists vaarta_runs_learner_world_idx
on public.vaarta_runs (learner, world_key);

create index if not exists vaarta_runs_learner_idx on public.vaarta_runs (learner, updated_at desc);

alter table public.vaarta_runs enable row level security;

drop policy if exists "vaarta_runs_select_own" on public.vaarta_runs;
create policy "vaarta_runs_select_own"
on public.vaarta_runs
for select
to authenticated
using (auth.uid() = learner);

drop policy if exists "vaarta_runs_insert_own" on public.vaarta_runs;
create policy "vaarta_runs_insert_own"
on public.vaarta_runs
for insert
to authenticated
with check (auth.uid() = learner);

drop policy if exists "vaarta_runs_update_own" on public.vaarta_runs;
create policy "vaarta_runs_update_own"
on public.vaarta_runs
for update
to authenticated
using (auth.uid() = learner)
with check (auth.uid() = learner);

drop policy if exists "vaarta_runs_delete_own" on public.vaarta_runs;
create policy "vaarta_runs_delete_own"
on public.vaarta_runs
for delete
to authenticated
using (auth.uid() = learner);

-- ---------------------------------------------------------------------------
-- vaarta_objective_progress — evidence per rung of the can-do ladder
-- ---------------------------------------------------------------------------

create table if not exists public.vaarta_objective_progress (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.vaarta_runs (id) on delete cascade,
  objective_id text not null,
  can_do text not null default '',
  skill text not null default 'clarification',
  level text not null default 'A1',
  attempts integer not null default 0,
  cleared boolean not null default false,
  -- Cleared with no prior attempt and no support shown.
  first_try boolean not null default false,
  -- Cleared after a recast or a hint: real evidence, different in kind.
  recovered_after_coaching boolean not null default false,
  hint_used boolean not null default false,
  voice_attempts integer not null default 0,
  typed_attempts integer not null default 0,
  last_error_code text,
  updated_at timestamptz not null default now(),
  unique (run_id, objective_id)
);

create index if not exists vaarta_objective_progress_run_idx
on public.vaarta_objective_progress (run_id);

alter table public.vaarta_objective_progress enable row level security;

drop policy if exists "vaarta_objective_progress_select_own" on public.vaarta_objective_progress;
create policy "vaarta_objective_progress_select_own"
on public.vaarta_objective_progress
for select
to authenticated
using (
  exists (
    select 1 from public.vaarta_runs r
    where r.id = run_id and r.learner = auth.uid()
  )
);

drop policy if exists "vaarta_objective_progress_insert_own" on public.vaarta_objective_progress;
create policy "vaarta_objective_progress_insert_own"
on public.vaarta_objective_progress
for insert
to authenticated
with check (
  exists (
    select 1 from public.vaarta_runs r
    where r.id = run_id and r.learner = auth.uid()
  )
);

drop policy if exists "vaarta_objective_progress_update_own" on public.vaarta_objective_progress;
create policy "vaarta_objective_progress_update_own"
on public.vaarta_objective_progress
for update
to authenticated
using (
  exists (
    select 1 from public.vaarta_runs r
    where r.id = run_id and r.learner = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- vaarta_words — the learner's word bank, with just enough scheduling
-- ---------------------------------------------------------------------------

create table if not exists public.vaarta_words (
  id uuid primary key default gen_random_uuid(),
  learner uuid not null references auth.users (id) on delete cascade,
  language_id text not null,
  native text not null,
  roman text not null default '',
  meaning text not null default '',
  -- The on-screen thing this word names, when the vision pass found one.
  anchor text,
  recalls integer not null default 0,
  lapses integer not null default 0,
  due_at date not null default current_date,
  source_world text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner, language_id, native)
);

create index if not exists vaarta_words_due_idx
on public.vaarta_words (learner, language_id, due_at);

alter table public.vaarta_words enable row level security;

drop policy if exists "vaarta_words_select_own" on public.vaarta_words;
create policy "vaarta_words_select_own"
on public.vaarta_words
for select
to authenticated
using (auth.uid() = learner);

drop policy if exists "vaarta_words_insert_own" on public.vaarta_words;
create policy "vaarta_words_insert_own"
on public.vaarta_words
for insert
to authenticated
with check (auth.uid() = learner);

drop policy if exists "vaarta_words_update_own" on public.vaarta_words;
create policy "vaarta_words_update_own"
on public.vaarta_words
for update
to authenticated
using (auth.uid() = learner)
with check (auth.uid() = learner);

drop policy if exists "vaarta_words_delete_own" on public.vaarta_words;
create policy "vaarta_words_delete_own"
on public.vaarta_words
for delete
to authenticated
using (auth.uid() = learner);

-- ---------------------------------------------------------------------------
-- vaarta_turns — append-only evidence trail
-- ---------------------------------------------------------------------------

create table if not exists public.vaarta_turns (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.vaarta_runs (id) on delete cascade,
  objective_id text not null,
  npc_index integer,
  input_mode text not null check (input_mode in ('voice', 'typed')),
  outcome text not null check (outcome in ('success', 'partial', 'retry')),
  error_code text,
  -- What the learner produced. Audio itself is never stored: it is used to
  -- score the live turn and discarded.
  transcript text,
  created_at timestamptz not null default now()
);

create index if not exists vaarta_turns_run_idx on public.vaarta_turns (run_id, created_at desc);

alter table public.vaarta_turns enable row level security;

drop policy if exists "vaarta_turns_select_own" on public.vaarta_turns;
create policy "vaarta_turns_select_own"
on public.vaarta_turns
for select
to authenticated
using (
  exists (
    select 1 from public.vaarta_runs r
    where r.id = run_id and r.learner = auth.uid()
  )
);

drop policy if exists "vaarta_turns_insert_own" on public.vaarta_turns;
create policy "vaarta_turns_insert_own"
on public.vaarta_turns
for insert
to authenticated
with check (
  exists (
    select 1 from public.vaarta_runs r
    where r.id = run_id and r.learner = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- Streak bookkeeping
-- ---------------------------------------------------------------------------
-- Done in SQL rather than the API route so it stays correct under concurrent
-- turns: two tabs finishing a turn at once would otherwise both read the old
-- streak and both write the same increment.

create or replace function public.vaarta_touch_streak (p_learner uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date;
  v_streak integer;
begin
  insert into public.vaarta_learners (id)
  values (p_learner)
  on conflict (id) do nothing;

  select last_played_on, streak
  into v_last, v_streak
  from public.vaarta_learners
  where id = p_learner
  for update;

  if v_last = current_date then
    -- Already counted today; the streak does not move.
    return v_streak;
  elsif v_last = current_date - 1 then
    v_streak := v_streak + 1;
  else
    -- A missed day (or a first ever turn) restarts the count at one.
    v_streak := 1;
  end if;

  update public.vaarta_learners
  set streak = v_streak,
      last_played_on = current_date,
      updated_at = now()
  where id = p_learner;

  return v_streak;
end;
$$;

revoke all on function public.vaarta_touch_streak (uuid) from public;
grant execute on function public.vaarta_touch_streak (uuid) to authenticated;

-- ==================== 0004_vaarta_preset_worlds.sql ====================

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

create table if not exists public.vaarta_preset_worlds (
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
drop policy if exists "vaarta_preset_worlds_read" on public.vaarta_preset_worlds;
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
drop policy if exists "vaarta_preset_worlds_insert" on public.vaarta_preset_worlds;
create policy "vaarta_preset_worlds_insert"
on public.vaarta_preset_worlds
for insert
to anon, authenticated
with check (true);

drop policy if exists "vaarta_preset_worlds_update" on public.vaarta_preset_worlds;
create policy "vaarta_preset_worlds_update"
on public.vaarta_preset_worlds
for update
to anon, authenticated
using (true)
with check (true);

-- ==================== 0005_preset_cache_maintenance.sql ====================

-- Vaarta: let a bad or stale preset actually be removed.
--
-- 0004 gave the preset cache select/insert/update policies but no delete, which
-- made it a write-only store: a `delete` returned 204 and removed nothing,
-- because row-level security filtered every row out before the delete ran. That
-- is the worst possible failure mode for a cache — the one operation you need
-- when an entry is wrong silently does nothing.
--
-- Two things need pruning in practice:
--   * a preset generated before a planner change, which should be rebuilt;
--   * a starter that no longer exists in lib/vaarta/starters.ts.

drop policy if exists "vaarta_preset_worlds_delete" on public.vaarta_preset_worlds;
create policy "vaarta_preset_worlds_delete"
on public.vaarta_preset_worlds
for delete
to anon, authenticated
using (true);

-- Drop presets for journeys that are no longer offered. Safe to re-run.
delete from public.vaarta_preset_worlds
where starter_id not in ('last-bus', 'wrong-address', 'first-day');

-- Drop presets for languages no longer in the catalogue.
delete from public.vaarta_preset_worlds
where language_id not in ('hi-IN', 'mr-IN', 'bn-IN', 'ta-IN', 'gu-IN', 'ml-IN');

-- ==================== 0006_vaarta_worlds.sql ====================

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

drop policy if exists "vaarta_worlds_author_select" on storage.objects;
create policy "vaarta_worlds_author_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vaarta-worlds'
  and (storage.foldername (name))[1] = auth.uid()::text
);

drop policy if exists "vaarta_worlds_author_insert" on storage.objects;
create policy "vaarta_worlds_author_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'vaarta-worlds'
  and (storage.foldername (name))[1] = auth.uid()::text
);

drop policy if exists "vaarta_worlds_author_update" on storage.objects;
create policy "vaarta_worlds_author_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'vaarta-worlds'
  and (storage.foldername (name))[1] = auth.uid()::text
);

drop policy if exists "vaarta_worlds_author_delete" on storage.objects;
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

create table if not exists public.vaarta_worlds (
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

create index if not exists vaarta_worlds_recent on public.vaarta_worlds (created_at desc);
create index if not exists vaarta_worlds_by_author on public.vaarta_worlds (author, created_at desc);
create index if not exists vaarta_worlds_by_language on public.vaarta_worlds (language_id, created_at desc);

alter table public.vaarta_worlds enable row level security;

-- Publishing is the point: any signed-in learner can read the whole library.
drop policy if exists "vaarta_worlds_read" on public.vaarta_worlds;
create policy "vaarta_worlds_read"
on public.vaarta_worlds
for select
to authenticated
using (true);

-- Writing is not. A row can only ever be created, changed or removed by the
-- person whose work it is.
drop policy if exists "vaarta_worlds_insert_own" on public.vaarta_worlds;
create policy "vaarta_worlds_insert_own"
on public.vaarta_worlds
for insert
to authenticated
with check (auth.uid() = author);

drop policy if exists "vaarta_worlds_update_own" on public.vaarta_worlds;
create policy "vaarta_worlds_update_own"
on public.vaarta_worlds
for update
to authenticated
using (auth.uid() = author)
with check (auth.uid() = author);

drop policy if exists "vaarta_worlds_delete_own" on public.vaarta_worlds;
create policy "vaarta_worlds_delete_own"
on public.vaarta_worlds
for delete
to authenticated
using (auth.uid() = author);
