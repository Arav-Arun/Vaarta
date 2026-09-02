"use client";

/* eslint-disable @next/next/no-img-element -- world thumbnails are Supabase Storage URLs, which next/image cannot optimise here. */

/**
 * The Vaarta dashboard.
 *
 * Three jobs, in the order a returning learner cares about them: show what
 * they have already earned, get them back into a world in one click, and only
 * then offer a blank prompt box.
 *
 * The proxy requires a signed-in learner before this dashboard can render.
 * The browser store keeps the interface responsive between durable syncs.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, BookMarked, Flame, Target, Trophy } from "lucide-react";
import { VaartaWorld } from "@/components/VaartaWorld";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { createClient } from "@/lib/supabase/client";
import { MAX_CREATE_IDEA_LENGTH } from "@/lib/constants";
import {
  DEFAULT_LANGUAGE,
  VAARTA_LANGUAGES,
  VAARTA_SUPPORT_LANGUAGES,
  isSupportLanguage,
  resolveLanguage,
} from "@/lib/vaarta/languages";
import { STARTERS, starterIdea } from "@/lib/vaarta/starters";
import * as store from "@/lib/vaarta/local-progress";
import { masteryOf } from "@/lib/vaarta/types";
import type { PublishedWorldCard } from "@/lib/vaarta/worlds";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

type SummaryRun = {
  worldId: string;
  worldTitle: string;
  cleared: number;
  cluesCount: number;
  updatedAt: string;
};

type Summary = {
  signedIn: boolean;
  languageId: string;
  streak: number;
  objectivesCleared: number;
  firstTryClears: number;
  wordsBanked: number;
  wordsDue: number;
  mastery: number;
  runs?: SummaryRun[];
};

type Launch = {
  idea: string;
  languageId: string;
  supportLanguage: string;
  playerName: string;
  /** Set for the four fixed journeys, so the generated world can be reused. */
  starterId?: string;
};

/** Local evidence, folded into the same shape the API returns. */
function localSummary(languageId: string): Summary {
  const localRuns = store.listRuns().filter((run) => run.languageId === languageId);
  const objectives = localRuns.flatMap((run) => Object.values(run.objectives));
  return {
    signedIn: false,
    languageId,
    streak: store.loadStreak().streak,
    objectivesCleared: objectives.filter((item) => item.cleared).length,
    firstTryClears: objectives.filter((item) => item.firstTry).length,
    wordsBanked: store.loadBank(languageId).length,
    wordsDue: store.dueWords(languageId).length,
    mastery: masteryOf(objectives),
    runs: localRuns.map((run) => ({
      worldId: run.worldId,
      worldTitle: run.worldTitle,
      cleared: Object.values(run.objectives).filter((item) => item.cleared).length,
      cluesCount: run.cluesFound.filter(Boolean).length,
      updatedAt: run.updatedAt,
    })),
  };
}

const PREFERENCE_DEFAULTS = {
  playerName: "",
  languageId: DEFAULT_LANGUAGE.id,
  supportLanguage: "English",
};

const IS_CUSTOM_WORLDS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_CUSTOM_WORLDS === "true";

