export type NodeEnv = "production" | "development" | "test";

export function currentNodeEnv(env: NodeEnv | string | undefined = process.env.NODE_ENV): NodeEnv {
  if (env === "production") return "production";
  if (env === "test") return "test";
  return "development";
}

export function isProduction(env: string | undefined = process.env.NODE_ENV): boolean {
  return currentNodeEnv(env) === "production";
}

/**
 * Resolve a required secret. In production a missing/blank value throws at the
 * call site (fail safe). Outside production the deterministic dev fallback keeps
 * MVP flows usable without credentials, per CLAUDE.md.
 */
export function requireSecret(
  name: string,
  devFallback: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[name]?.trim();
  if (value) return value;
  if (isProduction(env.NODE_ENV)) {
    throw new Error(`missing_required_secret:${name}`);
  }
  return devFallback;
}

/**
 * Assert that every required secret is present in production. No-op outside
 * production so dev/test keep deterministic fallbacks. Throws aggregating all
 * missing keys so startup fails once with the full list.
 */
export function assertRequiredSecretsInProduction(
  requiredNames: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isProduction(env.NODE_ENV)) return;
  const missing = requiredNames.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`missing_required_secrets:${missing.join(",")}`);
  }
}

export const PRODUCTION_REQUIRED_SECRETS = [
  "DATABASE_URL",
  "JWT_SECRET",
  "BUYER_JWT_SECRET",
  "EMBED_TOKEN_SECRET",
] as const;
