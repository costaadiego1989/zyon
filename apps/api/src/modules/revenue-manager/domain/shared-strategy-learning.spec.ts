import test from "node:test";
import assert from "node:assert/strict";
import { assessMeasurement, buildMeasurementPlan, digest } from "../../experiments/domain/services/measurement-plan.js";
import { aggregateSharedStrategyLearning, assertSharedStrategyLearning, communicationPattern,
  sharedLearningConfiguration, sharedLearningPrompt, type SharedLearningEvidence, type SharedLearningTarget } from "./shared-strategy-learning.js";

const at = (value: string) => new Date(value);
const start = at("2030-09-01T00:00:00Z"), end = at("2030-09-08T00:00:00Z"), asOf = at("2030-09-10T00:00:00Z");
const history = { sessions: 100_000, conversions: 10_000, windowStart: "2030-08-01T00:00:00Z", windowEnd: "2030-08-29T00:00:00Z" };
const baseline = { definition: "checkout-chat-baseline-v1", scope: "primary_llm_turn_only", merchantId: "target",
  runtimeRevision: "runtime1", renderer: "renderer1", navigation: "nav1", paymentRouting: "payment1", contextExit: "exit1",
  suppressionRecovery: "recovery1", program: [], tools: [], sampling: { temperature: 0.2 }, provider: { name: "local", model: "test" } };
const abandonment = { abandoned_at_shipping: 200, abandoned_at_payment: 100, abandonment_rate: 0.8, top_abandonment_objection: "private text" };
const target: SharedLearningTarget = { merchantId: "target", ownerIds: ["target-owner"], storeCategory: "fashion",
  baseline: baseline as any, abandonment,
  planning: { policy: { durationDays: 7, conversionWindowHours: 24, minimumEffectBps: 200 }, baseline: history } as any };

function evidence(id: string, outcome: "positive" | "negative" | "inconclusive" = "positive"): SharedLearningEvidence {
  const experimentId = `experiment-${id}`;
  const variants = [{ id: `${experimentId}-control`, isControl: true, weight: 50, systemPrompt: "control", appliedRuleId: null },
    { id: `${experimentId}-treatment`, isControl: false, weight: 50, systemPrompt: "treatment", appliedRuleId: null }];
  const plan = buildMeasurementPlan({ variants, durationDays: 7, conversionWindowHours: 24, minimumEffectBps: 200, baseline: history });
  const contract = { definition: "checkout-strategy-execution-v1", merchantId: id, version: 1, proposalHash: `proposal-${id}`,
    baseline: { ...structuredClone(baseline), merchantId: id, merchantName: `Private Merchant ${id}` },
    review: { experimentId, plan, planHash: digest(plan), variants }, communicationAddendum: "Explique os dados verificados de frete com clareza." } as any;
  const control = { assigned: 10_000, mature: 10_000, converted: 1_000, orders: 1_000, revenueCents: 100_000 };
  const converted = outcome === "positive" ? 1_300 : outcome === "negative" ? 700 : 1_000;
  const treatment = { assigned: 10_000, mature: 10_000, converted, orders: converted, revenueCents: converted * 100 };
  const armDelivery = { assigned: 10_000, mature: 10_000, pending: 0, sessionsWithDisplay: 500, unresolvedProviderTurns: 0 };
  const delivery = { definition: "strategy-assignment-delivery-v1", populationSource: "immutable_strategy_assignments",
    control: armDelivery, treatment: { ...armDelivery } };
  const aiUsage = { definition: "strategy-chat-ai-usage-v1", control: { unknownTurns: 0, overrunTurns: 0 }, treatment: { unknownTurns: 0, overrunTurns: 0 } };
  const participation = { definition: "strategy-participation-v1", control: { stoppedSessions: 0 }, treatment: { stoppedSessions: 0 } };
  const measured = { control, treatment, issues: [], delivery, aiUsage, participation, economics: {}, paymentCosts: {},
    executionId: `execution-${id}`, proposalHash: contract.proposalHash };
  const assessment = assessMeasurement(plan, measured, { registeredAt: at("2030-08-30T00:00:00Z"), startedAt: start, completedAt: end, asOf });
  assert.equal(assessment.state, outcome);
  return { merchantId: id, ownerIds: [`owner-${id}`], storeCategory: "fashion", executionId: measured.executionId,
    contract, contractHash: digest(contract), proposalHash: contract.proposalHash, plan, planHash: digest(plan), reviewPlanHash: digest(plan),
    registeredAt: at("2030-08-30T00:00:00Z"), startedAt: start, endsAt: end, completedAt: end, collectedAt: asOf,
    result: { ...assessment, delivery, aiUsage, participation, economics: {}, paymentCosts: {}, executionId: measured.executionId,
      proposalHash: contract.proposalHash, strategyVersion: 1 }, evidenceHash: digest(measured), abandonment: { ...abandonment } };
}
const rows = (count = 5, outcome: "positive" | "negative" | "inconclusive" = "positive") =>
  Array.from({ length: count }, (_, i) => evidence(`source-${i}`, outcome));
