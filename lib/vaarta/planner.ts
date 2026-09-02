/**
 * Vaarta's planner: turn a learner's idea plus a target language into one
 * complete run — the world document the screen pipeline consumes, and the
 * can-do ladder the teaching layer scores against.
 *
 * Both come from a single call so the curriculum is genuinely *about* the world
 * rather than bolted onto it: the market that gets painted is the market whose
 * vocabulary the learner is taught, and the person behind the stall is the
 * person who teaches it.
 */

import { generateContentWithRetry, Type } from "../gemini";
import { bibleSchema } from "../world-engine";
import { resolveSpeaker } from "../sarvam";
import type { GameBible } from "../universe";
import { acceptsRomanisedInput, type VaartaLanguage } from "./languages";
import {
  VAARTA_LEVELS,
  VAARTA_SKILLS,
  type VaartaCurriculum,
  type VaartaLevel,
  type VaartaObjective,
  type VaartaSkill,
  type VaartaWord,
  type VaartaWorldPlan,
} from "./types";

const TEXT_MODEL = process.env.TEXT_MODEL || "gemini-3.6-flash";

/** A learner-visible failure whose message is safe to show. */
export class VaartaPlannerError extends Error {
  readonly status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = "VaartaPlannerError";
    this.status = status;
  }
}

const wordSchema = {
  type: Type.OBJECT,
  properties: {
    native: {
      type: Type.STRING,
      description: "The word or short chunk in the target language's own script.",
    },
    roman: {
      type: Type.STRING,
      description: "Romanisation. Repeat `native` when the language already uses Latin script.",
    },
    meaning: {
      type: Type.STRING,
      description: "Meaning in the learner's support language, 1-6 words.",
    },
    anchor: {
      type: Type.STRING,
      description:
        "A concrete thing that will be visible in this world (a stall, a boat, a gate, a lamp) that this word names. Empty string for abstract words.",
    },
  },
  required: ["native", "roman", "meaning", "anchor"],
};

const objectiveSchema = {
  type: Type.OBJECT,
  properties: {
    canDo: {
      type: Type.STRING,
      description:
        "What the learner will be able to DO, phrased as a can-do statement, max 14 words. e.g. 'Ask a stallholder how much something costs and understand the answer.'",
    },
    level: { type: Type.STRING, enum: [...VAARTA_LEVELS] },
    skill: { type: Type.STRING, enum: [...VAARTA_SKILLS] },
    targetPhrase: wordSchema,
    successCriteria: {
      type: Type.STRING,
      description:
        "The pass condition, in plain English, naming every concrete signal the learner must get across. This is what a scorer judges against, so be specific and never require exact wording.",
    },
    vocabulary: {
      type: Type.ARRAY,
      description: "2-4 words this rung is responsible for teaching.",
      items: wordSchema,
    },
    ownerIndex: {
      type: Type.INTEGER,
      description:
        "Which character teaches this rung: 0, 1 or 2 matching the bible's npcs/rooms. Use -1 only for something learnable out on the street.",
    },
  },
  required: ["canDo", "level", "skill", "targetPhrase", "successCriteria", "vocabulary", "ownerIndex"],
};

const planSchema = {
  type: Type.OBJECT,
  properties: {
    bible: bibleSchema,
    curriculum: {
      type: Type.OBJECT,
      properties: {
        promise: {
          type: Type.STRING,
          description:
            "One sentence telling the learner what this world will make them able to do. Max 18 words.",
        },
        starterVocabulary: {
          type: Type.ARRAY,
          description:
            "3-5 words worth knowing before meeting anyone, drawn from what this world contains.",
          items: wordSchema,
        },
        objectives: {
          type: Type.ARRAY,
          description:
            "The can-do ladder for this world, 6-9 rungs, ordered easiest first. Each of the three characters must own at least two rungs.",
          items: objectiveSchema,
        },
      },
      required: ["promise", "starterVocabulary", "objectives"],
    },
  },
  required: ["bible", "curriculum"],
};

function cleanWord(value: unknown, fallback?: VaartaWord): VaartaWord | null {
  if (!value || typeof value !== "object") return fallback ?? null;
  const raw = value as Record<string, unknown>;
  const text = (field: string, max: number) =>
    typeof raw[field] === "string" ? (raw[field] as string).trim().slice(0, max) : "";
  const native = text("native", 120);
  const meaning = text("meaning", 120);
  if (!native || !meaning) return fallback ?? null;
  const anchor = text("anchor", 60);
  return {
    native,
    // Latin-script languages legitimately have nothing to romanise.
    roman: text("roman", 140) || native,
    meaning,
    ...(anchor ? { anchor } : {}),
  };
}

