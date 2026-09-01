import { NextRequest, NextResponse } from "next/server";
import { scoreTurn, VaartaTutorError } from "@/lib/vaarta/tutor";
import { recordTurn } from "@/lib/vaarta/progress";
import { resolveLanguage } from "@/lib/vaarta/languages";
import type { GameBible } from "@/lib/universe";
import type { VaartaCurriculum } from "@/lib/vaarta/types";
import { describeGenerationFailure } from "@/lib/vaarta/failure";

export const runtime = "nodejs";
// Audio in, a scored judgement and an in-character reply out.
export const maxDuration = 90;

type TurnBody = {
  bible: GameBible;
  curriculum: VaartaCurriculum;
  npcIndex: number;
  objectiveId: string;
  /** Rungs already cleared in this run; lets the server stay stateless. */
  clearedObjectiveIds?: string[];
  attemptsForObjective?: number;
  hintUsed?: boolean;
  history?: string[];
  typedResponse?: string;
  audioBase64?: string;
  audioMimeType?: string;
  scene?: { title?: string; ambient?: string };
  playerName?: string;
  /** Persistence, all optional: a signed-out learner sends none of it. */
  runId?: string | null;
  worldTitle?: string;
  cluesFound?: boolean[];
};

/**
 * POST `/api/vaarta/turn`: score one exchange and get the character's reply.
 *
 * The response is the only thing that moves the game forward — `clueRevealed`
 * on it is what unlocks a third of the world's mystery — so the deterministic
 * guards in `scoreTurn` matter more than they would in a chat app.
 */
export async function POST(req: NextRequest) {
  let body: TurnBody;
  try {
    body = (await req.json()) as TurnBody;
  } catch {
    return NextResponse.json({ error: "Invalid turn request." }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !body.bible?.npcs?.length ||
    !body.curriculum?.objectives?.length ||
    !Number.isInteger(body.npcIndex) ||
    body.npcIndex < 0 ||
    body.npcIndex > 2 ||
    typeof body.objectiveId !== "string"
  ) {
    return NextResponse.json({ error: "Missing world, curriculum, or objective." }, { status: 422 });
  }

  const hasTyped = typeof body.typedResponse === "string" && body.typedResponse.trim().length > 0;
  const hasAudio = typeof body.audioBase64 === "string" && body.audioBase64.length > 0;
  if (!hasTyped && !hasAudio) {
    return NextResponse.json({ error: "Say or type something first." }, { status: 422 });
  }

  const curriculum = body.curriculum;
  const objective = curriculum.objectives.find((item) => item.id === body.objectiveId);
  if (!objective) {
    return NextResponse.json({ error: "That objective is not in this world." }, { status: 422 });
  }

  // Re-resolve the language server-side: the browser's copy travels through
  // JSON and a hand-edited or stale payload should not be able to redirect
  // scoring (or TTS) to a language this run was never planned for.
  const language = resolveLanguage(curriculum.language?.id) ?? curriculum.language;

  const cleared = new Set(body.clearedObjectiveIds ?? []);
  const remainingAfterThis = curriculum.objectives.filter(
    (item) =>
      item.ownerIndex === body.npcIndex && item.id !== objective.id && !cleared.has(item.id)
  ).length;

  try {
    const turn = await scoreTurn({
      bible: body.bible,
      curriculum: { ...curriculum, language },
      npcIndex: body.npcIndex,
      objective,
      remainingAfterThis,
      attemptsForObjective: Math.max(0, Math.round(Number(body.attemptsForObjective) || 0)),
      hintUsed: body.hintUsed === true,
      history: (body.history ?? []).filter((line): line is string => typeof line === "string").slice(-24),
      typedResponse: hasTyped ? body.typedResponse!.trim().slice(0, 600) : undefined,
      audio: hasAudio
        ? { data: body.audioBase64!, mimeType: body.audioMimeType || "audio/webm" }
        : undefined,
      scene:
        body.scene?.title || body.scene?.ambient
          ? { title: body.scene.title ?? "", ambient: body.scene.ambient ?? "" }
          : undefined,
      playerName: (body.playerName || "the traveller").slice(0, 40),
    });

    // Persistence is a bonus, never a gate: a learner who just spoke a sentence
    // correctly must never see an error about the database.
    if (body.runId) {
      void recordTurn({
        runId: body.runId,
        objectiveId: objective.id,
        canDo: objective.canDo,
        skill: objective.skill,
        level: objective.level,
        npcIndex: body.npcIndex,
        inputMode: turn.inputMode,
        outcome: turn.outcome,
        errorCode: turn.feedbackFocus?.code,
        transcript: turn.transcript,
        hintUsed: body.hintUsed === true,
        priorAttempts: Math.max(0, Math.round(Number(body.attemptsForObjective) || 0)),
        newWords: turn.newWords,
        languageId: language.id,
        worldTitle: body.worldTitle || body.bible.title,
        cluesFound: Array.isArray(body.cluesFound) ? body.cluesFound : [false, false, false],
      });
    }

    return NextResponse.json(turn);
  } catch (error) {
    console.error("[/api/vaarta/turn]", error);
    if (error instanceof VaartaTutorError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const failure = describeGenerationFailure(error, "That turn could not be scored.");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