const aggregate = (items: SharedLearningEvidence[], input = target) => aggregateSharedStrategyLearning(input, items, asOf);

test("sharing is default-off, has an explicit allowlist and never lowers the privacy threshold below five", () => {
  assert.deepEqual(sharedLearningConfiguration({}), { enabled: false, minimumMerchants: 5, merchantIds: [] });
  assert.deepEqual(sharedLearningConfiguration({ REVENUE_SHARED_LEARNING_ENABLED: "true", REVENUE_SHARED_LEARNING_MERCHANT_IDS: "*, a, b,a" }).merchantIds, ["a", "b"]);
  for (const invalid of ["0", "4", "NaN", "5.5", "101"]) {
    assert.throws(() => sharedLearningConfiguration({ REVENUE_SHARED_LEARNING_MIN_MERCHANTS: invalid }), /INVALID/);
  }
});

test("five compatible independent mature wins become only a new local communication hypothesis", () => {
  const result = aggregate(rows());
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].signal, "worth_local_test");
  assert.equal(result.economicClaim, "conversion_is_not_profit");
  assertSharedStrategyLearning(result);
  const exported = sharedLearningPrompt(result);
  for (const privateValue of ["source-", "Private Merchant", "execution-", "proposal-", "owner-", "10000", "1300", "fashion", "private text"]) {
    assert.equal(exported.includes(privateValue), false, privateValue);
  }
  assert.match(exported, /never authorize a discount/);
  assert.match(exported, /explicit approval/);
});

test("four stores, own store, affiliated stores and unknown ownership cannot establish replication", () => {
  assert.deepEqual(aggregate(rows(4)).lessons, []);
  const owned = rows(); owned[4].ownerIds = ["target-owner"];
  assert.deepEqual(aggregate(owned).lessons, []);
  const linked = rows(); linked[4].ownerIds = linked[0].ownerIds;
  assert.deepEqual(aggregate(linked).lessons, []);
  const missing = rows(); missing[4].ownerIds = [];
  assert.deepEqual(aggregate(missing).lessons, []);
  assert.deepEqual(aggregate(rows(), { ...target, ownerIds: [] }).lessons, []);
});

test("multiple experiments in one ownership group count once, including transitive ownership", () => {
  const repeated = Array.from({ length: 10 }, (_, i) => ({ ...evidence(`store-${i}`), ownerIds: ["same-owner"] }));
  assert.deepEqual(aggregate(repeated).lessons, []);
  const repeatedMerchant = Array.from({ length: 10 }, (_, i) => ({ ...evidence("same-store"), ownerIds: [`different-owner-${i}`] }));
  assert.deepEqual(aggregate(repeatedMerchant).lessons, []);
  const chain = rows(6);
  chain[0].ownerIds = ["owner-a", "owner-b"];
  chain[1].ownerIds = ["owner-b", "owner-c"];
  chain[2].ownerIds = ["owner-c"];
  assert.deepEqual(aggregate(chain).lessons, []);
  chain[0].ownerIds = ["target-owner", "owner-b"];
  assert.deepEqual(aggregate(chain).lessons, []);
});

