export interface CartRecoveryMetrics {
  total_abandoned: number | null;
  total_attempts: number | null;
  total_recovered: number | null;
  recovery_rate_percent: number | null;
  revenue_recovered_brl: number | null;
}

function measuredNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function metric(
  raw: Record<string, unknown>, key: string, legacyKey?: string, factor = 1,
): number | null {
  // Explicit null is authoritative. Only missing keys use the legacy contract.
  if (key in raw) return measuredNumber(raw[key]);
  const legacy = legacyKey ? measuredNumber(raw[legacyKey]) : null;
  return legacy === null ? null : legacy * factor;
}

export function normalizeCartRecoveryMetrics(value: unknown): CartRecoveryMetrics {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return {
    total_abandoned: metric(raw, "total_abandoned"),
    total_attempts: metric(raw, "total_attempts", "recovery_attempts"),
    total_recovered: metric(raw, "total_recovered", "recovered"),
    recovery_rate_percent: metric(raw, "recovery_rate_percent", "recovery_rate", 100),
    revenue_recovered_brl: metric(raw, "revenue_recovered_brl", "revenue_recovered_cents", 0.01),
  };
}
