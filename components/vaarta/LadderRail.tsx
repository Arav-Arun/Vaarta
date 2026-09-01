"use client";

/**
 * The left rail: the can-do ladder, grouped by the character who teaches it.
 *
 * Grouping by character rather than showing one flat list is the point. In
 * Vaarta a clue is released only when its keeper has nothing left to teach, so
 * "two rungs left with Meera" is not a progress bar — it is a direction to
 * walk in.
 */

import { CheckCircle2, Circle, KeyRound, Lock, Volume2 } from "lucide-react";
import type { GameBible } from "@/lib/universe";
import type { VaartaCurriculum, VaartaObjectiveProgress } from "@/lib/vaarta/types";
import { Progress } from "@/components/ui/progress";

export type LadderRailProps = {
  bible: GameBible;
  curriculum: VaartaCurriculum;
  progress: Record<string, VaartaObjectiveProgress>;
  cluesFound: boolean[];
  /** The rung the player is being scored against right now, if any. */
  activeObjectiveId: string | null;
  mastery: number;
  /** Speak a line in the target language; `slow` separates it word by word. */
  onSpeak: (text: string, slow?: boolean) => void;
  speaking: boolean;
};

export function LadderRail({
  bible,
  curriculum,
  progress,
  cluesFound,
  activeObjectiveId,
  mastery,
  onSpeak,
  speaking,
}: LadderRailProps) {
  const cleared = curriculum.objectives.filter((item) => progress[item.id]?.cleared).length;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <section className="rounded-base border-2 border-border bg-secondary-background p-3 shadow-shadow">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">
          What this world teaches
        </p>
        <p className="mt-1 text-sm font-semibold leading-snug text-foreground">
          {curriculum.promise}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Progress value={curriculum.objectives.length ? (cleared / curriculum.objectives.length) * 100 : 0} className="h-2 flex-1" />
          <span className="shrink-0 text-[11px] font-bold tabular-nums text-foreground">
            {cleared}/{curriculum.objectives.length}
          </span>
        </div>
        <p className="mt-2 text-[11px] font-semibold text-inksoft">
          {mastery}% mastery · {curriculum.language.name} explained in {curriculum.supportLanguage}
        </p>

        {curriculum.starterVocabulary.length > 0 && (
          <div className="mt-3 border-t-2 border-border/40 pt-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft">
              Before you speak to anyone
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {curriculum.starterVocabulary.map((word) => (
                <li key={word.native}>
                  <button
                    type="button"
                    disabled={speaking}
                    aria-label={`Hear ${word.native} slowly`}
                    className="flex items-center gap-1 rounded-base border-2 border-border bg-background px-1.5 py-1 text-left transition hover:bg-main/20 disabled:opacity-40"
                    onClick={() => onSpeak(word.native, true)}
                  >
                    <span className="text-[12px] font-bold leading-none text-foreground">
                      {word.native}
                    </span>
                    <span className="text-[10px] leading-none text-inksoft">{word.meaning}</span>
                    <Volume2 size={9} className="shrink-0 text-inksoft" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {bible.npcs.map((npc, npcIndex) => {
        const rungs = curriculum.objectives.filter((item) => item.ownerIndex === npcIndex);
        const done = rungs.filter((item) => progress[item.id]?.cleared).length;
        const clueOut = cluesFound[npcIndex];
        return (
          <section
            key={`${npc.name}-${npcIndex}`}
            className="rounded-base border-2 border-border bg-secondary-background p-3 shadow-shadow"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-display text-base font-extrabold text-foreground">
                  {npc.name}
                </p>
                <p className="truncate text-[11px] font-semibold text-inksoft">
                  {npc.role} · {bible.rooms[npcIndex]?.name}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-base border-2 border-border px-1.5 py-0.5 text-[10px] font-black ${
                  clueOut ? "bg-main text-main-foreground" : "bg-background text-inksoft"
                }`}
                title={clueOut ? "Clue earned" : "Clear their rungs to earn the clue"}
              >
                {clueOut ? <KeyRound size={11} /> : <Lock size={11} />}
              </span>
            </div>

            <ul className="mt-2 space-y-1.5">
              {rungs.map((item) => {
                const evidence = progress[item.id];
                const isDone = Boolean(evidence?.cleared);
                const isActive = item.id === activeObjectiveId;
                return (
                  <li
                    key={item.id}
                    className={`rounded-base px-1.5 py-1 ${
                      isActive ? "border-2 border-border bg-main/25" : ""
                    }`}
                  >
                    <div
                      className={`flex items-start gap-2 text-[12px] font-semibold leading-snug ${
                        isDone ? "text-inksoft" : "text-foreground"
                      }`}
                    >
                      {isDone ? (
                        <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-main" />
                      ) : (
                        <Circle size={13} className="mt-0.5 shrink-0 text-inksoft/60" />
                      )}
                      <span className="min-w-0">
                        {item.canDo}
                        {isDone && evidence?.firstTry && (
                          <span className="ml-1 text-[10px] font-black uppercase text-main">
                            unaided
                          </span>
                        )}
                      </span>
                    </div>

                    {/* The line itself, in the language being learned.
                        A rung described only in English tells a learner what to
                        achieve and not one word of how to say it, which is the
                        wrong half of the lesson to show. */}
                    <div className="mt-1 ml-[21px] flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p
                          lang={curriculum.language.id}
                          className="text-[13px] font-bold leading-tight text-foreground"
                        >
                          {item.targetPhrase.native}
                        </p>
                        {item.targetPhrase.roman !== item.targetPhrase.native && (
                          <p className="text-[11px] italic leading-tight text-inksoft">
                            {item.targetPhrase.roman}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={speaking}
                        aria-label={`Hear "${item.targetPhrase.native}" slowly`}
                        title="Hear it slowly"
                        className="shrink-0 rounded-base border-2 border-border bg-background p-1 text-inksoft transition hover:text-foreground disabled:opacity-40"
                        onClick={() => onSpeak(item.targetPhrase.native, true)}
                      >
                        <Volume2 size={12} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {clueOut && (
              <p className="mt-2 rounded-base border-2 border-border bg-main/20 px-2 py-1.5 text-[11px] font-semibold leading-snug text-foreground">
                {bible.story.clues[npcIndex]}
              </p>
            )}
            {!clueOut && rungs.length > 0 && (
              <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-inksoft">
                {rungs.length - done} to go for their clue
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
