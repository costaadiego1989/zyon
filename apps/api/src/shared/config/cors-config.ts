import { isProduction } from "./secret-config.js";

const DEV_DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

export interface CorsConfig {
  origin: string[] | false;
  credentials: true;
}

/**
 * Build the CORS config from `CORS_ALLOWED_ORIGINS` (comma-separated allowlist).
 * Production with an empty/unset allowlist FAILS SAFE: `origin: false` rejects
 * all cross-origin requests rather than reflecting any origin. Dev defaults to a
 * localhost allowlist so the widget/dashboard work without configuration.
 */
export function resolveCorsConfig(env: NodeJS.ProcessEnv = process.env): CorsConfig {
  const configured = parseOrigins(env.CORS_ALLOWED_ORIGINS);

  if (configured.length > 0) {
    return { origin: configured, credentials: true };
  }

  if (isProduction(env.NODE_ENV)) {
    return { origin: false, credentials: true };
  }

  return { origin: DEV_DEFAULT_ORIGINS, credentials: true };
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
