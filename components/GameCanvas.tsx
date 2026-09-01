"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Hotspot, Rect, SceneData } from "@/lib/universe";
import { getCachedImage, preloadImage } from "@/lib/image-cache";
import {
  facingFrom,
  loadWalkSprite,
  walkFrame,
  type Facing,
  type WalkSprite,
} from "@/lib/walk-sprite";

const SPEED_X = 26; // % of width per second
const SPEED_Y = 20; // % of height per second

/**
 * The player's footprint, in percent of the frame.
 *
 * Deliberately small and centred on the feet rather than the whole sprite: in
 * a top-down world the character's head visually overlaps things they are
 * standing in front of, and colliding with their head makes every doorway feel
 * half a tile too narrow.
 */
const FOOT_HALF_WIDTH = 2.2;
const FOOT_ABOVE = 2;
const FOOT_BELOW = 0.8;

/**
 * Player height as a fraction of the backdrop.
 *
 * Measured against the people the image model paints into its own streets,
 * which land around 6-8% of frame height. Sitting just above them reads as the
 * foreground character without towering over the world. The caret below is what
 * actually guarantees findability, so this can stay honest to the art.
 */
const SPRITE_HEIGHT_FRACTION = 0.125;

export type PlayerState = {
  x: number; // 0-100 (% of width)
  y: number; // 0-100 (% of height)
  dir: 1 | -1;
  facing: Facing;
  moving: boolean;
};

export type ExitDirection = "n" | "e" | "s" | "w";

/** Discrete joystick axes written by mobile controls (-1, 0, or 1). */
export type TouchInput = { x: number; y: number };

function interactionLabel(near: Hotspot, touchControls: boolean): string {
  const prefix = touchControls ? "Action:" : "E:";
  switch (near.kind) {
    case "building":
      return `${prefix} enter ${near.name}`;
    case "npc":
      return `${prefix} talk to ${near.name}`;
    case "item":
      return `${prefix} pick up ${near.name}`;
    default:
      return `${prefix} ${near.name}`;
  }
}

