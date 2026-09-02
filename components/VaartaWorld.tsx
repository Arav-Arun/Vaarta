"use client";

/* eslint-disable @next/next/no-img-element -- generated frames arrive as data: URLs, which next/image cannot optimise. */

/**
 * A Vaarta run: one generated world, explored on foot, spoken through.
 *
 * The whole design turns on one rule — **a clue is paid for in speech**. Each
 * of the world's three characters owns a slice of the can-do ladder; clearing
 * their last rung is what makes them hand over the clue they guard, and three
 * clues is what ends the story. So walking, talking, and learning are the same
 * activity rather than three modes stitched together.
 *
 * What this deliberately does NOT inherit from the adventure engine underneath:
 *
 * - **No countdown clock.** A five-minute timer is good pressure in a mystery
 *   and terrible pedagogy in a language game; a learner who takes their time
 *   over a sentence is doing the thing we want.
 * - **No defeat finale.** For the same reason there is nothing to lose. The
 *   danger meter still rises from reckless *actions* (it is the world's own
 *   fiction) but never from a fumbled sentence.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  ChevronLeft,
  Compass,
  DoorOpen,
  Flame,
  KeyRound,
  ListChecks,
  Map as MapIcon,
  Music,
  Package,
  Share2,
  Sparkles,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import type { GameBible, Hotspot, SceneData } from "@/lib/universe";
import type { PresetBundle } from "@/lib/vaarta/preset-cache";
import type {
  VaartaBankedWord,
  VaartaCurriculum,
  VaartaObjective,
  VaartaObjectiveProgress,
  VaartaTurnResponse,
  VaartaWorldPlan,
} from "@/lib/vaarta/types";
import { masteryOf } from "@/lib/vaarta/types";
import { resolveLanguage } from "@/lib/vaarta/languages";
import * as store from "@/lib/vaarta/local-progress";
import { MusicEngine, getMusicTheme, pickMusicTheme } from "@/lib/music";
import { playSfx } from "@/lib/sfx";
import { getCachedImage, preloadSceneImages, warmSceneImages } from "@/lib/image-cache";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingBlock } from "@/components/LoadingBlock";
import { GameCanvas, type ExitDirection, type PlayerState, type TouchInput } from "@/components/GameCanvas";
import { MobileControls, useCoarsePointer } from "@/components/MobileControls";
import {
  Minimap,
  mergeKnownCell,
  streetCellFromScene,
  type MinimapCell,
} from "@/components/Minimap";
import { LadderRail } from "@/components/vaarta/LadderRail";
import { PhrasebookRail } from "@/components/vaarta/PhrasebookRail";
import { TutorDeck } from "@/components/vaarta/TutorDeck";

/** Walking off an edge: neighbour delta, spawn point on arrival, word shown. */
const EDGE_META: Record<
  ExitDirection,
  { dx: number; dy: number; spawn: { x: number; y: number }; word: string }
> = {
  n: { dx: 0, dy: -1, spawn: { x: 50, y: 92 }, word: "north" },
  e: { dx: 1, dy: 0, spawn: { x: 5, y: 70 }, word: "east" },
  s: { dx: 0, dy: 1, spawn: { x: 50, y: 8 }, word: "south" },
  w: { dx: -1, dy: 0, spawn: { x: 95, y: 70 }, word: "west" },
};

const ORIGIN_ID = "s0_0";

/**
 * Steer every world onto a calm track.
 *
 * The engine carries eight moods because it was built for a mystery game, and
 * the planner will happily pick `haunted-hollow` for a world about finding a
 * tea stall. Dread and a fast hand-drum pulse are the wrong bed for someone
 * concentrating on a second language and speaking into a microphone, so the
 * tense themes are remapped onto their nearest calm neighbour and the rest are
 * left alone.
 */
const SOOTHING_THEME: Record<string, string> = {
  "noir-rain": "backwater-dawn",
  "haunted-hollow": "mountain-air",
  "crown-ember": "first-light",
  "bazaar-dusk": "wandering-heart",
};

export type VaartaWorldProps = {
  idea: string;
  languageId: string;
  supportLanguage: string;
  playerName: string;
  /**
   * Set for the fixed starter journeys, absent for a custom world.
   *
   * Presence is what makes this run cacheable: the same starter in the same
   * language is the same world every time, so it is generated once and reused.
   */
  starterId?: string;
  /**
   * Set when opening a world somebody published, absent otherwise.
   *
   * A published world arrives finished: plan, ladder, painted screens and
   * character all exist, so opening one costs no model calls. Walking off its
   * edge still paints new ground, which is the point of publishing rather than
   * screenshotting.
   */
  worldId?: string;
  onLeave: () => void;
};

type Phase = "planning" | "playing";

