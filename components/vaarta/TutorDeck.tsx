"use client";

/**
 * The bottom deck: one conversation, scored as it happens.
 *
 * Everything the learner needs to take their next turn lives here — what the
 * character just said, what it meant, what went right or short last time, and
 * three concrete things they could try — so the eye never has to leave the
 * bottom band mid-sentence.
 */

import { useRef, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  Mic,
  Send,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NpcPlan } from "@/lib/universe";
import type { VaartaObjective, VaartaTurnResponse } from "@/lib/vaarta/types";

export type TutorDeckProps = {
  npc: NpcPlan;
  objective: VaartaObjective | null;
  /** The most recent scored exchange, or null before the learner has spoken. */
  lastTurn: VaartaTurnResponse | null;
  languageName: string;
  thinking: boolean;
  recording: boolean;
  speaking: boolean;
  /** True when this character has just given up their clue. */
  clueJustEarned: boolean;
  error: string | null;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSubmitTyped: (text: string) => void;
  onSpeak: (text: string, slow?: boolean) => void;
  onClose: () => void;
};

export function TutorDeck({
  npc,
  objective,
  lastTurn,
  languageName,
  thinking,
  recording,
  speaking,
  clueJustEarned,
  error,
  onStartRecording,
  onStopRecording,
  onSubmitTyped,
  onSpeak,
  onClose,
}: TutorDeckProps) {
  const [typed, setTyped] = useState("");
  const [draftFor, setDraftFor] = useState<string | null>(objective?.id ?? null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A cleared rung swaps in a new objective, and the draft underneath it was
  // written for the previous one. Adjusting during render (rather than in an
  // effect) means the stale text never reaches the screen for a frame.
  const objectiveId = objective?.id ?? null;
  if (objectiveId !== draftFor) {
    setDraftFor(objectiveId);
    setTyped("");
  }

  const busy = thinking || recording;
  const outcome = lastTurn?.outcome;

  return (
    <section className="pointer-events-auto w-full border-t-2 border-border bg-secondary-background/97 shadow-[0_-10px_36px_rgba(0,0,0,.28)] backdrop-blur-md">
      <div className="mx-auto grid w-full max-w-[120rem] gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)] lg:px-5">
        {/* ---- What just happened ---- */}
        <div className="min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">
                {npc.role} · speaking {languageName}
              </p>
              <h2 className="truncate font-display text-xl font-extrabold text-foreground">
                {npc.name}
              </h2>
            </div>
            <Button variant="neutral" size="sm" sound="close" onClick={onClose}>
              <X size={14} /> Leave
            </Button>
          </div>

          {clueJustEarned && (
            <p className="flex items-center gap-2 rounded-base border-2 border-border bg-main px-3 py-2 text-sm font-black text-main-foreground shadow-shadow">
              <KeyRound size={15} /> {npc.name} trusts you. Their clue is yours.
            </p>
          )}

          {lastTurn ? (
            <article className="rounded-base border-2 border-border bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-bold leading-snug text-foreground">
                    {lastTurn.npcLine.native}
                  </p>
                  {lastTurn.npcLine.roman !== lastTurn.npcLine.native && (
                    <p className="text-xs italic leading-snug text-inksoft">
                      {lastTurn.npcLine.roman}
                    </p>
                  )}
                  <p className="mt-0.5 text-sm font-medium leading-snug text-inksoft">
                    {lastTurn.npcLine.meaning}
                  </p>
                </div>
                <Button
                  variant="neutral"
                  size="sm"
                  className="shrink-0"
                  disabled={speaking}
                  aria-label="Hear that line again"
                  onClick={() => onSpeak(lastTurn.npcLine.native)}
                >
                  <Volume2 size={14} />
                </Button>
              </div>

              {lastTurn.transcript && (
                <p className="mt-2 border-t-2 border-border/40 pt-2 text-[11px] font-semibold text-inksoft">
                  You said: <span className="text-foreground">{lastTurn.transcript}</span>
                </p>
              )}
              {!lastTurn.transcript && lastTurn.inputMode === "voice" && (
                <p className="mt-2 border-t-2 border-border/40 pt-2 text-[11px] font-bold text-health">
                  Nothing audible came through. Move closer to the mic. Unclear audio is never
                  counted as a language mistake.
                </p>
              )}
            </article>
          ) : (
            <article className="rounded-base border-2 border-border bg-background p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">
                Before you speak
              </p>
              <p className="mt-1 text-sm font-semibold italic leading-snug text-foreground">
                {npc.opening}
              </p>
              <p className="mt-1.5 text-[11px] font-medium text-inksoft">
                Say it however you can. Meaning is what is scored, never your accent.
              </p>
            </article>
          )}

          {lastTurn && (
            <article
              className={`rounded-base border-2 border-border p-3 ${
                outcome === "success" ? "bg-main/25" : "bg-background"
              }`}
            >
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft">
                {outcome === "success" ? (
                  <>
                    <CheckCircle2 size={12} className="text-main" /> Cleared
                  </>
                ) : (
                  <>
                    <Sparkles size={12} className="text-main" />
                    {outcome === "partial" ? "Nearly" : "Try once more"}
                    {lastTurn.feedbackFocus ? ` · ${lastTurn.feedbackFocus.label}` : ""}
                  </>
                )}
              </p>
              <p className="mt-1 text-sm font-bold leading-snug text-foreground">
                {lastTurn.coaching.whatWorked}
              </p>
              {outcome !== "success" && (
                <>
                  <p className="mt-1 text-[12px] font-semibold leading-snug text-inksoft">
                    {lastTurn.coaching.nextFocus}
                  </p>
                  {lastTurn.coaching.level >= 1 && (
                    <div className="mt-2 flex items-start justify-between gap-2 rounded-base border-2 border-border bg-secondary-background px-2 py-1.5">
                      <div className="min-w-0">
                        <p className="text-sm font-bold leading-tight text-foreground">
                          {lastTurn.coaching.keyChunk.native}
                        </p>
                        <p className="text-[11px] italic leading-tight text-inksoft">
                          {lastTurn.coaching.keyChunk.roman} · {lastTurn.coaching.keyChunk.meaning}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={speaking}
                        aria-label="Hear that fragment slowly"
                        className="shrink-0 rounded-base border-2 border-border bg-background p-1 text-inksoft transition hover:text-foreground disabled:opacity-40"
                        onClick={() => onSpeak(lastTurn.coaching.keyChunk.native, true)}
                      >
                        <Volume2 size={12} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </article>
          )}
        </div>

        {/* ---- What to say next ---- */}
        <aside className="min-w-0 space-y-2">
          {objective && (
            <p className="rounded-base border-2 border-border bg-background px-2.5 py-1.5 text-[12px] font-bold leading-snug text-foreground">
              <span className="text-[10px] font-black uppercase tracking-wider text-inksoft">
                Now:{" "}
              </span>
              {objective.canDo}
            </p>
          )}

          {lastTurn?.suggestions?.length ? (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft">
                You could try
              </p>
              {lastTurn.suggestions.map((line) => (
                <button
                  key={line.native}
                  type="button"
                  disabled={busy}
                  // Filling the box rather than sending it: a tapped suggestion
                  // the learner never reads or edits teaches nothing.
                  onClick={() => {
                    setTyped(line.roman || line.native);
                    inputRef.current?.focus();
                  }}
                  className="w-full rounded-base border-2 border-border bg-background px-2 py-1.5 text-left transition hover:bg-main/20 disabled:opacity-50"
                >
                  <span className="block text-[12px] font-bold leading-tight text-foreground">
                    {line.native}
                  </span>
                  <span className="block text-[10px] leading-tight text-inksoft">
                    {line.meaning}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {error && (
            <p className="rounded-base border-2 border-border bg-health/20 px-2 py-1.5 text-[11px] font-bold text-foreground">
              {error}
            </p>
          )}

          <Button
            className={`w-full ${recording ? "bg-health text-white" : ""}`}
            size="lg"
            sound="none"
            disabled={thinking}
            onClick={recording ? onStopRecording : onStartRecording}
          >
            <Mic className={recording ? "animate-pulse" : ""} />
            {recording
              ? "Listening… pause to send"
              : thinking
                ? `${npc.name} is listening…`
                : `Say it in ${languageName}`}
          </Button>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = typed.trim();
              if (!value || busy) return;
              onSubmitTyped(value);
              setTyped("");
            }}
          >
            <Input
              ref={inputRef}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="…or type it"
              disabled={busy}
              aria-label={`Type your ${languageName} reply`}
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send typed reply"
              disabled={busy || !typed.trim()}
            >
              <Send />
            </Button>
          </form>
        </aside>
      </div>
    </section>
  );
}
