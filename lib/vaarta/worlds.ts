/**
 * The community library: worlds a learner built and chose to publish.
 *
 * A published world is a finished thing. Everything expensive about it — the
 * plan, the ladder, the painted screens, the character — already exists, so
 * opening one costs no model calls at all. That is the whole point: the person
 * who wrote "a fish market at 5am in Kochi" pays for it once, and everyone who
 * wants to practise Malayalam in a fish market walks straight in.
 *
 * Art goes to Storage rather than into the row. The preset cache can afford
 * inline data URLs because it is bounded to 18 rows; a library is not bounded,
 * and multi-megabyte rows would turn listing the gallery into a download.
 *
 * Publishing is always explicit. Nothing here runs unless somebody pressed a
 * button that said so.
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { DEFAULT_RETRY_OPTS, withRetry } from "@/lib/retry";
import type { SceneData } from "@/lib/universe";
import { resolveLanguage } from "./languages";
import type { VaartaWorldPlan } from "./types";

/** Public Supabase Storage bucket for published world art. */
export const WORLD_ASSETS_BUCKET = "vaarta-worlds";

/**
 * Ceilings on one published world.
 *
 * The client decides what to send, so these are the only thing standing between
 * the library and a learner who has explored thirty screens uploading forty
 * megabytes of art into a single row. Eight scenes is the opening screen plus
 * its rooms plus room to wander; a 1K frame lands around 1MB, so four is a
 * generous per-frame ceiling rather than a tight one.
 */
const MAX_SCENES = 8;
const MAX_IMAGE_CHARS = 4_000_000;

/** What a gallery card needs, and nothing that would make listing expensive. */
export type PublishedWorldCard = {
  id: string;
  title: string;
  idea: string;
  promise: string;
  languageId: string;
  languageName: string;
  thumbnailUrl: string;
  createdAt: string;
  /** True when the signed-in learner is the one who published it. */
  mine: boolean;
};

/** Everything needed to walk into a published world without generating. */
export type PublishedWorld = PublishedWorldCard & {
  plan: VaartaWorldPlan;
  scenes: SceneData[];
  spriteUrl: string | null;
};

/** What the client hands over when it publishes a run. */
export type PublishInput = {
  plan: VaartaWorldPlan;
  scenes: SceneData[];
  sprite: string | null;
  idea: string;
};

type WorldRow = {
  id: string;
  author: string;
  title: string;
  idea: string;
  promise: string;
  language_id: string;
  language_name: string;
  plan?: VaartaWorldPlan;
  scenes?: SceneData[];
  sprite_url?: string | null;
  thumbnail_url: string;
  created_at: string;
};

/** Columns a card needs. Deliberately excludes `plan` and `scenes`. */
const CARD_COLUMNS =
  "id, author, title, idea, promise, language_id, language_name, thumbnail_url, created_at";

function toCard(row: WorldRow, viewer: string | null): PublishedWorldCard {
  return {
    id: row.id,
    title: row.title,
    idea: row.idea,
    promise: row.promise,
    languageId: row.language_id,
    languageName: row.language_name,
    thumbnailUrl: row.thumbnail_url,
    createdAt: row.created_at,
    mine: viewer !== null && row.author === viewer,
  };
}

/** A frame this module is willing to upload: inline, and not enormous. */
function isPublishableFrame(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:") && value.length <= MAX_IMAGE_CHARS;
}

function parseDataUrl(dataUrl: string): { mimeType: string; bytes: Uint8Array; ext: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid data URL.");
  const mimeType = match[1];
  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : mimeType.includes("jpeg") || mimeType.includes("jpg")
        ? "jpg"
        : "bin";
  return { mimeType, bytes: new Uint8Array(Buffer.from(match[2], "base64")), ext };
}

/**
 * Upload one inline frame and return the URL that replaces it.
 *
 * Paths start with the author's id because that is what the Storage policies
 * key on: a learner may only write inside their own folder.
 */
async function uploadFrame(
  supabase: SupabaseClient,
  authorId: string,
  worldId: string,
  name: string,
  dataUrl: string
): Promise<{ path: string; url: string }> {
  const { mimeType, bytes, ext } = parseDataUrl(dataUrl);
  const path = `${authorId}/${worldId}/${name}.${ext}`;
  await withRetry(async () => {
    const { error } = await supabase.storage
      .from(WORLD_ASSETS_BUCKET)
      .upload(path, bytes, { contentType: mimeType, upsert: true });
    if (error) throw error;
  }, DEFAULT_RETRY_OPTS);
  return { path, url: supabase.storage.from(WORLD_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl };
}

/** A learner-visible failure whose message is safe to show. */
export class VaartaWorldError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "VaartaWorldError";
    this.status = status;
  }
}

/**
 * Check a run is worth publishing before any of it is uploaded.
 *
 * The order matters: uploading first and validating second would leave orphaned
 * art in Storage every time somebody published a half-built world.
 */
function assertPublishable(input: PublishInput): void {
  const bible = input.plan?.bible;
  const curriculum = input.plan?.curriculum;
  if (!bible?.title || !bible.story?.goal) {
    throw new VaartaWorldError("That world has no story to publish yet.", 422);
  }
  if (!Array.isArray(bible.rooms) || bible.rooms.length !== 3) {
    throw new VaartaWorldError("A world needs all three of its rooms before it can be shared.", 422);
  }
  if (!curriculum?.objectives?.length) {
    throw new VaartaWorldError("That world has no lesson ladder to publish.", 422);
  }
  const scenes = Array.isArray(input.scenes) ? input.scenes : [];
  if (!scenes.some((scene) => scene?.id && isPublishableFrame(scene.image))) {
    throw new VaartaWorldError("Nothing has been painted in that world yet.", 422);
  }
}

