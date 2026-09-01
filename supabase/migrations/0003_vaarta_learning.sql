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

create table public.vaarta_learners (
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

create policy "vaarta_learners_select_own"
on public.vaarta_learners
for select
to authenticated
using (auth.uid() = id);

create policy "vaarta_learners_insert_own"
on public.vaarta_learners
for insert
to authenticated
with check (auth.uid() = id);

create policy "vaarta_learners_update_own"
on public.vaarta_learners
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- vaarta_runs — one learner's pass through one world
-- ---------------------------------------------------------------------------

create table public.vaarta_runs (
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
create unique index vaarta_runs_learner_world_idx
on public.vaarta_runs (learner, world_key);

create index vaarta_runs_learner_idx on public.vaarta_runs (learner, updated_at desc);

alter table public.vaarta_runs enable row level security;

create policy "vaarta_runs_select_own"
on public.vaarta_runs
for select
to authenticated
using (auth.uid() = learner);

create policy "vaarta_runs_insert_own"
on public.vaarta_runs
for insert
to authenticated
with check (auth.uid() = learner);

create policy "vaarta_runs_update_own"
on public.vaarta_runs
for update
to authenticated
using (auth.uid() = learner)
with check (auth.uid() = learner);

create policy "vaarta_runs_delete_own"
on public.vaarta_runs
for delete
to authenticated
using (auth.uid() = learner);

-- ---------------------------------------------------------------------------
-- vaarta_objective_progress — evidence per rung of the can-do ladder
-- ---------------------------------------------------------------------------

create table public.vaarta_objective_progress (
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

create index vaarta_objective_progress_run_idx
on public.vaarta_objective_progress (run_id);

alter table public.vaarta_objective_progress enable row level security;

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

create table public.vaarta_words (
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

create index vaarta_words_due_idx
on public.vaarta_words (learner, language_id, due_at);

alter table public.vaarta_words enable row level security;

create policy "vaarta_words_select_own"
on public.vaarta_words
for select
to authenticated
using (auth.uid() = learner);

create policy "vaarta_words_insert_own"
on public.vaarta_words
for insert
to authenticated
with check (auth.uid() = learner);

create policy "vaarta_words_update_own"
on public.vaarta_words
for update
to authenticated
using (auth.uid() = learner)
with check (auth.uid() = learner);

create policy "vaarta_words_delete_own"
on public.vaarta_words
for delete
to authenticated
using (auth.uid() = learner);

-- ---------------------------------------------------------------------------
-- vaarta_turns — append-only evidence trail
-- ---------------------------------------------------------------------------

create table public.vaarta_turns (
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

create index vaarta_turns_run_idx on public.vaarta_turns (run_id, created_at desc);

alter table public.vaarta_turns enable row level security;

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