export function Home() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [serverSummaries, setServerSummaries] = useState<Record<string, Summary>>({});
  const [gallery, setGallery] = useState<PublishedWorldCard[]>([]);
  /** Which of the learner's own worlds is one more click away from removal. */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [launch, setLaunch] = useState<Launch | null>(null);

  /**
   * The browser store is exactly what `useSyncExternalStore` is for.
   *
   * It cannot be a lazy `useState` initialiser — the dashboard is prerendered,
   * so reading `localStorage` at first render would run on the server or
   * hydrate to different markup — and doing it in an effect means a cascading
   * render on every mount. Subscribing lets React adopt the stored values right
   * after hydration, and re-derive whenever a run writes new evidence.
   */
  const revision = useSyncExternalStore(store.subscribe, store.snapshot, store.serverSnapshot);
  const hydrated = revision >= 0;

  const prefs = useMemo(
    () => (hydrated ? store.loadPreferences(PREFERENCE_DEFAULTS) : PREFERENCE_DEFAULTS),
    // `revision` is the whole point: it changes when the store is written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, revision]
  );

  const language = resolveLanguage(prefs.languageId) ?? DEFAULT_LANGUAGE;
  const supportLanguage = isSupportLanguage(prefs.supportLanguage)
    ? prefs.supportLanguage
    : "English";

  // Everything the browser knows is derived, never mirrored into state, so a
  // world that just banked ten words shows them the moment you walk out of it.
  const localRecord = useMemo(
    () => (hydrated ? localSummary(language.id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, revision, language.id]
  );

  const serverSummary = serverSummaries[language.id] ?? null;

  // A signed-in record is the durable one; the browser fills the gaps between
  // syncs, and is the whole record when there is no session.
  const summary: Summary | null = serverSummary
    ? { ...localRecord, ...serverSummary, signedIn: true }
    : localRecord;

  const walkedRuns: SummaryRun[] = useMemo(() => {
    const local = localRecord?.runs ?? [];
    const server = serverSummary?.runs ?? [];
    const map = new Map<string, SummaryRun>();
    for (const r of local) map.set(r.worldId, r);
    for (const r of server) map.set(r.worldId, r);
    return Array.from(map.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [localRecord, serverSummary]);

  // Pull the durable record when there is a session. Always 200, so a failure
  // here means the network, not the absence of an account.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const targetLang = language.id;
    void (async () => {
      try {
        const res = await fetch(
          `/api/vaarta/progress?language=${encodeURIComponent(targetLang)}&supportLanguage=${encodeURIComponent(supportLanguage)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          signedIn: boolean;
          languageId: string;
          streak: number;
          objectivesCleared: number;
          firstTryClears: number;
          wordsBanked: number;
          wordsDue: number;
          mastery: number;
          runs?: {
            worldKey: string;
            worldTitle: string;
            cleared: number;
            cluesFound: boolean[];
            updatedAt: string;
          }[];
        };
        if (!cancelled && data.signedIn) {
          setServerSummaries((prev) => ({
            ...prev,
            [targetLang]: {
              signedIn: true,
              languageId: targetLang,
              streak: data.streak,
              objectivesCleared: data.objectivesCleared,
              firstTryClears: data.firstTryClears,
              wordsBanked: data.wordsBanked,
              wordsDue: data.wordsDue,
              mastery: data.mastery,
              runs: data.runs?.map((r) => ({
                worldId: r.worldKey,
                worldTitle: r.worldTitle,
                cleared: r.cleared,
                cluesCount: r.cluesFound?.filter(Boolean).length ?? 0,
                updatedAt: r.updatedAt,
              })),
            },
          }));
        }
      } catch {
        // The browser's own record already rendered; nothing to report.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, language.id, supportLanguage]);

  // Worlds other learners published. Always 200, and an empty library is the
  // normal state of a new deployment rather than an error worth showing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/vaarta/worlds");
        if (!res.ok) return;
        const data = (await res.json()) as { worlds: PublishedWorldCard[] };
        if (!cancelled) setGallery(data.worlds.slice(0, 6));
      } catch {
        // No gallery is a perfectly good dashboard.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The name box is uncontrolled on purpose: a controlled one would write to
   * localStorage on every keystroke, and each write notifies the store and
   * re-derives the whole dashboard.
   */
  const nameRef = useRef<HTMLInputElement>(null);
  const currentName = () => (nameRef.current?.value ?? prefs.playerName).trim();

  const persistPreferences = useCallback(
    (next: Partial<Launch>) => {
      const saved = {
        playerName: next.playerName ?? currentName(),
        languageId: next.languageId ?? prefs.languageId,
        supportLanguage: next.supportLanguage ?? prefs.supportLanguage,
      };
      store.savePreferences(saved);
      // Mirrored to Postgres when there is a session; a 200 with
      // `persisted: false` simply means there is not one.
      void fetch("/api/vaarta/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preferences",
          displayName: saved.playerName,
          language: saved.languageId,
          supportLanguage: saved.supportLanguage,
        }),
      }).catch(() => {});
    },
    // `currentName` reads a ref at call time, so it needs no dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefs.languageId, prefs.supportLanguage, prefs.playerName]
  );

  const begin = useCallback(
    (worldIdea: string, fromStarter?: string) => {
      if (!fromStarter && !IS_CUSTOM_WORLDS_ENABLED) return;
      const text = worldIdea.trim();
      if (!text) return;
      const name = currentName() || "Traveller";
      persistPreferences({ playerName: name });
      setLaunch({
        idea: text,
        languageId: language.id,
        supportLanguage,
        playerName: name,
        starterId: fromStarter,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language.id, supportLanguage, persistPreferences]
  );

  /**
   * Unpublish one of the learner's own worlds.
   *
   * Two clicks, because this deletes the row and every frame it uploaded and
   * there is no undo. The button asks first and only acts on the second press.
   */
  const unpublish = useCallback(async (id: string) => {
    if (confirmRemove !== id) {
      setConfirmRemove(id);
      return;
    }
    setConfirmRemove(null);
    // Optimistic: the row is gone from the library either way, and a failed
    // delete reappears on the next dashboard load rather than silently lying.
    setGallery((worlds) => worlds.filter((world) => world.id !== id));
    await fetch(`/api/vaarta/worlds/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
      () => {}
    );
  }, [confirmRemove]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
      setServerSummaries({});
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }, [router]);

  const starters = useMemo(
    () => STARTERS.map((starter) => ({ starter, idea: starterIdea(starter, language.homeRegion) })),
    [language.homeRegion]
  );

  if (launch) {
    return (
      <VaartaWorld
        idea={launch.idea}
        languageId={launch.languageId}
        supportLanguage={launch.supportLanguage}
        playerName={launch.playerName}
        starterId={launch.starterId}
        // Leaving needs no refresh call: the world wrote its evidence through
        // the same store this page subscribes to.
        onLeave={() => setLaunch(null)}
      />
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-6xl px-5 py-10 sm:px-8 md:py-16">
      <motion.header
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
        className="mb-10 flex items-center justify-between gap-4 border-b-2 border-border pb-6"
      >
        <h1 className="font-display text-5xl font-extrabold leading-none tracking-tight text-foreground sm:text-6xl">
          Vaarta
        </h1>
        <Button
          variant="neutral"
          size="sm"
          className="shrink-0"
          disabled={signingOut}
          onClick={signOut}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </motion.header>

      {/* ---- The learner ---- */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.05, ease: EASE_OUT }}
        className="mb-12"
      >
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-inksoft">
          I want to learn
        </p>

        {/* Compact enough that all eleven fit two rows without a gap on the right. */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {VAARTA_LANGUAGES.map((candidate) => {
            const active = candidate.id === language.id;
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => persistPreferences({ languageId: candidate.id })}
                aria-pressed={active}
                className={`rounded-base border-2 border-border px-2.5 py-2 text-left transition ${
                  active
                    ? "bg-main text-main-foreground shadow-shadow"
                    : "bg-secondary-background text-foreground shadow-shadow hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none"
                }`}
              >
                <p className="truncate font-display text-base font-extrabold leading-tight">
                  {candidate.endonym}
                </p>
                <p className="truncate text-[10px] font-bold uppercase tracking-wider opacity-70">
                  {candidate.name}
                </p>
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold text-foreground">
            What should the world call you?
            <Input
              // Remounted once on hydration so the stored name becomes the
              // default without ever causing a hydration mismatch.
              key={hydrated ? "name-hydrated" : "name-initial"}
              ref={nameRef}
              defaultValue={prefs.playerName}
              maxLength={32}
              onBlur={() => persistPreferences({})}
              placeholder="Your name"
              className="mt-1.5"
            />
          </label>
          <label className="text-sm font-bold text-foreground" htmlFor="support-language">
            Explain things to me in
            <select
              id="support-language"
              value={supportLanguage}
              onChange={(event) => persistPreferences({ supportLanguage: event.target.value })}
              className="mt-1.5 h-10 w-full rounded-base border-2 border-border bg-secondary-background px-3 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-black"
            >
              {VAARTA_SUPPORT_LANGUAGES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </motion.section>

      {/* ---- What you have earned ---- */}
      {summary && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1, ease: EASE_OUT }}
          className="mb-12"
        >
          <div className="mb-3 flex items-end justify-between gap-4">
            <p className="text-xs font-bold uppercase tracking-widest text-inksoft">
              Your {language.name}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="gap-0 px-4 py-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-inksoft">
                <Flame size={12} className="text-main" /> Streak
              </p>
              <p className="mt-1 font-display text-3xl font-extrabold text-foreground">
                {summary.streak}
                <span className="ml-1 text-xs font-bold uppercase text-inksoft">
                  day{summary.streak === 1 ? "" : "s"}
                </span>
              </p>
            </Card>
            <Card className="gap-0 px-4 py-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-inksoft">
                <Target size={12} className="text-main" /> Can-dos
              </p>
              <p className="mt-1 font-display text-3xl font-extrabold text-foreground">
                {summary.objectivesCleared}
              </p>
              <p className="text-[11px] font-semibold text-inksoft">
                {summary.firstTryClears} unaided
              </p>
            </Card>
            <Card className="gap-0 px-4 py-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-inksoft">
                <BookMarked size={12} className="text-main" /> Words
              </p>
              <p className="mt-1 font-display text-3xl font-extrabold text-foreground">
                {summary.wordsBanked}
              </p>
              <p className="text-[11px] font-semibold text-inksoft">
                {summary.wordsDue > 0 ? `${summary.wordsDue} due for review` : "all reviewed"}
              </p>
            </Card>
            <Card className="gap-0 px-4 py-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-inksoft">
                <Trophy size={12} className="text-main" /> Mastery
              </p>
              <p className="mt-1 font-display text-3xl font-extrabold text-foreground">
                {summary.mastery}%
              </p>
              <Progress value={summary.mastery} className="mt-1.5 h-1.5" />
            </Card>
          </div>
        </motion.section>
      )}

      {/* ---- Pick up where you stopped ---- */}
      {walkedRuns.length > 0 && (
        <section className="mb-12">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-inksoft">
            Worlds you have walked
          </p>
          <ul className="space-y-2">
            {walkedRuns.slice(0, 4).map((run) => (
              <li
                key={run.worldId}
                className="flex items-center gap-4 rounded-base border-2 border-border bg-secondary-background px-4 py-3 shadow-shadow"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-base font-bold text-foreground">
                    {run.worldTitle}
                  </p>
                  <p className="text-[11px] font-semibold text-inksoft">
                    {run.cleared} can-do{run.cleared === 1 ? "" : "s"} cleared ·{" "}
                    {run.cluesCount}/3 clues ·{" "}
                    {new Date(run.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-inksoft">
                  {/* Worlds are generated per run, so this is a record, not a resume point. */}
                  finished walking
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- Starter journeys ---- */}
      <section className="mb-12">
        <div className="mb-3 flex items-end justify-between gap-4">
          <p className="text-xs font-bold uppercase tracking-widest text-inksoft">
            Start a journey
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {starters.map(({ starter, idea: seededIdea }, index) => (
            <motion.button
              key={starter.id}
              type="button"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.08 + index * 0.04, ease: EASE_OUT }}
              onClick={() => begin(seededIdea, starter.id)}
              className="group relative overflow-hidden rounded-base border-2 border-border text-left shadow-shadow transition hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none"
            >
              <div className="relative h-36 overflow-hidden border-b-2 border-border">
                <img
                  src={starter.cover}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
              </div>
              <div className="bg-secondary-background px-4 py-3">
                <p className="font-display text-lg font-extrabold leading-tight text-foreground">
                  {starter.title}
                </p>
                <p className="mt-1 text-[12px] font-semibold leading-snug text-inksoft">
                  {starter.blurb}
                </p>
              </div>
            </motion.button>
          ))}
        </div>
      </section>

      {/* ---- Worlds other learners published ---- */}
      {gallery.length > 0 && (
        <section className="mb-12">
          <div className="mb-3 flex items-end justify-between gap-4">
            <p className="text-xs font-bold uppercase tracking-widest text-inksoft">
              Worlds people have shared
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {gallery.map((world) => (
              <div key={world.id} className="relative">
              <a
                href={`/w/${world.id}`}
                className="group relative block aspect-4/3 overflow-hidden rounded-base border-2 border-border shadow-shadow transition hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none"
              >
                {world.thumbnailUrl ? (
                  <img
                    src={world.thumbnailUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="absolute inset-0 bg-foreground/10" />
                )}
                <div className="absolute inset-0 bg-linear-to-t from-foreground/85 via-foreground/25 to-transparent" />
                {world.languageName && (
                  <span className="absolute left-2 top-2 rounded-base border-2 border-border bg-secondary-background px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
                    {world.languageName}
                  </span>
                )}
                {world.mine && (
                  <span className="absolute right-2 top-2 rounded-base border-2 border-border bg-main px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-main-foreground">
                    Yours
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 px-3 pb-3">
                  <p className="font-display text-sm font-bold leading-tight text-white">
                    {world.title}
                  </p>
                  {world.promise && (
                    <p className="mt-0.5 line-clamp-2 text-[11px] font-semibold leading-snug text-white/75">
                      {world.promise}
                    </p>
                  )}
                </div>
              </a>
              {world.mine && (
                <button
                  type="button"
                  onClick={() => void unpublish(world.id)}
                  onBlur={() => setConfirmRemove((id) => (id === world.id ? null : id))}
                  className="absolute bottom-2 right-2 rounded-base border-2 border-border bg-secondary-background px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground"
                >
                  {confirmRemove === world.id ? "Remove?" : "Remove"}
                </button>
              )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- Build your own ---- */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.12, ease: EASE_OUT }}
      >
        <div className="mb-2">
          <p className="text-xs font-bold uppercase tracking-widest text-inksoft">
            Or describe somewhere else entirely
          </p>
        </div>
        <Card className={!IS_CUSTOM_WORLDS_ENABLED ? "border-ink/20 bg-black/[0.02] dark:bg-white/[0.02]" : ""}>
          <CardContent>
            <Textarea
              value={IS_CUSTOM_WORLDS_ENABLED ? idea : ""}
              onChange={(event) => {
                if (IS_CUSTOM_WORLDS_ENABLED) setIdea(event.target.value);
              }}
              onKeyDown={(event) => {
                if (IS_CUSTOM_WORLDS_ENABLED && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  begin(idea);
                }
              }}
              maxLength={MAX_CREATE_IDEA_LENGTH}
              rows={3}
              disabled={!IS_CUSTOM_WORLDS_ENABLED}
              readOnly={!IS_CUSTOM_WORLDS_ENABLED}
              placeholder={
                IS_CUSTOM_WORLDS_ENABLED
                  ? `A place you want to be able to handle in ${language.name}. A repair shop, a wedding you were invited to, a hospital reception desk.`
                  : "To try the custom world generation feature, run on localhost and add a gemini api key with a billing account linked."
              }
              className={`resize-none ${
                !IS_CUSTOM_WORLDS_ENABLED
                  ? "cursor-not-allowed select-none bg-black/5 text-inksoft/80 opacity-70 dark:bg-white/5"
                  : ""
              }`}
            />
          </CardContent>
          <CardFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[11px] font-medium text-inksoft/70">
              {IS_CUSTOM_WORLDS_ENABLED
                ? "Cmd + Enter to build · the world and its lesson are written together"
                : "To try the custom world generation feature, run on localhost and add a gemini api key with a billing account linked."}
            </span>
            <Button
              onClick={() => begin(idea)}
              disabled={!IS_CUSTOM_WORLDS_ENABLED || !idea.trim()}
              className={!IS_CUSTOM_WORLDS_ENABLED ? "cursor-not-allowed opacity-40" : ""}
            >
              Build this world
              <ArrowRight size={15} />
            </Button>
          </CardFooter>
        </Card>
      </motion.section>
    </div>
  );
}
