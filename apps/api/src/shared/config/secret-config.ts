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

export const CORE_PRODUCTION_REQUIRED_SECRETS = [
  "DATABASE_URL",
  "JWT_SECRET",
  "BUYER_JWT_SECRET",
  "EMBED_TOKEN_SECRET",
  "AACP_PAYMENT_ENC_KEY",
  "AACP_PII_ENC_KEY",
] as const;

export const PRODUCTION_REQUIRED_SECRETS = CORE_PRODUCTION_REQUIRED_SECRETS;

function hasEnabledFlag(name: string, env: NodeJS.ProcessEnv): boolean {
  return env[name]?.trim().toLowerCase() === "true";
}

function hasAnySecret(names: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return names.some((name) => Boolean(env[name]?.trim()));
}

export function resolveProductionRequiredSecrets(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [...CORE_PRODUCTION_REQUIRED_SECRETS, ...featureGatedSecrets(env)];
}

function featureGatedSecrets(env: NodeJS.ProcessEnv): string[] {
  return [
    ...stripeSecrets(env),
    ...asaasSecrets(env),
    ...redisSecrets(env),
    ...opsSecrets(env),
  ];
}

function stripeSecrets(env: NodeJS.ProcessEnv): string[] {
  const enabled = hasEnabledFlag("STRIPE_ENABLED", env);
  const configured = hasAnySecret(["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY"], env);
  return enabled || configured ? ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] : [];
}

function asaasSecrets(env: NodeJS.ProcessEnv): string[] {
  const enabled = hasEnabledFlag("ASAAS_ENABLED", env);
  const configured = hasAnySecret(["ASAAS_API_KEY", "ASAAS_API_KEY_SANDBOX"], env);
  return enabled || configured ? ["ASAAS_WEBHOOK_TOKEN"] : [];
}

function redisSecrets(env: NodeJS.ProcessEnv): string[] {
  return hasEnabledFlag("REDIS_ENABLED", env) ? ["REDIS_URL"] : [];
}

function opsSecrets(env: NodeJS.ProcessEnv): string[] {
  return hasEnabledFlag("METRICS_ENABLED", env) ? ["OPS_SHARED_SECRET"] : [];
}
