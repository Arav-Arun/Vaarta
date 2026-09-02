/**
 * Vaarta's curriculum and tutoring layer.
 *
 * The world itself is described by the `GameBible` that the whole screen
 * pipeline (paint → trace → read) already understands. Vaarta authors a bible
 * *and* this parallel document: the language, the can-do ladder, and the
 * vocabulary each place is expected to teach.
 *
 * Keeping them separate means the world engine needs no knowledge of language
 * teaching, and the teaching layer needs no knowledge of pixels. What binds
 * them is `ownerIndex`: rung *i* belongs to the character standing in room *i*,
 * so climbing the ladder and exploring the world are the same activity.
 */

import type { GameBible } from "../universe";
import type { VaartaLanguage } from "./languages";

/** Practical communicative skills a turn can produce evidence for. */
export const VAARTA_SKILLS = [
  "greeting",
  "destination",
  "confirmation",
  "polite_closing",
  "clarification",
  "describing",
  "asking_price",
  "requesting_help",
  "narrating",
  "disagreeing",
] as const;

export type VaartaSkill = (typeof VAARTA_SKILLS)[number];

/** Rough difficulty band, used to order the ladder and pace a run. */
export const VAARTA_LEVELS = ["A1", "A2", "B1"] as const;
export type VaartaLevel = (typeof VAARTA_LEVELS)[number];

/**
 * One word or short chunk the learner is meant to acquire.
 *
 * `anchor` is what makes Vaarta different from a flashcard deck: it names a
 * thing the vision pass actually found in the painted frame, so the word can
 * be taught while the learner is looking at the object it refers to.
 */
export type VaartaWord = {
  native: string;
  /** Romanisation, or the same string again for Latin-script languages. */
  roman: string;
  meaning: string;
  /** Name of an on-screen object this word refers to, when there is one. */
  anchor?: string;
};

/** One rung of the can-do ladder. */
export type VaartaObjective = {
  id: string;
  /** Learner-facing goal, phrased as something they can do. */
  canDo: string;
  level: VaartaLevel;
  skill: VaartaSkill;
  /** One model answer. Never a required wording. */
  targetPhrase: VaartaWord;
  /** The pass condition the scorer judges against, in plain English. */
  successCriteria: string;
  /** Words this rung is responsible for teaching. */
  vocabulary: VaartaWord[];
  /** Index of the bible room/NPC that owns this rung, or -1 for the street. */
  ownerIndex: number;
};

/** The teaching plan for one generated world. */
export type VaartaCurriculum = {
  language: VaartaLanguage;
  /** Language the learner reads explanations in. */
  supportLanguage: string;
  /** Ordered ladder; the run is complete when every rung is cleared. */
  objectives: VaartaObjective[];
  /** Words worth pre-teaching before the learner meets anyone. */
  starterVocabulary: VaartaWord[];
  /** One line telling the learner what this world will make them able to do. */
  promise: string;
};

/** Everything one planner call produces for a new Vaarta run. */
export type VaartaWorldPlan = {
  /** Drives the existing screen/interior/dialogue pipeline unchanged. */
  bible: GameBible;
  curriculum: VaartaCurriculum;
};

/* ------------------------------------------------------------------ */
/* Tutoring — one scored exchange with one character                   */
/* ------------------------------------------------------------------ */

/** Whether the learner spoke or used the typed accessibility fallback. */
export type VaartaInputMode = "voice" | "typed";

/** How well the attempt met the current rung's success criteria. */
export type VaartaOutcome = "success" | "partial" | "retry";

/** What specifically went wrong, so coaching can be concrete. */
export type VaartaErrorCode =
  | "missing_intent"
  | "missing_detail"
  | "unclear_audio"
  | "politeness"
  | "wording"
  | "wrong_language";

/** A line an NPC speaks, always carried in all three forms the UI shows. */
export type VaartaLine = {
  native: string;
  roman: string;
  meaning: string;
};

