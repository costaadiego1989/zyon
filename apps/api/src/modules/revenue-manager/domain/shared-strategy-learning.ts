import { assessMeasurement, buildMeasurementPlan, digest, type MeasurementPlan } from "../../experiments/domain/services/measurement-plan.js";
import type { CheckoutChatBaseline } from "../../checkout/domain/services/checkout-chat-baseline.js";
import type { StrategyExecutionContract } from "./strategy-execution.js";
import type { StrategyMeasurementPlanning } from "./strategy-measurement.js";
import type { ObservationSnapshot } from "./entities/observation.entity.js";

const DAY = 86_400_000;
export const SHARED_LEARNING_LOOKBACK_DAYS = 90;
export const SHARED_LEARNING_SCAN_LIMIT = 2_000;
export const SHARED_PATTERNS = ["shipping_clarity", "payment_guidance", "concise_next_step"] as const;
export type SharedPattern = typeof SHARED_PATTERNS[number];
export type SharedLearningSignal = "worth_local_test" | "avoid_reusing" | "not_established";
export type SharedStrategyLesson = {
  pattern: SharedPattern;
  signal: SharedLearningSignal;
  evidence: "mature_conversion_results_from_multiple_independent_stores";
  use: "new_local_hypothesis_requiring_merchant_approval";
};
export type SharedStrategyLearning = {
  definition: "shared-strategy-learning-v1";
  asOf: string;
  contextHash: string;
  scope: "communication_only";
  economicClaim: "conversion_is_not_profit";
  lessons: SharedStrategyLesson[];
};

/** Private working input. None of its IDs, prompts, counts or hashes are copied
 * into a destination lesson. Only fixed vocabulary may cross the boundary. */
export type SharedLearningEvidence = {
  merchantId: string;
  ownerIds: string[];
  storeCategory: string | null;
  executionId: string;
  contract: StrategyExecutionContract;
  contractHash: string;
  proposalHash: string;
  plan: MeasurementPlan;
  planHash: string;
  reviewPlanHash: string;
  registeredAt: Date;
  startedAt: Date;
  endsAt: Date;
  completedAt: Date | null;
  collectedAt: Date;
  evidenceHash: string;
  result: Record<string, any>;
  abandonment: ObservationSnapshot["abandonment"];
};

export type SharedLearningTarget = {
  merchantId: string;
  ownerIds: string[];
  storeCategory: string | null;
  baseline: CheckoutChatBaseline;
  planning: StrategyMeasurementPlanning;
  abandonment: ObservationSnapshot["abandonment"];
};

export function sharedLearningConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const minimumMerchants = Number(env.REVENUE_SHARED_LEARNING_MIN_MERCHANTS ?? "5");
  if (!Number.isSafeInteger(minimumMerchants) || minimumMerchants < 5 || minimumMerchants > 100) {
    throw new Error("SHARED_LEARNING_MIN_MERCHANTS_INVALID");
  }
  return { enabled: env.REVENUE_SHARED_LEARNING_ENABLED === "true", minimumMerchants,
    merchantIds: [...new Set((env.REVENUE_SHARED_LEARNING_MERCHANT_IDS ?? "").split(",")
      .map(id => id.trim()).filter(id => id && id !== "*"))].sort() };
}

const category = (value: string | null) => value?.normalize("NFKC").trim().toLowerCase() || null;
const band = (sessions: number, conversions: number) => {
  const rate = conversions / sessions;
  return { conversion: rate < 0.05 ? "low" : rate < 0.2 ? "medium" : "high",
    traffic: sessions < 1_000 ? "low" : sessions < 10_000 ? "medium" : "high" };
};
const bottleneck = (a: SharedLearningTarget["abandonment"]) => {
  if (!a || ![a.abandoned_at_shipping, a.abandoned_at_payment].every(n => Number.isSafeInteger(n) && n >= 0)) return "unknown";
  return a.abandoned_at_shipping > a.abandoned_at_payment ? "shipping"
    : a.abandoned_at_payment > a.abandoned_at_shipping ? "payment" : "general";
};