/** True when the player's feet, placed at (x, y), would be inside something solid. */
function blocked(x: number, y: number, solids: Rect[]): boolean {
  const left = x - FOOT_HALF_WIDTH;
  const right = x + FOOT_HALF_WIDTH;
  const top = y - FOOT_ABOVE;
  const bottom = y + FOOT_BELOW;
  for (const rect of solids) {
    if (
      left < rect.x + rect.w &&
      right > rect.x &&
      top < rect.y + rect.h &&
      bottom > rect.y
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Find open ground near a spawn point.
 *
 * A player who arrives inside a wall cannot move at all — every direction is
 * blocked — so this is not a nicety. Spirals outward from the requested point
 * and gives up (returning it unchanged) rather than looping forever on a
 * screen the vision pass boxed badly; walking through one bad wall beats being
 * frozen on arrival.
 */
function nearestFreeSpot(x: number, y: number, solids: Rect[]): { x: number; y: number } {
  if (!blocked(x, y, solids)) return { x, y };
  for (let radius = 3; radius <= 30; radius += 3) {
    for (let angle = 0; angle < 360; angle += 30) {
      const radians = (angle * Math.PI) / 180;
      const cx = Math.max(3, Math.min(97, x + Math.cos(radians) * radius));
      const cy = Math.max(6, Math.min(95, y + Math.sin(radians) * radius * 0.8));
      if (!blocked(cx, cy, solids)) return { x: cx, y: cy };
    }
  }
  return { x, y };
}

export function GameCanvas({
  scene,
  sprite,
  paused,
  onInteract,
  spawn,
  onExitEdge,
  onPosition,
  onNearChange,
  showVision,
  touchInputRef,
  touchControls = false,
}: {
  scene: SceneData;
  sprite: HTMLCanvasElement | null;
  /** True while dialogue / overlays own the keyboard. */
  paused: boolean;
  onInteract: (hotspot: Hotspot) => void;
  /** Where to place the player on scene change (e.g. entering from an edge). */
  spawn?: { x: number; y: number } | null;
  /** Fired once when the player walks off an open edge of an overworld screen. */
  onExitEdge?: (dir: ExitDirection) => void;
  /** Live player pose for HUD (minimap); throttled in the render loop. */
  onPosition?: (p: PlayerState) => void;
  /** Hotspot within interaction range; throttled for mobile action button. */
  onNearChange?: (hotspot: Hotspot | null) => void;
  /** Show the engine's traced frame and its collision map instead of the clean one. */
  showVision?: boolean;
  /** Joystick axes from mobile controls; merged with keyboard each frame. */
  touchInputRef?: RefObject<TouchInput>;
  /** Swap in-canvas prompt copy for touch (Action vs E). */
  touchControls?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const visionRef = useRef<HTMLImageElement | null>(null);
  const walkRef = useRef<WalkSprite | null>(null);
  const showVisionRef = useRef(Boolean(showVision));
  const keysRef = useRef<Record<string, boolean>>({});
  const playerRef = useRef<PlayerState>({
    x: 12,
    y: 70,
    dir: 1,
    facing: "down",
    moving: false,
  });
  const nearRef = useRef<Hotspot | null>(null);
  const exitFiredRef = useRef(false);
  const onExitEdgeRef = useRef(onExitEdge);
  const onPositionRef = useRef(onPosition);
  const pausedRef = useRef(paused);
  const touchInputRefProp = useRef(touchInputRef);
  const touchControlsRef = useRef(touchControls);
  const onNearChangeRef = useRef(onNearChange);
  // The render loop and window listeners read the newest props through refs so
  // they never re-subscribe. Refs must only be written after commit, so this
  // deliberately dependency-free effect runs the sync on every render.
  useEffect(() => {
    showVisionRef.current = Boolean(showVision);
    onExitEdgeRef.current = onExitEdge;
    onPositionRef.current = onPosition;
    pausedRef.current = paused;
    touchInputRefProp.current = touchInputRef;
    touchControlsRef.current = touchControls;
    onNearChangeRef.current = onNearChange;
  });
  const debugRef = useRef(false);
  const mainColorRef = useRef("#ffbf00");
  useEffect(() => {
    debugRef.current = new URLSearchParams(window.location.search).has("debug");
    const main = getComputedStyle(document.documentElement)
      .getPropertyValue("--main")
      .trim();
    if (main) mainColorRef.current = main;
  }, []);

  // The built-in walk cycle: a real character on screen before the world's own
  // generated sprite finishes rendering.
  useEffect(() => {
    let cancelled = false;
    loadWalkSprite().then((loaded) => {
      if (!cancelled) walkRef.current = loaded;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // (Re)load the backdrop when the scene changes; spawn on walkable ground.
  // crossOrigin is required for Supabase Storage URLs used in the canvas loop.
  useEffect(() => {
    let cancelled = false;

    const applyBackdrop = (img: HTMLImageElement) => {
      if (!cancelled) imgRef.current = img;
    };

    const cached = getCachedImage(scene.image);
    if (cached) {
      applyBackdrop(cached);
    } else {
      preloadImage(scene.image).then(applyBackdrop).catch(() => {});
    }

    visionRef.current = null;
    if (scene.annotated) {
      const visCached = getCachedImage(scene.annotated);
      if (visCached) {
        visionRef.current = visCached;
      } else {
        preloadImage(scene.annotated)
          .then((vis) => {
            if (!cancelled) visionRef.current = vis;
          })
          .catch(() => {});
      }
    }

    const startX = spawn?.x ?? (scene.kind === "interior" ? 50 : 14);
    const startY = spawn?.y ?? 72;
    const safe = nearestFreeSpot(startX, startY, scene.obstacles ?? []);
    playerRef.current = {
      x: safe.x,
      y: safe.y,
      dir: 1,
      facing: scene.kind === "interior" ? "up" : "down",
      moving: false,
    };
    exitFiredRef.current = false;
    onPositionRef.current?.(playerRef.current);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- spawn only applies at scene change
  }, [scene.id, scene.image, scene.kind, scene.annotated, scene.obstacles]);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (pausedRef.current) return;
      const k = e.key.toLowerCase();
      if (["arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s", "e", "enter"].includes(k)) {
        e.preventDefault();
      }
      if (k === "e" || k === "enter") {
        const near = nearRef.current;
        if (near) onInteract(near);
        return;
      }
      keysRef.current[k] = true;
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [onInteract]);

  // Render loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastTick = performance.now();
    let lastPositionReport = 0;
    let lastReported = { x: 0, y: 0, moving: false };
    let lastNearReport = 0;
    let lastReportedNear: Hotspot | null = null;
    const solids = scene.obstacles ?? [];

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      lastTick = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = parent.clientWidth;
      const ch = parent.clientHeight;
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false; // crisp pixel-art upscale

      // --- Move on the flat plane, resolving each axis separately so a
      //     diagonal into a wall slides along it instead of stopping dead ---
      const p = playerRef.current;
      if (!pausedRef.current) {
        const keys = keysRef.current;
        const touch = touchInputRefProp.current?.current ?? { x: 0, y: 0 };
        let vx = 0;
        let vy = 0;
        if (keys["arrowleft"] || keys["a"] || touch.x < 0) vx -= 1;
        if (keys["arrowright"] || keys["d"] || touch.x > 0) vx += 1;
        if (keys["arrowup"] || keys["w"] || touch.y < 0) vy -= 1;
        if (keys["arrowdown"] || keys["s"] || touch.y > 0) vy += 1;
        if (vx !== 0) p.dir = vx > 0 ? 1 : -1;
        p.facing = facingFrom(vx, vy, p.facing);
        p.moving = vx !== 0 || vy !== 0;

        const nextX = Math.max(2, Math.min(98, p.x + vx * SPEED_X * dt));
        if (!blocked(nextX, p.y, solids)) p.x = nextX;

        const nextY = Math.max(4, Math.min(96, p.y + vy * SPEED_Y * dt));
        if (!blocked(p.x, nextY, solids)) p.y = nextY;

        // --- Walk off an open edge → the world continues one screen over ---
        const edges = scene.edges;
        if (edges && onExitEdgeRef.current && !exitFiredRef.current) {
          let dir: ExitDirection | null = null;
          if (vx > 0 && p.x >= 97.5 && edges.e) dir = "e";
          else if (vx < 0 && p.x <= 2.5 && edges.w) dir = "w";
          else if (vy < 0 && p.y <= 4.5 && edges.n) dir = "n";
          else if (vy > 0 && p.y >= 95.5 && edges.s) dir = "s";
          if (dir) {
            exitFiredRef.current = true;
            onExitEdgeRef.current(dir);
          }
        }
        // Stepping back from the edge re-arms the exit (covers failed loads).
        if (exitFiredRef.current && p.x > 8 && p.x < 92 && p.y > 10 && p.y < 90) {
          exitFiredRef.current = false;
        }
      } else {
        p.moving = false;
      }

      const reportPosition = onPositionRef.current;
      if (reportPosition) {
        const moved =
          p.x !== lastReported.x ||
          p.y !== lastReported.y ||
          p.moving !== lastReported.moving;
        if (moved && now - lastPositionReport >= 100) {
          lastPositionReport = now;
          lastReported = { x: p.x, y: p.y, moving: p.moving };
          reportPosition(p);
        }
      }

      // --- Near hotspot? Pick the CLOSEST one in range, not the first: a
      //     screen now carries up to a dozen, and array order is arbitrary ---
      const px = p.x;
      const py = p.y;
      let near: Hotspot | null = null;
      let nearestDistance = Infinity;
      for (const h of scene.hotspots) {
        const m = 4; // forgiving margin (percent)
        if (
          px >= h.rect.x - m &&
          px <= h.rect.x + h.rect.w + m &&
          py >= h.rect.y - m &&
          py <= h.rect.y + h.rect.h + m
        ) {
          const cx = h.rect.x + h.rect.w / 2;
          const cy = h.rect.y + h.rect.h / 2;
          const distance = (px - cx) ** 2 + (py - cy) ** 2;
          if (distance < nearestDistance) {
            nearestDistance = distance;
            near = h;
          }
        }
      }
      nearRef.current = near;

      const reportNear = onNearChangeRef.current;
      if (reportNear) {
        const nearChanged = near?.id !== lastReportedNear?.id;
        if (nearChanged && now - lastNearReport >= 100) {
          lastNearReport = now;
          lastReportedNear = near;
          reportNear(near);
        }
      }

      // --- Draw backdrop (cover fit; game coords are % of the image) ---
      const img =
        showVisionRef.current && visionRef.current
          ? visionRef.current
          : imgRef.current;
      let ox = 0;
      let oy = 0;
      let dw = cw;
      let dh = ch;
      // CONTAIN, not cover.
      //
      // Every hotspot, wall and the player itself is positioned in percent of
      // the backdrop, so anything cropped out of the frame is not merely
      // unseen — it is unreachable. With both rails open the canvas goes nearly
      // square, and a 16:9 map cover-fitted into that put the spawn point at
      // x = -128px: the player existed, moved, and collided correctly, entirely
      // off-screen. Letterboxing is a far smaller cost than a hidden third of
      // the world.
      ctx.fillStyle = "#14100d";
      ctx.fillRect(0, 0, cw, ch);
      if (img && img.naturalWidth > 0) {
        const s = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
        dw = img.naturalWidth * s;
        dh = img.naturalHeight * s;
        ox = (cw - dw) / 2;
        oy = (ch - dh) / 2;
        ctx.drawImage(img, ox, oy, dw, dh);
      }
      const X = (pxPct: number) => ox + (pxPct / 100) * dw;
      const Y = (pyPct: number) => oy + (pyPct / 100) * dh;

      // --- Engine vision: show the collision map over the traced frame, so
      //     "what the engine sees" includes what it will not let you walk into.
      if ((showVisionRef.current || debugRef.current) && solids.length) {
        ctx.save();
        ctx.fillStyle = "rgba(255,0,110,0.16)";
        ctx.strokeStyle = "rgba(255,0,110,0.65)";
        ctx.lineWidth = 1.5;
        for (const rect of solids) {
          const rx = X(rect.x);
          const ry = Y(rect.y);
          const rw = (rect.w / 100) * dw;
          const rh = (rect.h / 100) * dh;
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
        }
        ctx.restore();
      }

      // --- Debug overlay (?debug=1): player state ---
      if (debugRef.current) {
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(8, ch - 30, 260, 22);
        ctx.fillStyle = "#7CFC9E";
        ctx.font = "12px monospace";
        ctx.fillText(
          `x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} ${p.facing} solids=${solids.length}`,
          14,
          ch - 14
        );
      }

      // --- Hotspot affordances ---
      for (const h of scene.hotspots) {
        const hx = X(h.rect.x);
        const hy = Y(h.rect.y);
        const hw = (h.rect.w / 100) * dw;
        const hh = (h.rect.h / 100) * dh;
        const isNear = near?.id === h.id;

        const t = now / 500;
        const bob = Math.sin(t + h.rect.x) * 3;
        ctx.beginPath();
        ctx.arc(hx + hw / 2, hy - 10 + bob, isNear ? 6 : 4, 0, Math.PI * 2);
        const baseColor =
          h.kind === "item"
            ? "rgba(255,215,80,0.9)"
            : h.kind === "action"
              ? "rgba(120,200,255,0.9)"
              : h.kind === "npc"
                ? "rgba(150,255,170,0.95)"
                : "rgba(255,255,255,0.75)";
        ctx.fillStyle = isNear ? "#ffb24d" : baseColor;
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;

        if (isNear) {
          ctx.strokeStyle = "rgba(255,178,77,0.9)";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 5]);
          ctx.strokeRect(hx, hy, hw, hh);
          ctx.setLineDash([]);
        }

        // Doors carry a standing label. Everything a learner can DO in this
        // game is behind one of them, and a 4px bobbing dot is not a findable
        // affordance on a screen this dense: without this you can walk a whole
        // world without realising there was anywhere to go.
        if (h.kind === "building" && !isNear) {
          const label = h.name;
          ctx.font = "700 11px var(--font-sans), system-ui, sans-serif";
          const tw = ctx.measureText(label).width;
          const bx = hx + hw / 2 - tw / 2 - 8;
          const by = hy - 34 + bob;
          ctx.fillStyle = "rgba(20,14,10,0.72)";
          ctx.beginPath();
          ctx.roundRect(bx, by, tw + 16, 18, 9);
          ctx.fill();
          ctx.fillStyle = "rgba(255,203,110,0.95)";
          ctx.fillText(label, bx + 8, by + 13);
        }
      }

      // --- Player sprite (constant size, like a real overworld character) ---
      const footX = X(px);
      const footY = Y(py);
      // Sized against the people the image model paints into its own frames,
      // which sit around 5% of the frame height. A touch larger than them, so
      // the player reads as the foreground character without towering over the
      // world they are standing in.
      const spriteH = dh * SPRITE_HEIGHT_FRACTION;

      ctx.beginPath();
      ctx.ellipse(footX, footY, spriteH * 0.22, spriteH * 0.07, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fill();

      const bob = p.moving ? Math.abs(Math.sin(now / 110)) * spriteH * 0.04 : 0;
      const walk = walkRef.current;
      const walkImage = walk ? walkFrame(walk, p.facing, p.moving, now) : null;

      if (sprite) {
        // The world's own generated character, once it has arrived.
        const ratio = sprite.width / sprite.height;
        const sh = spriteH;
        const sw = sh * ratio;
        ctx.save();
        ctx.translate(footX, footY - bob);
        if (p.dir === -1) ctx.scale(-1, 1);
        ctx.drawImage(sprite, -sw / 2, -sh, sw, sh);
        ctx.restore();
      } else if (walkImage && walkImage.naturalWidth > 0) {
        const ratio = walkImage.naturalWidth / walkImage.naturalHeight;
        const sh = spriteH;
        const sw = sh * ratio;
        ctx.drawImage(walkImage, footX - sw / 2, footY - bob - sh, sw, sh);
      } else {
        ctx.beginPath();
        ctx.arc(footX, footY - spriteH * 0.5, spriteH * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = mainColorRef.current;
        ctx.fill();
      }

      // --- "You are here" caret ---
      // A generated street can be dense enough to lose a character in, and
      // scale alone cannot fix that without making the player look wrong. This
      // marker is the guarantee: whatever the frame contains, the player can
      // always find themselves on it at a glance.
      {
        // Bobs on its own clock so it reads as a marker rather than part of the
        // art, and is drawn last so nothing in a busy frame can sit over it.
        const float = Math.sin(now / 420) * 3;
        const caretY = footY - spriteH - 14 - bob + float;
        const caretW = Math.max(9, spriteH * 0.2);
        const caretH = caretW * 1.1;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(footX - caretW, caretY - caretH);
        ctx.lineTo(footX + caretW, caretY - caretH);
        ctx.lineTo(footX, caretY);
        ctx.closePath();
        ctx.fillStyle = mainColorRef.current;
        ctx.strokeStyle = "rgba(20,14,10,0.9)";
        ctx.lineWidth = 3;
        ctx.shadowColor = "rgba(0,0,0,0.7)";
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fill();
        ctx.restore();
      }

      // --- Interaction prompt ---
      if (near && !pausedRef.current) {
        const label = interactionLabel(near, touchControlsRef.current);
        ctx.font = "600 14px var(--font-sans), system-ui, sans-serif";
        const tw = ctx.measureText(label).width;
        const bx = footX - tw / 2 - 12;
        const by = footY - spriteH - 40;
        ctx.fillStyle = "rgba(20,14,10,0.82)";
        ctx.beginPath();
        ctx.roundRect(bx, by, tw + 24, 30, 15);
        ctx.fill();
        ctx.fillStyle = "#ffb24d";
        ctx.fillText(label, bx + 12, by + 20);
        if (near.hint) {
          ctx.font = "500 11px var(--font-sans), system-ui, sans-serif";
          const hw2 = ctx.measureText(near.hint).width;
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fillText(near.hint, footX - hw2 / 2, by - 8);
        }
      }
    };

    raf = requestAnimationFrame(tick);

    // rAF stops in hidden/occluded tabs; keep the simulation ticking (slowly)
    // via a timer so the game never appears frozen after a tab switch.
    const fallback = setInterval(() => {
      if (performance.now() - lastTick > 250) {
        cancelAnimationFrame(raf);
        tick(performance.now());
      }
    }, 120);

    // Test/debug hooks (?debug=1): drive keys + read state programmatically.
    if (debugRef.current) {
      (window as unknown as Record<string, unknown>).__vaarta = {
        setKey: (k: string, v: boolean) => {
          keysRef.current[k] = v;
        },
        state: () => ({
          ...playerRef.current,
          near: nearRef.current?.name ?? null,
          solids: solids.length,
        }),
      };
    }

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(fallback);
      delete (window as unknown as Record<string, unknown>).__vaarta;
    };
  }, [scene, sprite]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full touch-none select-none"
    />
  );
}