type Conversation = {
  npcIndex: number;
  history: string[];
  lastTurn: VaartaTurnResponse | null;
  clueJustEarned: boolean;
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status}).`);
  return data as T;
}

/** Strip the `data:…;base64,` prefix for model continuity payloads. */
function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * Get a frame as raw base64, whatever form it is in.
 *
 * A freshly generated screen is a data URL and needs only its prefix removed.
 * A published world's screens are Storage URLs, and handing one of those to the
 * image model as "the previous frame" would send it the text of a URL: the next
 * screen would be painted with no continuity at all, silently.
 */
async function frameBase64(image: string): Promise<string | null> {
  if (image.startsWith("data:")) return stripDataUrl(image);
  if (!/^https?:/.test(image)) return null;
  try {
    const blob = await fetch(image).then((res) => res.blob());
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("frame read failed"));
      reader.readAsDataURL(blob);
    });
    return stripDataUrl(dataUrl);
  } catch {
    // Continuity is a nicety; losing it is much better than failing the paint.
    return null;
  }
}

/**
 * Turn a white-background sprite render into a transparent canvas.
 *
 * Returns null when the image is clearly not an isolated character. The image
 * model is asked for a character on pure white and usually obliges, but it
 * sometimes returns a whole painted scene instead — and that gets chroma-keyed
 * into nothing useful and then drawn over the world as a floating miniature
 * map. Checking the border is the cheap, reliable tell: a real cut-out sprite
 * is surrounded by background, a scene is surrounded by scenery.
 */
async function chromaKeySprite(src: string): Promise<HTMLCanvasElement | null> {
  const img = new Image();
  // A published world's sprite is a Storage URL, and reading its pixels back
  // out of a canvas is exactly what this function does. Without this the canvas
  // is tainted and `getImageData` throws.
  if (/^https?:/.test(src)) img.crossOrigin = "anonymous";
  img.src = src;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("sprite load failed"));
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;

  // --- Is this actually a cut-out? Sample the frame's own border. ---
  const at = (x: number, y: number) => (y * canvas.width + x) * 4;
  const isBackground = (i: number) => px[i] > 228 && px[i + 1] > 228 && px[i + 2] > 228;
  let border = 0;
  let borderBackground = 0;
  const step = Math.max(1, Math.floor(canvas.width / 64));
  for (let x = 0; x < canvas.width; x += step) {
    for (const y of [0, 1, canvas.height - 2, canvas.height - 1]) {
      border += 1;
      if (isBackground(at(x, y))) borderBackground += 1;
    }
  }
  for (let y = 0; y < canvas.height; y += step) {
    for (const x of [0, 1, canvas.width - 2, canvas.width - 1]) {
      border += 1;
      if (isBackground(at(x, y))) borderBackground += 1;
    }
  }
  // A generous threshold: a real sprite is nearly all border background, and a
  // painted scene is nearly none. Anything ambiguous is rejected, because the
  // built-in walk cycle is a much better outcome than a scene pasted on a scene.
  if (border === 0 || borderBackground / border < 0.75) return null;

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    if (r > 232 && g > 232 && b > 232) px[i + 3] = 0;
    else if (r > 215 && g > 215 && b > 215) px[i + 3] = Math.round(px[i + 3] * 0.4);
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/** Convert a short browser recording into the base64 payload the API accepts. */
async function audioPayload(blob: Blob): Promise<{ data: string; mimeType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that recording."));
    reader.readAsDataURL(blob);
  });
  return { data: stripDataUrl(dataUrl), mimeType: blob.type || "audio/webm" };
}

/**
 * Hand a generated starter world to the shared cache.
 *
 * Entirely fire-and-forget: the learner is already playing, and a cache that
 * refuses the write (no database, failed validation, offline) costs nothing but
 * the next person's generation time.
 */
function cachePreset(
  starterId: string,
  languageId: string,
  bundle: { plan: VaartaWorldPlan; scenes: SceneData[]; sprite: string | null }
): void {
  void fetch("/api/vaarta/preset", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ starterId, language: languageId, bundle }),
  }).catch(() => {});
}

/**
 * A stable id for this world in browser storage.
 *
 * Title alone collides — "The Night Market" is a popular idea — so the story
 * goal is folded in, which is unique enough in practice and, unlike a random
 * id, survives a reload of the same world.
 */
function worldIdFor(bible: GameBible, languageId?: string): string {
  const lang = languageId ? `${languageId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-` : "";
  const seed = `${lang}${bible.title}|${bible.story.goal}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return `${lang}${bible.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${Math.abs(hash).toString(36)}`;
}

