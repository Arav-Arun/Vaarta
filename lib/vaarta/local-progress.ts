/**
 * The browser's own copy of a learner's progress.
 *
 * Vaarta has no account wall: someone can open it, pick a language, and speak
 * their first sentence without signing in. That means the browser has to be a
 * complete store in its own right, not a cache — the same evidence the
 * database keeps, kept locally, so signing in later adds durability rather
 * than unlocking the feature.
 *
 * Every read and write is wrapped: private browsing and blocked-cookie
 * contexts throw on `localStorage` access, and a learner in one of those must
 * still be able to play.
 */

"use client";

import {
  emptyObjectiveProgress,
  masteryOf,
  type VaartaBankedWord,
  type VaartaObjectiveProgress,
  type VaartaWord,
} from "./types";

const KEY_PREFIX = "vaarta";

/** How long until a word is worth testing again, by how well it is known. */
const REVIEW_INTERVALS_DAYS = [1, 3, 7, 16, 35];

function dueDate(recalls: number): string {
  const days = REVIEW_INTERVALS_DAYS[Math.min(recalls, REVIEW_INTERVALS_DAYS.length - 1)];
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}:${key}`);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`${KEY_PREFIX}:${key}`, JSON.stringify(value));
  } catch {
    // A blocked write must never interrupt a turn that already succeeded.
  }
  bump();
}

/* ------------------------------------------------------------------ */
/* Subscription, so React can treat this as the external store it is   */
/* ------------------------------------------------------------------ */

/**
 * A revision counter, not the data itself.
 *
 * `useSyncExternalStore` requires a snapshot that is referentially stable
 * between changes; returning parsed objects would hand React a new identity on
 * every render and loop forever. A number changes only when something is
 * actually written, and callers derive the data they want from it.
 */
let revision = 0;
const listeners = new Set<() => void>();

function bump(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Client snapshot. Always >= 0, so it differs from the server's on hydration. */
export function snapshot(): number {
  return revision;
}

/**
 * Server snapshot. `-1` means "the browser store has not been read yet", which
 * lets a component render neutral defaults during prerender and pick up the
 * real values on the client without a hydration mismatch.
 */
export function serverSnapshot(): number {
  return -1;
}

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

export type LocalPreferences = {
  playerName: string;
  languageId: string;
  supportLanguage: string;
};

export function loadPreferences(fallback: LocalPreferences): LocalPreferences {
  const stored = read<Partial<LocalPreferences>>("prefs-v1", {});
  return {
    playerName: stored.playerName?.trim() || fallback.playerName,
    languageId: stored.languageId || fallback.languageId,
    supportLanguage: stored.supportLanguage || fallback.supportLanguage,
  };
}

export function savePreferences(prefs: LocalPreferences): void {
  write("prefs-v1", prefs);
}

/* ------------------------------------------------------------------ */
/* Per-run evidence                                                    */
/* ------------------------------------------------------------------ */

export type LocalRun = {
  worldId: string;
  worldTitle: string;
  languageId: string;
  objectives: Record<string, VaartaObjectiveProgress>;
  cluesFound: boolean[];
  updatedAt: string;
};

function runKey(worldId: string): string {
  return `run:${worldId}:v1`;
}

export function loadRun(worldId: string, worldTitle: string, languageId: string): LocalRun {
  const stored = read<LocalRun | null>(runKey(worldId), null);
  if (stored?.objectives && (!stored.languageId || stored.languageId === languageId)) return stored;
  return {
    worldId,
    worldTitle,
    languageId,
    objectives: {},
    cluesFound: [false, false, false],
    updatedAt: new Date().toISOString(),
  };
}

export function saveRun(run: LocalRun): void {
  write(runKey(run.worldId), { ...run, updatedAt: new Date().toISOString() });
  rememberRunId(run.worldId);
}

/** Keep an index of run ids so the dashboard can list them without scanning. */
function rememberRunId(worldId: string): void {
  const ids = read<string[]>("runs-v1", []);
  if (ids.includes(worldId)) return;
  write("runs-v1", [...ids, worldId].slice(-40));
}

export function listRuns(): LocalRun[] {
  return read<string[]>("runs-v1", [])
    .map((id) => read<LocalRun | null>(runKey(id), null))
    .filter((run): run is LocalRun => run !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Fold one scored attempt into a rung's running evidence.
 *
 * `supported` is passed in rather than inferred: whether the learner opened
 * the phrase help is known by the UI at the moment they opened it, and reading
 * it back from state after an await has already been a source of "supported
 * attempt scored as first try" bugs in this codebase.
 */
export function applyAttempt(
  run: LocalRun,
  input: {
    objectiveId: string;
    cleared: boolean;
    inputMode: "voice" | "typed";
    supported: boolean;
    errorCode?: VaartaObjectiveProgress["lastErrorCode"];
  }
): LocalRun {
  const prior = run.objectives[input.objectiveId] ?? emptyObjectiveProgress(input.objectiveId);
  const supported = prior.hintUsed || input.supported;
  const next: VaartaObjectiveProgress = {
    objectiveId: input.objectiveId,
    attempts: prior.attempts + 1,
    cleared: prior.cleared || input.cleared,
    firstTry: prior.firstTry || (input.cleared && prior.attempts === 0 && !supported),
    recoveredAfterCoaching: prior.recoveredAfterCoaching || (input.cleared && supported),
    hintUsed: supported,
    voiceAttempts: prior.voiceAttempts + (input.inputMode === "voice" ? 1 : 0),
    typedAttempts: prior.typedAttempts + (input.inputMode === "typed" ? 1 : 0),
    // Keep the last genuine fault rather than overwriting it with nothing.
    lastErrorCode: input.cleared ? prior.lastErrorCode : input.errorCode,
  };
  return {
    ...run,
    objectives: { ...run.objectives, [input.objectiveId]: next },
    updatedAt: new Date().toISOString(),
  };
}

/** Mark the phrase help as used before the attempt that follows it is scored. */
export function markHintUsed(run: LocalRun, objectiveId: string): LocalRun {
  const prior = run.objectives[objectiveId] ?? emptyObjectiveProgress(objectiveId);
  return {
    ...run,
    objectives: { ...run.objectives, [objectiveId]: { ...prior, hintUsed: true } },
  };
}

export function runMastery(run: LocalRun, objectiveIds: string[]): number {
  return masteryOf(
    objectiveIds.map((id) => run.objectives[id] ?? emptyObjectiveProgress(id))
  );
}

/* ------------------------------------------------------------------ */
/* The word bank                                                       */
/* ------------------------------------------------------------------ */

function bankKey(languageId: string): string {
  return `words:${languageId}:v1`;
}

export function loadBank(languageId: string): VaartaBankedWord[] {
  return read<VaartaBankedWord[]>(bankKey(languageId), []);
}

/**
 * Add words the learner just met, advancing the schedule for ones they already
 * had. Meeting a word again inside a live conversation is the recall event —
 * that is why the bank is fed from NPC speech rather than from a word list.
 */
export function bankWords(
  languageId: string,
  words: VaartaWord[],
  sourceWorld: string
): VaartaBankedWord[] {
  if (!words.length) return loadBank(languageId);
  const existing = loadBank(languageId);
  const byNative = new Map(existing.map((word) => [word.native, word]));

  for (const word of words) {
    const prior = byNative.get(word.native);
    const recalls = (prior?.recalls ?? -1) + 1;
    byNative.set(word.native, {
      ...word,
      recalls,
      lapses: prior?.lapses ?? 0,
      dueAt: dueDate(recalls),
      sourceWorld: prior?.sourceWorld ?? sourceWorld,
    });
  }

  const next = [...byNative.values()];
  write(bankKey(languageId), next);
  return next;
}

/** Words whose review date has arrived. */
export function dueWords(languageId: string): VaartaBankedWord[] {
  const now = today();
  return loadBank(languageId)
    .filter((word) => word.dueAt <= now)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/* ------------------------------------------------------------------ */
/* Streak                                                              */
/* ------------------------------------------------------------------ */

type StreakState = { streak: number; lastPlayedOn: string | null };

export function loadStreak(): StreakState {
  return read<StreakState>("streak-v1", { streak: 0, lastPlayedOn: null });
}

/** Count today toward the streak. Idempotent within a day. */
export function touchStreak(): StreakState {
  const state = loadStreak();
  const now = today();
  if (state.lastPlayedOn === now) return state;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const wasYesterday = state.lastPlayedOn === yesterday.toISOString().slice(0, 10);

  const next: StreakState = {
    streak: wasYesterday ? state.streak + 1 : 1,
    lastPlayedOn: now,
  };
  write("streak-v1", next);
  return next;
}
