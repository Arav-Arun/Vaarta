import { DEFAULT_RETRY_OPTS, getErrorStatus, isTransientError, withRetry } from "./retry";

// Nano Banana Flash Image powers every visual in Vaarta.
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gemini-3.1-flash-image";

/** JSON Schema type names accepted by Gemini's REST API. */
export const Type = {
  STRING: "STRING",
  NUMBER: "NUMBER",
  INTEGER: "INTEGER",
  BOOLEAN: "BOOLEAN",
  ARRAY: "ARRAY",
  OBJECT: "OBJECT",
} as const;

type GeminiPart = {
  text?: string;
  inlineData?: { data: string; mimeType: string };
};

type GeminiGenerateParams = {
  model: string;
  contents: Array<string | GeminiPart> | string | GeminiPart;
  config?: Record<string, unknown>;
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  text?: string;
};

function apiKey() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local to run the game."
    );
  }
  return process.env.GEMINI_API_KEY;
}

function toGeminiParts(contents: GeminiGenerateParams["contents"]): GeminiPart[] {
  const items = Array.isArray(contents) ? contents : [contents];
  return items.map((content) => {
    if (typeof content === "string") return { text: content };
    if (content.text !== undefined || content.inlineData !== undefined) return content;
    throw new Error("Gemini content must be text or inline data.");
  });
}

function geminiError(status: number, body: unknown) {
  const detail =
    body && typeof body === "object" && "error" in body
      ? (body.error as { message?: unknown }).message
      : undefined;
  const error = new Error(
    typeof detail === "string" && detail ? detail : `Gemini request failed (${status}).`
  ) as Error & { status: number };
  error.status = status;
  return error;
}

/**
 * Calls Gemini directly with the API-key REST flow. This app does not use
 * Vertex credentials, so native fetch avoids pulling a server-auth dependency
 * tree into the deployment just to make the same API request.
 */
async function generateContent(params: GeminiGenerateParams): Promise<GeminiResponse> {
  const { model, contents, config = {} } = params;
  const { systemInstruction, ...generationConfig } = config;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey(),
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: toGeminiParts(contents) }],
        ...(typeof systemInstruction === "string"
          ? { systemInstruction: { role: "user", parts: [{ text: systemInstruction }] } }
          : {}),
        ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
      }),
    }
  );

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw geminiError(response.status, payload);

  const result = (payload ?? {}) as GeminiResponse;
  const text = result.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("");
  return { ...result, ...(text ? { text } : {}) };
}

/** Avoid repeatedly retrying a permanent zero-quota response from Gemini. */
function shouldRetryGeminiRequest(error: unknown): boolean {
  if (!isTransientError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return !/limit\s*[:=]\s*0\b/i.test(message);
}

/** Gemini generateContent with exponential backoff on transient failures. */
export async function generateContentWithRetry(
  params: GeminiGenerateParams
) {
  return withRetry(() => generateContent(params), {
    ...DEFAULT_RETRY_OPTS,
    shouldRetry: shouldRetryGeminiRequest,
  });
}

const TRANSPARENT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export type ImageResult = {
  /** base64 (no data-url prefix) */
  b64: string;
  mimeType: string;
  /** true when generation failed and we fell back to a placeholder */
  fallback: boolean;
  /** Why generation failed, when `fallback` is true. Safe to show a user. */
  failureReason?: string;
};

/**
 * Turn a raw image-model failure into one honest sentence. Quota is only one of
 * several causes, and reporting the others as quota sends people to the billing
 * console for a problem that lives in the code.
 */
function describeImageFailure(err: unknown): string {
  const status = getErrorStatus(err);
  const message = err instanceof Error ? err.message : String(err);
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message)) {
    return "This Gemini project is out of image-generation quota right now.";
  }
  if (status === 401 || status === 403 || /API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(message)) {
    return "Gemini rejected the API key for image generation.";
  }
  if (status === 404 || /NOT_FOUND|is not found|not supported/i.test(message)) {
    return `The configured image model (${IMAGE_MODEL}) is not available to this key.`;
  }
  if (/SAFETY|blocked|PROHIBITED_CONTENT/i.test(message)) {
    return "Gemini declined to illustrate that prompt.";
  }
  return "The image model did not return a picture.";
}

/**
 * Generate a scene image with Nano Banana. When a previous frame is supplied it
 * is passed as a visual reference so characters and art style stay consistent.
 */
export async function generateImage(
  imagePrompt: string,
  styleBible: string,
  prevImage: string | null
): Promise<ImageResult> {
  const fullPrompt = [
    imagePrompt,
    `Art direction: ${styleBible}`,
    "16:9 composition, 1K, no text, no watermark, no logos.",
    prevImage
      ? "Maintain the same recurring characters, wardrobe, and overall art style as the reference image for visual continuity."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const contents: Array<
    { text: string } | { inlineData: { data: string; mimeType: string } }
  > = [];
  if (prevImage) {
    contents.push({
      inlineData: { data: prevImage, mimeType: "image/png" },
    });
  }
  contents.push({ text: fullPrompt });

  try {
    const response = await generateContentWithRetry({
      model: IMAGE_MODEL,
      contents,
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "16:9", imageSize: "1K" },
    },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return {
          b64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
          fallback: false,
        };
      }
    }
    throw new Error("No image data returned by image model.");
  } catch (err) {
    console.error("[generateImage] falling back to placeholder:", err);
    return {
      b64: TRANSPARENT_PNG,
      mimeType: "image/png",
      fallback: true,
      failureReason: describeImageFailure(err),
    };
  }
}

export function toDataUrl(b64: string, mimeType: string): string {
  return `data:${mimeType};base64,${b64}`;
}
