/**
 * The languages Vaarta can teach.
 *
 * The catalogue is exactly the set Sarvam's speech stack supports, because a
 * language is only worth offering here if the learner can *hear* it: every
 * rung of the ladder is cleared by speaking, and an NPC who cannot talk back
 * is a flashcard with extra steps.
 *
 * A learner may still name something outside the list — `resolveLanguage`
 * falls back to a generated profile so the world still builds — but such a
 * language loses native TTS, and `speaks` says so honestly rather than
 * pretending.
 *
 * Everything downstream (planner prompt, scoring rubric, TTS locale, whether
 * romanisation is shown) reads the resolved profile, so adding a language is
 * data, not code.
 */

/**
 * Writing system, named precisely enough for `lib/vaarta/script.ts` to detect
 * it. "other" means "we have no Unicode range for this", not "no script".
 */
export type VaartaScript =
  | "latin"
  | "devanagari"
  | "bengali"
  | "gurmukhi"
  | "gujarati"
  | "odia"
  | "tamil"
  | "telugu"
  | "kannada"
  | "malayalam"
  | "other";

export type VaartaLanguage = {
  /** Sarvam's BCP-47 code, used as the stable id everywhere. */
  id: string;
  /** English name shown in the picker. */
  name: string;
  /** The language's own name for itself. */
  endonym: string;
  script: VaartaScript;
  /**
   * True when Sarvam can synthesise this language. False means the world
   * still builds, but NPC lines fall back to the browser's speech engine.
   */
  speaks: boolean;
  /**
   * True when a learner realistically cannot type the script yet, so the game
   * must accept and teach a romanised form alongside the native one.
   */
  needsRomanisation: boolean;
  /** Where the planner roots a world when the learner gives no idea. */
  homeRegion: string;
  /** Shown on the picker card so the language reads as a real language. */
  greeting: { native: string; roman: string; meaning: string };
  /**
   * What a curriculum for this language must get right to sound like the
   * language rather than a translation of a generic one: address tiers,
   * honorifics, speaker-gender agreement, diglossia. Handed verbatim to the
   * planner and to the tutor, because these are exactly the things a model
   * flattens away when left to its own devices.
   */
  teachingNotes: string;
};

/**
 * Every language Sarvam speaks, in the order they appear in the picker.
 *
 * The ids ARE the `target_language_code` values sent to Sarvam TTS, so this
 * list is the single source of truth for both the curriculum and the voice.
 */
export const VAARTA_LANGUAGES: VaartaLanguage[] = [
  {
    id: "hi-IN",
    name: "Hindi",
    endonym: "हिन्दी",
    script: "devanagari",
    speaks: true,
    needsRomanisation: true,
    homeRegion: "North India — Old Delhi bazaars, Varanasi ghats, Himalayan foothills",
    greeting: { native: "नमस्ते", roman: "namaste", meaning: "hello" },
    teachingNotes:
      "Address tiers decide everything: आप (aap) is the default with strangers and elders, तुम (tum) is for friends and juniors, and तू (tu) is intimate or outright rude to a stranger. Verbs agree with the SPEAKER's own gender (मैं जाता हूँ for a man, मैं जाती हूँ for a woman), so a learner must be taught the form that fits them. Politeness lives in -इए imperatives (कीजिए, बताइए) and softeners like ज़रा, not in a word for 'please'.",
  },
  {
    id: "mr-IN",
    name: "Marathi",
    endonym: "मराठी",
    script: "devanagari",
    speaks: true,
    needsRomanisation: true,
    homeRegion: "Maharashtra — Mumbai's streets, Pune's lanes, the Konkan coast",
    greeting: { native: "नमस्कार", roman: "namaskar", meaning: "hello" },
    teachingNotes:
      "Kinship address to strangers is close to obligatory: काका or मामा for an older man, ताई or मावशी for an older woman, दादा for a slightly older man. Skipping it reads as brusque, so teach it from the first rung. तुम्ही (tumhi) is the polite you, तू (tu) is familiar. Marathi has three genders including neuter, which is rarer than in Hindi, and verbs agree with the speaker's gender: मी जातो versus मी जाते.",
  },
  {
    id: "bn-IN",
    name: "Bengali",
    endonym: "বাংলা",
    script: "bengali",
    speaks: true,
    needsRomanisation: true,
    homeRegion: "Bengal — Kolkata's para lanes, the Sundarbans, Shantiniketan",
    greeting: { native: "নমস্কার", roman: "nomoshkar", meaning: "hello" },
    teachingNotes:
      "The three pronoun tiers each take DIFFERENT verb endings, and that is the central thing to teach: আপনি (apni) formal, তুমি (tumi) familiar, তুই (tui) intimate. Start a learner on আপনি throughout. Bengali has no grammatical gender at all, so verbs do not change with the speaker — noticeably simpler than Hindi or Marathi. Strangers are addressed as দাদা or দিদি.",
  },
  {
    id: "ta-IN",
    name: "Tamil",
    endonym: "தமிழ்",
    script: "tamil",
    speaks: true,
    needsRomanisation: true,
    homeRegion: "Tamil Nadu — Madurai temples, Chennai marina, Chettinad villages",
    greeting: { native: "வணக்கம்", roman: "vanakkam", meaning: "hello" },
    teachingNotes:
      "Tamil is strongly diglossic: the written form and the spoken form genuinely differ, and a learner taught written Tamil will not be understood casually and will not understand the reply. Teach SPOKEN Tamil — வர்றேன் rather than வருகிறேன், பண்றேன் rather than செய்கிறேன். நீங்க (neenga) is the polite you, நீ (nee) is familiar. Address strangers by relative age: அண்ணா, அக்கா, தம்பி.",
  },
  {
    id: "gu-IN",
    name: "Gujarati",
    endonym: "ગુજરાતી",
    script: "gujarati",
    speaks: true,
    needsRomanisation: true,
    homeRegion: "Gujarat — Ahmedabad's pols, Kutch salt flats, Saurashtra ports",
    greeting: { native: "નમસ્તે", roman: "namaste", meaning: "hello" },
    teachingNotes:
      "The normal polite way to address someone is to attach -ભાઈ or -બેન to their name — રમેશભાઈ, ગીતાબેન — and a learner who uses bare names sounds curt. તમે (tame) is the polite you, તું (tu) is familiar. Verbs and adjectives agree with gender and number, and the postpositions ને, થી and માં carry the case relations a beginner needs early.",
  },
  {
    id: "ml-IN",
    name: "Malayalam",
    endonym: "മലയാളം",
    script: "malayalam",
    speaks: true,
    needsRomanisation: true,
    homeRegion: "Kerala — Kochi harbours, Alappuzha backwaters, Wayanad plantations",
    greeting: { native: "നമസ്കാരം", roman: "namaskaram", meaning: "hello" },
    teachingNotes:
      "Malayalam usually AVOIDS a second-person pronoun with elders and strangers entirely, using a name, a title, or ചേട്ടൻ / ചേച്ചി instead; even നിങ്ങൾ (ningal) can land blunt. Teach the avoidance, not just the pronoun. The language is heavily agglutinative — case, tense and politeness stack onto one word — so teach whole usable chunks rather than word-by-word assembly. Verbs do not inflect for gender.",
  },
];