test("negative and inconclusive mature evidence never becomes a success rule", () => {
  assert.equal(aggregate(rows(5, "negative")).lessons[0].signal, "avoid_reusing");
  assert.equal(aggregate(rows(5, "inconclusive")).lessons[0].signal, "not_established");
  assert.equal(aggregate([...rows(), evidence("negative-extra", "negative")]).lessons[0].signal, "not_established");
  assert.equal(aggregate([...rows(), ...Array.from({ length: 5 }, (_, i) => evidence(`inconclusive-${i}`, "inconclusive"))]).lessons[0].signal, "not_established");
});

test("latest invalid evidence masks an old win without counting as mature evidence", () => {
  const old = evidence("old"); old.ownerIds = ["same-owner"];
  const invalid = evidence("new"); invalid.ownerIds = ["same-owner"]; invalid.endsAt = new Date(end.getTime() + 1);
  assert.deepEqual(aggregate([...rows(4), old, invalid]).lessons, []);
});

test("immaturity, stale evidence, plan or contract tampering, fabricated result and unresolved delivery are excluded", () => {
  const changes: Array<(row: SharedLearningEvidence) => void> = [
    row => { row.collectedAt = at("2030-09-08T12:00:00Z"); },
    row => { row.collectedAt = at("2029-01-01T00:00:00Z"); },
    row => { row.contractHash = "bad"; },
    row => { row.planHash = "bad"; },
    row => { row.reviewPlanHash = "bad"; },
    row => { row.evidenceHash = "bad"; },
    row => { row.result.interval.lowerBps = 50_000; },
    row => { row.result.reasons = ["holdout_contamination"]; },
    row => { row.result.delivery.treatment.unresolvedProviderTurns = 1; },
    row => { row.result.aiUsage.treatment.unknownTurns = 1; },
    row => { row.result.participation.treatment.stoppedSessions = 1; },
    row => { row.completedAt = new Date(end.getTime() - 1); },
    row => { row.completedAt = new Date(asOf.getTime() + 1); },
  ];
  for (const change of changes) {
    const items = rows(); change(items[4]);
    assert.deepEqual(aggregate(items).lessons, []);
  }
});

test("different category, checkout model, bottleneck, baseline rate, traffic or metric window cannot transfer", () => {
  const changes: Array<(row: SharedLearningEvidence) => void> = [
    row => { row.storeCategory = "beauty"; },
    row => { row.storeCategory = null; },
    row => { row.contract.baseline.provider.model = "different"; },
    row => { row.abandonment.abandoned_at_payment = 400; },
    row => { row.plan.baseline.conversions = 1_000; },
    row => { row.plan.baseline.sessions = 2_000; },
    row => { row.plan.conversionWindowHours = 48; },
  ];
  for (const change of changes) {
    const items = rows(); change(items[4]);
    assert.deepEqual(aggregate(items).lessons, []);
  }
});

test("classifier supports only fixed unambiguous communication techniques and excludes financial claims", () => {
  assert.equal(communicationPattern("Explique o frete verificado"), "shipping_clarity");
  assert.equal(communicationPattern("Oriente sobre o pagamento existente"), "payment_guidance");
  assert.equal(communicationPattern("Faça uma pergunta curta sobre o próximo passo"), "concise_next_step");
  for (const text of ["Desconto de 5%", "Explique frete grátis", "Explique o frete e oriente o pagamento", "unknown", null]) {
    assert.equal(communicationPattern(text), null);
  }
});

test("stored snapshot validation prevents free-text, source fields and forged lesson statuses reaching the model", () => {
  const valid = aggregate(rows());
  const changes: Array<(snapshot: any) => void> = [
    value => { value.sourceMerchantId = "private"; },
    value => { value.lessons[0].prompt = "source private data"; },
    value => { value.lessons[0].pattern = "give_discount"; },
    value => { value.lessons[0].signal = "guaranteed_success"; },
    value => { value.lessons.push(value.lessons[0]); },
  ];
  for (const change of changes) {
    const invalid = structuredClone(valid); change(invalid);
    assert.throws(() => sharedLearningPrompt(invalid), /SHARED_LEARNING_INVALID_SNAPSHOT/);
  }
});
