import { isProduction } from "./secret-config.js";

const DEV_DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
  "http://127.0.0.1:8080",
];

export interface CorsConfig {
  origin: string[] | false;
  credentials: true;
  allowedHeaders: string[];
  exposedHeaders: string[];
}

/**
 * Build the CORS config from `CORS_ALLOWED_ORIGINS` (comma-separated allowlist).
 * Production with an empty/unset allowlist FAILS SAFE: `origin: false` rejects
 * all cross-origin requests rather than reflecting any origin. Dev defaults to a
 * localhost allowlist so the widget/dashboard work without configuration.
 */
export function resolveCorsConfig(env: NodeJS.ProcessEnv = process.env): CorsConfig {
  const configured = parseOrigins(env.CORS_ALLOWED_ORIGINS);

  const allowedHeaders = [
    "Content-Type",
    "Authorization",
    "Idempotency-Key",
    "If-Match",
    "If-None-Match",
    "x-aacp-api-key",
    "x-correlation-id",
    "x-aacp-embed-token",
    "x-aacp-event-id",
    "x-aacp-event-type",
    "x-aacp-timestamp",
    "x-aacp-signature"
  ];

  if (configured.length > 0) {
    return { origin: configured, credentials: true, allowedHeaders, exposedHeaders: ["ETag", "Idempotency-Replayed"] };
  }

  if (isProduction(env.NODE_ENV)) {
    return { origin: false, credentials: true, allowedHeaders, exposedHeaders: ["ETag", "Idempotency-Replayed"] };
  }

  return { origin: DEV_DEFAULT_ORIGINS, credentials: true, allowedHeaders, exposedHeaders: ["ETag", "Idempotency-Replayed"] };
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