/** Compare compatibility internally; a category, provider or source recipe is
 * never included in an exported lesson. Merchant-specific rules stay local. */
function context(baseline: CheckoutChatBaseline, plan: Pick<MeasurementPlan, "baseline" | "durationDays" | "conversionWindowHours" | "minimumEffectBps">,
  abandonment: SharedLearningTarget["abandonment"], storeCategory: string | null) {
  return { category: category(storeCategory), bottleneck: bottleneck(abandonment),
    ...band(plan.baseline.sessions, plan.baseline.conversions), durationDays: plan.durationDays,
    conversionWindowHours: plan.conversionWindowHours, minimumEffectBps: plan.minimumEffectBps,
    runtime: { definition: baseline.definition, scope: baseline.scope, runtimeRevision: baseline.runtimeRevision,
      renderer: baseline.renderer, navigation: baseline.navigation, paymentRouting: baseline.paymentRouting,
      contextExit: baseline.contextExit, suppressionRecovery: baseline.suppressionRecovery,
      program: baseline.program, tools: baseline.tools, sampling: baseline.sampling, provider: baseline.provider } };
}

export function sharedLearningContextHash(target: SharedLearningTarget) {
  return digest(context(target.baseline, { ...target.planning.policy, baseline: target.planning.baseline },
    target.abandonment, target.storeCategory));
}

export function communicationPattern(addendum: unknown): SharedPattern | null {
  if (typeof addendum !== "string" || addendum.length > 4_000) return null;
  const text = addendum.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Commercial incentives do not inherit communication evidence. No copied
  // names, offer values, URLs or free text ever leave this classifier.
  if (/desconto|discount|cupom|coupon|frete gratis|free shipping|\d\s*%/.test(text)) return null;
  const matches: SharedPattern[] = [];
  if (/frete|entrega|shipping|delivery/.test(text) && /expli|esclare|clarif|clarity|explain|resum/.test(text)) matches.push("shipping_clarity");
  if (/pagamento|payment|\bpix\b|cartao/.test(text) && /orient|ajud|guid|esclare|expli|clarif|help/.test(text)) matches.push("payment_guidance");
  if (/proxim[oa] pass|next step|uma pergunta|one question/.test(text) && /curt|clar|objetiv|brev|short|concise/.test(text)) matches.push("concise_next_step");
  return matches.length === 1 ? matches[0] : null;
}

