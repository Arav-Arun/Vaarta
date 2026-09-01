import { NextRequest, NextResponse } from "next/server";
import { synthesizeSarvamSpeech } from "@/lib/sarvam";
import { resolveLanguage, ttsLocale } from "@/lib/vaarta/languages";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST `/api/vaarta/voice`: speak an NPC line in the language being learned.
 *
 * Sarvam's Bulbul covers every language in the catalogue, which is exactly why
 * the catalogue is that set. When the learner has named a language outside it,
 * `ttsLocale` returns null and this hands back `audio: null` so the browser can
 * fall back to its own speech engine rather than play the wrong accent.
 *
 * Voice is always best-effort: a failure here returns null audio, never an
 * error, because losing the sound of a line must not block the turn.
 */
export async function POST(req: NextRequest) {
  let body: { text?: string; language?: string; voice?: string; slow?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid voice request." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || typeof body.text !== "string") {
    return NextResponse.json({ error: "Missing line to speak." }, { status: 422 });
  }

  const text = body.text.trim().slice(0, 400);
  if (!text) return NextResponse.json({ error: "Missing line to speak." }, { status: 422 });

  const language = resolveLanguage(body.language);
  const locale = language ? ttsLocale(language) : null;
  if (!locale) {
    // Honest null: the browser's speech engine takes over from here.
    return NextResponse.json({ audio: null, spokenBy: "browser" });
  }

  try {
    const audio = await synthesizeSarvamSpeech(text, body.voice, {
      languageCode: locale,
      // Slow mode is for hearing a phrase apart word by word, not for drama.
      pace: body.slow === true ? 0.7 : 1,
      temperature: 0.6,
    });
    return NextResponse.json({ audio, spokenBy: audio ? "sarvam" : "browser" });
  } catch (error) {
    console.error("[/api/vaarta/voice]", error);
    return NextResponse.json({ audio: null, spokenBy: "browser" });
  }
}
