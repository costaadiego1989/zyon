import { createHash } from "node:crypto";

export const MEASUREMENT_VERSION = "session-conversion-fixed-horizon-v1";
const DAY = 86_400_000;
const Z95 = 1.959963984540054;
const Z80 = 0.8416212335729143;

export type MeasurementVariant = {
  id: string; isControl: boolean; weight: number; systemPrompt: string; appliedRuleId: string | null;
};
export function fingerprintVariants(variants: MeasurementVariant[]): string {
  return digest(variants.map(v => ({ id: v.id, control: v.isControl, weight: v.weight,
    prompt: v.systemPrompt, rule: v.appliedRuleId })).sort((a, b) => a.id.localeCompare(b.id)));
}
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, canonical(item)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export interface MeasurementPlan {
  definitionVersion: typeof MEASUREMENT_VERSION;
  metric: "approved_order_conversion";
  unit: "checkout_session";
  currency: "BRL";
  controlVariantId: string;
  treatmentVariantId: string;
  variantFingerprint: string;
  durationDays: number;
  conversionWindowHours: number;
  minimumEffectBps: number;
  minimumSessionsPerArm: number;
  confidence: 0.95;
  planningPower: 0.8;
  inference: "newcombe-wilson-two-sided";
  allocation: "50/50";
  trafficEstimate: { sessionsPerArm: number; reachesPlannedSample: boolean; basis: "previous_28_days" };
  baseline: { sessions: number; conversions: number; windowStart: string; windowEnd: string };
}

/** Planning approximation for two independent proportions, equal allocation,
 * two-sided alpha=.05 / power=.80, pooled null and unpooled alternative variance.
 * The planning MDE is absolute (100 bps = one percentage point), not relative lift.
 * References and numerical reference fixtures are documented with this delivery. */
export function requiredSample(baselineRate: number, effect: number): number {
  if (!Number.isFinite(baselineRate) || !Number.isFinite(effect) || baselineRate <= 0
    || effect <= 0 || baselineRate + effect >= 1) throw new Error("EXPERIMENT_INVALID_PLANNING_RATE");
  const treatment = baselineRate + effect;
  const pooled = (baselineRate + treatment) / 2;
  const numerator = Z95 * Math.sqrt(2 * pooled * (1 - pooled))
    + Z80 * Math.sqrt(baselineRate * (1 - baselineRate) + treatment * (1 - treatment));
  const n = Math.max(100, Math.ceil((numerator / effect) ** 2));
  if (!Number.isSafeInteger(n) || n > 1_000_000) throw new Error("EXPERIMENT_SAMPLE_NOT_FEASIBLE");
  return n;
}

export function buildMeasurementPlan(input: {
  variants: MeasurementVariant[]; durationDays: number; conversionWindowHours: number;
  minimumEffectBps: number; baseline: MeasurementPlan["baseline"];
}): MeasurementPlan {
  const { variants, durationDays, conversionWindowHours, minimumEffectBps, baseline } = input;
  if (variants.length !== 2 || variants.filter(v => v.isControl).length !== 1
    || new Set(variants.map(v => v.id)).size !== 2
    || variants.some(v => !v.id || v.weight !== 50 || !v.systemPrompt.trim() || v.appliedRuleId)) {
    throw new Error("EXPERIMENT_MEASUREMENT_REQUIRES_TWO_COMMUNICATION_ARMS");
  }
  if (!Number.isInteger(durationDays) || durationDays < 7 || durationDays > 28
    || !Number.isInteger(conversionWindowHours) || conversionWindowHours < 1 || conversionWindowHours > 168
    || !Number.isInteger(minimumEffectBps) || minimumEffectBps < 10 || minimumEffectBps > 2000) {
    throw new Error("EXPERIMENT_INVALID_MEASUREMENT_CONFIG");
  }
  if (!Number.isSafeInteger(baseline.sessions) || baseline.sessions < 100
    || !Number.isSafeInteger(baseline.conversions) || baseline.conversions <= 0 || baseline.conversions >= baseline.sessions
    || !Number.isFinite(Date.parse(baseline.windowStart)) || !Number.isFinite(Date.parse(baseline.windowEnd))
    || Date.parse(baseline.windowEnd) - Date.parse(baseline.windowStart) !== 28 * DAY) {
    throw new Error("EXPERIMENT_INSUFFICIENT_PLANNING_BASELINE");
  }
  const minimumSessionsPerArm = requiredSample(baseline.conversions / baseline.sessions, minimumEffectBps / 10_000);
  const sessionsPerArm = Math.floor(baseline.sessions / 28 * durationDays / 2);
  return { definitionVersion: MEASUREMENT_VERSION, metric: "approved_order_conversion", unit: "checkout_session",
    currency: "BRL", controlVariantId: variants.find(v => v.isControl)!.id,
    treatmentVariantId: variants.find(v => !v.isControl)!.id, variantFingerprint: fingerprintVariants(variants),
    durationDays, conversionWindowHours, minimumEffectBps,
    minimumSessionsPerArm,
    confidence: 0.95, planningPower: 0.8, inference: "newcombe-wilson-two-sided", allocation: "50/50",
    trafficEstimate: { sessionsPerArm, reachesPlannedSample: sessionsPerArm >= minimumSessionsPerArm, basis: "previous_28_days" },
    baseline: { ...baseline } };
}