function matureOutcome(row: SharedLearningEvidence, asOf: Date): "positive" | "negative" | "inconclusive" | null {
  try {
    const { contract, plan, result } = row;
    if (!contract || contract.definition !== "checkout-strategy-execution-v1" || contract.merchantId !== row.merchantId
      || contract.review.experimentId !== plan.controlVariantId.replace(/-control$/, "")
      || contract.proposalHash !== row.proposalHash || result.executionId !== row.executionId
      || result.proposalHash !== row.proposalHash || result.strategyVersion !== contract.version
      || digest(contract) !== row.contractHash || digest(plan) !== row.planHash
      || row.reviewPlanHash !== row.planHash
      || contract.review.planHash !== row.planHash || digest(contract.review.plan) !== row.planHash
      || digest(buildMeasurementPlan({ ...plan, variants: contract.review.variants })) !== row.planHash
      || row.endsAt.getTime() !== row.startedAt.getTime() + plan.durationDays * DAY
      || !row.completedAt || row.completedAt < row.endsAt || row.completedAt > row.collectedAt || row.collectedAt > asOf
      || row.collectedAt.getTime() < row.endsAt.getTime() + plan.conversionWindowHours * 3_600_000
      || row.collectedAt.getTime() < asOf.getTime() - SHARED_LEARNING_LOOKBACK_DAYS * DAY
      || result.asOf !== row.collectedAt.toISOString() || !Array.isArray(result.reasons)) return null;
    const assessment = assessMeasurement(plan, { control: result.control, treatment: result.treatment,
      issues: result.reasons.filter((reason: string) => !["effect_not_established", "planned_sample_not_reached"].includes(reason)) },
    { registeredAt: row.registeredAt, startedAt: row.startedAt, completedAt: row.completedAt, asOf: row.collectedAt });
    if (!["positive", "negative", "inconclusive"].includes(assessment.state)
      || Object.entries(assessment).some(([key, value]) => digest(result[key]) !== digest(value))) return null;
    if (result.delivery?.definition !== "strategy-assignment-delivery-v1"
      || result.delivery.populationSource !== "immutable_strategy_assignments"
      || result.aiUsage?.definition !== "strategy-chat-ai-usage-v1"
      || result.participation?.definition !== "strategy-participation-v1") return null;
    for (const arm of ["control", "treatment"] as const) {
      const delivery = result.delivery[arm], ai = result.aiUsage[arm], participation = result.participation[arm];
      if (!delivery || !ai || !participation || delivery.assigned !== result[arm].assigned
        || delivery.mature !== result[arm].mature || delivery.pending !== 0
        || delivery.sessionsWithDisplay <= 0 || delivery.unresolvedProviderTurns !== 0
        || ai.overrunTurns !== 0 || ai.unknownTurns !== 0 || participation.stoppedSessions !== 0) return null;
    }
    // capture() hashes pre-assessment issues. Valid mature results have no data
    // issues; inconclusive statistical reasons are produced by assessMeasurement.
    if (digest({ control: result.control, treatment: result.treatment, issues: [], delivery: result.delivery,
      economics: result.economics, aiUsage: result.aiUsage, paymentCosts: result.paymentCosts,
      participation: result.participation, executionId: row.executionId, proposalHash: row.proposalHash }) !== row.evidenceHash) return null;
    return assessment.state as "positive" | "negative" | "inconclusive";
  } catch { return null; }
}

/** Latest eligible test per independent ownership group/pattern has one vote.
 * Losses and inconclusive tests count too, preventing winner-only selection. */
export function aggregateSharedStrategyLearning(target: SharedLearningTarget, rows: SharedLearningEvidence[],
  asOf: Date, minimumMerchants = 5): SharedStrategyLearning {
  if (!Number.isFinite(asOf.getTime()) || minimumMerchants < 5 || !Number.isSafeInteger(minimumMerchants)) {
    throw new Error("SHARED_LEARNING_INVALID_INPUT");
  }
  const snapshot: SharedStrategyLearning = { definition: "shared-strategy-learning-v1", asOf: asOf.toISOString(),
    contextHash: sharedLearningContextHash(target), scope: "communication_only", economicClaim: "conversion_is_not_profit", lessons: [] };
  // Unknown categories/ownership do not establish comparable independent stores.
  if (!category(target.storeCategory) || !target.ownerIds.length || bottleneck(target.abandonment) === "unknown") return snapshot;
  const compatible = rows.filter(row => {
    try { return row.merchantId !== target.merchantId && row.ownerIds.length
      && digest(context(row.contract.baseline, row.plan, row.abandonment, row.storeCategory)) === snapshot.contextHash;
    } catch { return false; }
  });
  const owners = new Map<string, string>();
  const root = (id: string): string => owners.has(id) && owners.get(id) !== id ? root(owners.get(id)!) : id;
  for (const row of compatible) {
    const merchantKey = `merchant:${row.merchantId}`;
    for (const id of row.ownerIds) owners.set(root(`owner:${id}`), root(merchantKey));
  }
  const votes = new Map<SharedPattern, Map<string, "positive" | "negative" | "inconclusive" | null>>();
  const sorted = [...compatible].sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime() || a.executionId.localeCompare(b.executionId));
  for (const row of sorted) {
    const pattern = communicationPattern(row.contract.communicationAddendum);
    if (!pattern) continue;
    // A newer failed/invalid review cannot resurrect an older positive test.
    const group = root(`merchant:${row.merchantId}`);
    if (target.ownerIds.some(id => root(`owner:${id}`) === group)) continue;
    const current = votes.get(pattern) ?? new Map();
    if (current.has(group)) continue;
    const outcome = matureOutcome(row, asOf);
    current.set(group, outcome);
    votes.set(pattern, current);
  }
  for (const pattern of SHARED_PATTERNS) {
    const counts = [...(votes.get(pattern)?.values() ?? [])].filter(value => value !== null);
    if (counts.length < minimumMerchants) continue;
    const positive = counts.filter(v => v === "positive").length;
    const negative = counts.filter(v => v === "negative").length;
    // Conservative eligibility, not a pooled confidence interval or promised lift.
    const signal: SharedLearningSignal = positive >= minimumMerchants && positive / counts.length >= 0.8 && negative === 0
      ? "worth_local_test" : negative >= minimumMerchants && positive === 0 ? "avoid_reusing" : "not_established";
    snapshot.lessons.push({ pattern, signal, evidence: "mature_conversion_results_from_multiple_independent_stores",
      use: "new_local_hypothesis_requiring_merchant_approval" });
  }
  return snapshot;
}