/**
 * Code-owned escalation plus the model's concise, response-specific note.
 *
 * `level` is decided by the server from the attempt count, not by the model:
 * a model asked to grade its own leniency drifts, and a learner who is quietly
 * handed the answer on attempt one has not learned anything.
 */
export type VaartaCoaching = {
  /** 0 = affirm, 1 = a focused recast, 2 = a small guided rebuild. */
  level: 0 | 1 | 2;
  strategy: "affirm" | "recast" | "guided_rebuild";
  whatWorked: string;
  nextFocus: string;
  keyChunk: VaartaLine;
};

/** One scored exchange, sent to the browser. */
export type VaartaTurnResponse = {
  inputMode: VaartaInputMode;
  /** What the model heard, in whatever script the learner produced. */
  transcript: string;
  /** The same utterance rendered in the target language's own script. */
  heardNative: string;
  /** The practical meaning the model believes the learner intended. */
  intent: string;
  outcome: VaartaOutcome;
  /** The character's in-world reply, in the language being learned. */
  npcLine: VaartaLine;
  coaching: VaartaCoaching;
  feedbackFocus?: { code: VaartaErrorCode; label: string };
  /** Skills this attempt produced evidence for. */
  skillEvidence: VaartaSkill[];
  /** Words the character used that are worth banking for review. */
  newWords: VaartaWord[];
  /** Three things the learner could try saying next, as scaffolding. */
  suggestions: VaartaLine[];
  /** True when this attempt cleared the rung it was scored against. */
  objectiveCleared: boolean;
  /**
   * True when clearing this rung emptied the character's share of the ladder,
   * so their guarded clue comes out. This is the whole design: a clue is paid
   * for in speech, never in a menu click.
   */
  clueRevealed: boolean;
  /** Opaque conversation memory the browser echoes back on the next turn. */
  sessionMemory: string[];
};

/* ------------------------------------------------------------------ */
/* Progress — evidence that survives the run                           */
/* ------------------------------------------------------------------ */

/** Per-objective evidence, kept separate rather than collapsed into a score. */
export type VaartaObjectiveProgress = {
  objectiveId: string;
  attempts: number;
  cleared: boolean;
  /** Cleared with no prior attempt and no support shown. */
  firstTry: boolean;
  /** Cleared after a recast or hint — a genuinely different kind of evidence. */
  recoveredAfterCoaching: boolean;
  hintUsed: boolean;
  voiceAttempts: number;
  typedAttempts: number;
  lastErrorCode?: VaartaErrorCode;
};

/**
 * One word in the learner's bank, with the scheduling fields a review queue
 * needs. Kept deliberately small: a full SRS is out of scope, but "when is
 * this due again" is what turns a word list into retention.
 */
export type VaartaBankedWord = VaartaWord & {
  /** Times the learner has produced this word unaided. */
  recalls: number;
  /** Times it has been shown as support instead. */
  lapses: number;
  /** ISO date this word is next worth testing. */
  dueAt: string;
  /** The world it was first met in, so review can name the place. */
  sourceWorld?: string;
};

/** Empty evidence for one rung. */
export function emptyObjectiveProgress(objectiveId: string): VaartaObjectiveProgress {
  return {
    objectiveId,
    attempts: 0,
    cleared: false,
    firstTry: false,
    recoveredAfterCoaching: false,
    hintUsed: false,
    voiceAttempts: 0,
    typedAttempts: 0,
  };
}

/**
 * Weighted mastery over a ladder.
 *
 * An unaided clear is worth full credit and a coached clear most of it, because
 * recovering from a misunderstanding is a real skill — but not the same skill
 * as getting it right cold, and collapsing the two hides the thing a learner
 * most wants to see improve.
 */
export function masteryOf(progress: VaartaObjectiveProgress[]): number {
  if (!progress.length) return 0;
  const total = progress.reduce(
    (sum, item) => sum + (item.cleared ? (item.firstTry ? 100 : 82) : 0),
    0
  );
  return Math.round(total / progress.length);
}
