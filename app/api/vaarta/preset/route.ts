import { NextRequest, NextResponse } from "next/server";
import { isUsableBundle, readPreset, writePreset } from "@/lib/vaarta/preset-cache";
import { resolveLanguage } from "@/lib/vaarta/languages";
import { STARTERS } from "@/lib/vaarta/starters";

export const runtime = "nodejs";
// Bundles carry inline art, so a write is a few megabytes.
export const maxDuration = 60;

const STARTER_IDS = new Set(STARTERS.map((starter) => starter.id));

/**
 * Resolve the pair this request is about, or explain why it is not cacheable.
 *
 * Only the fixed starter journeys are cached. A custom world is unique by
 * definition, so accepting one here would fill the table with rows that can
 * never be hit again.
 */
function resolvePair(starterId: string | null, languageId: string | null) {
  if (!starterId || !STARTER_IDS.has(starterId)) return null;
  const language = resolveLanguage(languageId);
  // Only catalogue languages have a stable id worth keying a shared row on.
  if (!language || language.id.startsWith("custom:")) return null;
  return { starterId, languageId: language.id };
}

/**
 * GET `/api/vaarta/preset?starter=…&language=…`
 *
 * Returns the cached world for a starter journey, or `{ bundle: null }` when it
 * has never been built. Always 200: a miss is the normal first case, not an
 * error, and the client simply generates instead.
 *
 * `lookupFailed` is true when the cache could not be consulted at all. A player
 * should ignore it and generate; the warmer must not, or an unreachable store
 * reads as "nothing is cached" and it rebuilds the whole catalogue.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const pair = resolvePair(url.searchParams.get("starter"), url.searchParams.get("language"));
  if (!pair) return NextResponse.json({ bundle: null, lookupFailed: false });

  const { bundle, answered } = await readPreset(pair.starterId, pair.languageId);
  return NextResponse.json({ bundle, lookupFailed: !answered });
}

/**
 * PUT `/api/vaarta/preset`
 *
 * Store a freshly generated starter world so the next learner walks straight
 * in. The payload is validated for shape before it lands, because this row is
 * shared with everyone who picks the same journey.
 */
export async function PUT(req: NextRequest) {
  let body: { starterId?: string; language?: string; bundle?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid preset payload." }, { status: 400 });
  }

  const pair = resolvePair(body?.starterId ?? null, body?.language ?? null);
  if (!pair) {
    return NextResponse.json({ error: "Not a cacheable journey." }, { status: 422 });
  }
  if (!isUsableBundle(body.bundle)) {
    return NextResponse.json({ error: "That world is not complete enough to cache." }, { status: 422 });
  }

  const persisted = await writePreset(pair.starterId, pair.languageId, body.bundle);
  return NextResponse.json({ persisted });
}
