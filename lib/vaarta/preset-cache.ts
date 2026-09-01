/**
 * Cached worlds for the three starter journeys.
 *
 * "The Last Bus Out" in Marathi is the same world every time it is played, so
 * generating it again on every visit burns roughly eleven model calls to arrive
 * at the same place. This module makes the first learner pay for it and nobody
 * else.
 *
 * Two layers, both optional:
 *
 *  1. **Process memory** — instant, survives nothing, costs nothing. Enough to
 *     make a second start in the same dev session immediate.
 *  2. **Postgres** — durable and shared across everyone, when Supabase is
 *     configured. Absent that, the memory layer still works and the app is
 *     simply back to generating per visit.
 *
 * Custom worlds are never cached: they are unique by definition, and a cache
 * keyed by a freeform prompt would never hit.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { SceneData } from "@/lib/universe";
import type { VaartaWorldPlan } from "./types";

/** Everything needed to enter a starter world without generating anything. */
export type PresetBundle = {
  plan: VaartaWorldPlan;
  scenes: SceneData[];
  sprite: string | null;
};

/**
 * Ceiling on one cached scene's inline art, in characters of base64.
 *
 * A 1K frame lands around 1MB; anything several times that is a payload worth
 * refusing rather than storing for everyone.
 */
const MAX_IMAGE_CHARS = 4_000_000;
const MAX_SCENES = 8;

/**
 * How many bundles the process keeps hot.
 *
 * Each one carries its art inline, so a bundle is megabytes, not kilobytes.
 * An unbounded map of those in a server that stays up for days is a leak with a
 * polite name: this one reached 2GB overnight and stopped answering. Four is
 * enough for the pairs anyone is actually playing right now, and Postgres is
 * still there for the rest.
 */
const MEMORY_LIMIT = 4;

const memory = new Map<string, PresetBundle>();

function key(starterId: string, languageId: string): string {
  return `${starterId}:${languageId}`;
}

/** Read through the hot set, marking a hit as most recently used. */
function remember(cacheKey: string): PresetBundle | undefined {
  const hit = memory.get(cacheKey);
  if (!hit) return undefined;
  // Map iterates in insertion order, so re-inserting is what makes this an LRU.
  memory.delete(cacheKey);
  memory.set(cacheKey, hit);
  return hit;
}

/** Keep a bundle hot, evicting the least recently used to stay under the cap. */
function keep(cacheKey: string, bundle: PresetBundle): void {
  memory.delete(cacheKey);
  memory.set(cacheKey, bundle);
  while (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next();
    if (oldest.done) break;
    memory.delete(oldest.value);
  }
}

/**
 * Strip the traced "vision" frame before caching.
 *
 * It exists so the map-view toggle can show what the engine saw, which is a
 * debug affordance, and keeping it would roughly double every cached row.
 */
function slimScene(scene: SceneData): SceneData {
  const rest = { ...scene };
  delete rest.annotated;
  return rest;
}

function isDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:") && value.length <= MAX_IMAGE_CHARS;
}

/**
 * Reject anything that would poison the cache for everyone else.
 *
 * This is the only thing standing between a shared, unauthenticated cache and a
 * broken starter journey, so it checks structure rather than trusting the
 * caller: the world must have its three rooms, three characters and a usable
 * ladder, and every scene must carry real inline art.
 */
export function isUsableBundle(value: unknown): value is PresetBundle {
  if (!value || typeof value !== "object") return false;
  const bundle = value as Partial<PresetBundle>;
  const bible = bundle.plan?.bible;
  const curriculum = bundle.plan?.curriculum;
  if (!bible?.story?.goal || !bible.title) return false;
  if (!Array.isArray(bible.rooms) || bible.rooms.length !== 3) return false;
  if (!Array.isArray(bible.npcs) || bible.npcs.length !== 3) return false;
  if (!Array.isArray(bible.story.clues) || bible.story.clues.length !== 3) return false;
  if (!curriculum?.language?.id || !Array.isArray(curriculum.objectives)) return false;
  if (curriculum.objectives.length < 3) return false;

  if (!Array.isArray(bundle.scenes) || bundle.scenes.length === 0) return false;
  if (bundle.scenes.length > MAX_SCENES) return false;
  for (const scene of bundle.scenes) {
    if (!scene?.id || !Array.isArray(scene.hotspots)) return false;
    if (scene.kind !== "street" && scene.kind !== "interior") return false;
    if (!isDataUrl(scene.image)) return false;
  }
  // The opening screen is the one scene that must be present, or the learner
  // arrives in a world with nowhere to stand.
  if (!bundle.scenes.some((scene) => scene.id === "s0_0")) return false;
  if (bundle.sprite != null && !isDataUrl(bundle.sprite)) return false;
  return true;
}

