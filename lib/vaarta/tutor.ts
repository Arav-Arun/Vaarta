/**
 * The tutor: score one spoken (or typed) exchange with one character.
 *
 * This is where Vaarta's central design decision lives — **a clue is paid for
 * in speech, never in a menu click.** Each character owns a slice of the can-do
 * ladder. The player talks to them in the language they are learning; when the
 * last of that character's rungs clears, the character gives up the clue they
 * were guarding, and the engine's existing win condition (three clues, then the
 * finale) does the rest.
 *
 * So the conversation is not a quiz bolted onto a game. Speaking well *is* the
 * movement mechanic.
 *
 * The model is a judge and an actor, never the referee of its own leniency:
 * coaching escalation and the language guards below are decided in code, after
 * the model has spoken.
 */

import { generateContentWithRetry, Type } from "../gemini";
import { bibleBrief } from "../world-engine";
import type { GameBible } from "../universe";
import { acceptsRomanisedInput } from "./languages";
import { scriptEvidence, vocabularyOverlap } from "./script";
import {
  VAARTA_SKILLS,
  type VaartaCoaching,
  type VaartaCurriculum,
  type VaartaErrorCode,
  type VaartaInputMode,
  type VaartaLine,
  type VaartaObjective,
  type VaartaOutcome,
  type VaartaSkill,
  type VaartaTurnResponse,
  type VaartaWord,
} from "./types";

const TEXT_MODEL = process.env.TEXT_MODEL || "gemini-3.6-flash";

/** A learner-visible failure whose message is safe to show. */
export class VaartaTutorError extends Error {
  readonly status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = "VaartaTutorError";
    this.status = status;
  }
}

const ERROR_CODES: VaartaErrorCode[] = [
  "missing_intent",
  "missing_detail",
  "unclear_audio",
  "politeness",
  "wording",
  "wrong_language",
];

/** Human labels for the coaching chip; kept out of the model's hands. */
const ERROR_LABELS: Record<VaartaErrorCode, string> = {
  missing_intent: "the main point did not come across",
  missing_detail: "one required detail was missing",
  unclear_audio: "the audio was hard to make out",
  politeness: "register and politeness",
  wording: "wording to tighten",
  wrong_language: "answer in the language you are learning",
};

const lineSchema = {
  type: Type.OBJECT,
  properties: {
    native: { type: Type.STRING, description: "The line in the target language's own script." },
    roman: { type: Type.STRING, description: "Practical romanisation, or the same text for Latin-script languages." },
    meaning: { type: Type.STRING, description: "Meaning in the learner's support language." },
  },
  required: ["native", "roman", "meaning"],
};

const wordSchema = {
  type: Type.OBJECT,
  properties: {
    native: { type: Type.STRING },
    roman: { type: Type.STRING },
    meaning: { type: Type.STRING },
    anchor: { type: Type.STRING, description: "A visible thing this word names, or empty string." },
  },
  required: ["native", "roman", "meaning", "anchor"],
};