export interface ArmMeasurement {
  assigned: number; mature: number; converted: number; orders: number; revenueCents: number;
}
export interface MeasurementEvidence {
  control: ArmMeasurement; treatment: ArmMeasurement;
  issues: string[];
}

function wilson(successes: number, total: number): [number, number] {
  const p = successes / total;
  const denominator = 1 + Z95 ** 2 / total;
  const center = (p + Z95 ** 2 / (2 * total)) / denominator;
  const half = Z95 * Math.sqrt(p * (1 - p) / total + Z95 ** 2 / (4 * total ** 2)) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** Newcombe's unpaired difference of Wilson intervals; treatment minus control.
 * This is a fixed-horizon interval, never an always-valid sequential test. */
export function conversionDifference(control: ArmMeasurement, treatment: ArmMeasurement) {
  if ([control, treatment].some(arm => !Number.isSafeInteger(arm.mature) || arm.mature <= 0
    || !Number.isSafeInteger(arm.converted) || arm.converted < 0 || arm.converted > arm.mature)) {
    throw new Error("EXPERIMENT_INVALID_BINOMIAL_COUNTS");
  }
  const c = control.converted / control.mature;
  const t = treatment.converted / treatment.mature;
  const [cl, cu] = wilson(control.converted, control.mature);
  const [tl, tu] = wilson(treatment.converted, treatment.mature);
  return { effectBps: (t - c) * 10_000,
    lowerBps: (t - c - Math.hypot(t - tl, cu - c)) * 10_000,
    upperBps: (t - c + Math.hypot(tu - t, c - cl)) * 10_000 };
}

export function assessMeasurement(plan: MeasurementPlan, evidence: MeasurementEvidence, timing: {
  registeredAt: Date; startedAt: Date | null; completedAt: Date | null; asOf: Date;
}) {
  type State = "not_started" | "collecting" | "awaiting_maturity" | "invalid" | "inconclusive" | "positive" | "negative";
  if ([timing.asOf, timing.registeredAt, timing.startedAt, timing.completedAt]
    .some(date => date !== null && !Number.isFinite(date.getTime()))) throw new Error("EXPERIMENT_INVALID_REVIEW_TIME");
  const issues = [...evidence.issues];
  const start = timing.startedAt?.getTime() ?? null;
  const end = start === null ? null : start + plan.durationDays * DAY;
  const matureAt = end === null ? null : end + plan.conversionWindowHours * 3_600_000;
  let state: State = "not_started";
  let interval: ReturnType<typeof conversionDifference> | null = null;
  if (plan.definitionVersion !== MEASUREMENT_VERSION || plan.inference !== "newcombe-wilson-two-sided"
    || plan.allocation !== "50/50") issues.push("unsupported_definition");
  for (const arm of [evidence.control, evidence.treatment]) {
    if (Object.values(arm).some(n => !Number.isSafeInteger(n) || n < 0)
      || arm.converted > arm.mature || arm.mature > arm.assigned || arm.orders < arm.converted) issues.push("invalid_counts");
  }
  if (timing.registeredAt > timing.asOf || (start !== null && (timing.registeredAt.getTime() > start || start > timing.asOf.getTime()))) {
    issues.push("invalid_registration_time");
  }
  if (start === null && evidence.control.assigned + evidence.treatment.assigned > 0) issues.push("assignments_before_activation");
  if (end !== null && timing.completedAt && timing.completedAt.getTime() < end) issues.push("stopped_before_fixed_horizon");
  if (issues.length) state = "invalid";
  else if (start !== null && end !== null && matureAt !== null) {
    if (timing.asOf.getTime() < end) state = "collecting";
    else if (timing.asOf.getTime() < matureAt
      || evidence.control.mature !== evidence.control.assigned || evidence.treatment.mature !== evidence.treatment.assigned) state = "awaiting_maturity";
    else {
      const c = evidence.control.assigned, t = evidence.treatment.assigned;
      // Equal-allocation chi-square diagnostic, df=1, alpha=.001. Treat imbalance
      // as a data-quality investigation, never evidence for a winning variant.
      if (c + t >= 100 && (c - t) ** 2 / (c + t) > 10.827566170662733) {
        issues.push("sample_ratio_mismatch"); state = "invalid";
      } else if (Math.min(c, t) < plan.minimumSessionsPerArm) {
        issues.push("planned_sample_not_reached"); state = "inconclusive";
      } else {
        interval = conversionDifference(evidence.control, evidence.treatment);
        if (interval.upperBps < 0) state = "negative";
        else if (interval.lowerBps > 0 && interval.effectBps >= plan.minimumEffectBps) state = "positive";
        else { state = "inconclusive"; issues.push("effect_not_established"); }
      }
    }
  }
  return { definitionVersion: MEASUREMENT_VERSION, state, reasons: [...new Set(issues)].sort(),
    asOf: timing.asOf.toISOString(), enrollmentEndsAt: end === null ? null : new Date(end).toISOString(),
    matureAt: matureAt === null ? null : new Date(matureAt).toISOString(),
    primaryMetric: plan.metric, unit: plan.unit, currency: plan.currency, inference: plan.inference, confidence: plan.confidence, interval,
    control: evidence.control, treatment: evidence.treatment,
    minimumSessionsPerArm: plan.minimumSessionsPerArm,
    contributionCents: null, aiCostCents: null, promotionAllowed: false as const,
    orderStateBasis: "recorded_state_at_collection" as const };
}