async function db(): Promise<SupabaseClient | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  try {
    return await createClient();
  } catch {
    return null;
  }
}

/**
 * What the cache could tell us about one starter journey.
 *
 * `answered` is the part that matters to anything expensive. "There is no
 * cached world" and "I could not find out" both arrive as `bundle: null`, and
 * treating the second as the first is how a two-minute network drop turns into
 * rebuilding worlds that were already cached, at eleven model calls each. A
 * player can safely ignore the distinction and just generate; the warmer
 * cannot.
 */
export type PresetLookup = {
  bundle: PresetBundle | null;
  answered: boolean;
};

/** Read a cached starter world. */
export async function readPreset(
  starterId: string,
  languageId: string
): Promise<PresetLookup> {
  const hit = remember(key(starterId, languageId));
  if (hit) return { bundle: hit, answered: true };

  const client = await db();
  // No Supabase at all is still a definite answer: this deployment has no
  // durable cache, so there is nothing to wait for.
  if (!client) return { bundle: null, answered: true };

  const { data, error } = await client
    .from("vaarta_preset_worlds")
    .select("plan, scenes, sprite")
    .eq("starter_id", starterId)
    .eq("language_id", languageId)
    .maybeSingle();
  if (error) {
    // Either migration 0004 has not been run, or the store was unreachable.
    // Neither is evidence that the world is missing.
    console.error("[vaarta/preset-cache] read failed:", error.message);
    return { bundle: null, answered: false };
  }
  if (!data) return { bundle: null, answered: true };

  const bundle: PresetBundle = {
    plan: data.plan as VaartaWorldPlan,
    scenes: (data.scenes ?? []) as SceneData[],
    sprite: (data.sprite as string | null) ?? null,
  };
  if (!isUsableBundle(bundle)) {
    // A definite answer, just an unwelcome one: the row exists and is junk.
    console.error("[vaarta/preset-cache] stored bundle is unusable; ignoring it");
    return { bundle: null, answered: true };
  }
  keep(key(starterId, languageId), bundle);
  return { bundle, answered: true };
}

/**
 * Store (or extend) a cached starter world.
 *
 * Scenes are merged by id rather than replaced, so a room painted five minutes
 * into a run joins the same row as the opening screen. The plan itself is only
 * written once: rewriting it would silently change the ladder under anyone
 * mid-run against the cached copy.
 */
export async function writePreset(
  starterId: string,
  languageId: string,
  bundle: PresetBundle
): Promise<boolean> {
  const slim: PresetBundle = {
    plan: bundle.plan,
    scenes: bundle.scenes.map(slimScene),
    sprite: bundle.sprite,
  };

  const existing = remember(key(starterId, languageId));
  const merged: PresetBundle = existing
    ? {
        plan: existing.plan,
        scenes: mergeScenes(existing.scenes, slim.scenes),
        sprite: existing.sprite ?? slim.sprite,
      }
    : slim;
  keep(key(starterId, languageId), merged);

  const client = await db();
  if (!client) return false;

  const { data: stored } = await client
    .from("vaarta_preset_worlds")
    .select("plan, scenes, sprite")
    .eq("starter_id", starterId)
    .eq("language_id", languageId)
    .maybeSingle();

  const next: PresetBundle = stored
    ? {
        plan: stored.plan as VaartaWorldPlan,
        scenes: mergeScenes((stored.scenes ?? []) as SceneData[], slim.scenes),
        sprite: (stored.sprite as string | null) ?? slim.sprite,
      }
    : merged;

  const { error } = await client.from("vaarta_preset_worlds").upsert(
    {
      starter_id: starterId,
      language_id: languageId,
      plan: next.plan,
      scenes: next.scenes.slice(0, MAX_SCENES),
      sprite: next.sprite,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "starter_id,language_id" }
  );
  if (error) {
    console.error("[vaarta/preset-cache] write failed:", error.message);
    return false;
  }
  keep(key(starterId, languageId), next);
  return true;
}

/** Merge incoming scenes over existing ones, keyed by scene id. */
function mergeScenes(existing: SceneData[], incoming: SceneData[]): SceneData[] {
  const byId = new Map(existing.map((scene) => [scene.id, scene]));
  for (const scene of incoming) byId.set(scene.id, scene);
  return [...byId.values()].slice(0, MAX_SCENES);
}
