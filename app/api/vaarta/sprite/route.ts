import { NextRequest, NextResponse } from "next/server";
import { generateSprite } from "@/lib/world-engine";
import type { GameBible } from "@/lib/universe";
import { describeGenerationFailure } from "@/lib/vaarta/failure";

export const runtime = "nodejs";
export const maxDuration = 60;

type SpriteRequest = {
  bible: GameBible;
  /** The opening frame as raw base64, so the sprite matches its art style. */
  referenceFrame?: string | null;
};

/**
 * POST `/api/vaarta/sprite`: forge the learner's character.
 *
 * The reference frame matters more than it looks: a sprite generated blind
 * reads as pasted onto the world, and in a game where the player spends the
 * whole run looking at their own back, that break is the first thing they see.
 * Failure is not fatal — the client keeps the built-in walking sprite.
 */
export async function POST(req: NextRequest) {
  let body: SpriteRequest;
  try {
    body = (await req.json()) as SpriteRequest;
  } catch {
    return NextResponse.json({ error: "Invalid sprite request." }, { status: 400 });
  }
  if (!body?.bible?.protagonist) {
    return NextResponse.json({ error: "Missing world." }, { status: 422 });
  }

  // Gate sprite generation unless enabled or warming presets
  const warmToken = process.env.VAARTA_WARM_TOKEN;
  const isWarmRun = Boolean(warmToken && req.headers.get("x-vaarta-warm") === warmToken);
  const isCustomAllowed = process.env.ENABLE_CUSTOM_WORLDS === "true";

  if (!isCustomAllowed && !isWarmRun) {
    return NextResponse.json(
      {
        error:
          "Dynamic sprite generation is disabled on this deployment. Run on localhost with your own GEMINI_API_KEY to draw custom characters.",
      },
      { status: 403 }
    );
  }

  try {
    const sprite = await generateSprite(
      { setup: body.bible.protagonist, styleBible: body.bible.styleBible },
      body.referenceFrame ?? null
    );
    return NextResponse.json({ sprite });
  } catch (error) {
    console.error("[/api/vaarta/sprite]", error);
    const failure = describeGenerationFailure(error, "The character could not be drawn.");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