export function VaartaWorld({
  idea,
  languageId,
  supportLanguage,
  playerName,
  starterId,
  worldId,
  onLeave,
}: VaartaWorldProps) {
  const [phase, setPhase] = useState<Phase>("planning");
  const [bootStatus, setBootStatus] = useState("Writing the world and the lesson inside it");
  const [bible, setBible] = useState<GameBible | null>(null);
  const [curriculum, setCurriculum] = useState<VaartaCurriculum | null>(null);
  const [scene, setScene] = useState<SceneData | null>(null);
  const [parentCoord, setParentCoord] = useState<{ x: number; y: number } | null>(null);
  const [sprite, setSprite] = useState<HTMLCanvasElement | null>(null);
  const [spawn, setSpawn] = useState<{ x: number; y: number } | null>(null);
  const [cluesFound, setCluesFound] = useState([false, false, false]);
  const [inventory, setInventory] = useState<string[]>([]);
  const [heat, setHeat] = useState(0);
  const [ambient, setAmbient] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  const [wandering, setWandering] = useState<string | null>(null);
  const [assetLoading, setAssetLoading] = useState<string | null>(null);
  const [genCalls, setGenCalls] = useState(0);
  const [screensPainted, setScreensPainted] = useState(0);
  const [roomsReady, setRoomsReady] = useState(0);
  const [knownStreets, setKnownStreets] = useState<MinimapCell[]>([]);
  const [walkedStreets, setWalkedStreets] = useState<string[]>([]);
  const [playerPos, setPlayerPos] = useState<{ x: number; y: number } | null>(null);
  const [nearHotspot, setNearHotspot] = useState<Hotspot | null>(null);
  const [showVision, setShowVision] = useState(false);
  const [musicOn, setMusicOn] = useState(
    () => typeof window === "undefined" || localStorage.getItem("vaarta-music") !== "off"
  );
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [thinking, setThinking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [hintShown, setHintShown] = useState(false);
  const [run, setRun] = useState<store.LocalRun | null>(null);
  const [bank, setBank] = useState<VaartaBankedWord[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finale, setFinale] = useState<{ title: string; resolution: string; image: string } | null>(null);
  const [finaleLoading, setFinaleLoading] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"none" | "ladder" | "phrasebook">("none");
  const [share, setShare] = useState<
    { state: "idle" | "working" } | { state: "shared"; url: string } | { state: "failed"; reason: string }
  >({ state: "idle" });

  const scenesRef = useRef<Map<string, SceneData>>(new Map());
  const screenPromises = useRef<Map<string, Promise<SceneData>>>(new Map());
  const interiorPromises = useRef<Map<string, Promise<SceneData>>>(new Map());
  const placedRoomsRef = useRef<Set<number>>(new Set());
  const runIdRef = useRef<string | null>(null);
  const runRef = useRef<store.LocalRun | null>(null);
  const bootStartedRef = useRef(false);
  /** The plan, for callbacks that fire long after boot resolved it. */
  const planRef = useRef<VaartaWorldPlan | null>(null);
  /** True when this run was served from cache, so rooms are not re-cached. */
  const fromCacheRef = useRef(false);
  /** The character as the model returned it, which is what publishing uploads. */
  const spriteDataRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<MusicEngine | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceRafRef = useRef<number | null>(null);
  const acquiringMicRef = useRef(false);
  const submittingRef = useRef(false);
  const touchInputRef = useRef<TouchInput>({ x: 0, y: 0 });
  const touchControls = useCoarsePointer();

  const language = resolveLanguage(curriculum?.language?.id ?? languageId);

  /* ---------------- Progress bookkeeping ---------------- */

  const commitRun = useCallback((next: store.LocalRun) => {
    runRef.current = next;
    setRun(next);
    store.saveRun(next);
  }, []);

  /* ---------------- Boot ---------------- */

  const prefetchInterior = useCallback((theBible: GameBible, roomIndex: number, parentId: string) => {
    const id = `b${roomIndex}`;
    if (scenesRef.current.has(id)) return Promise.resolve(scenesRef.current.get(id)!);
    const pending = interiorPromises.current.get(id);
    if (pending) return pending;

    const request = post<{ scene: SceneData }>("/api/vaarta/interior", {
      bible: theBible,
      roomIndex,
      parentId,
    })
      .then(({ scene: room }) => {
        scenesRef.current.set(room.id, room);
        setGenCalls((n) => n + 2);
        setRoomsReady((n) => n + 1);
        warmSceneImages(room);
        // Rooms join the same cached row, so a later visitor walks into a
        // painted interior instead of waiting at the door.
        const plan = planRef.current;
        if (starterId && plan) {
          cachePreset(starterId, languageId, { plan, scenes: [room], sprite: null });
        }
        return room;
      })
      .catch((cause) => {
        interiorPromises.current.delete(id);
        throw cause;
      });
    interiorPromises.current.set(id, request);
    return request;
  }, [starterId, languageId]);

  const paintScreen = useCallback(
    (theBible: GameBible, x: number, y: number, arriveFrom: ExitDirection | null, prev: SceneData | null): Promise<SceneData> => {
      const id = `s${x}_${y}`;
      const cached = scenesRef.current.get(id);
      if (cached) return Promise.resolve(cached);
      const pending = screenPromises.current.get(id);
      if (pending) return pending;

      // Claim a room before the request so two screens painted in parallel
      // cannot both be told to place the same building.
      let claimed: number | null = null;
      for (const index of [0, 1, 2] as const) {
        if (!placedRoomsRef.current.has(index)) {
          placedRoomsRef.current.add(index);
          claimed = index;
          break;
        }
      }

      const request = (prev ? frameBase64(prev.image) : Promise.resolve(null))
        .then((prevImage) =>
          post<{ scene: SceneData }>("/api/vaarta/screen", {
            bible: theBible,
            x,
            y,
            arriveFrom,
            prevImage,
            unplacedRooms: claimed !== null ? [claimed] : [],
          })
        )
        .then(({ scene: painted }) => {
          scenesRef.current.set(painted.id, painted);
          setGenCalls((n) => n + 3);
          setScreensPainted((n) => n + 1);
          warmSceneImages(painted);
          const cell = streetCellFromScene(painted);
          if (cell) setKnownStreets((prev2) => mergeKnownCell(prev2, cell));

          let placed = false;
          for (const hotspot of painted.hotspots) {
            if (hotspot.kind === "building" && typeof hotspot.clueIndex === "number") {
              placedRoomsRef.current.add(hotspot.clueIndex);
              placed = true;
              void prefetchInterior(theBible, hotspot.clueIndex, painted.id);
            }
          }
          // Vision missed the reserved room; release it so a later screen can
          // still place it, or the run loses a third of its story.
          if (claimed !== null && !placed) placedRoomsRef.current.delete(claimed);
          return painted;
        })
        .catch((cause) => {
          screenPromises.current.delete(id);
          if (claimed !== null) placedRoomsRef.current.delete(claimed);
          throw cause;
        });

      screenPromises.current.set(id, request);
      return request;
    },
    [prefetchInterior]
  );

  const showScene = useCallback((next: SceneData) => {
    scenesRef.current.set(next.id, next);
    setScene(next);
    setParentCoord(
      next.kind === "interior" && next.parentId
        ? scenesRef.current.get(next.parentId)?.coord ?? null
        : null
    );
    setAmbient(next.ambient);
    setTimeout(() => setAmbient((current) => (current === next.ambient ? null : current)), 5000);
    warmSceneImages(next);

    const cell = streetCellFromScene(next);
    if (cell) {
      setKnownStreets((prev) => mergeKnownCell(prev, cell));
      const key = `${cell.x},${cell.y}`;
      setWalkedStreets((prev) => (prev.includes(key) ? prev : [...prev, key]));
    }
  }, []);

  /**
   * Publish this world to the community library.
   *
   * Only ever runs from the button. Publishing puts somebody's writing in front
   * of strangers, so it is not something to do on their behalf because they
   * happened to finish a run.
   */
  const publish = useCallback(async () => {
    const plan = planRef.current;
    if (!plan) return;
    setShare({ state: "working" });
    try {
      const { id } = await post<{ id: string }>("/api/vaarta/worlds", {
        plan,
        scenes: [...scenesRef.current.values()],
        sprite: spriteDataRef.current,
        idea,
      });
      const url = `${window.location.origin}/w/${id}`;
      // Best effort: the URL is on screen either way, and clipboard access is
      // refused outright in some browsers and contexts.
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Nothing to do; the link is still shown and selectable.
      }
      setShare({ state: "shared", url });
      playSfx("success");
    } catch (cause) {
      setShare({
        state: "failed",
        reason: cause instanceof Error ? cause.message : "That world could not be shared.",
      });
    }
  }, [idea]);

  const ensureSceneReady = useCallback(async (next: SceneData, label?: string) => {
    const needsOverlay = label && !getCachedImage(next.image);
    if (needsOverlay) setAssetLoading(label);
    try {
      await preloadSceneImages(next);
    } finally {
      if (needsOverlay) setAssetLoading(null);
    }
  }, []);

  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;

    void (async () => {
      try {
        // Two kinds of world arrive already built: a starter journey, which is
        // the same world every time it is played, and a world somebody
        // published. Both land here as a bundle, and everything downstream
        // treats them identically.
        let cached: PresetBundle | null = null;
        if (worldId) {
          setBootStatus("Opening this world");
          const { world } = await fetch(`/api/vaarta/worlds/${encodeURIComponent(worldId)}`)
            .then((res) => (res.ok ? res.json() : { world: null }))
            .catch(() => ({ world: null }));
          if (!world) throw new Error("That world could not be opened. It may have been removed.");
          cached = { plan: world.plan, scenes: world.scenes, sprite: world.spriteUrl };
        } else if (starterId) {
          setBootStatus("Looking for this journey");
          cached = await fetch(
            `/api/vaarta/preset?starter=${encodeURIComponent(starterId)}&language=${encodeURIComponent(languageId)}`
          )
            .then((res) => (res.ok ? res.json() : { bundle: null }))
            .then((data: { bundle: PresetBundle | null }) => data.bundle)
            .catch(() => null);
        }

        setBootStatus(
          cached ? "Opening the world" : "Writing the world and the lesson inside it"
        );
        const plan =
          cached?.plan ??
          (await post<VaartaWorldPlan>("/api/vaarta/world", {
            idea,
            language: languageId,
            supportLanguage,
          }));
        planRef.current = plan;
        fromCacheRef.current = Boolean(cached);
        setBible(plan.bible);
        setCurriculum(plan.curriculum);
        if (!cached) setGenCalls((n) => n + 1);

        // Adopt every screen and room the cache already holds, so entering a
        // building later is instant too.
        if (cached) {
          for (const scene of cached.scenes) {
            scenesRef.current.set(scene.id, scene);
            warmSceneImages(scene);
            const cell = streetCellFromScene(scene);
            if (cell) setKnownStreets((prev) => mergeKnownCell(prev, cell));
            for (const hotspot of scene.hotspots) {
              if (hotspot.kind === "building" && typeof hotspot.clueIndex === "number") {
                placedRoomsRef.current.add(hotspot.clueIndex);
              }
            }
          }
          setScreensPainted(cached.scenes.filter((s) => s.kind === "street").length);
          setRoomsReady(cached.scenes.filter((s) => s.kind === "interior").length);
          // Warm any room the cache does not already hold, so walking up to a
          // door still means walking straight through it.
          for (const scene of cached.scenes) {
            if (scene.kind !== "street") continue;
            for (const hotspot of scene.hotspots) {
              if (
                hotspot.kind === "building" &&
                typeof hotspot.clueIndex === "number" &&
                !scenesRef.current.has(`b${hotspot.clueIndex}`)
              ) {
                void prefetchInterior(plan.bible, hotspot.clueIndex, scene.id).catch(() => {});
              }
            }
          }
        }

        const worldKey = worldIdFor(plan.bible, plan.curriculum.language.id);
        const localRun = store.loadRun(worldKey, plan.bible.title, plan.curriculum.language.id);
        runRef.current = localRun;
        setRun(localRun);
        setCluesFound(localRun.cluesFound);
        setBank(store.loadBank(plan.curriculum.language.id));
        setDueCount(store.dueWords(plan.curriculum.language.id).length);
        setStreak(store.loadStreak().streak);

        // Open the database-side run in parallel; a signed-out learner simply
        // gets a null id back and keeps everything in the browser.
        void post<{ runId: string | null }>("/api/vaarta/progress", {
          action: "start-run",
          // The same key the browser store uses, so the two records line up.
          worldKey,
          worldTitle: plan.bible.title,
          curriculum: plan.curriculum,
        })
          .then(({ runId }) => {
            runIdRef.current = runId;
          })
          .catch(() => {});

        if (!cached) {
          setBootStatus("Painting the first screen, then teaching the engine to read it");
        }
        const origin = await paintScreen(plan.bible, 0, 0, null, null);
        await ensureSceneReady(origin);
        showScene(origin);
        setPhase("playing");

        // The world's own character, matched to the frame that was just
        // painted. Until it lands the built-in walk cycle is on screen.
        const spritePromise = cached?.sprite
          ? Promise.resolve(cached.sprite)
          : frameBase64(origin.image).then((referenceFrame) =>
              post<{ sprite: string }>("/api/vaarta/sprite", {
                bible: plan.bible,
                referenceFrame,
              }).then(({ sprite: raw }) => {
                setGenCalls((n) => n + 1);
                return raw;
              })
            );

        const rawSprite = await spritePromise
          .then((raw) => {
            spriteDataRef.current = raw;
            void chromaKeySprite(raw)
              .then((keyed) => {
                // Null means the model painted a scene rather than a character.
                // The built-in walk cycle is already on screen, so simply keep it.
                if (keyed) setSprite(keyed);
                else console.debug("[vaarta] sprite was not a cut-out; keeping the walk cycle");
              })
              .catch(() => {});
            return raw;
          })
          .catch(() => null);

        // Hand the finished journey to the cache so nobody pays for it twice.
        if (starterId && !cached) {
          void cachePreset(starterId, languageId, {
            plan,
            scenes: [origin],
            sprite: rawSprite,
          });
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "This world could not be built.");
      }
    })();
    // Boot is guarded by `bootStartedRef` and must run exactly once; `starterId`
    // is read at mount and a change to it would mean a different world entirely,
    // which arrives as a fresh mount from the dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea, languageId, supportLanguage, paintScreen, ensureSceneReady, showScene]);

  /* ---------------- Music and effects ---------------- */

  useEffect(() => {
    if (phase !== "playing" || !bible) return;
    const engine = (musicRef.current ??= new MusicEngine());
    const chosen =
      getMusicTheme(bible.musicTheme) ??
      pickMusicTheme([bible.setting, bible.styleBible, bible.street?.description].filter(Boolean).join(" "));
    engine.start(getMusicTheme(SOOTHING_THEME[chosen.id] ?? chosen.id) ?? chosen);
    engine.setMuted(!musicOn);
  }, [phase, bible, musicOn]);

  useEffect(() => () => musicRef.current?.dispose(), []);

  useEffect(() => {
    musicRef.current?.setMuted(!musicOn);
    try {
      localStorage.setItem("vaarta-music", musicOn ? "on" : "off");
    } catch {
      // A blocked write only costs the preference, never the audio.
    }
  }, [musicOn]);

  // The one hard rule inherited from the engine: music ducks while speech plays.
  useEffect(() => {
    musicRef.current?.setDucked(speaking);
  }, [speaking]);

  const prevClues = useRef(0);
  useEffect(() => {
    const found = cluesFound.filter(Boolean).length;
    const was = prevClues.current;
    prevClues.current = found;
    if (phase === "playing" && found > was) playSfx("success");
  }, [cluesFound, phase]);

  useEffect(() => {
    if (phase === "playing" && error) playSfx("error");
  }, [error, phase]);

  const deckWasOpen = useRef(false);
  useEffect(() => {
    const open = conversation !== null;
    const was = deckWasOpen.current;
    deckWasOpen.current = open;
    if (phase !== "playing" || open === was) return;
    playSfx(open ? "open" : "close");
  }, [conversation, phase]);

  /* ---------------- Voice ---------------- */

  const stopVoice = useCallback(() => {
    audioRef.current?.pause();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string, slow = false) => {
      if (!voiceOn || !text.trim() || !language) return;
      setSpeaking(true);
      let playing = false;
      try {
        const { audio } = await post<{ audio: string | null }>("/api/vaarta/voice", {
          text,
          language: language.id,
          voice: bible?.npcs[conversation?.npcIndex ?? 0]?.voice,
          slow,
        });
        if (audio) {
          audioRef.current?.pause();
          const element = new Audio(audio);
          audioRef.current = element;
          element.onended = () => setSpeaking(false);
          element.onerror = () => setSpeaking(false);
          // Only claim the flag once playback really started: play() rejects
          // under autoplay policy and would otherwise latch "speaking" on.
          await element.play();
          playing = true;
          return;
        }
        // No Sarvam voice for this language — the browser takes over.
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = language.id;
          utterance.rate = slow ? 0.75 : 0.95;
          utterance.onend = () => setSpeaking(false);
          window.speechSynthesis.speak(utterance);
          playing = true;
        }
      } catch {
        // Voice is an enhancement; silence is an acceptable outcome.
      } finally {
        if (!playing) setSpeaking(false);
      }
    },
    [voiceOn, language, bible, conversation]
  );

  useEffect(() => stopVoice, [stopVoice]);

  /* ---------------- The current rung ---------------- */

  /**
   * The rung a character is currently holding out for: their first uncleared
   * one, in ladder order.
   *
   * Two readings of the same thing, deliberately kept apart. Render reads the
   * `run` STATE, so the rail and the deck always agree with what is on screen.
   * The scoring path reads the `runRef`, because it fires after an await and
   * the state it closed over may already be a turn behind.
   */
  const objectiveFrom = useCallback(
    (npcIndex: number, evidence: Record<string, VaartaObjectiveProgress>): VaartaObjective | null =>
      (curriculum?.objectives ?? []).find(
        (item) => item.ownerIndex === npcIndex && !evidence[item.id]?.cleared
      ) ?? null,
    [curriculum]
  );

  const activeObjective = conversation
    ? objectiveFrom(conversation.npcIndex, run?.objectives ?? {})
    : null;

  /* ---------------- Interaction ---------------- */

  const onInteract = useCallback(
    async (hotspot: Hotspot) => {
      if (!bible || !scene || finale) return;

      if (hotspot.kind === "exit") {
        stopVoice();
        setConversation(null);
        const parent = scenesRef.current.get(scene.parentId ?? ORIGIN_ID);
        if (parent) {
          setSpawn(null);
          await ensureSceneReady(parent, parent.title);
          showScene(parent);
        }
        return;
      }

      if (hotspot.kind === "item" && hotspot.itemName) {
        playSfx("pickup");
        const item = hotspot.itemName;
        setInventory((inv) => (inv.includes(item) ? inv : [...inv, item]));
        const updated = { ...scene, hotspots: scene.hotspots.filter((h) => h.id !== hotspot.id) };
        scenesRef.current.set(updated.id, updated);
        setScene(updated);
        setAmbient(`Picked up: ${item}`);
        setTimeout(() => setAmbient(null), 3500);
        return;
      }

      if (hotspot.kind === "action") {
        playSfx(hotspot.grantsItem ? "pickup" : "click");
        if (hotspot.grantsItem) {
          const item = hotspot.grantsItem;
          setInventory((inv) => (inv.includes(item) ? inv : [...inv, item]));
        }
        // Heat still rises from a reckless act — that is the world's fiction —
        // but never from a fumbled sentence.
        const drawn = hotspot.suspicion ?? 0;
        if (drawn > 0) setHeat((value) => Math.min(100, value + drawn));
        setAmbient(hotspot.outcome ? hotspot.outcome : `${hotspot.name}: done.`);
        setTimeout(() => setAmbient(null), 4500);
        const updated = { ...scene, hotspots: scene.hotspots.filter((h) => h.id !== hotspot.id) };
        scenesRef.current.set(updated.id, updated);
        setScene(updated);
        return;
      }

      if (hotspot.kind === "npc" && typeof scene.clueIndex === "number") {
        stopVoice();
        setTurnError(null);
        setHintShown(false);
        setConversation({
          npcIndex: scene.clueIndex,
          history: [],
          lastTurn: null,
          clueJustEarned: false,
        });
        return;
      }

      if (hotspot.kind === "building") {
        if (typeof hotspot.clueIndex !== "number") {
          setAmbient(`${hotspot.name} is bolted shut.`);
          setTimeout(() => setAmbient(null), 3000);
          return;
        }
        setEntering(hotspot.name);
        try {
          const room =
            scenesRef.current.get(`b${hotspot.clueIndex}`) ??
            (await prefetchInterior(bible, hotspot.clueIndex, scene.id));
          setSpawn(null);
          await ensureSceneReady(room);
          showScene(room);
        } catch {
          setError(`Couldn't step into ${hotspot.name}. Try again.`);
          setTimeout(() => setError(null), 4000);
        } finally {
          setEntering(null);
        }
      }
    },
    [bible, scene, finale, ensureSceneReady, prefetchInterior, showScene, stopVoice]
  );

  const onExitEdge = useCallback(
    async (dir: ExitDirection) => {
      if (!bible || !scene?.coord || finale) return;
      const { dx, dy, spawn: arriveAt, word } = EDGE_META[dir];
      const nx = scene.coord.x + dx;
      const ny = scene.coord.y + dy;
      const existing = scenesRef.current.get(`s${nx}_${ny}`);
      if (existing) {
        setSpawn(arriveAt);
        await ensureSceneReady(existing, `Heading ${word}`);
        showScene(existing);
        return;
      }
      setWandering(word);
      try {
        const next = await paintScreen(bible, nx, ny, dir, scene);
        setSpawn(arriveAt);
        await ensureSceneReady(next);
        showScene(next);
      } catch {
        setError("The path ahead dissolved into mist. Try again.");
        setTimeout(() => setError(null), 4000);
      } finally {
        setWandering(null);
      }
    },
    [bible, scene, finale, ensureSceneReady, paintScreen, showScene]
  );

  /* ---------------- Speaking a turn ---------------- */

  const submitTurn = useCallback(
    async (payload: { typedResponse?: string; audioBase64?: string; audioMimeType?: string }) => {
      if (submittingRef.current || !bible || !curriculum || !conversation) return;
      const objective = objectiveFrom(conversation.npcIndex, runRef.current?.objectives ?? {});
      if (!objective) return;

      submittingRef.current = true;
      setThinking(true);
      setTurnError(null);

      const currentRun = runRef.current;
      const prior = currentRun?.objectives[objective.id];
      const cleared = Object.values(currentRun?.objectives ?? {})
        .filter((item) => item.cleared)
        .map((item) => item.objectiveId);

      try {
        const turn = await post<VaartaTurnResponse>("/api/vaarta/turn", {
          bible,
          curriculum,
          npcIndex: conversation.npcIndex,
          objectiveId: objective.id,
          clearedObjectiveIds: cleared,
          attemptsForObjective: prior?.attempts ?? 0,
          hintUsed: hintShown || Boolean(prior?.hintUsed),
          history: conversation.history,
          scene: scene ? { title: scene.title, ambient: scene.ambient } : undefined,
          playerName,
          runId: runIdRef.current,
          worldTitle: bible.title,
          cluesFound,
          ...payload,
        });

        // Fold the attempt into the browser's own record first: it is the
        // store of record for a signed-out learner, and the mirror for
        // everyone else.
        if (currentRun) {
          const nextRun = store.applyAttempt(currentRun, {
            objectiveId: objective.id,
            cleared: turn.objectiveCleared,
            inputMode: turn.inputMode,
            supported: hintShown || Boolean(prior?.hintUsed),
            errorCode: turn.feedbackFocus?.code,
          });
          commitRun(
            turn.clueRevealed
              ? {
                  ...nextRun,
                  cluesFound: nextRun.cluesFound.map((found, index) =>
                    index === conversation.npcIndex ? true : found
                  ),
                }
              : nextRun
          );
        }

        if (turn.newWords.length) {
          setBank(store.bankWords(curriculum.language.id, turn.newWords, bible.title));
          setDueCount(store.dueWords(curriculum.language.id).length);
        }
        setStreak(store.touchStreak().streak);

        if (turn.objectiveCleared) {
          playSfx("success");
          setHintShown(false);
        }
        if (turn.clueRevealed) {
          setCluesFound((prev) =>
            prev.map((found, index) => (index === conversation.npcIndex ? true : found))
          );
        }

        setConversation((current) =>
          current && current.npcIndex === conversation.npcIndex
            ? {
                ...current,
                history: turn.sessionMemory,
                lastTurn: turn,
                clueJustEarned: turn.clueRevealed,
              }
            : current
        );
        void speak(turn.npcLine.native);
      } catch (cause) {
        setTurnError(cause instanceof Error ? cause.message : "That turn could not be scored.");
      } finally {
        submittingRef.current = false;
        setThinking(false);
      }
    },
    [
      bible,
      curriculum,
      conversation,
      objectiveFrom,
      hintShown,
      scene,
      playerName,
      cluesFound,
      commitRun,
      speak,
    ]
  );

  /* ---------------- Microphone ---------------- */

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setTurnError("Recording is unavailable here. Type your reply instead.");
      return;
    }
    // `recording` only flips true after the permission await, so without this
    // ref a second click acquires a second stream and orphans the first,
    // leaving the browser's mic indicator lit until the tab closes.
    if (acquiringMicRef.current || recorderRef.current) return;
    acquiringMicRef.current = true;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      acquiringMicRef.current = false;
      setTurnError("Microphone permission was not granted. Type your reply instead.");
      return;
    }

    try {
      streamRef.current = stream;
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (silenceRafRef.current !== null) cancelAnimationFrame(silenceRafRef.current);
        silenceRafRef.current = null;
        void audioContextRef.current?.close();
        audioContextRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) {
          setTurnError("No audio was captured. Try again, or type your reply.");
          return;
        }
        // Nobody awaits this handler, so it has to own its own failures.
        void (async () => {
          try {
            const audio = await audioPayload(blob);
            await submitTurn({ audioBase64: audio.data, audioMimeType: audio.mimeType });
          } catch (cause) {
            setTurnError(cause instanceof Error ? cause.message : "Could not read that recording.");
          }
        })();
      };
      recorder.start();

      // Stop after roughly three seconds of real silence, so a learner never
      // has to find the button again mid-thought.
      try {
        const AudioContextCtor =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextCtor) {
          const audioContext = new AudioContextCtor();
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 512;
          audioContext.createMediaStreamSource(stream).connect(analyser);
          const samples = new Uint8Array(analyser.fftSize);
          let activeTicks = 0;
          let silentTicks = 0;
          const monitor = () => {
            activeTicks += 1;
            analyser.getByteTimeDomainData(samples);
            let energy = 0;
            for (const sample of samples) {
              const normalized = (sample - 128) / 128;
              energy += normalized * normalized;
            }
            const rms = Math.sqrt(energy / samples.length);
            if (rms > 0.035) silentTicks = 0;
            else silentTicks += 1;
            // requestAnimationFrame is roughly 60 Hz: 180 quiet frames ≈ 3s.
            if (recorderRef.current?.state === "recording" && activeTicks > 55 && silentTicks > 180) {
              recorderRef.current.stop();
              return;
            }
            silenceRafRef.current = requestAnimationFrame(monitor);
          };
          audioContextRef.current = audioContext;
          silenceRafRef.current = requestAnimationFrame(monitor);
        }
      } catch {
        // Silence detection is optional; MediaRecorder still works.
      }
      setRecording(true);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setTurnError("This browser could not start a recorder. Type your reply instead.");
    } finally {
      acquiringMicRef.current = false;
    }
  }, [submitTurn]);

  // Release the microphone if the player leaves mid-turn.
  useEffect(
    () => () => {
      try {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      } catch {
        // A recorder already torn down by the browser is fine to ignore.
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (silenceRafRef.current !== null) cancelAnimationFrame(silenceRafRef.current);
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      streamRef.current = null;
      recorderRef.current = null;
    },
    []
  );

  /* ---------------- Finale ---------------- */

  const allCluesFound = cluesFound.every(Boolean);

  const runFinale = useCallback(async () => {
    if (!bible || finale || finaleLoading) return;
    stopVoice();
    setConversation(null);
    setFinaleLoading(true);
    try {
      const { finale: ending } = await post<{
        finale: { title: string; resolution: string; image: string };
      }>("/api/vaarta/finale", { bible, language: language?.id });
      setGenCalls((n) => n + 2);
      setFinale(ending);
    } catch {
      setError("The ending slipped away. Try again.");
      setTimeout(() => setError(null), 4000);
    } finally {
      setFinaleLoading(false);
    }
  }, [bible, finale, finaleLoading, language, stopVoice]);

  /* ---------------- Render ---------------- */

  const onPlayerPosition = useCallback((p: PlayerState) => {
    setPlayerPos({ x: p.x, y: p.y });
  }, []);

  if (phase === "planning" || !scene || !bible || !curriculum) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6">
        <Card className="w-full max-w-md gap-0 px-6 py-6">
          <h2 className="font-display text-3xl font-extrabold text-foreground">
            {bible?.title ?? "Building your world"}
          </h2>
          <LoadingBlock
            className="mt-5 border-t-2 border-border pt-4"
            label={bootStatus}
            detail="The world, its lesson ladder, the first screen and your character are all generated for this run."
          />
          {error && (
            <>
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
              <Button variant="neutral" className="mt-3 w-full" onClick={onLeave}>
                <ChevronLeft size={15} /> Back to your worlds
              </Button>
            </>
          )}
        </Card>
      </div>
    );
  }

  const progress: Record<string, VaartaObjectiveProgress> = run?.objectives ?? {};
  const mastery = masteryOf(
    curriculum.objectives.map(
      (item) =>
        progress[item.id] ?? {
          objectiveId: item.id,
          attempts: 0,
          cleared: false,
          firstTry: false,
          recoveredAfterCoaching: false,
          hintUsed: false,
          voiceAttempts: 0,
          typedAttempts: 0,
        }
    )
  );
  const minimapCoord =
    scene.kind === "street" && scene.coord ? scene.coord : scene.kind === "interior" ? parentCoord : null;
  const paused =
    conversation !== null || entering !== null || wandering !== null || assetLoading !== null || finale !== null;

  /**
   * What to do next, phrased as somewhere to walk.
   *
   * The goal line alone ("board the hidden bus") is not actionable while the
   * learner is standing in an empty square: every objective in this game lives
   * behind one specific character, so the HUD names the door.
   */
  const nextObjective =
    curriculum.objectives.find((item) => !progress[item.id]?.cleared) ?? null;
  const nextRoom =
    nextObjective && nextObjective.ownerIndex >= 0 ? bible.rooms[nextObjective.ownerIndex] : null;
  const nextNpc =
    nextObjective && nextObjective.ownerIndex >= 0 ? bible.npcs[nextObjective.ownerIndex] : null;
  const directive =
    scene.kind === "interior"
      ? `Walk up to ${scene.npc?.name ?? "them"} and press E to talk`
      : nextRoom && nextNpc
        ? `Find ${nextRoom.name} and talk to ${nextNpc.name}`
        : bible.story.goal;

  const ladderRail = (
    <LadderRail
      bible={bible}
      curriculum={curriculum}
      progress={progress}
      cluesFound={cluesFound}
      activeObjectiveId={activeObjective?.id ?? null}
      mastery={mastery}
      onSpeak={speak}
      speaking={speaking}
    />
  );

  const phrasebookRail = (
    <PhrasebookRail
      languageName={curriculum.language.name}
      objective={activeObjective}
      starterVocabulary={curriculum.starterVocabulary}
      bank={bank}
      dueCount={dueCount}
      streak={streak}
      hintShown={hintShown}
      onRevealHint={() => {
        setHintShown((shown) => {
          const next = !shown;
          // Mark support *at the moment it is revealed*: reading it back from
          // state after the scoring await has misfiled supported attempts as
          // unaided clears before.
          if (next && activeObjective && runRef.current) {
            commitRun(store.markHintUsed(runRef.current, activeObjective.id));
          }
          return next;
        });
      }}
      onSpeak={speak}
      speaking={speaking}
    />
  );

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-ink">
      {/* ---- Top bar ---- */}
      <header className="z-20 flex shrink-0 items-center gap-2 border-b-2 border-border bg-secondary-background px-2 py-1.5 sm:px-3">
        <Button variant="neutral" size="sm" sound="close" onClick={onLeave}>
          <ChevronLeft size={15} />
          <span className="hidden sm:inline">Worlds</span>
        </Button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">
            {bible.title} · {scene.title}
          </p>
          <p className="truncate text-[13px] font-bold leading-tight text-foreground">
            {activeObjective?.canDo ?? directive}
          </p>
        </div>

        {inventory.length > 0 && (
          <Card className="hidden max-w-[16rem] flex-row flex-wrap items-center gap-1 px-2 py-1 lg:flex">
            <Package size={11} className="text-main" />
            {inventory.map((item) => (
              <Badge key={item} variant="neutral" className="text-[10px]">
                {item}
              </Badge>
            ))}
          </Card>
        )}

        {/* Reckless *actions* raise this. A fumbled sentence never does. */}
        {heat > 0 && (
          <Card className="hidden flex-row items-center gap-1.5 px-2 py-1 md:flex">
            <Flame size={11} className={heat >= 60 ? "text-health" : "text-inksoft"} />
            <span className="text-[9px] font-bold uppercase tracking-widest text-inksoft">
              {bible.heatLabel}
            </span>
            <Progress
              value={heat}
              className="h-1.5 w-12 [&_[data-slot=progress-indicator]]:bg-health"
            />
          </Card>
        )}

        <Card className="hidden flex-row items-center gap-1.5 px-2 py-1 md:flex">
          <KeyRound size={11} className="text-main" />
          <span className="flex gap-0.5">
            {cluesFound.map((found, index) => (
              <span
                key={index}
                className={`h-1.5 w-4 rounded-full ${found ? "bg-main" : "bg-foreground/15"}`}
              />
            ))}
          </span>
          <span className="text-[11px] font-bold tabular-nums text-foreground">
            {cluesFound.filter(Boolean).length}/3
          </span>
        </Card>

        {allCluesFound && !finale && (
          <Button size="sm" onClick={runFinale} disabled={finaleLoading}>
            {finaleLoading ? "Ending…" : "Finish the story"}
          </Button>
        )}

        {/*
          Sharing is offered for a world this learner built, and not for a
          starter journey (everyone already has it) or a world they are visiting
          (it is already published, by somebody else).
        */}
        {!starterId && !worldId && (
          share.state === "shared" ? (
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(share.url).catch(() => {})}
              title={share.url}
              className="hidden max-w-[13rem] shrink-0 items-center gap-1.5 rounded-base border-2 border-border bg-main px-2 py-1 text-[11px] font-bold text-main-foreground sm:flex"
            >
              <Share2 size={11} />
              <span className="truncate">Shared. Copy link</span>
            </button>
          ) : (
            <Button
              variant="neutral"
              size="sm"
              onClick={() => void publish()}
              disabled={share.state === "working"}
              title={
                share.state === "failed"
                  ? share.reason
                  : "Publish this world so anyone can walk into it"
              }
            >
              <Share2 size={13} />
              <span className="hidden sm:inline">
                {share.state === "working" ? "Sharing…" : "Share this world"}
              </span>
            </Button>
          )
        )}

        {/* Rail toggles, for screens too narrow to hold both rails open. */}
        <Button
          variant={mobilePanel === "ladder" ? "default" : "neutral"}
          size="icon"
          className="size-8 xl:hidden [&_svg]:size-3.5"
          aria-label="Lesson ladder"
          onClick={() => setMobilePanel((panel) => (panel === "ladder" ? "none" : "ladder"))}
        >
          <ListChecks />
        </Button>
        <Button
          variant={mobilePanel === "phrasebook" ? "default" : "neutral"}
          size="icon"
          className="size-8 lg:hidden [&_svg]:size-3.5"
          aria-label="Phrasebook"
          onClick={() => setMobilePanel((panel) => (panel === "phrasebook" ? "none" : "phrasebook"))}
        >
          <BookOpen />
        </Button>
        {scene.annotated && (
          <Button
            variant={showVision ? "default" : "neutral"}
            size="icon"
            className="hidden size-8 sm:inline-flex [&_svg]:size-3.5"
            aria-label="Show what the engine sees, including its collision map"
            title="Show what the engine sees, including its collision map"
            onClick={() => setShowVision((value) => !value)}
          >
            <MapIcon />
          </Button>
        )}
        <Button
          variant={musicOn ? "default" : "neutral"}
          size="icon"
          className="size-8 [&_svg]:size-3.5"
          sound={musicOn ? "toggleOff" : "toggleOn"}
          aria-label={musicOn ? "Music on" : "Music off"}
          onClick={() => setMusicOn((value) => !value)}
        >
          <Music className={musicOn ? "" : "opacity-40"} />
        </Button>
        <Button
          variant={voiceOn ? "default" : "neutral"}
          size="icon"
          className="size-8 [&_svg]:size-3.5"
          sound={voiceOn ? "toggleOff" : "toggleOn"}
          aria-label={voiceOn ? "Voices on" : "Voices off"}
          onClick={() => {
            if (voiceOn) stopVoice();
            setVoiceOn((value) => !value);
          }}
        >
          {voiceOn ? <Volume2 /> : <VolumeX />}
        </Button>
      </header>

      {/* ---- Rails + canvas ---- */}
      <div className="relative flex min-h-0 flex-1">
        <aside className="hidden w-[19rem] shrink-0 border-r-2 border-border bg-background xl:block">
          {ladderRail}
        </aside>

        <div className="relative min-w-0 flex-1">
          <GameCanvas
            scene={scene}
            sprite={sprite}
            paused={paused}
            onInteract={onInteract}
            spawn={spawn}
            onExitEdge={onExitEdge}
            onPosition={onPlayerPosition}
            onNearChange={setNearHotspot}
            touchInputRef={touchInputRef}
            touchControls={touchControls}
            showVision={showVision}
          />

          <MobileControls
            touchInputRef={touchInputRef}
            nearHotspot={nearHotspot}
            paused={paused}
            onInteract={onInteract}
          />

          {!conversation && !finale && (
            <div className="pointer-events-none absolute right-3 top-3 z-10">
              <Minimap
                known={knownStreets}
                walked={walkedStreets}
                currentCoord={minimapCoord}
                player={playerPos}
                inside={scene.kind === "interior"}
                compact={touchControls}
              />
            </div>
          )}

          <AnimatePresence>
            {ambient && (
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="pointer-events-none absolute inset-x-0 top-4 z-10 mx-auto w-fit max-w-[80%] rounded-full bg-black/55 px-4 py-2 text-center text-sm font-medium text-white backdrop-blur-sm"
              >
                {ambient}
              </motion.p>
            )}
          </AnimatePresence>

          {!conversation && !touchControls && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/55 px-4 py-2 text-xs font-semibold text-white/90 backdrop-blur-sm">
WASD or arrows to move · E to enter and talk
            </div>
          )}

          {!conversation && !finale && !touchControls && (
            <Card
              className="pointer-events-none absolute bottom-3 right-3 z-10 flex-row items-center gap-2 gap-y-0 px-3 py-2"
              title="Every screen is painted, traced by the model over its own frame, then read back into hotspots and walls"
            >
              <Zap size={11} strokeWidth={2.5} className="text-main" />
              <span className="text-[11px] font-semibold tabular-nums text-foreground">
                {genCalls} generations
              </span>
              <span className="h-3 w-px bg-border" />
              <Compass size={11} strokeWidth={2.5} className="text-main" />
              <span className="text-[11px] font-semibold tabular-nums text-foreground">
                {screensPainted} {screensPainted === 1 ? "screen" : "screens"}
              </span>
              <span className="h-3 w-px bg-border" />
              <DoorOpen size={11} strokeWidth={2.5} className="text-main" />
              <span className="text-[11px] font-semibold tabular-nums text-foreground">
                rooms {roomsReady}/3
              </span>
            </Card>
          )}

          {/* Narrow screens: the rails become overlays rather than disappearing. */}
          <AnimatePresence>
            {mobilePanel !== "none" && (
              <motion.aside
                initial={{ opacity: 0, x: mobilePanel === "ladder" ? -20 : 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: mobilePanel === "ladder" ? -20 : 20 }}
                transition={{ duration: 0.18 }}
                className={`absolute inset-y-0 z-20 w-[min(20rem,88vw)] border-border bg-background/97 backdrop-blur-md ${
                  mobilePanel === "ladder" ? "left-0 border-r-2" : "right-0 border-l-2"
                }`}
              >
                {mobilePanel === "ladder" ? ladderRail : phrasebookRail}
              </motion.aside>
            )}
          </AnimatePresence>
        </div>

        <aside className="hidden w-[19rem] shrink-0 border-l-2 border-border bg-background lg:block">
          {phrasebookRail}
        </aside>
      </div>

      {/* ---- Conversation deck ---- */}
      {conversation && bible.npcs[conversation.npcIndex] && (
        <TutorDeck
          npc={bible.npcs[conversation.npcIndex]}
          objective={activeObjective}
          lastTurn={conversation.lastTurn}
          languageName={curriculum.language.name}
          thinking={thinking}
          recording={recording}
          speaking={speaking}
          clueJustEarned={conversation.clueJustEarned}
          error={turnError}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          onSubmitTyped={(text) => void submitTurn({ typedResponse: text })}
          onSpeak={speak}
          onClose={() => {
            stopVoice();
            setConversation(null);
            setHintShown(false);
          }}
        />
      )}

      {/* ---- Overlays ---- */}
      <Dialog open={!!assetLoading}>
        <DialogContent className="[&>button]:hidden" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-center font-display text-xl">{assetLoading}</DialogTitle>
            <LoadingBlock label="" detail="stepping through…" className="mt-2" />
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Dialog open={!!wandering}>
        <DialogContent className="[&>button]:hidden" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-center font-display text-xl">
              Wandering {wandering}…
            </DialogTitle>
            <LoadingBlock label="" detail="painting the next screen · tracing it · reading it" className="mt-2" />
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Dialog open={!!entering}>
        <DialogContent className="[&>button]:hidden" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-center font-display text-xl">{entering}</DialogTitle>
            <LoadingBlock label="" detail="stepping inside…" className="mt-2" />
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {finale && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 z-40 overflow-y-auto bg-ink"
          >
            <img src={finale.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/45 to-transparent" />
            <div className="relative flex min-h-full flex-col items-center justify-end px-6 pb-14 text-center">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.35 }}
                className="max-w-xl"
              >
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-main">The truth</p>
                <h2 className="mt-2 font-display text-4xl font-extrabold text-white">{finale.title}</h2>
                <p className="mt-4 text-base font-medium leading-relaxed text-white/90">
                  {finale.resolution}
                </p>
                <p className="mt-6 rounded-base border-2 border-white/25 bg-black/40 px-4 py-3 text-sm font-semibold text-white">
                  You cleared {curriculum.objectives.filter((item) => progress[item.id]?.cleared).length} of{" "}
                  {curriculum.objectives.length} speaking goals in {curriculum.language.name}, and banked{" "}
                  {bank.length} word{bank.length === 1 ? "" : "s"}.
                </p>
                <Button className="mt-7" size="lg" onClick={onLeave}>
                  <Sparkles /> Back to your worlds
                </Button>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-20 left-1/2 z-30 w-[min(92%,28rem)] -translate-x-1/2"
          >
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
