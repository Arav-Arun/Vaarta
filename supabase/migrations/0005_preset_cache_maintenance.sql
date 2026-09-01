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
