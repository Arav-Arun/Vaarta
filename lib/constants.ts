/**
 * Shared constants safe to import from both client and server.
 */

/** Max characters for the idea a learner types when building their own world. */
export const MAX_CREATE_IDEA_LENGTH = 1200;

/** Max retry attempts after the initial call (e.g. 3 → 500ms, 1s, 2s backoff). */
export const RETRY_MAX = 3;

/** Base delay in ms for exponential backoff (doubled each retry). */
export const RETRY_BASE_MS = 500;
