import { GoogleGenAI } from "@google/genai";
import { DEFAULT_RETRY_OPTS, getErrorStatus, isTransientError, withRetry } from "./retry";

// Nano Banana Flash Image powers every visual in Vaarta.
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gemini-3.1-flash-image";

let client: GoogleGenAI | null = null;
export function ai(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local to run the game."
    );
  }
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

/** Avoid repeatedly retrying a permanent zero-quota response from Gemini. */
function shouldRetryGeminiRequest(error: unknown): boolean {
  if (!isTransientError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return !/limit\s*[:=]\s*0\b/i.test(message);
}

/** Gemini generateContent with exponential backoff on transient failures. */
export async function generateContentWithRetry(
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0]
) {
  return withRetry(() => ai().models.generateContent(params), {
    ...DEFAULT_RETRY_OPTS,
    shouldRetry: shouldRetryGeminiRequest,
  });
}

/**
 * Gemini Omni currently exposes its generation surface through Interactions,
 * rather than `models.generateContent`. Keep its retry policy identical to the
 * rest of the app without forcing callers to know the transport difference.
 */
export async function generateInteractionWithRetry(
  params: Parameters<GoogleGenAI["interactions"]["create"]>[0]
) {
  return withRetry(() => ai().interactions.create(params), {
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
