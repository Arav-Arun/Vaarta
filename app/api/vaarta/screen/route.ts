import { NextRequest, NextResponse } from "next/server";
import { generateScreen } from "@/lib/world-engine";
import type { Direction } from "@/lib/world-engine";
import type { GameBible } from "@/lib/universe";
import { describeGenerationFailure } from "@/lib/vaarta/failure";

export const runtime = "nodejs";
// Three model passes per screen: paint, trace, then read both frames.
export const maxDuration = 180;

const DIRECTIONS = new Set(["n", "e", "s", "w"]);

type ScreenRequest = {
  bible: GameBible;
  x: number;
  y: number;
  /** Direction the player walked to reach this screen. */
  arriveFrom?: Direction | null;
  /** The previous screen as raw base64, so the two share an horizon. */
  prevImage?: string | null;
  /** Bible rooms (0-2) not yet placed anywhere in the world. */
  unplacedRooms?: number[];
};

/**
 * POST `/api/vaarta/screen`: paint one screen of the learner's world, trace it,
 * and read both frames into interactive hotspots and solid obstacles.
 *
 * Public and stateless: the browser holds the world document and posts it back,
 * the same way it holds the live conversation.
 */
export async function POST(req: NextRequest) {
  let body: ScreenRequest;
  try {
    body = (await req.json()) as ScreenRequest;
  } catch {
    return NextResponse.json({ error: "Invalid screen request." }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    !body.bible?.story?.goal ||
    !Array.isArray(body.bible.rooms) ||
    body.bible.rooms.length < 3 ||
    !Array.isArray(body.bible.npcs) ||
    body.bible.npcs.length < 3 ||
    !Number.isFinite(body.x) ||
    !Number.isFinite(body.y)
  ) {
    return NextResponse.json({ error: "Missing world or screen coordinates." }, { status: 422 });
  }

  try {
    const scene = await generateScreen(
      body.bible,
      Math.round(body.x),
      Math.round(body.y),
      body.arriveFrom && DIRECTIONS.has(body.arriveFrom) ? body.arriveFrom : null,
      body.prevImage || null,
      (body.unplacedRooms ?? []).filter((room) => Number.isInteger(room) && room >= 0 && room <= 2)
    );
    return NextResponse.json({ scene });
  } catch (error) {
    console.error("[/api/vaarta/screen]", error);
    const failure = describeGenerationFailure(
      error,
      "This part of the world could not be painted."
    );
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