const turnSchema = {
  type: Type.OBJECT,
  properties: {
    transcript: {
      type: Type.STRING,
      description:
        "Exactly what the learner said or typed, in whatever script they produced. Empty string if the audio carried no speech.",
    },
    heardNative: {
      type: Type.STRING,
      description:
        "The same utterance written in the TARGET language's own script. Empty string when nothing intelligible was produced.",
    },
    languageHeard: {
      type: Type.STRING,
      description:
        "The English name of the language the learner actually spoke — your honest judgement. Say the support language's name when they simply answered in it.",
    },
    intent: {
      type: Type.STRING,
      description:
        "The practical meaning the learner was trying to convey, in the support language, max 14 words.",
    },
    outcome: {
      type: Type.STRING,
      enum: ["success", "partial", "retry"],
      description:
        "'success' when the success criteria are met — judge MEANING, never accent or exact wording. 'partial' when the point mostly landed but a required detail is missing. 'retry' when the message would not work in the real situation.",
    },
    errorCode: {
      type: Type.STRING,
      enum: [...ERROR_CODES],
      description: "What specifically fell short. On success, name the weakest remaining aspect.",
    },
    npcLine: {
      ...lineSchema,
      description:
        "What your character says back, IN THE TARGET LANGUAGE, in character, 6-20 words. React to what the learner actually said. End by inviting a real response.",
    },
    whatWorked: {
      type: Type.STRING,
      description:
        "One specific, warm sentence in the support language about what the learner got right. Never generic praise.",
    },
    nextFocus: {
      type: Type.STRING,
      description:
        "One concrete thing to change next time, in the support language, max 18 words. On success, something to stretch toward.",
    },
    keyChunk: {
      ...lineSchema,
      description:
        "The single most useful fragment for this moment — a chunk, not a whole sentence.",
    },
    skillEvidence: {
      type: Type.ARRAY,
      items: { type: Type.STRING, enum: [...VAARTA_SKILLS] },
      description: "Skills this attempt genuinely produced evidence for. Often just one. Empty on a failed attempt.",
    },
    newWords: {
      type: Type.ARRAY,
      description:
        "0-3 words from YOUR reply worth adding to the learner's bank. Only words a beginner would not already have.",
      items: wordSchema,
    },
    suggestions: {
      type: Type.ARRAY,
      description:
        "Exactly 3 things the learner could try saying next, each a different tactic, each a full usable line.",
      items: lineSchema,
    },
    memoryLine: {
      type: Type.STRING,
      description:
        "One compact line recording this exchange so the next turn stays continuous, max 20 words.",
    },
  },
  required: [
    "transcript",
    "heardNative",
    "languageHeard",
    "intent",
    "outcome",
    "errorCode",
    "npcLine",
    "whatWorked",
    "nextFocus",
    "keyChunk",
    "skillEvidence",
    "newWords",
    "suggestions",
    "memoryLine",
  ],
};

export type TutorTurnInput = {
  bible: GameBible;
  curriculum: VaartaCurriculum;
  /** Which of the three characters is being spoken to. */
  npcIndex: number;
  /** The rung this attempt is scored against. */
  objective: VaartaObjective;
  /**
   * How many of this character's rungs would still be uncleared if this one
   * succeeds. Zero means their clue comes out on success.
   */
  remainingAfterThis: number;
  /** Prior attempts on this rung; drives coaching escalation in code. */
  attemptsForObjective: number;
  /** True when the learner has already revealed the phrase help for this rung. */
  hintUsed: boolean;
  /** Compact memory lines from earlier turns in this conversation. */
  history: string[];
  /** The learner's typed answer, when they used the accessibility fallback. */
  typedResponse?: string;
  /** The learner's recording, when they spoke. */
  audio?: { data: string; mimeType: string };
  /** Where this is happening, so the character can react to the place. */
  scene?: { title: string; ambient: string };
  playerName: string;
};

function cleanLine(value: unknown, fallback: VaartaLine): VaartaLine {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  const text = (field: string, max: number) =>
    typeof raw[field] === "string" ? (raw[field] as string).trim().slice(0, max) : "";
  const native = text("native", 240);
  if (!native) return fallback;
  return {
    native,
    roman: text("roman", 280) || native,
    meaning: text("meaning", 240) || fallback.meaning,
  };
}

function cleanWords(value: unknown, max: number): VaartaWord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const text = (field: string, limit: number) =>
        typeof raw[field] === "string" ? (raw[field] as string).trim().slice(0, limit) : "";
      const native = text("native", 120);
      const meaning = text("meaning", 120);
      if (!native || !meaning) return null;
      const anchor = text("anchor", 60);
      return {
        native,
        roman: text("roman", 140) || native,
        meaning,
        ...(anchor ? { anchor } : {}),
      } satisfies VaartaWord;
    })
    .filter((word): word is VaartaWord => word !== null)
    .slice(0, max);
}

/**
 * Coaching escalation, owned by code.
 *
 * A model asked to grade its own leniency drifts toward handing over the
 * answer, and a learner who is given the sentence on attempt one has practised
 * nothing. Level is therefore a pure function of how many times they have
 * already tried this rung.
 */
function coachingFor(
  outcome: VaartaOutcome,
  attempts: number,
  whatWorked: string,
  nextFocus: string,
  keyChunk: VaartaLine
): VaartaCoaching {
  if (outcome === "success") {
    return { level: 0, strategy: "affirm", whatWorked, nextFocus, keyChunk };
  }
  const level = attempts >= 2 ? 2 : 1;
  return {
    level,
    strategy: level === 2 ? "guided_rebuild" : "recast",
    whatWorked,
    nextFocus,
    keyChunk,
  };
}

