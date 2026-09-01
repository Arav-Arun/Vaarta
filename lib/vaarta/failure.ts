/**
 * Turn a generation failure into something the person reading it can act on.
 *
 * "This world could not be built. Please try again." is the right message for a
 * flaky model call and exactly the wrong one for an unset API key — retrying
 * will never work, and the one fact the reader needs is missing. Every Vaarta
 * generation route funnels its errors through here so a misconfiguration says
 * so once, plainly, instead of looking like bad luck.
 *
 * Nothing here leaks internals: each branch is a sentence written for a person,
 * and the raw error is logged separately by the route.
 */

import { getErrorStatus } from "../retry";

export type Failure = { message: string; status: number };

/**
 * @param error   Whatever the generation call threw.
 * @param fallback What to say when the cause is genuinely just "it failed".
 */
export function describeGenerationFailure(error: unknown, fallback: string): Failure {
  const message = error instanceof Error ? error.message : String(error);
  const status = getErrorStatus(error);

  // The single most common local failure: no key at all.
  if (/GEMINI_API_KEY is not set/i.test(message)) {
    return {
      message:
        "Vaarta has no Gemini key. Add GEMINI_API_KEY to .env.local and restart the server.",
      status: 503,
    };
  }
  if (status === 401 || status === 403 || /API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(message)) {
    return {
      message: "Gemini rejected the configured API key. Check GEMINI_API_KEY.",
      status: 503,
    };
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message)) {
    return {
      message:
        "This Gemini project is out of quota right now. Enable billing for the key, or try again later.",
      status: 429,
    };
  }
  if (status === 404 || /NOT_FOUND|is not found|not supported/i.test(message)) {
    return {
      message:
        "The configured model is not available to this key. Check TEXT_MODEL and IMAGE_MODEL.",
      status: 503,
    };
  }
  if (/SAFETY|blocked|PROHIBITED_CONTENT/i.test(message)) {
    return {
      message: "Gemini declined that idea. Try describing the place a different way.",
      status: 422,
    };
  }
  // Nothing reached Gemini at all. This is the one failure that is about the
  // machine running Vaarta rather than about Vaarta, and it is worth saying so:
  // it fails instantly, exhausts its retries in a few seconds, and otherwise
  // looks exactly like the model having a bad day.
  if (/fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network/i.test(message)) {
    return {
      message: "Could not reach Gemini. Check this machine's network connection, then try again.",
      status: 503,
    };
  }
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /UNAVAILABLE|overloaded|INTERNAL/i.test(message)
  ) {
    return {
      message: "Gemini is overloaded right now. Wait a moment and try again.",
      status: 503,
    };
  }
  return { message: fallback, status: 503 };
}
