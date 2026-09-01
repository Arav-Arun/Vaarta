import { NextRequest, NextResponse } from "next/server";
import { generateFinale } from "@/lib/world-engine";
import type { GameBible } from "@/lib/universe";
import { describeGenerationFailure } from "@/lib/vaarta/failure";

export const runtime = "nodejs";
export const maxDuration = 90;

type FinaleRequest = {
  bible: GameBible;
  /** How many rungs the learner cleared, so the ending can name it. */
  cleared?: number;
  total?: number;
  language?: string;
};

/**
 * POST `/api/vaarta/finale`: close the run.
 *
 * Vaarta has only one ending. The underlying world engine also has a defeat
 * finale, driven by a suspicion meter and a session clock, and neither belongs
 * in a language game: a learner who takes a long time or fumbles a sentence
 * has not lost, they have practised. So this route only ever writes a victory.
 */
export async function POST(req: NextRequest) {
  let body: FinaleRequest;
  try {
    body = (await req.json()) as FinaleRequest;
  } catch {
    return NextResponse.json({ error: "Invalid finale request." }, { status: 400 });
  }
  if (!body?.bible?.story?.secret) {
    return NextResponse.json({ error: "Missing world." }, { status: 422 });
  }

  try {
    const finale = await generateFinale(body.bible, "victory");
    return NextResponse.json({ finale });
  } catch (error) {
    console.error("[/api/vaarta/finale]", error);
    const failure = describeGenerationFailure(error, "The ending slipped away. Try again.");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
