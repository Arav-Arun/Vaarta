import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteWorld, readWorld } from "@/lib/vaarta/worlds";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** GET `/api/vaarta/worlds/[id]`: one published world, ready to walk into. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "No such world." }, { status: 404 });

  const { supabase, user } = await viewer();
  if (!supabase) return NextResponse.json({ error: "No such world." }, { status: 404 });

  const world = await readWorld(supabase, user?.id ?? null, id);
  if (!world) return NextResponse.json({ error: "No such world." }, { status: 404 });
  return NextResponse.json({ world });
}

/**
 * DELETE `/api/vaarta/worlds/[id]`: unpublish.
 *
 * Row-level security is what actually enforces authorship; the `author` filter
 * in the query is belt and braces, so a mistake here cannot delete a stranger's
 * world even if a policy were later loosened.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "No such world." }, { status: 404 });

  const { supabase, user } = await viewer();
  if (!supabase || !user) {
    return NextResponse.json({ error: "Sign in to manage your worlds." }, { status: 401 });
  }
  const removed = await deleteWorld(supabase, user, id);
  if (!removed) return NextResponse.json({ error: "That world could not be removed." }, { status: 503 });
  return NextResponse.json({ removed: true });
}
