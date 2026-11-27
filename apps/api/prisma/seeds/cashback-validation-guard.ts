import { createHash } from "node:crypto";

export const CASHBACK_QA_NAMESPACE = "qa-cashback-v1";
export const CASHBACK_QA_MERCHANT_KEYS = ["specific", "general", "blocked-coupon", "blocked-rule", "margin", "paused", "disabled", "draft", "ended", "fulfillment", "isolation", "expiry", "refund", "pending", "loss"] as const;
export type CashbackQaMerchantKey = typeof CASHBACK_QA_MERCHANT_KEYS[number];
export type CashbackQaEnvironment = "local" | "homolog";
export const qaMerchantId = (key: CashbackQaMerchantKey) => `${CASHBACK_QA_NAMESPACE}-${key}`;
export const qaId = (key: string) => `${CASHBACK_QA_NAMESPACE}-${key}`;
export class CashbackSeedError extends Error { constructor(public readonly code: string) { super(code); } }
function check(value: unknown, code: string): asserts value { if (!value) throw new CashbackSeedError(code); }

export interface CashbackSeedTargetInput {
  databaseUrl: string;
  environment: CashbackQaEnvironment;
  confirmation: string;
  expectedHost?: string;
  expectedDatabase?: string;
  deploymentEnvironment?: string;
  runtimeEnvironment?: Record<string, string | undefined>;
}
export interface CashbackSeedTarget { databaseUrl: string; environment: CashbackQaEnvironment; host: string; database: string; schema: string; targetHash: string; }

/** NODE_ENV describes Node optimization, not whether the deployment is homolog. */
export function validateCashbackSeedTarget(input: CashbackSeedTargetInput): CashbackSeedTarget {
  check(input.environment === "local" || input.environment === "homolog", "cashback_seed_environment_forbidden");
  check(input.confirmation === CASHBACK_QA_NAMESPACE, "cashback_seed_confirmation_required");
  check(typeof input.databaseUrl === "string" && input.databaseUrl.length > 0, "cashback_seed_explicit_database_required");
  let url: URL; try { url = new URL(input.databaseUrl); } catch { throw new CashbackSeedError("cashback_seed_database_url_invalid"); }
  check(url.protocol === "postgres:" || url.protocol === "postgresql:", "cashback_seed_postgres_required");
  check(!url.hash, "cashback_seed_url_fragment_forbidden");
  const allowedParameters=new Set(["schema","sslmode","connect_timeout","pool_timeout","connection_limit","pgbouncer","socket_timeout"]);
  for(const key of url.searchParams.keys()){
    check(allowedParameters.has(key), "cashback_seed_url_parameter_forbidden");
    check(url.searchParams.getAll(key).length === 1, "cashback_seed_duplicate_url_parameter_forbidden");
  }
  const host = url.hostname.toLowerCase(), database = decodeURIComponent(url.pathname.slice(1)), schema = url.searchParams.get("schema") ?? "public";
  check(database.length > 0 && /^[a-zA-Z0-9_-]+$/.test(database) && /^[a-zA-Z0-9_]+$/.test(schema), "cashback_seed_database_name_invalid");
  check(!/(^|[-_.])(prod|production|live)([-_.]|$)/i.test(`${host}.${database}.${schema}`), "cashback_seed_production_target_forbidden");
  const runtime = input.runtimeEnvironment ?? process.env;
  for (const name of ["RAILWAY_ENVIRONMENT_NAME", "APP_ENV", "DEPLOYMENT_ENVIRONMENT", "CASHBACK_QA_DEPLOYMENT_ENVIRONMENT"]) {
    const value = runtime[name];
    check(!value || !/^(production|prod|live)$/i.test(value.trim()), "cashback_seed_production_runtime_forbidden");
  }
  if (input.environment === "local") {
    check(["localhost", "127.0.0.1", "[::1]"].includes(host), "cashback_seed_local_loopback_required");
    check(database === "cashback_seed_qa" || /^cashback_seed_qa_[a-zA-Z0-9_]+$/.test(database), "cashback_seed_dedicated_local_database_required");
  } else {
    check(input.expectedHost === host && input.expectedDatabase === database, "cashback_seed_homolog_target_mismatch");
    const deployment = runtime.RAILWAY_ENVIRONMENT_NAME ?? input.deploymentEnvironment;
    check(typeof deployment === "string" && /^(homolog|homologacao|homologação|staging|stage|sandbox|qa)$/i.test(deployment), "cashback_seed_homolog_deployment_proof_required");
  }
  return { databaseUrl: input.databaseUrl, environment: input.environment, host, database, schema,
    targetHash: createHash("sha256").update(`${host}:${url.port || "5432"}/${database}/${schema}`).digest("hex") };
}

export function assertQaMerchantId(value: string): void {
  check(CASHBACK_QA_MERCHANT_KEYS.some(key => qaMerchantId(key) === value), "cashback_seed_merchant_outside_namespace");
}
