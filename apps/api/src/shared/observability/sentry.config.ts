import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface SentryConfig {
  enabled: boolean;
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
  tracesSampleRate: number;
  profilesSampleRate: number;
  /**
   * When true the integration is fully no-op. Always true when SENTRY_DSN is
   * blank, missing, or contains only whitespace.
   */
}

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;
const DEFAULT_PROFILES_SAMPLE_RATE = 0.0;

/**
 * Resolve Sentry configuration from environment variables.
 *
 * Sentry is disabled by default: a missing or blank SENTRY_DSN switches the
 * integration into a safe no-op so the API never crashes on telemetry
 * misconfiguration.
 */
export function resolveSentryConfig(
  env: NodeJS.ProcessEnv,
  pkgRoot: string = resolvePackageRoot(),
): SentryConfig {
  const dsn = readString(env.SENTRY_DSN);
  const environment = readString(env.NODE_ENV) ?? "development";
  const tracesSampleRate = readNumber(
    env.SENTRY_TRACES_SAMPLE_RATE,
    DEFAULT_TRACES_SAMPLE_RATE,
  );
  const profilesSampleRate = readNumber(
    env.SENTRY_PROFILES_SAMPLE_RATE,
    DEFAULT_PROFILES_SAMPLE_RATE,
  );

  return {
    enabled: Boolean(dsn),
    dsn,
    environment,
    release: readRelease(env.SENTRY_RELEASE, pkgRoot),
    tracesSampleRate,
    profilesSampleRate,
  };
}

function readString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(
  value: string | undefined,
  fallback: number,
): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  // Clamp to the documented Sentry range.
  return Math.min(1, Math.max(0, parsed));
}

function readRelease(
  explicit: string | undefined,
  pkgRoot: string,
): string | undefined {
  const explicitRelease = readString(explicit);
  if (explicitRelease) return explicitRelease;
  const pkgPath = path.join(pkgRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return undefined;
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function resolvePackageRoot(): string {
  // Walk upwards from this file until a package.json is found, defaulting to
  // the apps/api directory. Works both in source (src/) and built (dist/).
  // Compatible with both CJS (`__dirname`) and ESM (`import.meta.url`).
  const here = typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(here, "..", "..", "..");
}
