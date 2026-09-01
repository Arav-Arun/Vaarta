/**
 * The built-in four-direction walking character.
 *
 * Worlds get a generated sprite matched to their own art style, but that takes
 * a model call and arrives seconds after the first screen does. Until then the
 * player used to be a coloured dot, which made the opening moments of every
 * world feel like a prototype. These frames — real pixel art, already in the
 * repo — mean there is a character on screen from the first frame, and the
 * generated sprite simply replaces it when it lands.
 */

"use client";

import { preloadImage } from "@/lib/image-cache";

export type Facing = "down" | "up" | "left" | "right";

/** Four frames per direction: contact, passing, contact, passing. */
export type WalkSprite = Record<Facing, HTMLImageElement[]>;

const FACINGS: Facing[] = ["down", "up", "left", "right"];
const FRAMES_PER_FACING = 4;

const DEFAULT_BASE = "/vaarta/sprites/traveller";

let cached: Promise<WalkSprite | null> | null = null;

/**
 * Load the walk cycle once per page.
 *
 * Resolves to null rather than throwing when the frames are missing: a game
 * that refuses to start because a decorative sprite 404'd would be a worse
 * outcome than the dot it replaces.
 */
export function loadWalkSprite(base: string = DEFAULT_BASE): Promise<WalkSprite | null> {
  cached ??= (async () => {
    try {
      const entries = await Promise.all(
        FACINGS.map(async (facing) => {
          const frames = await Promise.all(
            Array.from({ length: FRAMES_PER_FACING }, (_, index) =>
              preloadImage(`${base}/${facing}-${index}.png`)
            )
          );
          return [facing, frames] as const;
        })
      );
      return Object.fromEntries(entries) as WalkSprite;
    } catch {
      return null;
    }
  })();
  return cached;
}

/**
 * Pick the frame for a moment in the walk cycle.
 *
 * Standing still returns frame 0 — the contact pose — rather than freezing
 * wherever the animation happened to stop, so a stopped character always reads
 * as standing rather than mid-stride.
 */
export function walkFrame(
  sprite: WalkSprite,
  facing: Facing,
  moving: boolean,
  nowMs: number
): HTMLImageElement | null {
  const frames = sprite[facing];
  if (!frames?.length) return null;
  if (!moving) return frames[0];
  return frames[Math.floor(nowMs / 140) % frames.length];
}

/** Which way to face, from this frame's movement axes. */
export function facingFrom(vx: number, vy: number, previous: Facing): Facing {
  if (vx === 0 && vy === 0) return previous;
  // Vertical wins ties: in a top-down world, walking away from the camera
  // reads more clearly than a sideways shuffle on a diagonal.
  if (Math.abs(vy) >= Math.abs(vx)) return vy < 0 ? "up" : "down";
  return vx < 0 ? "left" : "right";
}
