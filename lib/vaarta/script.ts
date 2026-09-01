/**
 * Deterministic evidence about which language a learner actually produced.
 *
 * The original Marathi game gated progress on a hand-written list of Marathi
 * words. That cannot generalise: no word list covers a curriculum the planner
 * invents at runtime, and a learner who answers correctly with vocabulary
 * outside the list gets stuck forever.
 *
 * Vaarta replaces it with two independent signals:
 *
 *  1. This module — cheap, deterministic writing-system detection. It cannot be
 *     fooled by an optimistic model, but it can only ever separate scripts, so
 *     it says nothing useful when the target and the support language share an
 *     alphabet (English), and nothing useful between two languages that share
 *     a script (Hindi and Marathi are both Devanagari).
 *  2. The scorer reporting which language it actually heard, which is the only
 *     workable signal in those two cases.
 *
 * Neither alone is sufficient; `scriptEvidence` reports what this half knows so
 * the caller can combine them without pretending to more certainty than it has.
 */

import type { VaartaScript } from "./languages";

/** Unicode blocks that positively identify a writing system. */
const SCRIPT_RANGES: Record<Exclude<VaartaScript, "other">, RegExp> = {
  latin: /[A-Za-zÀ-ɏ]/,
  devanagari: /[ऀ-ॿ]/,
  bengali: /[ঀ-৿]/,
  gurmukhi: /[਀-੿]/,
  gujarati: /[઀-૿]/,
  odia: /[଀-୿]/,
  tamil: /[஀-௿]/,
  telugu: /[ఀ-౿]/,
  kannada: /[ಀ-೿]/,
  malayalam: /[ഀ-ൿ]/,
};

/** Any script that is not the Latin alphabet, for "did they switch?" checks. */
const NON_LATIN = /[Ͱ-᳿Ḁ-ỿⰀ-퟿豈-﷿ﹰ-﻿]/;

export type ScriptVerdict =
  /** Text is written in the target's script; strong evidence of production. */
  | "target_script"
  /** Text is in some other non-Latin script; they answered in another language. */
  | "other_script"
  /** Text is Latin-only while the target is not; a romanisation or a fallback. */
  | "latin_only"
  /** Target uses Latin too, so script tells us nothing. */
  | "indistinguishable"
  /** Nothing to judge. */
  | "empty";

/**
 * What the writing system alone can tell us about one learner utterance.
 *
 * Deliberately returns `indistinguishable` rather than guessing when the target
 * language shares the Latin alphabet — a caller must fall back to the scorer's
 * own language judgement there, not to a coin flip.
 */
export function scriptEvidence(utterance: string, targetScript: VaartaScript): ScriptVerdict {
  const text = utterance.trim();
  if (!text) return "empty";

  if (targetScript === "latin") return "indistinguishable";

  if (targetScript !== "other") {
    if (SCRIPT_RANGES[targetScript].test(text)) return "target_script";
  } else if (NON_LATIN.test(text)) {
    // An unlisted language: any non-Latin script is at least a real attempt at
    // something other than the learner's support language.
    return "target_script";
  }

  // Not the target's script. Distinguish "wrong language entirely" from
  // "romanised the target", because those deserve different coaching.
  const foreign = (Object.keys(SCRIPT_RANGES) as (keyof typeof SCRIPT_RANGES)[]).some(
    (script) => script !== "latin" && script !== targetScript && SCRIPT_RANGES[script].test(text)
  );
  if (foreign) return "other_script";
  return "latin_only";
}

/**
 * True when two languages share a writing system, so `scriptEvidence` alone
 * cannot separate them.
 *
 * Hindi and Marathi are the live case: both Devanagari, both in the catalogue.
 * The scorer must carry the whole burden of "was that actually Marathi?".
 */
export function scriptIsAmbiguous(
  targetScript: VaartaScript,
  otherScripts: VaartaScript[]
): boolean {
  return otherScripts.some((script) => script === targetScript);
}

/** Strip punctuation and case so two spellings of the same word compare equal. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,!?;:()"'`‘’“”।॥]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How much of an objective's own vocabulary the learner reproduced.
 *
 * Used only as corroborating evidence, never as a gate: a learner who conveys
 * the right meaning with different words has still succeeded, and the scorer
 * judging `successCriteria` is what decides that. This exists so a romanised
 * answer in a non-Latin-script language can still be recognised as a genuine
 * attempt at the target language rather than treated as English.
 */
export function vocabularyOverlap(
  utterance: string,
  expected: { native: string; roman: string }[]
): number {
  const text = normalise(utterance);
  if (!text) return 0;
  let hits = 0;
  for (const word of expected) {
    const native = word.native.trim();
    const roman = normalise(word.roman);
    // Native forms are matched raw: lowercasing is meaningless in most scripts
    // and stripping punctuation could damage them.
    if ((native && utterance.includes(native)) || (roman && text.includes(roman))) hits += 1;
  }
  return expected.length ? hits / expected.length : 0;
}