/**
 * Languages a learner reads explanations in, independent of what they study.
 *
 * Deliberately a different list: a beginner needs feedback in a language they
 * already command, which is usually not one they can hear an NPC speak.
 */
export const VAARTA_SUPPORT_LANGUAGES = [
  "English",
  "Hindi",
  "Marathi",
  "Bengali",
  "Tamil",
  "Gujarati",
  "Malayalam",
] as const;

export type VaartaSupportLanguage = (typeof VAARTA_SUPPORT_LANGUAGES)[number];

export function isSupportLanguage(value: unknown): value is VaartaSupportLanguage {
  return (
    typeof value === "string" &&
    (VAARTA_SUPPORT_LANGUAGES as readonly string[]).includes(value)
  );
}

/** Scripts a beginner cannot type on a default keyboard without extra setup. */
const NON_TYPEABLE_SCRIPTS: VaartaScript[] = [
  "devanagari",
  "bengali",
  "gurmukhi",
  "gujarati",
  "odia",
  "tamil",
  "telugu",
  "kannada",
  "malayalam",
  "other",
];

/**
 * Resolve any learner-supplied language name to a usable profile.
 *
 * Catalogue entries match on Sarvam code, English name, endonym, or the bare
 * primary subtag (so a saved `"mr"` from an older run still loads). Anything
 * else gets a conservative generated profile with `speaks: false`, because
 * promising audio we cannot deliver is worse than saying so up front.
 */
export function resolveLanguage(value: string | undefined | null): VaartaLanguage | null {
  const query = value?.trim();
  if (!query) return null;
  const lower = query.toLowerCase();
  const known = VAARTA_LANGUAGES.find(
    (language) =>
      language.id.toLowerCase() === lower ||
      language.id.split("-")[0] === lower ||
      language.name.toLowerCase() === lower ||
      language.endonym.toLowerCase() === lower
  );
  if (known) return known;

  // An unlisted language is still teachable; only the promises get weaker.
  const name = query.slice(0, 40).replace(/\s+/g, " ");
  return {
    id: `custom:${lower.slice(0, 40)}`,
    name,
    endonym: name,
    script: "other",
    speaks: false,
    needsRomanisation: true,
    homeRegion: `a place where ${name} is spoken every day`,
    greeting: { native: "", roman: "", meaning: "hello" },
    teachingNotes: `Teach ${name} as it is actually spoken day to day, with whatever politeness tiers and forms of address a stranger would expect.`,
  };
}

/** The default a fresh learner lands on. */
export const DEFAULT_LANGUAGE = VAARTA_LANGUAGES[0];

/** True when the learner is studying a script they likely cannot type yet. */
export function acceptsRomanisedInput(language: VaartaLanguage): boolean {
  return language.needsRomanisation || NON_TYPEABLE_SCRIPTS.includes(language.script);
}

/**
 * The `target_language_code` for Sarvam TTS, or null when Sarvam cannot speak
 * this language and the caller should fall back to browser speech.
 */
export function ttsLocale(language: VaartaLanguage): string | null {
  return language.speaks ? language.id : null;
}
