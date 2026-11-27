import { createHash } from "node:crypto";
import type { MetaAdsOffer } from "@zyon/shared-types";
import { MetaAdsError, type MetaAdsStoreState, type StoredSubscription } from "./types.js";

export type MetaAdsEnvironment = Readonly<Record<string, string | undefined>>;

function positiveInteger(raw: string | undefined, fallback: number, code: string): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) throw new MetaAdsError(code, 503);
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) throw new MetaAdsError(code, 503);
  return value;
}

/** The price source is server configuration; public callers cannot supply a quote. */
export function readOffer(env: MetaAdsEnvironment): MetaAdsOffer {
  const commercial = {
    monthlyPriceCents: positiveInteger(env.META_ADS_AGENT_MONTHLY_PRICE_CENTS, 14900, "addon_price_invalid"),
    currency: "BRL" as const,
    cadence: "monthly" as const,
    monthlyImageCredits: positiveInteger(env.META_ADS_AGENT_MONTHLY_IMAGE_CREDITS, 30, "addon_allowance_invalid"),
    extraImageCredits: positiveInteger(env.META_ADS_AGENT_EXTRA_IMAGE_CREDITS, 10, "addon_allowance_invalid"),
    extraImagePriceCents: positiveInteger(env.META_ADS_AGENT_EXTRA_IMAGE_PRICE_CENTS, 3900, "addon_price_invalid"),
    maxManagedCampaigns: positiveInteger(env.META_ADS_AGENT_MAX_MANAGED_CAMPAIGNS, 5, "addon_allowance_invalid"),
  };
  const unavailableReasons: string[] = [];
  if (env.META_ADS_AGENT_ENABLED !== "true") unavailableReasons.push("module_disabled");
  if (env.META_ADS_AGENT_COMMERCIAL_READY !== "true") unavailableReasons.push("commercial_readiness_required");
  const benchmarkCount = env.META_ADS_AGENT_COST_BENCHMARK_RESULTS?.trim() ?? "";
  const benchmarkDigest = env.META_ADS_AGENT_COST_BENCHMARK_SHA256?.trim() ?? "";
  if (!/^\d+$/.test(benchmarkCount) || !Number.isSafeInteger(Number(benchmarkCount)) || Number(benchmarkCount) < 40 ||
      !/^[a-f0-9]{64}$/i.test(benchmarkDigest)) unavailableReasons.push("cost_benchmark_required");
  return {
    ...commercial,
    version: `mga-v1-${stableDigest(commercial).slice(0, 24)}`,
    commercialReady: unavailableReasons.length === 0,
    unavailableReasons,
  };
}

export function stableDigest(value: unknown): string {
  const active = new WeakSet<object>();
  function canonical(item: unknown): unknown {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || active.has(item)) throw new MetaAdsError("invalid_json");
    active.add(item);
    let result: unknown;
    if (Array.isArray(item)) result = item.map(canonical);
    else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new MetaAdsError("invalid_json");
      result = Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical((item as Record<string, unknown>)[key])]));
    }
    active.delete(item);
    return result;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function requireIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new MetaAdsError("invalid_identifier");
  return value;
}

export function isEligible(plan: string): boolean { return plan === "growth" || plan === "scale"; }

export function requireEntitlement(plan: string, state: MetaAdsStoreState, now = new Date()): StoredSubscription {
  const subscription = state.subscription;
  const end = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).getTime() : NaN;
  if (!isEligible(plan) || !subscription || !["active", "cancel_at_period_end"].includes(subscription.status) ||
      !Number.isFinite(end) || end <= now.getTime()) throw new MetaAdsError("addon_not_entitled", 403);
  return subscription;
}
