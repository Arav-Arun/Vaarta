import { NextRequest, NextResponse } from "next/server";
import { generateVaartaWorld, VaartaPlannerError } from "@/lib/vaarta/planner";
import { isSupportLanguage, resolveLanguage } from "@/lib/vaarta/languages";
import { describeGenerationFailure } from "@/lib/vaarta/failure";

export const runtime = "nodejs";
// One planner call authors the whole world and its ladder; give it room.
export const maxDuration = 120;

/**
 * POST `/api/vaarta/world`: author a world and the can-do ladder it teaches.
 *
 * Public by design — Vaarta has no account wall. A signed-in learner's run is
 * persisted separately by `/api/vaarta/progress`; a signed-out one lives in
 * their browser.
 */
export async function POST(req: NextRequest) {
  let body: { idea?: string; language?: string; supportLanguage?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid world request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid world request." }, { status: 400 });
  }

  const language = resolveLanguage(body.language);
  if (!language) {
    return NextResponse.json({ error: "Choose a language to learn." }, { status: 422 });
  }
  const supportLanguage = isSupportLanguage(body.supportLanguage) ? body.supportLanguage : "English";
  const idea = typeof body.idea === "string" ? body.idea : "";

  try {
    return NextResponse.json(await generateVaartaWorld(idea, language, supportLanguage));
  } catch (error) {
    console.error("[/api/vaarta/world]", error);
    if (error instanceof VaartaPlannerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const failure = describeGenerationFailure(error, "This world could not be built. Try again.");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