function cleanWordList(value: unknown, max: number): VaartaWord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanWord(item))
    .filter((word): word is VaartaWord => word !== null)
    .slice(0, max);
}

function cleanObjective(value: unknown, index: number): VaartaObjective | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const canDo = typeof raw.canDo === "string" ? raw.canDo.trim().slice(0, 160) : "";
  const successCriteria =
    typeof raw.successCriteria === "string" ? raw.successCriteria.trim().slice(0, 360) : "";
  const targetPhrase = cleanWord(raw.targetPhrase);
  if (!canDo || !successCriteria || !targetPhrase) return null;
  const level = (VAARTA_LEVELS as readonly string[]).includes(raw.level as string)
    ? (raw.level as VaartaLevel)
    : "A1";
  const skill = (VAARTA_SKILLS as readonly string[]).includes(raw.skill as string)
    ? (raw.skill as VaartaSkill)
    : "clarification";
  const ownerRaw = Number(raw.ownerIndex);
  const ownerIndex = Number.isInteger(ownerRaw) && ownerRaw >= 0 && ownerRaw <= 2 ? ownerRaw : -1;
  return {
    id: `obj-${index}`,
    canDo,
    level,
    skill,
    targetPhrase,
    successCriteria,
    vocabulary: cleanWordList(raw.vocabulary, 4),
    ownerIndex,
  };
}

/**
 * Make sure every character owns at least one rung.
 *
 * A character with nothing to teach is a dead end in a game where clues are
 * paid for in speech: the player walks into their room, has nothing to clear,
 * and the run stalls with a clue permanently out of reach. Reassigning is
 * cruder than re-prompting but it always terminates, which matters more.
 */
function spreadOwnership(objectives: VaartaObjective[]): void {
  const owners = [0, 1, 2] as const;
  for (const owner of owners) {
    if (objectives.some((objective) => objective.ownerIndex === owner)) continue;
    // Take from whoever is richest, so no character is emptied to fill another.
    const counts = owners.map(
      (candidate) => objectives.filter((objective) => objective.ownerIndex === candidate).length
    );
    const richest = counts.indexOf(Math.max(...counts));
    const donor =
      objectives.find((objective) => objective.ownerIndex === -1) ??
      objectives.filter((objective) => objective.ownerIndex === richest).at(-1);
    if (donor) donor.ownerIndex = owner;
  }
}

/**
 * Author a complete Vaarta run.
 *
 * Returns a `GameBible` that the existing screen, interior, and dialogue
 * pipeline consumes with no changes, plus the curriculum the teaching layer
 * owns. The bible's three rooms and three characters are the same three that
 * own the ladder's rungs.
 */
