import { NextRequest, NextResponse } from "next/server";
import { generateInteriorScene } from "@/lib/world-engine";
import type { GameBible } from "@/lib/universe";
import { describeGenerationFailure } from "@/lib/vaarta/failure";

export const runtime = "nodejs";
// Layout pass, then the image itself.
export const maxDuration = 120;

type InteriorRequest = {
  bible: GameBible;
  /** Which bible room (0-2) to build the interior of. */
  roomIndex: number;
  /** The overworld screen the building stands on, for the exit door. */
  parentId?: string;
};

/**
 * POST `/api/vaarta/interior`: paint one of the world's three rooms.
 *
 * Rooms are where the language actually happens — each holds the character who
 * owns a slice of the can-do ladder — so this is not an optional flourish but
 * the second half of the map.
 */
export async function POST(req: NextRequest) {
  let body: InteriorRequest;
  try {
    body = (await req.json()) as InteriorRequest;
  } catch {
    return NextResponse.json({ error: "Invalid room request." }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    !body.bible?.story?.goal ||
    !Array.isArray(body.bible.rooms) ||
    body.bible.rooms.length < 3 ||
    !Number.isInteger(body.roomIndex) ||
    body.roomIndex < 0 ||
    body.roomIndex > 2
  ) {
    return NextResponse.json({ error: "Missing world or room index." }, { status: 422 });
  }

  try {
    const scene = await generateInteriorScene(
      body.bible,
      body.roomIndex,
      typeof body.parentId === "string" && body.parentId ? body.parentId : "s0_0"
    );
    return NextResponse.json({ scene });
  } catch (error) {
    console.error("[/api/vaarta/interior]", error);
    const failure = describeGenerationFailure(error, "This room could not be painted.");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
