/**
 * Server-side learner progress: read the dashboard, record a scored turn.
 *
 * Everything here degrades rather than fails. A learner without an account
 * still gets a complete game — the browser keeps the same evidence in
 * `localStorage` (see `lib/vaarta/local-progress.ts`) — so a database that is
 * unreachable, unmigrated, or simply not signed into must never break play.
 * Every function therefore returns `null` or a no-op instead of throwing, and
 * the caller treats persistence as a bonus.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { masteryOf, type VaartaObjectiveProgress, type VaartaWord } from "./types";
import type { VaartaCurriculum, VaartaErrorCode, VaartaInputMode, VaartaOutcome } from "./types";

/** How long until a word is worth testing again, by how well it is known. */
const REVIEW_INTERVALS_DAYS = [1, 3, 7, 16, 35];

function dueDate(recalls: number): string {
  const days = REVIEW_INTERVALS_DAYS[Math.min(recalls, REVIEW_INTERVALS_DAYS.length - 1)];
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

type Db = SupabaseClient;

/** The dashboard's whole payload. */
export type LearnerSummary = {
  signedIn: boolean;
  displayName: string | null;
  languageId: string;
  supportLanguage: string;
  streak: number;
  lastPlayedOn: string | null;
  objectivesCleared: number;
  objectivesAttempted: number;
  firstTryClears: number;
  coachedClears: number;
  voiceTurns: number;
  typedTurns: number;
  wordsBanked: number;
  wordsDue: number;
  mastery: number;
  runs: {
    runId: string;
    worldKey: string;
    worldTitle: string;
    languageId: string;
    cleared: number;
    total: number;
    cluesFound: boolean[];
    updatedAt: string;
  }[];
};

/** An anonymous learner's summary, so the dashboard renders the same shape. */
export function emptySummary(languageId: string, supportLanguage: string): LearnerSummary {
  return {
    signedIn: false,
    displayName: null,
    languageId,
    supportLanguage,
    streak: 0,
    lastPlayedOn: null,
    objectivesCleared: 0,
    objectivesAttempted: 0,
    firstTryClears: 0,
    coachedClears: 0,
    voiceTurns: 0,
    typedTurns: 0,
    wordsBanked: 0,
    wordsDue: 0,
    mastery: 0,
    runs: [],
  };
}

type LearnerRow = {
  display_name: string | null;
  language_id: string;
  support_language: string;
  streak: number;
  last_played_on: string | null;
};

type ObjectiveRow = {
  run_id: string;
  objective_id: string;
  attempts: number;
  cleared: boolean;
  first_try: boolean;
  recovered_after_coaching: boolean;
  hint_used: boolean;
  voice_attempts: number;
  typed_attempts: number;
  last_error_code: string | null;
};

type RunRow = {
  id: string;
  world_key: string;
  world_title: string;
  language_id: string;
  clues_found: boolean[] | null;
  updated_at: string;
};

/**
 * Load (or lazily create) the learner row.
 *
 * A learner who has signed in but never finished a turn has no row yet; the
 * dashboard should still show them their chosen language rather than an error.
 */
async function loadLearner(db: Db, userId: string): Promise<LearnerRow | null> {
  const { data, error } = await db
    .from("vaarta_learners")
    .select("display_name, language_id, support_language, streak, last_played_on")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[vaarta/progress] learner read failed:", error.message);
    return null;
  }
  return (data as LearnerRow) ?? null;
}

