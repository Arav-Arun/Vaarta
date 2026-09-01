import { RETRY_BASE_MS, RETRY_MAX } from "@/lib/constants";

export type RetryOptions = {
  /** Retry attempts after the initial call (e.g. 3 = four total tries). */
  retries: number;
  /** Base delay in ms; doubled before each retry (500 → 1s → 2s). */
  baseMs: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number) => void;
};

const TRANSIENT_HTTP = new Set([429, 500, 502, 503, 504]);

const TRANSIENT_CODES = new Set([
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
  "INTERNAL",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

export function getErrorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  if (typeof e.status === "number") return e.status;
  if (typeof e.statusCode === "number") return e.statusCode;
  if (e.cause) return getErrorStatus(e.cause);
  return undefined;
}

function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  if (typeof e.code === "string") return e.code;
  if (typeof e.status === "string") return e.status;
  if (e.cause) return getErrorCode(e.cause);
  return undefined;
}

/**
 * Returns true for rate limits, server errors, and network failures.
 * Skips 4xx client errors that retrying cannot fix.
 */
export function isTransientError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status !== undefined) {
    if (TRANSIENT_HTTP.has(status)) return true;
    if (status >= 400 && status < 500) return false;
  }

  const code = getErrorCode(err);
  if (code && TRANSIENT_CODES.has(code)) return true;

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout")
    ) {
      return true;
    }
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` with exponential backoff on transient failures.
 * Re-throws the last error when retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  const { retries, baseMs, shouldRetry = isTransientError, onRetry } = opts;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err, attempt + 1)) {
        throw err;
      }
      onRetry?.(err, attempt + 1);
      await sleep(baseMs * Math.pow(2, attempt));
    }
  }

  throw new Error("withRetry: unreachable");
}

/** Shared retry config for server-side Gemini, Storage, and fetch calls. */
export const DEFAULT_RETRY_OPTS: RetryOptions = {
  retries: RETRY_MAX,
  baseMs: RETRY_BASE_MS,
  shouldRetry: isTransientError,
  onRetry: (err, attempt) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[withRetry] attempt ${attempt} failed, retrying: ${msg}`);
  },
};
