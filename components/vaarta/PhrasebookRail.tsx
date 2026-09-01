"use client";

/**
 * The right rail: the words this place is teaching, and the ones already
 * banked.
 *
 * The `anchor` field is what earns this rail its screen space. Every word the
 * planner writes names something the vision pass can actually find in the
 * painted frame, so the rail can say "the word for that stall you are standing
 * next to" rather than showing a flashcard with no referent.
 */

import { BookMarked, Eye, EyeOff, Flame, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VaartaBankedWord, VaartaObjective, VaartaWord } from "@/lib/vaarta/types";

export type PhrasebookRailProps = {
  languageName: string;
  /** The rung in play, when the learner is mid-conversation. */
  objective: VaartaObjective | null;
  /** Words worth knowing before meeting anyone. */
  starterVocabulary: VaartaWord[];
  bank: VaartaBankedWord[];
  dueCount: number;
  streak: number;
  /** True once the learner has revealed the model answer for this rung. */
  hintShown: boolean;
  onRevealHint: () => void;
  onSpeak: (text: string, slow?: boolean) => void;
  speaking: boolean;
};

function WordChip({
  word,
  onSpeak,
  speaking,
}: {
  word: VaartaWord;
  onSpeak: (text: string, slow?: boolean) => void;
  speaking: boolean;
}) {
  return (
    <li className="rounded-base border-2 border-border bg-background px-2 py-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight text-foreground">{word.native}</p>
          {word.roman !== word.native && (
            <p className="text-[11px] italic leading-tight text-inksoft">{word.roman}</p>
          )}
          <p className="text-[11px] font-semibold leading-tight text-foreground">{word.meaning}</p>
        </div>
        <button
          type="button"
          disabled={speaking}
          aria-label={`Hear ${word.native}`}
          className="shrink-0 rounded-base border-2 border-border bg-secondary-background p-1 text-inksoft transition hover:text-foreground disabled:opacity-40"
          onClick={() => onSpeak(word.native, true)}
        >
          <Volume2 size={12} />
        </button>
      </div>
      {word.anchor && (
        <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-main">
          look for: {word.anchor}
        </p>
      )}
    </li>
  );
}

export function PhrasebookRail({
  languageName,
  objective,
  starterVocabulary,
  bank,
  dueCount,
  streak,
  hintShown,
  onRevealHint,
  onSpeak,
  speaking,
}: PhrasebookRailProps) {
  const teaching = objective?.vocabulary ?? starterVocabulary;
  const recent = [...bank].slice(-8).reverse();

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <section className="rounded-base border-2 border-border bg-secondary-background p-3 shadow-shadow">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">
            <Flame size={12} className="text-main" /> Streak
          </p>
          <p className="font-display text-xl font-extrabold leading-none text-foreground">
            {streak}
            <span className="ml-1 text-[10px] font-bold uppercase text-inksoft">
              day{streak === 1 ? "" : "s"}
            </span>
          </p>
        </div>
        <div className="mt-2 flex items-center justify-between border-t-2 border-border/40 pt-2">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">
            <BookMarked size={12} className="text-main" /> Words
          </p>
          <p className="text-[11px] font-bold tabular-nums text-foreground">
            {bank.length} banked{dueCount > 0 ? ` · ${dueCount} due` : ""}
          </p>
        </div>
      </section>

      {objective && (
        <section className="rounded-base border-2 border-border bg-secondary-background p-3 shadow-shadow">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">
            Get this across
          </p>
          <p className="mt-1 text-sm font-bold leading-snug text-foreground">{objective.canDo}</p>

          <div className="mt-3 rounded-base border-2 border-border bg-background p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-inksoft">
                One way to say it
              </p>
              <Button
                variant="neutral"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={onRevealHint}
                title={
                  hintShown
                    ? "Hide the model answer"
                    : "Revealing counts as supported practice, not an unaided clear"
                }
              >
                {hintShown ? <EyeOff size={11} /> : <Eye size={11} />}
                {hintShown ? "Hide" : "Show"}
              </Button>
            </div>
            {hintShown ? (
              <div className="mt-1.5">
                <p className="text-sm font-bold leading-tight text-foreground">
                  {objective.targetPhrase.native}
                </p>
                {objective.targetPhrase.roman !== objective.targetPhrase.native && (
                  <p className="text-[11px] italic leading-tight text-inksoft">
                    {objective.targetPhrase.roman}
                  </p>
                )}
                <p className="text-[11px] font-semibold text-foreground">
                  {objective.targetPhrase.meaning}
                </p>
                <Button
                  variant="neutral"
                  size="sm"
                  className="mt-2 h-7 w-full text-[11px]"
                  disabled={speaking}
                  onClick={() => onSpeak(objective.targetPhrase.native, true)}
                >
                  <Volume2 size={12} /> Hear it slowly
                </Button>
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] font-medium leading-snug text-inksoft">
                Try it in your own words first. Clearing a rung unaided is tracked separately.
              </p>
            )}
          </div>
        </section>
      )}

      <section className="rounded-base border-2 border-border bg-secondary-background p-3 shadow-shadow">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">
          {objective ? "Words for this moment" : `Starter ${languageName}`}
        </p>
        <ul className="mt-2 space-y-1.5">
          {teaching.map((word) => (
            <WordChip
              key={`${word.native}-${word.meaning}`}
              word={word}
              onSpeak={onSpeak}
              speaking={speaking}
            />
          ))}
          {teaching.length === 0 && (
            <li className="text-[11px] font-medium text-inksoft">
              Walk up to someone and start speaking. Words appear as you meet them.
            </li>
          )}
        </ul>
      </section>

      {recent.length > 0 && (
        <section className="rounded-base border-2 border-border bg-secondary-background p-3 shadow-shadow">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">
            Picked up here
          </p>
          <ul className="mt-2 space-y-1.5">
            {recent.map((word) => (
              <WordChip
                key={`bank-${word.native}`}
                word={word}
                onSpeak={onSpeak}
                speaking={speaking}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