/** Everything the dashboard needs, in one round of queries. */
export async function loadSummary(
  fallbackLanguageId: string,
  fallbackSupportLanguage: string
): Promise<LearnerSummary> {
  const empty = emptySummary(fallbackLanguageId, fallbackSupportLanguage);
  let db: Db;
  try {
    db = await createClient();
  } catch {
    // No Supabase configuration at all — a perfectly valid way to run Vaarta.
    return empty;
  }

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return empty;

  const learner = await loadLearner(db, user.id);

  const { data: runRows, error: runsError } = await db
    .from("vaarta_runs")
    .select("id, world_key, world_title, language_id, clues_found, updated_at")
    .order("updated_at", { ascending: false })
    .limit(24);
  if (runsError) {
    // Almost always "relation does not exist" — the migration has not been run.
    console.error("[vaarta/progress] runs read failed:", runsError.message);
    return { ...empty, signedIn: true };
  }

  const runs = (runRows ?? []) as RunRow[];
  const runIds = runs.map((run) => run.id);

  let objectives: ObjectiveRow[] = [];
  if (runIds.length) {
    const { data, error } = await db
      .from("vaarta_objective_progress")
      .select(
        "run_id, objective_id, attempts, cleared, first_try, recovered_after_coaching, hint_used, voice_attempts, typed_attempts, last_error_code"
      )
      .in("run_id", runIds);
    if (error) console.error("[vaarta/progress] objectives read failed:", error.message);
    else objectives = (data ?? []) as ObjectiveRow[];
  }

  const languageId = learner?.language_id ?? fallbackLanguageId;

  const { count: wordsBanked } = await db
    .from("vaarta_words")
    .select("id", { count: "exact", head: true })
    .eq("language_id", languageId);

  const { count: wordsDue } = await db
    .from("vaarta_words")
    .select("id", { count: "exact", head: true })
    .eq("language_id", languageId)
    .lte("due_at", new Date().toISOString().slice(0, 10));

  const cleared = objectives.filter((row) => row.cleared);
  const byRun = new Map<string, ObjectiveRow[]>();
  for (const row of objectives) {
    const list = byRun.get(row.run_id);
    if (list) list.push(row);
    else byRun.set(row.run_id, [row]);
  }

  return {
    signedIn: true,
    displayName: learner?.display_name ?? null,
    languageId,
    supportLanguage: learner?.support_language ?? fallbackSupportLanguage,
    streak: learner?.streak ?? 0,
    lastPlayedOn: learner?.last_played_on ?? null,
    objectivesCleared: cleared.length,
    objectivesAttempted: objectives.length,
    firstTryClears: cleared.filter((row) => row.first_try).length,
    coachedClears: cleared.filter((row) => row.recovered_after_coaching).length,
    voiceTurns: objectives.reduce((sum, row) => sum + row.voice_attempts, 0),
    typedTurns: objectives.reduce((sum, row) => sum + row.typed_attempts, 0),
    wordsBanked: wordsBanked ?? 0,
    wordsDue: wordsDue ?? 0,
    mastery: masteryOf(
      objectives.map((row) => ({
        objectiveId: row.objective_id,
        attempts: row.attempts,
        cleared: row.cleared,
        firstTry: row.first_try,
        recoveredAfterCoaching: row.recovered_after_coaching,
        hintUsed: row.hint_used,
        voiceAttempts: row.voice_attempts,
        typedAttempts: row.typed_attempts,
      }))
    ),
    runs: runs.map((run) => {
      const rows = byRun.get(run.id) ?? [];
      return {
        runId: run.id,
        worldKey: run.world_key,
        worldTitle: run.world_title,
        languageId: run.language_id,
        cleared: rows.filter((row) => row.cleared).length,
        total: rows.length,
        cluesFound: run.clues_found ?? [false, false, false],
        updatedAt: run.updated_at,
      };
    }),
  };
}