/**
 * Which screens travel, newest-first up to the cap, with the opening screen
 * always kept.
 *
 * Dropping the opening screen would publish a world with nowhere to stand, so
 * it is pinned regardless of how much else the author explored.
 */
function scenesToPublish(scenes: SceneData[]): SceneData[] {
  const usable = scenes.filter((scene) => scene?.id && isPublishableFrame(scene.image));
  const origin = usable.filter((scene) => scene.id === "s0_0");
  const rest = usable.filter((scene) => scene.id !== "s0_0");
  return [...origin, ...rest].slice(0, MAX_SCENES);
}

/**
 * Publish a run to the library.
 *
 * Only screens that were actually painted travel: an unpainted room is left out
 * rather than published as a hole, and whoever opens the world paints it then,
 * exactly as the author would have.
 */
export async function publishWorld(
  supabase: SupabaseClient,
  user: User,
  input: PublishInput
): Promise<{ id: string }> {
  assertPublishable(input);

  const language = resolveLanguage(input.plan.curriculum.language?.id);
  const languageId = language?.id ?? input.plan.curriculum.language?.id ?? "";
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(languageId)) {
    throw new VaartaWorldError("That world's language cannot be published.", 422);
  }

  // The row id is minted here rather than by the database, because every
  // Storage path has to contain it and the art is uploaded first.
  const worldId = crypto.randomUUID();

  // Everything uploaded so far, so a failure can take its own litter with it.
  // Without this, a publish that dies between the first upload and the insert
  // leaves frames in Storage that no row will ever reference or delete.
  const uploaded: string[] = [];
  const discardUploads = async () => {
    if (!uploaded.length) return;
    await supabase.storage.from(WORLD_ASSETS_BUCKET).remove(uploaded).catch(() => {});
  };
  const upload = async (name: string, dataUrl: string) => {
    const { path, url } = await uploadFrame(supabase, user.id, worldId, name, dataUrl);
    uploaded.push(path);
    return url;
  };

  let scenes: SceneData[];
  let spriteUrl: string | null;
  try {
    scenes = [];
    for (const scene of scenesToPublish(input.scenes)) {
      // The traced overlay is a debug view; it does not survive publishing.
      const { annotated, ...rest } = scene;
      void annotated;
      scenes.push({ ...rest, image: await upload(`scene-${scene.id}`, scene.image) });
    }
    spriteUrl = isPublishableFrame(input.sprite) ? await upload("sprite", input.sprite) : null;
  } catch (cause) {
    await discardUploads();
    console.error("[vaarta/worlds] upload failed:", cause);
    throw new VaartaWorldError("That world's art could not be uploaded. Try again.", 503);
  }

  const opening = scenes.find((scene) => scene.id === "s0_0") ?? scenes[0];

  const { error } = await supabase.from("vaarta_worlds").insert({
    id: worldId,
    author: user.id,
    title: input.plan.bible.title.slice(0, 120),
    idea: (input.idea ?? "").slice(0, 420),
    promise: (input.plan.curriculum.promise ?? "").slice(0, 200),
    language_id: languageId,
    language_name: language?.name ?? "",
    plan: input.plan,
    scenes,
    sprite_url: spriteUrl,
    thumbnail_url: opening?.image ?? "",
  });
  if (error) {
    await discardUploads();
    console.error("[vaarta/worlds] publish failed:", error.message);
    throw new VaartaWorldError("That world could not be shared. Try again.", 503);
  }

  return { id: worldId };
}

/** The most recent published worlds, newest first. */
export async function listWorlds(
  supabase: SupabaseClient,
  viewer: string | null,
  limit = 24
): Promise<PublishedWorldCard[]> {
  const { data, error } = await supabase
    .from("vaarta_worlds")
    .select(CARD_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 48));
  if (error) {
    // Almost always "relation does not exist": migration 0006 has not been run.
    console.error("[vaarta/worlds] list failed:", error.message);
    return [];
  }
  return ((data ?? []) as WorldRow[]).map((row) => toCard(row, viewer));
}

/** One published world, with everything needed to play it. */
export async function readWorld(
  supabase: SupabaseClient,
  viewer: string | null,
  id: string
): Promise<PublishedWorld | null> {
  const { data, error } = await supabase
    .from("vaarta_worlds")
    .select(`${CARD_COLUMNS}, plan, scenes, sprite_url`)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[vaarta/worlds] read failed:", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as WorldRow;
  if (!row.plan?.bible || !row.plan.curriculum) return null;
  return {
    ...toCard(row, viewer),
    plan: row.plan,
    scenes: (row.scenes ?? []) as SceneData[],
    spriteUrl: row.sprite_url ?? null,
  };
}

/** Remove a world and every frame it uploaded. Authors only, enforced by RLS. */
export async function deleteWorld(
  supabase: SupabaseClient,
  user: User,
  id: string
): Promise<boolean> {
  const prefix = `${user.id}/${id}`;
  const { data: files } = await supabase.storage.from(WORLD_ASSETS_BUCKET).list(prefix, {
    limit: 100,
  });
  if (files?.length) {
    await supabase.storage
      .from(WORLD_ASSETS_BUCKET)
      .remove(files.map((file) => `${prefix}/${file.name}`));
  }
  const { error } = await supabase.from("vaarta_worlds").delete().eq("id", id).eq("author", user.id);
  if (error) {
    console.error("[vaarta/worlds] delete failed:", error.message);
    return false;
  }
  return true;
}