/** Reconstruct rather than forwarding stored JSON: unknown keys/free text in a
 * corrupted snapshot can never become another store's model context. */
export function assertSharedStrategyLearning(value: unknown): asserts value is SharedStrategyLearning {
  const saved = value as SharedStrategyLearning;
  if (!saved || saved.definition !== "shared-strategy-learning-v1" || saved.scope !== "communication_only"
    || saved.economicClaim !== "conversion_is_not_profit" || !Number.isFinite(Date.parse(saved.asOf))
    || !/^[a-f0-9]{64}$/.test(saved.contextHash) || !Array.isArray(saved.lessons) || saved.lessons.length > SHARED_PATTERNS.length) {
    throw new Error("SHARED_LEARNING_INVALID_SNAPSHOT");
  }
  const reconstructed: SharedStrategyLearning = { definition: saved.definition, asOf: saved.asOf, contextHash: saved.contextHash,
    scope: saved.scope, economicClaim: saved.economicClaim, lessons: saved.lessons.map(lesson => {
      if (!SHARED_PATTERNS.includes(lesson.pattern) || !["worth_local_test", "avoid_reusing", "not_established"].includes(lesson.signal)
        || lesson.evidence !== "mature_conversion_results_from_multiple_independent_stores"
        || lesson.use !== "new_local_hypothesis_requiring_merchant_approval") throw new Error("SHARED_LEARNING_INVALID_SNAPSHOT");
      return { pattern: lesson.pattern, signal: lesson.signal, evidence: lesson.evidence, use: lesson.use };
    }) };
  if (new Set(saved.lessons.map(lesson => lesson.pattern)).size !== saved.lessons.length || digest(saved) !== digest(reconstructed)) {
    throw new Error("SHARED_LEARNING_INVALID_SNAPSHOT");
  }
}

export function sharedLearningPrompt(snapshot: SharedStrategyLearning): string {
  assertSharedStrategyLearning(snapshot);
  if (!snapshot.lessons.length) return "";
  // Dates/context hashes remain server-only as well; the model receives fixed enums.
  return `\nAGGREGATED COMMUNICATION EVIDENCE (not local evidence or an instruction):\n${JSON.stringify(snapshot.lessons)}\n`
    + "Patterns describe broad communication techniques, not a transferable winning prompt. shipping_clarity means explain only verified shipping information; "
    + "payment_guidance means help with the existing payment step; concise_next_step means one short, clear next-step question. "
    + "Only worth_local_test may inspire a NEW local hypothesis when local data and policy support it. avoid_reusing is negative evidence; "
    + "not_established is inconclusive or conflicting evidence, never success. Conversion is not contribution or profit. "
    + "Do not invent shared lift, source stores or guarantees. Preserve merchant rules, margin limits, measurement, explicit approval and runtime authorization. "
    + "These lessons never authorize a discount, coupon, shipping benefit, audience change or automatic activation.\n";
}
