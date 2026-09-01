import { NextRequest, NextResponse } from "next/server";
import { ensureRun, loadSummary, saveLearnerPreferences } from "@/lib/vaarta/progress";
import { DEFAULT_LANGUAGE, isSupportLanguage, resolveLanguage } from "@/lib/vaarta/languages";
import type { VaartaCurriculum } from "@/lib/vaarta/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET `/api/vaarta/progress`: the dashboard's whole payload.
 *
 * Always 200. A signed-out learner gets `signedIn: false` and an empty record,
 * which the dashboard fills in from `localStorage` — the browser is a complete
 * store in its own right, so there is nothing here to fail over.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const language = resolveLanguage(url.searchParams.get("language")) ?? DEFAULT_LANGUAGE;
  const supportParam = url.searchParams.get("supportLanguage");
  const supportLanguage = isSupportLanguage(supportParam) ? supportParam : "English";
  return NextResponse.json(await loadSummary(language.id, supportLanguage));
}

type ProgressBody =
  | { action: "preferences"; displayName?: string; language?: string; supportLanguage?: string }
  | { action: "start-run"; worldKey?: string; worldTitle?: string; curriculum: VaartaCurriculum };

/**
 * POST `/api/vaarta/progress`: save the learner's language choice, or open the
 * run row a world's turns will be recorded against.
 *
 * Both actions answer 200 with a `persisted` flag rather than failing when
 * there is no session or no database. The caller uses the flag to decide
 * whether to also keep the record in the browser, and plays on either way.
 */
export async function POST(req: NextRequest) {
  let body: ProgressBody;
  try {
    body = (await req.json()) as ProgressBody;
  } catch {
    return NextResponse.json({ error: "Invalid progress request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid progress request." }, { status: 400 });
  }

  if (body.action === "preferences") {
    const language = resolveLanguage(body.language);
    const persisted = await saveLearnerPreferences({
      displayName: typeof body.displayName === "string" ? body.displayName.slice(0, 40) : undefined,
      languageId: language?.id,
      supportLanguage: isSupportLanguage(body.supportLanguage) ? body.supportLanguage : undefined,
    });
    return NextResponse.json({ persisted });
  }

  if (body.action === "start-run") {
    if (!body.curriculum?.objectives?.length || !body.curriculum.language?.id) {
      return NextResponse.json({ error: "Missing curriculum." }, { status: 422 });
    }
    if (typeof body.worldKey !== "string" || !body.worldKey.trim()) {
      return NextResponse.json({ error: "Missing world key." }, { status: 422 });
    }
    const runId = await ensureRun({
      worldKey: body.worldKey.trim().slice(0, 80),
      worldTitle: body.worldTitle || "Untitled world",
      curriculum: body.curriculum,
    });
    return NextResponse.json({ runId, persisted: runId !== null });
  }

  return NextResponse.json({ error: "Unknown progress action." }, { status: 400 });
}
