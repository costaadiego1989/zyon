import { createHash } from "node:crypto";

export const WEEK_MS = 7 * 86_400_000;
export const LEASE_MS = 10 * 60_000;
export const MAX_RUN_ATTEMPTS = 3;
export const weeklyAnalysisEnabled = () => process.env.REVENUE_WEEKLY_ENABLED === "true";
export const weeklyGenerationEnabled = () => process.env.REVENUE_WEEKLY_GENERATION_ENABLED === "true";
export const weeklyMerchantAllowed = (merchantId: string) => {
  const configured = (process.env.REVENUE_WEEKLY_MERCHANT_IDS ?? "").split(",").map(id => id.trim());
  return configured.includes("*") || configured.includes(merchantId);
};

export function analysisGroup(merchantId: string): number {
  return createHash("sha256").update(merchantId).digest().readUInt32BE(0) % 7;
}

/** Scan UTC instants, so IANA offsets/DST are handled without assuming a fixed offset. */
export function nextNight(after: Date, timezone = "America/Sao_Paulo", group?: number): Date {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const start = Math.ceil(after.getTime() / 3_600_000) * 3_600_000;
  for (let i = 0; i < 9 * 24; i++) {
    const date = new Date(start + i * 3_600_000);
    const parts = Object.fromEntries(format.formatToParts(date).map(p => [p.type, p.value]));
    const day = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`).getUTCDay();
    if (parts.hour === "03" && (group === undefined || day === group)) return date;
  }
  throw new Error("ANALYSIS_TIMEZONE_WINDOW_UNAVAILABLE");
}

export function isNight(now: Date, timezone: string): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour >= 3 && hour < 6;
}

export class AnalysisDeferred extends Error {
  constructor(readonly code: string) { super(code); }
}

export function positiveInteger(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new AnalysisDeferred("budget_configuration_required");
  return value;
}
