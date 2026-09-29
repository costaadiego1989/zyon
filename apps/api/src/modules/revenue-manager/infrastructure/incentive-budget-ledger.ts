import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { assertRecommendedIncentiveBudgetTerms, incentiveCents, incentiveKey, type IncentiveBudgetTerms } from "../domain/incentive-budget.js";
import type { StrategyProposal } from "../domain/strategy-proposal.js";
import { lockCheckoutBaselineRows } from "./checkout-baseline.reader.js";
import { merchantRulesSnapshot } from "./hypothesis-merchant-context.adapter.js";
import { assertStoredDiscountStudy } from "./strategy-discount-study.js";
import { readIncentivePolicy } from "./incentive-policy.reader.js";
import { approvedIncentiveReview } from "./incentive-review.reader.js";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
function fail(reason: string): never { throw new Error(`INCENTIVE_${reason}`); }
const actor = (value: string) => typeof value === "string" && value.trim().length > 0 && value.length <= 150;
const clock = async (tx: Tx) => (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now;
export const incentiveBudgetEnabled = (merchantId: string) => process.env.REVENUE_INCENTIVE_BUDGET_ENABLED === "true"
  && (process.env.REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS ?? "").split(",").map(s => s.trim()).includes(merchantId);

async function currentFundingSource(tx: Tx, terms: IncentiveBudgetTerms) {
  // Lock the mutable version/status row as well as the merchant. This fences
  // superseded proposals in READ COMMITTED and old REPEATABLE READ snapshots.
  await tx.$queryRaw`SELECT id FROM revenue_strategies WHERE id = ${terms.strategyId} AND merchant_id = ${terms.merchantId} FOR SHARE`;
  const version = await tx.revenueStrategyVersion.findUnique({ where: { strategyId_merchantId_version: {
    strategyId: terms.strategyId, merchantId: terms.merchantId, version: terms.version } }, include: { strategy: true } });
  if (!version || version.proposalHash !== terms.proposalHash || digest(version.proposal) !== version.proposalHash
    || version.strategy.currentVersion !== terms.version || version.strategy.status !== "pending_review") fail("PROPOSAL_CHANGED");
  if (!await tx.revenueAnalysisSchedule.findUnique({ where: { merchantId: terms.merchantId } })) fail("WEEKLY_OWNERSHIP_REQUIRED");
  const proposal = version.proposal as unknown as StrategyProposal;
  if (!proposal.discountStudy) fail("STUDY_REQUIRED");
  const rules = merchantRulesSnapshot(await tx.merchantRule.findUniqueOrThrow({ where: { merchantId: terms.merchantId } }));
  const policy = await readIncentivePolicy(tx, terms.merchantId);
  if (!policy.enabled || terms.policyVersion !== policy.version || terms.policyHash !== policy.policyHash) fail("POLICY_CHANGED");
  await assertStoredDiscountStudy(tx, terms.merchantId, version.strategy.runId, proposal.observation.id, rules, proposal.discountStudy, proposal.incentiveRecommendation);
  const run = await tx.revenueAnalysisRun.findFirst({ where: { id: version.strategy.runId, merchantId: terms.merchantId } });
  if (run?.status !== "completed") fail("ANALYSIS_NOT_COMPLETED");
  assertRecommendedIncentiveBudgetTerms(terms, { merchantId: terms.merchantId, strategyId: terms.strategyId,
    version: terms.version, proposalHash: version.proposalHash, study: proposal.discountStudy, rules, policy,
    recommendation: proposal.incentiveRecommendation });
  const review = await approvedIncentiveReview(tx, terms, proposal.incentiveRecommendation);
  return { ...version, review };
}

/** INTERNAL financing only. Requires the separate merchant approval and its
 * actor, and derives exact recommended terms. No review endpoint invokes it;
 * activation must compose this with deterministic checkout authority. */
export async function registerReviewedIncentiveBudget(tx: Tx, input: {
  merchantId: string; terms: IncentiveBudgetTerms; termsHash: string; actorId: string; requestKey: string;
}) {
  input = structuredClone(input);
  if (!input.terms || input.terms.merchantId !== input.merchantId || !incentiveKey(input.requestKey) || !actor(input.actorId)
    || digest(input.terms) !== input.termsHash) fail("INVALID_APPROVAL");
  await lockCheckoutBaselineRows(tx, input.merchantId);
  const requestHash = digest(input);
  const prior = await tx.strategyIncentiveBudget.findUnique({ where: { merchantId_requestKey: {
    merchantId: input.merchantId, requestKey: input.requestKey } } });
  if (prior) {
    if (prior.requestHash !== requestHash) fail("APPROVAL_KEY_CONFLICT");
    return prior; // Historical receipt, including after a stop or configuration change.
  }
  if (!incentiveBudgetEnabled(input.merchantId)) fail("BUDGET_DISABLED");
  const terms = input.terms;
  const version = await currentFundingSource(tx, terms);
  if (version.review.actorId !== input.actorId) fail("APPROVAL_ACTOR_CHANGED");
  if (await tx.strategyIncentiveBudget.findUnique({ where: { strategyId_merchantId: {
    strategyId: terms.strategyId, merchantId: input.merchantId } } })) fail("BUDGET_ALREADY_REVIEWED");
  const now = await clock(tx);
  if (version.expiresAt <= now || Date.parse(terms.startsAt) <= now.getTime()
    || Date.parse(terms.startsAt) >= version.expiresAt.getTime()) fail("APPROVAL_EXPIRED");
  return tx.strategyIncentiveBudget.create({ data: { id: randomUUID(), merchantId: input.merchantId,
    strategyId: terms.strategyId, version: terms.version, policyVersion: terms.policyVersion, reviewId: version.review.id,
    proposalHash: terms.proposalHash, terms: json(terms), termsHash: input.termsHash,
    actorId: input.actorId, requestKey: input.requestKey, requestHash, limitCents: terms.limitCents,
    maxDiscountCents: terms.maxDiscountCents, maxRedemptions: terms.maxRedemptions,
    startsAt: new Date(terms.startsAt), endsAt: new Date(terms.endsAt), approvedAt: now } });
}

/** Accounting only: does not qualify an audience, validate a cart's margin,
 * authorize a coupon or grant a discount. Compose with those deterministic
 * checks AND the checkout mutation in the caller's transaction. */
export async function reserveIncentiveBudget(tx: Tx, input: {
  merchantId: string; budgetId: string; sessionId: string; buyerId: string; requestKey: string; amountCents: number;
}) {
  input = structuredClone(input);
  if (!incentiveKey(input.requestKey) || !incentiveCents(input.amountCents) || !input.buyerId?.trim()) fail("INVALID_RESERVATION");
  await lockCheckoutBaselineRows(tx, input.merchantId);
  const requestHash = digest(input);
  const prior = await tx.strategyIncentiveReservation.findUnique({ where: { budgetId_merchantId_requestKey: {
    budgetId: input.budgetId, merchantId: input.merchantId, requestKey: input.requestKey } } });
  if (prior) {
    if (prior.requestHash !== requestHash) fail("RESERVATION_KEY_CONFLICT");
    return prior; // A released receipt cannot create another offer on a retry.
  }
  if (!incentiveBudgetEnabled(input.merchantId)) fail("BUDGET_DISABLED");
  const budget = await tx.strategyIncentiveBudget.findFirst({ where: { id: input.budgetId, merchantId: input.merchantId } });
  if (!budget) fail("BUDGET_NOT_FOUND");
  if (digest(budget.terms) !== budget.termsHash) fail("BUDGET_CORRUPT");
  const source = await currentFundingSource(tx, budget.terms as unknown as IncentiveBudgetTerms);
  if (budget.reviewId !== source.review.id) fail("SPECIFIC_APPROVAL_REQUIRED");
  // Database guard binds the session/buyer/currency, locks the budget, enforces
  // both caps and maintains counters even when another writer uses raw SQL.
  return tx.strategyIncentiveReservation.create({ data: { id: randomUUID(), ...input, requestHash, reservedAt: await clock(tx) } });
}

/** The caller supplies a durable commerce evidence identity in the SAME
 * transaction. This bookkeeping primitive does not prove provider payment or
 * delivery. Disabling/closing/expiring the envelope never prevents resolution. */
export async function resolveIncentiveBudget(tx: Tx, input: {
  merchantId: string; reservationId: string; status: "spent" | "released"; spentCents: number; evidenceKey: string;
}) {
  input = structuredClone(input);
  if (!incentiveKey(input.evidenceKey) || (input.status !== "spent" && input.status !== "released")
    || (input.status === "released" ? input.spentCents !== 0 : !incentiveCents(input.spentCents))) fail("INVALID_RESOLUTION");
  await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${input.merchantId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM strategy_incentive_reservations WHERE id = ${input.reservationId} AND merchant_id = ${input.merchantId} FOR UPDATE`;
  const row = await tx.strategyIncentiveReservation.findFirst({ where: { id: input.reservationId, merchantId: input.merchantId } });
  if (!row) fail("RESERVATION_NOT_FOUND");
  const resolutionHash = digest(input);
  if (row.status !== "reserved") {
    if (row.resolutionHash !== resolutionHash) fail("RESOLUTION_CONFLICT");
    return row;
  }
  if (input.spentCents > row.amountCents) fail("RESERVATION_EXCEEDED");
  return tx.strategyIncentiveReservation.update({ where: { id: row.id }, data: { status: input.status,
    spentCents: input.spentCents, evidenceKey: input.evidenceKey, resolutionHash, resolvedAt: await clock(tx) } });
}

export async function closeIncentiveBudget(tx: Tx, input: { merchantId: string; budgetId: string; actorId: string; reason: string }) {
  if (!actor(input.actorId) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 500) fail("INVALID_CLOSURE");
  await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${input.merchantId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM strategy_incentive_budgets WHERE id = ${input.budgetId} AND merchant_id = ${input.merchantId} FOR UPDATE`;
  const row = await tx.strategyIncentiveBudget.findFirst({ where: { id: input.budgetId, merchantId: input.merchantId } });
  if (!row) fail("BUDGET_NOT_FOUND");
  if (row.closedAt) return row;
  return tx.strategyIncentiveBudget.update({ where: { id: row.id }, data: { closedAt: await clock(tx), closedBy: input.actorId, closeReason: input.reason } });
}

export async function readIncentiveBudget(tx: Tx, merchantId: string, budgetId: string) {
  const row = await tx.strategyIncentiveBudget.findFirst({ where: { id: budgetId, merchantId } });
  if (!row) fail("BUDGET_NOT_FOUND");
  const now = await clock(tx);
  return { budgetId: row.id, strategyId: row.strategyId, version: row.version, currency: "BRL" as const,
    status: row.closedAt ? "closed" : now >= row.endsAt ? "expired" : now < row.startsAt ? "scheduled" : "open",
    limitCents: row.limitCents, reservedCents: row.reservedCents, spentCents: row.spentCents,
    uncommittedCents: row.limitCents - row.reservedCents - row.spentCents,
    reservedCount: row.reservedCount, spentCount: row.spentCount, maxRedemptions: row.maxRedemptions };
}
