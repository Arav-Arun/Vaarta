/**
 * Offline checks for Vaarta's language layer.
 *
 * No server, no API key. This covers the deterministic half of the system —
 * writing-system detection, vocabulary overlap, language resolution, and the
 * mastery weighting — which is exactly the part that must never regress,
 * because it is what stops a learner being told their correct answer was not
 * in the target language.
 *
 *   npm run test:vaarta
 */

import { scriptEvidence, scriptIsAmbiguous, vocabularyOverlap } from "../lib/vaarta/script.ts";
import {
  acceptsRomanisedInput,
  DEFAULT_LANGUAGE,
  isSupportLanguage,
  resolveLanguage,
  ttsLocale,
  VAARTA_LANGUAGES,
} from "../lib/vaarta/languages.ts";
import { masteryOf } from "../lib/vaarta/types.ts";

let failures = 0;

function check(label, got, want) {
  const ok = Object.is(got, want);
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `  — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
}

console.log("\nWriting-system detection");
// A learner answering in the script they are studying is the strong signal.
check("Devanagari answer for a Devanagari target", scriptEvidence("मला बसने जायचे आहे", "devanagari"), "target_script");
check("Tamil answer for a Tamil target", scriptEvidence("எனக்கு உதவி வேண்டும்", "tamil"), "target_script");
check("Bengali answer for a Bengali target", scriptEvidence("আমি বাজারে যাব", "bengali"), "target_script");
check("Telugu answer for a Telugu target", scriptEvidence("నాకు సహాయం కావాలి", "telugu"), "target_script");
check("Kannada answer for a Kannada target", scriptEvidence("ನನಗೆ ಸಹಾಯ ಬೇಕು", "kannada"), "target_script");
check("Malayalam answer for a Malayalam target", scriptEvidence("എനിക്ക് സഹായം വേണം", "malayalam"), "target_script");
check("Gujarati answer for a Gujarati target", scriptEvidence("મને મદદ જોઈએ છે", "gujarati"), "target_script");
check("Gurmukhi answer for a Punjabi target", scriptEvidence("ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ", "gurmukhi"), "target_script");
check("Odia answer for an Odia target", scriptEvidence("ମୋତେ ସାହାଯ୍ୟ ଦରକାର", "odia"), "target_script");
check("Mixed script still counts as production", scriptEvidence("Bus कुठे मिळेल?", "devanagari"), "target_script");

// Romanisation and plain English are indistinguishable by script alone, so both
// come back as `latin_only`; the scorer's own language verdict separates them.
check("Romanised answer is not mistaken for the script", scriptEvidence("mala bus ne jayache aahe", "devanagari"), "latin_only");
check("English answer for a Devanagari target", scriptEvidence("I want to go by bus", "devanagari"), "latin_only");

// Wrong-language-entirely is worth telling apart from a romanisation.
check("Tamil answer for a Devanagari target", scriptEvidence("வணக்கம் நண்பரே", "devanagari"), "other_script");
check("Kannada answer for a Telugu target", scriptEvidence("ನಮಸ್ಕಾರ", "telugu"), "other_script");

// The honest non-answers.
check("Latin-script target is undecidable by script", scriptEvidence("Hello, one ticket please", "latin"), "indistinguishable");
check("Empty input", scriptEvidence("   ", "devanagari"), "empty");

// An unlisted language has no range, so any non-Latin text is a real attempt.
check("Unlisted target, non-Latin answer", scriptEvidence("გამარჯობა", "other"), "target_script");
check("Unlisted target, Latin answer", scriptEvidence("gamarjoba", "other"), "latin_only");

console.log("\nShared-script ambiguity");
// Hindi and Marathi are both Devanagari: script alone can never separate them,
// and the scorer has to carry that judgement on its own.
check("Devanagari cannot separate Hindi from Marathi", scriptIsAmbiguous("devanagari", ["devanagari"]), true);
check("Tamil is unambiguous against Devanagari", scriptIsAmbiguous("tamil", ["devanagari"]), false);

console.log("\nVocabulary overlap");
const vocabulary = [
  { native: "मला", roman: "mala" },
  { native: "बस", roman: "bus" },
  { native: "कुठे", roman: "kuthe" },
  { native: "मिळेल", roman: "milel" },
];
check("Full native match", vocabularyOverlap("मला बस कुठे मिळेल?", vocabulary), 1);
check("Full romanised match", vocabularyOverlap("mala bus kuthe milel", vocabulary), 1);
check("Half match", vocabularyOverlap("mala bus", vocabulary), 0.5);
check("No match", vocabularyOverlap("where is the train", vocabulary), 0);
check("Empty utterance", vocabularyOverlap("", vocabulary), 0);
check("Empty vocabulary", vocabularyOverlap("mala bus", []), 0);

console.log("\nLanguage catalogue");
check("Every catalogue language is one Sarvam speaks", VAARTA_LANGUAGES.every((l) => l.speaks), true);
check("Every id is a Sarvam target_language_code", VAARTA_LANGUAGES.every((l) => /^[a-z]{2}-IN$/.test(l.id)), true);
check("Six languages offered", VAARTA_LANGUAGES.length, 6);
check("Every language carries teaching notes", VAARTA_LANGUAGES.every((l) => l.teachingNotes.length > 80), true);
// Notes exist to stop a curriculum flattening into translated English, so a
// stub that says nothing specific is worse than useless.
check("Notes name a real register system", VAARTA_LANGUAGES.every((l) => /\p{Script=Devanagari}|\p{Script=Bengali}|\p{Script=Tamil}|\p{Script=Gujarati}|\p{Script=Malayalam}/u.test(l.teachingNotes)), true);
check("Resolve by Sarvam code", resolveLanguage("mr-IN")?.name, "Marathi");
check("A dropped language falls back, not crashes", resolveLanguage("pa-IN")?.speaks, false);
check("Resolve by bare subtag (older saved runs)", resolveLanguage("mr")?.name, "Marathi");
check("Resolve by English name", resolveLanguage("Tamil")?.id, "ta-IN");
check("Resolve by endonym", resolveLanguage("বাংলা")?.id, "bn-IN");
check("Resolve is case-insensitive", resolveLanguage("bengali")?.id, "bn-IN");
check("Empty input resolves to nothing", resolveLanguage("  "), null);
check("Unlisted language still resolves", resolveLanguage("Georgian")?.name, "Georgian");
check("Unlisted language admits it cannot be spoken", resolveLanguage("Georgian")?.speaks, false);
check("Unlisted language has no TTS locale", ttsLocale(resolveLanguage("Georgian")), null);
check("Marathi has a TTS locale", ttsLocale(resolveLanguage("mr-IN")), "mr-IN");
check("Every offered language can be spoken", VAARTA_LANGUAGES.every((l) => ttsLocale(l) !== null), true);
check("Default language is in the catalogue", VAARTA_LANGUAGES.includes(DEFAULT_LANGUAGE), true);

console.log("\nRomanisation policy");
check("Devanagari needs romanisation", acceptsRomanisedInput(resolveLanguage("hi-IN")), true);
check("Malayalam needs romanisation", acceptsRomanisedInput(resolveLanguage("ml-IN")), true);
check("Every offered language needs romanisation", VAARTA_LANGUAGES.every(acceptsRomanisedInput), true);

console.log("\nSupport languages");
check("English is a support language", isSupportLanguage("English"), true);
check("Klingon is not", isSupportLanguage("Klingon"), false);
check("Non-strings are rejected", isSupportLanguage(42), false);

console.log("\nMastery weighting");
const rung = (over) => ({
  objectiveId: "x",
  attempts: 1,
  cleared: false,
  firstTry: false,
  recoveredAfterCoaching: false,
  hintUsed: false,
  voiceAttempts: 0,
  typedAttempts: 0,
  ...over,
});
check("Nothing cleared", masteryOf([rung({}), rung({})]), 0);
check("Unaided clear is full credit", masteryOf([rung({ cleared: true, firstTry: true })]), 100);
// A coached clear is real evidence, but not the same evidence as getting it cold.
check("Coached clear is worth less", masteryOf([rung({ cleared: true, recoveredAfterCoaching: true })]), 82);
check("Mixed ladder averages", masteryOf([rung({ cleared: true, firstTry: true }), rung({})]), 50);
check("Empty ladder is zero, not NaN", masteryOf([]), 0);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
