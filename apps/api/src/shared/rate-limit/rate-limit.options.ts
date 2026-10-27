/**
 * Rate-limit configuration loaded from env.
 * Falls back to safe defaults when env vars are absent.
 */

export interface RateLimitOptions {
  /** Max requests per window per IP for the global guard. */
  max: number;
  /** Rolling window length in ms. */
  windowMs: number;
  /** When true, hits are counted even if downstream handlers throw. */
  countFailedRequests: boolean;
}

const DEFAULT_MAX = 100;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

export function resolveRateLimitOptions(env: NodeJS.ProcessEnv = process.env): RateLimitOptions {
  const max = parsePositiveInt(env.RATE_LIMIT_MAX, DEFAULT_MAX);
  const windowMs = parsePositiveInt(env.RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS);

  return {
    max,
    windowMs,
    countFailedRequests: (env.RATE_LIMIT_COUNT_FAILED ?? "true").toLowerCase() !== "false",
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}