/** Persist the learner's language choice so the dashboard opens where they left off. */
export async function saveLearnerPreferences(input: {
  displayName?: string | null;
  languageId?: string;
  supportLanguage?: string;
}): Promise<boolean> {
  let db: Db;
  try {
    db = await createClient();
  } catch {
    return false;
  }
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return false;

  const { error } = await db.from("vaarta_learners").upsert(
    {
      id: user.id,
      ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
      ...(input.languageId ? { language_id: input.languageId } : {}),
      ...(input.supportLanguage ? { support_language: input.supportLanguage } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) {
    console.error("[vaarta/progress] preference write failed:", error.message);
    return false;
  }
  return true;
}

/**
 * Find or create the run row for one world.
 *
 * Returns null whenever persistence is unavailable, which the caller treats as
 * "play on, keep it in the browser".
 */
export async function ensureRun(input: {
  /** Stable per world; the client derives it from the world's own identity. */
  worldKey: string;
  worldTitle: string;
  curriculum: VaartaCurriculum;
}): Promise<string | null> {
  let db: Db;
  try {
    db = await createClient();
  } catch {
    return null;
  }
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  // Replaying a world continues its record rather than opening a second one.
  const { data: existing } = await db
    .from("vaarta_runs")
    .select("id")
    .eq("learner", user.id)
    .eq("world_key", input.worldKey)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data, error } = await db
    .from("vaarta_runs")
    .insert({
      learner: user.id,
      world_key: input.worldKey,
      world_title: input.worldTitle.slice(0, 120),
      language_id: input.curriculum.language.id,
      support_language: input.curriculum.supportLanguage,
      curriculum: input.curriculum,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[vaarta/progress] run insert failed:", error.message);
    return null;
  }
  return data.id as string;
}

export type TurnRecord = {
  runId: string;
  objectiveId: string;
  canDo: string;
  skill: string;
  level: string;
  npcIndex: number;
  inputMode: VaartaInputMode;
  outcome: VaartaOutcome;
  errorCode?: VaartaErrorCode;
  transcript: string;
  hintUsed: boolean;
  /** Prior attempts on this rung, so first-try credit is decided here. */
  priorAttempts: number;
  newWords: VaartaWord[];
  languageId: string;
  worldTitle: string;
  cluesFound: boolean[];
};

/**
 * Record one scored turn: the evidence row, the rung's running totals, any
 * words the character taught, and the streak.
 *
 * Fire-and-forget from the caller's point of view — a failed write is logged
 * and swallowed, because a learner who just spoke a sentence correctly should
 * never see an error about it.
 */
export async function recordTurn(record: TurnRecord): Promise<void> {
  let db: Db;
  try {
    db = await createClient();
  } catch {
    return;
  }
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return;

  const cleared = record.outcome === "success";
  const supported = record.hintUsed || record.priorAttempts > 0;

  try {
    await db.from("vaarta_turns").insert({
      run_id: record.runId,
      objective_id: record.objectiveId,
      npc_index: record.npcIndex,
      input_mode: record.inputMode,
      outcome: record.outcome,
      error_code: record.errorCode ?? null,
      transcript: record.transcript.slice(0, 500),
    });

    // Read-modify-write on one rung. Two tabs racing here would lose an
    // attempt count, which is a far smaller cost than the round trip a
    // stored procedure would need for every single turn.
    const { data: existing } = await db
      .from("vaarta_objective_progress")
      .select(
        "attempts, cleared, first_try, recovered_after_coaching, hint_used, voice_attempts, typed_attempts"
      )
      .eq("run_id", record.runId)
      .eq("objective_id", record.objectiveId)
      .maybeSingle();

    const prior = (existing ?? {
      attempts: 0,
      cleared: false,
      first_try: false,
      recovered_after_coaching: false,
      hint_used: false,
      voice_attempts: 0,
      typed_attempts: 0,
    }) as Omit<ObjectiveRow, "run_id" | "objective_id" | "last_error_code">;

    await db.from("vaarta_objective_progress").upsert(
      {
        run_id: record.runId,
        objective_id: record.objectiveId,
        can_do: record.canDo.slice(0, 200),
        skill: record.skill,
        level: record.level,
        attempts: prior.attempts + 1,
        cleared: prior.cleared || cleared,
        first_try: prior.first_try || (cleared && prior.attempts === 0 && !supported),
        recovered_after_coaching: prior.recovered_after_coaching || (cleared && supported),
        hint_used: prior.hint_used || record.hintUsed,
        voice_attempts: prior.voice_attempts + (record.inputMode === "voice" ? 1 : 0),
        typed_attempts: prior.typed_attempts + (record.inputMode === "typed" ? 1 : 0),
        // A success has no fault to carry forward; keep the last real one.
        last_error_code: cleared ? null : record.errorCode ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,objective_id" }
    );

    await db
      .from("vaarta_runs")
      .update({ clues_found: record.cluesFound, updated_at: new Date().toISOString() })
      .eq("id", record.runId);

    if (record.newWords.length) {
      await bankWords(db, user.id, record.languageId, record.worldTitle, record.newWords);
    }

    await db.rpc("vaarta_touch_streak", { p_learner: user.id });
  } catch (error) {
    console.error("[vaarta/progress] turn write failed:", error);
  }
}

/**
 * Add words to the bank, advancing the review schedule for ones already there.
 *
 * Meeting a word again in a live conversation counts as a recall, which is the
 * whole reason the bank is populated from NPC speech rather than from a list.
 */
async function bankWords(
  db: Db,
  userId: string,
  languageId: string,
  worldTitle: string,
  words: VaartaWord[]
): Promise<void> {
  const natives = words.map((word) => word.native);
  const { data: existingRows } = await db
    .from("vaarta_words")
    .select("native, recalls")
    .eq("language_id", languageId)
    .in("native", natives);

  const recallsByNative = new Map(
    ((existingRows ?? []) as { native: string; recalls: number }[]).map((row) => [
      row.native,
      row.recalls,
    ])
  );

  const rows = words.map((word) => {
    const recalls = (recallsByNative.get(word.native) ?? -1) + 1;
    return {
      learner: userId,
      language_id: languageId,
      native: word.native,
      roman: word.roman,
      meaning: word.meaning,
      anchor: word.anchor ?? null,
      recalls,
      due_at: dueDate(recalls),
      source_world: worldTitle.slice(0, 120),
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await db
    .from("vaarta_words")
    .upsert(rows, { onConflict: "learner,language_id,native" });
  if (error) console.error("[vaarta/progress] word bank write failed:", error.message);
}

/** The words due for review in one language, newest schedule first. */
export async function dueWords(languageId: string, limit = 20): Promise<VaartaWord[]> {
  let db: Db;
  try {
    db = await createClient();
  } catch {
    return [];
  }
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return [];

  const { data, error } = await db
    .from("vaarta_words")
    .select("native, roman, meaning, anchor")
    .eq("language_id", languageId)
    .lte("due_at", new Date().toISOString().slice(0, 10))
    .order("due_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("[vaarta/progress] due words read failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    native: row.native as string,
    roman: row.roman as string,
    meaning: row.meaning as string,
    ...(row.anchor ? { anchor: row.anchor as string } : {}),
  }));
}

export type { VaartaObjectiveProgress };
