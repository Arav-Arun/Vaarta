import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  listWorlds,
  publishWorld,
  VaartaWorldError,
  type PublishInput,
} from "@/lib/vaarta/worlds";

export const runtime = "nodejs";
// Publishing uploads every painted frame, which is a few megabytes.
export const maxDuration = 120;

/**
 * The signed-in learner, or null.
 *
 * `proxy.ts` already turns anonymous traffic away, so a null here means either
 * no Supabase project is configured at all or the warm token was used. Both are
 * machines, and neither has a library.
 */
async function viewer() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { supabase: null, user: null };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { supabase, user };
  } catch {
    return { supabase: null, user: null };
  }
}

/**
 * GET `/api/vaarta/worlds`: the community library, newest first.
 *
 * Always 200. An empty library and an unconfigured database look the same to
 * the dashboard, which simply omits the section — a gallery is not worth an
 * error state.
 */
export async function GET() {
  const { supabase, user } = await viewer();
  if (!supabase) return NextResponse.json({ worlds: [] });
  return NextResponse.json({ worlds: await listWorlds(supabase, user?.id ?? null) });
}

/**
 * POST `/api/vaarta/worlds`: publish the world the learner is playing.
 *
 * Never automatic. This runs only when somebody pressed "Share this world",
 * because publishing puts a person's writing in front of strangers and that is
 * not a decision to make on their behalf.
 */
export async function POST(req: NextRequest) {
  const { supabase, user } = await viewer();
  if (!supabase || !user) {
    return NextResponse.json({ error: "Sign in to share a world." }, { status: 401 });
  }

  let body: PublishInput;
  try {
    body = (await req.json()) as PublishInput;
  } catch {
    return NextResponse.json({ error: "Invalid world payload." }, { status: 400 });
  }

  try {
    return NextResponse.json(await publishWorld(supabase, user, body));
  } catch (error) {
    if (error instanceof VaartaWorldError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[/api/vaarta/worlds]", error);
    return NextResponse.json({ error: "That world could not be shared." }, { status: 503 });
  }
}