/**
 * Score one exchange and get the character's reply.
 *
 * Everything the browser needs to advance comes back in one object, including
 * whether this attempt was the one that unlocked the character's clue.
 */
export async function scoreTurn(input: TutorTurnInput): Promise<VaartaTurnResponse> {
  const {
    bible,
    curriculum,
    npcIndex,
    objective,
    remainingAfterThis,
    attemptsForObjective,
    history,
    typedResponse,
    audio,
    scene,
    playerName,
  } = input;

  const npc = bible.npcs[npcIndex];
  const room = bible.rooms[npcIndex];
  if (!npc || !room) throw new VaartaTutorError("That character is not part of this world.", 422);

  const language = curriculum.language;
  const support = curriculum.supportLanguage;
  const romanised = acceptsRomanisedInput(language);
  const inputMode: VaartaInputMode = audio ? "voice" : "typed";

  const prompt = [
    bibleBrief(bible),
    "",
    `YOU ARE ${npc.name}, ${npc.role}, in ${room.name}. ${npc.persona}`,
    `YOUR VERBAL QUIRK (use it): ${npc.quirk}`,
    `YOU SPEAK ${language.name} WITH THE LEARNER. Every line you say is in ${language.name}.`,
    `HOW ${language.name.toUpperCase()} ACTUALLY WORKS HERE: ${language.teachingNotes}`,
    `THE LEARNER IS CALLED ${playerName} and reads explanations in ${support}.`,
    scene ? `RIGHT NOW: ${scene.title} — ${scene.ambient}` : "",
    "",
    `THE RUNG BEING SCORED: ${objective.canDo}`,
    `PASS CONDITION: ${objective.successCriteria}`,
    `ONE MODEL ANSWER (never require this wording): ${objective.targetPhrase.native} (${objective.targetPhrase.roman}) — ${objective.targetPhrase.meaning}`,
    objective.vocabulary.length
      ? `WORDS THIS RUNG TEACHES: ${objective.vocabulary
          .map((word) => `${word.native} (${word.roman}) = ${word.meaning}`)
          .join("; ")}`
      : "",
    history.length ? `\nCONVERSATION SO FAR:\n${history.slice(-10).join("\n")}` : "",
    "",
    inputMode === "voice"
      ? "THE LEARNER JUST SPOKE. The audio is attached — transcribe it first, then judge it."
      : `THE LEARNER JUST TYPED: ${typedResponse}`,
    "",
    attemptsForObjective === 0
      ? "This is their first attempt at this rung. Do not hand over the model answer."
      : `This is attempt ${attemptsForObjective + 1} at this rung. Give more of the shape of the answer, but still let them produce it.`,
    remainingAfterThis === 0
      ? "If they succeed, this is the LAST thing you were holding out for — your reply should feel like the moment you decide to trust them."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const contents: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  if (audio) contents.push({ inlineData: { data: audio.data, mimeType: audio.mimeType } });
  contents.push({ text: prompt });

  const res = await generateContentWithRetry({
    model: TEXT_MODEL,
    contents,
    config: {
      systemInstruction: [
        `You are two things at once: a character in an adventure game, and a patient ${language.name} tutor assessing one attempt.`,
        "As the character: stay in role, react to what the learner actually said, and always end by inviting a real response. Never break character, never mention being an AI.",
        `As the tutor: judge whether the learner's PRACTICAL MEANING would work in this situation. Accept ${language.name}, romanised ${language.name}, and understandable mixed speech. NEVER score accent, fluency, or grammar polish — only whether the message lands.`,
        "Register is the one exception to that leniency, and only when it would genuinely cause offence: an intimate pronoun aimed at an elder, or a missing honorific where one is expected, is a real communication failure and belongs in the coaching. A merely clumsy sentence that still lands is a pass.",
        romanised
          ? `The learner probably cannot type ${language.name}'s script, so a romanised answer is a full, legitimate answer.`
          : "",
        `Write every coaching field in ${support}. Write every character line in ${language.name}.`,
        "Unclear audio is never a language mistake: if you cannot make out speech, return an empty transcript and errorCode 'unclear_audio'.",
        "Return ONLY the structured object.",
      ]
        .filter(Boolean)
        .join(" "),
      responseMimeType: "application/json",
      responseSchema: turnSchema,
      temperature: 0.8,
    },
  });

  if (!res.text) throw new VaartaTutorError("The tutor could not score that turn. Please try again.");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(res.text) as Record<string, unknown>;
  } catch {
    throw new VaartaTutorError("The tutor's reply came back malformed. Please try again.");
  }

  const str = (field: string, max: number) =>
    typeof parsed[field] === "string" ? (parsed[field] as string).trim().slice(0, max) : "";

  const transcript = str("transcript", 400);
  const heardNative = str("heardNative", 400) || transcript;
  const languageHeard = str("languageHeard", 60);
  const fallbackLine: VaartaLine = {
    native: objective.targetPhrase.native,
    roman: objective.targetPhrase.roman,
    meaning: objective.targetPhrase.meaning,
  };
  const npcLine = cleanLine(parsed.npcLine, fallbackLine);
  const keyChunk = cleanLine(parsed.keyChunk, fallbackLine);

  let outcome: VaartaOutcome =
    parsed.outcome === "success" || parsed.outcome === "partial" ? parsed.outcome : "retry";
  let errorCode: VaartaErrorCode = ERROR_CODES.includes(parsed.errorCode as VaartaErrorCode)
    ? (parsed.errorCode as VaartaErrorCode)
    : "wording";

  /* ---- Deterministic guards, applied after the model has spoken ---- */

  // 1. Nothing intelligible. Silence is a microphone problem, not a language
  //    failure, and must never be recorded as one.
  if (!transcript) {
    outcome = "retry";
    errorCode = "unclear_audio";
  } else {
    // 2. Writing-system evidence. It can only ever separate scripts, so it is
    //    trusted where it speaks and ignored where it honestly cannot.
    const verdict = scriptEvidence(transcript, language.script);
    const overlap = vocabularyOverlap(transcript, objective.vocabulary);
    const modelHeardTarget = languageHeard
      .toLowerCase()
      .includes(language.name.toLowerCase());

    if (verdict === "other_script") {
      // They answered in a different language's script entirely.
      outcome = "retry";
      errorCode = "wrong_language";
    } else if (
      verdict === "latin_only" &&
      overlap === 0 &&
      !modelHeardTarget &&
      outcome === "success"
    ) {
      // Romanisation is legitimate, so this only fires when NOTHING points at
      // the target language: no target vocabulary, and the model itself says it
      // heard something else. An optimistic model cannot wave that through.
      outcome = "partial";
      errorCode = "wrong_language";
    }
  }

  const objectiveCleared = outcome === "success";
  const coaching = coachingFor(
    outcome,
    attemptsForObjective,
    str("whatWorked", 240) ||
      (objectiveCleared ? "That got the message across." : "You made a real attempt at it."),
    str("nextFocus", 240) || objective.successCriteria,
    keyChunk
  );

  const rawSkills = Array.isArray(parsed.skillEvidence) ? parsed.skillEvidence : [];
  const skillEvidence = [
    ...new Set(
      rawSkills.filter((skill): skill is VaartaSkill =>
        (VAARTA_SKILLS as readonly string[]).includes(skill as string)
      )
    ),
  ].slice(0, 3);

  const rawSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const suggestions = rawSuggestions
    .map((item) => cleanLine(item, fallbackLine))
    .filter((line, index, all) => all.findIndex((other) => other.native === line.native) === index)
    .slice(0, 3);

  const memoryLine = str("memoryLine", 200);
  const sessionMemory = [
    ...history,
    `${playerName}: ${transcript || "(nothing audible)"}`,
    `${npc.name}: ${npcLine.native}`,
    ...(memoryLine ? [`— ${memoryLine}`] : []),
  ].slice(-24);

  return {
    inputMode,
    transcript,
    heardNative,
    intent: str("intent", 200),
    outcome,
    npcLine,
    coaching,
    // A cleared rung has no fault to report; anything else names one.
    feedbackFocus: objectiveCleared
      ? undefined
      : { code: errorCode, label: ERROR_LABELS[errorCode] },
    skillEvidence: objectiveCleared ? skillEvidence : [],
    newWords: cleanWords(parsed.newWords, 3),
    suggestions,
    objectiveCleared,
    // The whole point: the clue is released by speech, and only once the
    // character has nothing left to teach.
    clueRevealed: objectiveCleared && remainingAfterThis === 0,
    sessionMemory,
  };
}