export async function generateVaartaWorld(
  idea: string,
  language: VaartaLanguage,
  supportLanguage: string
): Promise<VaartaWorldPlan> {
  const learnerIdea = idea.trim().slice(0, 420);
  const romanised = acceptsRomanisedInput(language);

  const res = await generateContentWithRetry({
    model: TEXT_MODEL,
    contents: [
      {
        text: [
          `TARGET LANGUAGE: ${language.name}${
            language.endonym && language.endonym !== language.name ? ` (${language.endonym})` : ""
          }.`,
          `WHAT A ${language.name.toUpperCase()} COURSE MUST GET RIGHT:\n${language.teachingNotes}`,
          `THE LEARNER READS EXPLANATIONS IN: ${supportLanguage}.`,
          learnerIdea
            ? `THE LEARNER'S IDEA FOR THE WORLD:\n${learnerIdea}`
            : `THE LEARNER GAVE NO IDEA. Root the world in ${language.homeRegion}.`,
          "",
          "Author BOTH halves of this run in one pass:",
          "1. `bible` — the complete world document: setting, palette, protagonist, the spine, the street, all 3 rooms, all 3 characters, and the fail rules.",
          "2. `curriculum` — the can-do ladder that this exact world teaches.",
          "",
          "The two must be the same world. Every rung's vocabulary must name things the world actually contains, every character must teach what their room is for, and the ladder must climb: greetings and naming first, then asking and confirming, then handling a reply that does not go to plan.",
        "",
        "THE LADDER IS A COURSE, NOT A LIST. Make it a real progression:",
        "- Rung 1 must be clearable by someone who has never spoken a word of this language. Later rungs must NOT be.",
        "- Start at A1 and finish at A2 or B1. Never give every rung the same level.",
        "- Each rung should reuse something an earlier rung taught, so the language compounds instead of resetting.",
        "- The last two rungs must require handling a reply that does not go to plan: a correction, a refusal, a question back.",
        "- Honour the register facts above in EVERY model answer. A rung whose target phrase uses the wrong politeness tier teaches the learner to be rude.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    config: {
      systemInstruction: [
        `You are the creative director and the language-curriculum designer for Vaarta, a game where a learner acquires ${language.name} by walking through a generated world and speaking to the people in it.`,
        "Design ONE tight spine the world converges toward, with exactly 3 rooms and 3 characters, each character guarding one part of it. Honour the learner's idea — its named details, era, and tone.",
        `Teach ${language.name} the way it is actually spoken: everyday register, real politeness, the words a person would genuinely need in this place. Never teach textbook sentences nobody says.`,
        romanised
          ? `Give every ${language.name} word BOTH its native script and a practical romanisation, because the learner probably cannot type the script yet.`
          : `${language.name} uses Latin script, so repeat the word itself in the roman field.`,
        `Write every explanation, meaning, and can-do statement in ${supportLanguage}.`,
        "The danger meter must fit a learning game: name it something like Confusion or Fluster, and make its fail states about a conversation breaking down, never violence.",
        "Return ONLY the structured object.",
      ].join(" "),
      responseMimeType: "application/json",
      responseSchema: planSchema,
      temperature: 1.0,
    },
  });

  if (!res.text) throw new VaartaPlannerError("The planner returned an empty world. Please try again.");

  let parsed: { bible?: unknown; curriculum?: unknown };
  try {
    parsed = JSON.parse(res.text) as { bible?: unknown; curriculum?: unknown };
  } catch {
    throw new VaartaPlannerError("The planner's world came back incomplete. Please try again.");
  }

  const bible = parsed.bible as GameBible | undefined;
  if (!bible?.story || !Array.isArray(bible.rooms) || !Array.isArray(bible.npcs)) {
    throw new VaartaPlannerError("The planner could not finish this world. Please try again.");
  }

  // The screen pipeline hard-depends on exactly 3 rooms / 3 NPCs / 3 clues.
  bible.story.clues = (bible.story.clues ?? []).slice(0, 3);
  while (bible.story.clues.length < 3) bible.story.clues.push("Something worth knowing here.");
  bible.rooms = bible.rooms.slice(0, 3);
  bible.npcs = bible.npcs.slice(0, 3);
  if (bible.rooms.length < 3 || bible.npcs.length < 3) {
    throw new VaartaPlannerError("The planner returned an incomplete world. Please try again.");
  }
  bible.beats = (bible.beats ?? []).slice(0, 5);
  bible.heatLabel = bible.heatLabel?.trim() || "Fluster";
  bible.failStates = (bible.failStates ?? []).slice(0, 3);
  bible.street.items = (bible.street?.items ?? []).slice(0, 3);
  bible.street.actions = (bible.street?.actions ?? []).slice(0, 3);
  for (const room of bible.rooms) {
    room.items = (room.items ?? []).slice(0, 3);
    room.actions = (room.actions ?? []).slice(0, 3);
  }
  for (const npc of bible.npcs) npc.voice = resolveSpeaker(npc.voice);

  const rawCurriculum = (parsed.curriculum ?? {}) as Record<string, unknown>;
  const objectives = Array.isArray(rawCurriculum.objectives)
    ? rawCurriculum.objectives
        .map((item, index) => cleanObjective(item, index))
        .filter((item): item is VaartaObjective => item !== null)
        .slice(0, 9)
    : [];
  if (objectives.length < 3) {
    throw new VaartaPlannerError("The planner could not build a usable lesson ladder. Please try again.");
  }
  // Every rung must be able to teach something, so fall back to its own model
  // answer when the planner left the vocabulary list empty.
  for (const objective of objectives) {
    if (!objective.vocabulary.length) objective.vocabulary = [objective.targetPhrase];
  }
  spreadOwnership(objectives);

  const curriculum: VaartaCurriculum = {
    language,
    supportLanguage,
    promise:
      typeof rawCurriculum.promise === "string" && rawCurriculum.promise.trim()
        ? rawCurriculum.promise.trim().slice(0, 160)
        : `Speak enough ${language.name} to get through ${bible.title}.`,
    starterVocabulary: cleanWordList(rawCurriculum.starterVocabulary, 5),
    objectives,
  };

  return { bible, curriculum };
}
