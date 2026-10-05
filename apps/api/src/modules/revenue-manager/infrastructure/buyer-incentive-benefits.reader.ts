import type { Prisma, PrismaClient, StrategyIncentiveAssignment, StrategyIncentiveExecution } from "@prisma/client";
import { moneyCents } from "@zyon/rules-engine";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { toCheckoutSession } from "../../checkout/infrastructure/prisma/checkout-session.mapper.js";
import { strategyIncentiveCouponTerms } from "../../coupons/infrastructure/strategy-incentive-coupon.js";
import { assessExecutableIncentive } from "../domain/executable-incentive.js";
import { incentiveBenefitDisplay } from "../domain/incentive-benefit-display.js";
import { assertRecommendedIncentiveBudgetTerms, type IncentiveBudgetTerms } from "../domain/incentive-budget.js";
import type { StrategyProposal } from "../domain/strategy-proposal.js";
import type { StrategyIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";
import { incentiveAssignmentArm, incentiveCartHash, incentiveExecutionEnabled, readAuthoritativeIncentiveCart } from "./incentive-execution-ledger.js";
import { incentiveBudgetEnabled } from "./incentive-budget-ledger.js";
import { merchantRulesSnapshot } from "./hypothesis-merchant-context.adapter.js";
import { readIncentivePolicy } from "./incentive-policy.reader.js";
import { assertStoredDiscountStudy, commercialModesEnabled } from "./strategy-discount-study.js";
import { assertStoredStrategyOrchestration } from "./strategy-orchestration.reader.js";

export type BuyerIncentiveBenefit = {
  id: string;
  kind: "percentage" | "fixed" | "shipping" | "progressive";
  name: string;
  description: string;
  currency: "BRL";
  amountCents: number;
  maxDiscountCents: number;
  discountPercent: number;
  deliveryMode: "automatic" | "coupon_code";
  couponCode?: string;
  sessionId: string;
  expiresAt: string;
  condition: string;
  status: "applied";
};

type Tx = Prisma.TransactionClient;
const cap = 20;
const validIdentity = (value: string) => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 200;
const positiveCents = (value: number) => Number.isSafeInteger(value) && value > 0;

/** Display only, never financial authority. Read the existing treatment grant
 * in one read-only snapshot; checkout/payment still revalidate before use. */
export async function readBuyerIncentiveBenefits(prisma: PrismaClient, merchantId: string, globalUserId: string): Promise<BuyerIncentiveBenefit[]> {
  if (!validIdentity(merchantId) || !validIdentity(globalUserId)
    || !incentiveExecutionEnabled(merchantId) || !incentiveBudgetEnabled(merchantId)) return [];
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const consent = await tx.buyerIntentMemoryConsent.findUnique({ where: { merchantId_globalUserId: { merchantId, globalUserId } } });
    if (!consent || consent.merchantId !== merchantId || consent.globalUserId !== globalUserId
      || !consent.optedIn || consent.expiresAt <= now) return [];
    const intent = await tx.customerIntentRecord.findFirst({ where: { merchantId, globalUserId, generatedAt: { lte: now } },
      orderBy: [{ generatedAt: "desc" }, { id: "asc" }] });
    if (!intent || intent.merchantId !== merchantId || intent.globalUserId !== globalUserId || intent.generatedAt > now) return [];
    const holdout = await tx.holdoutGroupAssignment.findUnique({ where: { globalUserId_merchantId: { globalUserId, merchantId } } });
    if (holdout && holdout.cohort !== "treatment") return [];
    if (await tx.strategyExecution.count({ where: { merchantId, status: { in: ["running", "paused"] } } })
      || await tx.promptExperiment.count({ where: { merchantId, status: "running" } })) return [];
    const executions = await tx.strategyIncentiveExecution.findMany({ where: { merchantId, startedAt: { lte: now }, endsAt: { gt: now } },
      orderBy: [{ startedAt: "desc" }, { id: "asc" }], take: cap });
    if (!executions.length) return [];
    const assignments = await tx.strategyIncentiveAssignment.findMany({ where: { merchantId, buyerId: globalUserId,
      arm: "treatment", reservationId: { not: null }, executionId: { in: executions.map(e => e.id) } },
      orderBy: [{ assignedAt: "desc" }, { id: "asc" }], take: cap });
    const offers: BuyerIncentiveBenefit[] = [];
    for (const assignment of assignments) {
      const execution = executions.find(e => e.id === assignment.executionId);
      if (!execution) continue;
      const offer = await readExistingBenefit(tx, merchantId, globalUserId, now, consent.expiresAt,
        intent.primaryIntent, assignment, execution);
      if (offer) offers.push(offer);
    }
    return offers;
  }, { isolationLevel: "RepeatableRead", timeout: 10_000 });
}

async function readExistingBenefit(tx: Tx, merchantId: string, buyerId: string, now: Date, consentExpiresAt: Date,
  intent: string, assignment: StrategyIncentiveAssignment, execution: StrategyIncentiveExecution): Promise<BuyerIncentiveBenefit | null> {
  if (execution.merchantId !== merchantId || execution.startedAt > now || execution.endsAt <= now
    || assignment.merchantId !== merchantId || assignment.buyerId !== buyerId || assignment.arm !== "treatment"
    || assignment.assignedAt < execution.startedAt || assignment.assignedAt > now || !assignment.reservationId
    || incentiveAssignmentArm(execution.id, buyerId) !== "treatment" || !positiveCents(assignment.amountCents)) return null;
  const recommendation = execution.recommendation as unknown as StrategyIncentiveRecommendation;
  if (!recommendation || recommendation.status !== "recommended" || digest(recommendation) !== execution.recommendationHash
    || recommendation.merchantId !== merchantId || recommendation.test.audience.intent !== intent) return null;
  const commercial = ["weekly-incentive-recommendation-v3", "weekly-incentive-recommendation-v4"].includes(recommendation.definition);
  if (commercial && !commercialModesEnabled(merchantId)) return null;
  const budget = await tx.strategyIncentiveBudget.findFirst({ where: { id: execution.budgetId, merchantId } });
  const reservation = await tx.strategyIncentiveReservation.findFirst({ where: { id: assignment.reservationId, merchantId, buyerId,
    sessionId: assignment.sessionId, budgetId: execution.budgetId, status: "reserved" } });
  if (!budget || !reservation || budget.merchantId !== merchantId || budget.closedAt || budget.startsAt > now || budget.endsAt <= now
    || budget.strategyId !== execution.strategyId || budget.version !== execution.version || budget.reviewId !== execution.reviewId
    || reservation.merchantId !== merchantId || reservation.buyerId !== buyerId || reservation.sessionId !== assignment.sessionId
    || reservation.budgetId !== budget.id || reservation.status !== "reserved" || reservation.resolvedAt
    || reservation.spentCents !== null || reservation.amountCents !== assignment.amountCents
    || assignment.amountCents > budget.maxDiscountCents || budget.reservedCents < reservation.amountCents || budget.reservedCount < 1
    || budget.reservedCents + budget.spentCents > budget.limitCents || budget.reservedCount + budget.spentCount > budget.maxRedemptions
    || digest(budget.terms) !== budget.termsHash) return null;
  const terms = budget.terms as unknown as IncentiveBudgetTerms;
  if (terms.limitCents !== budget.limitCents || terms.maxDiscountCents !== budget.maxDiscountCents || terms.maxRedemptions !== budget.maxRedemptions
    || terms.startsAt !== budget.startsAt.toISOString() || terms.endsAt !== budget.endsAt.toISOString()
    || +budget.startsAt !== +execution.startedAt || +budget.endsAt !== +execution.endsAt) return null;
  const session = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: assignment.sessionId } } });
  if (!session || session.merchantId !== merchantId || session.globalUserId !== buyerId || session.cohort !== "treatment"
    || session.promptVariantId || !session.shipping || session.createdAt < execution.startedAt || session.createdAt > assignment.assignedAt
    || await tx.strategyAssignment.count({ where: { merchantId, sessionId: session.sessionId } })
    || await tx.completedOrder.count({ where: { merchantId, sessionId: session.sessionId } })
    || await tx.paymentIntent.count({ where: { merchantId, sessionId: session.sessionId } })
    || await tx.acceptedOffer.count({ where: { merchantId, sessionId: session.sessionId } })
    || await tx.couponRedemption.count({ where: { merchantId, sessionId: session.sessionId, status: "applied" } })) return null;
  const version = await tx.revenueStrategyVersion.findUnique({ where: { strategyId_merchantId_version: {
    strategyId: execution.strategyId, merchantId, version: execution.version } }, include: { strategy: true } });
  const ruleRow = await tx.merchantRule.findUnique({ where: { merchantId } });
  if (!version || !ruleRow || version.merchantId !== merchantId || version.strategy.merchantId !== merchantId
    || version.strategy.currentVersion !== execution.version || version.strategy.status !== "pending_review"
    || version.proposalHash !== budget.proposalHash || digest(version.proposal) !== version.proposalHash
    || !await tx.revenueAnalysisSchedule.findUnique({ where: { merchantId } })) return null;
  const proposal = version.proposal as unknown as StrategyProposal;
  const rules = merchantRulesSnapshot(ruleRow);
  if (!proposal.discountStudy || !proposal.incentiveRecommendation || digest(proposal.incentiveRecommendation) !== execution.recommendationHash
    || digest(proposal.rules) !== digest(rules)) return null;
  try {
    const policy = await readIncentivePolicy(tx, merchantId);
    if (!policy.enabled || digest(policy) !== digest(recommendation.financialPolicy)) return null;
    assertRecommendedIncentiveBudgetTerms(terms, { merchantId, strategyId: execution.strategyId, version: execution.version,
      proposalHash: version.proposalHash, study: proposal.discountStudy, rules, policy, recommendation });
    await assertStoredDiscountStudy(tx, merchantId, version.strategy.runId, proposal.observation.id, rules, proposal.discountStudy, recommendation);
    await assertStoredStrategyOrchestration(tx, merchantId, version.strategy.runId, proposal);
  } catch (error) {
    if (error instanceof Error && /^(INCENTIVE_|STRATEGY_)/.test(error.message)) return null;
    throw error;
  }
  const run = await tx.revenueAnalysisRun.findFirst({ where: { id: version.strategy.runId, merchantId } });
  const review = await tx.strategyIncentiveReview.findFirst({ where: { merchantId, strategyId: execution.strategyId, version: execution.version },
    orderBy: { sequence: "desc" } });
  const head = await tx.strategyIncentiveReviewHead.findUnique({ where: { strategyId_merchantId_version: {
    strategyId: execution.strategyId, merchantId, version: execution.version } } });
  if (!run || run.status !== "completed" || !review || !head || head.currentSequence !== review.sequence
    || review.id !== execution.reviewId || review.kind !== "approve" || review.proposalHash !== version.proposalHash
    || review.recommendationHash !== execution.recommendationHash || review.policyVersion !== terms.policyVersion
    || review.policyHash !== terms.policyHash || execution.startedAt <= review.createdAt || execution.startedAt >= review.expiresAt) return null;
  const checkout = toCheckoutSession(session);
  const cartHash = commercial ? digest({ cart: incentiveCartHash(checkout.cart), shipping: checkout.shipping ?? null }) : incentiveCartHash(checkout.cart);
  if (cartHash !== assignment.cartHash || checkout.cart.commercialNudge?.ruleId !== assignment.id) return null;
  let amountCents = assignment.amountCents, discountPercent = recommendation.test.discountPercent, maxDiscountCents = recommendation.test.maxDiscountCents;
  let stageIndex: 0 | 1 = 1;
  if (recommendation.test.kind === "capped_progressive_discount") {
    const grant = await tx.strategyIncentiveStageGrant.findFirst({ where: { merchantId, assignmentId: assignment.id }, orderBy: { stageIndex: "desc" } });
    if (!grant || grant.createdAt > now || (grant.stageIndex !== 0 && grant.stageIndex !== 1)) return null;
    stageIndex = grant.stageIndex;
    const stage = recommendation.test.stages?.[stageIndex];
    if (!stage || grant.trigger !== stage.trigger) return null;
    amountCents = grant.amountCents; discountPercent = stage.discountPercent; maxDiscountCents = stage.maxDiscountCents;
  }
  if (!positiveCents(amountCents) || amountCents > maxDiscountCents || amountCents > reservation.amountCents
    || moneyCents(checkout.cart.currentDiscount) !== amountCents) return null;
  const delivery = recommendation.test.delivery;
  if (delivery?.mode === "coupon_code") {
    const coupon = await tx.coupon.findFirst({ where: { merchantId, strategyIncentiveExecutionId: execution.id } });
    const expected = strategyIncentiveCouponTerms(execution);
    if (!coupon || !expected || coupon.merchantId !== merchantId || coupon.strategyIncentiveExecutionId !== execution.id
      || coupon.status !== "active" || coupon.code !== delivery.code || checkout.cart.commercialNudge?.couponCode !== delivery.code
      || coupon.discountType !== expected.discountType || Number(coupon.discountValue) !== expected.discountValue
      || Number(coupon.minCartTotal) !== expected.minCartTotal || coupon.maxUsages !== expected.maxUsages
      || coupon.maxPerBuyer !== expected.maxPerBuyer || +coupon.startsAt !== +expected.startsAt
      || !coupon.endsAt || +coupon.endsAt !== +expected.endsAt) return null;
  } else if (checkout.cart.commercialNudge?.couponCode) return null;
  const current = await readAuthoritativeIncentiveCart(tx, session);
  if (!current) return null;
  const { commercialNudge: _nudge, ...base } = current;
  const assessment = assessExecutableIncentive({ ...base, currentDiscount: 0 }, rules, recommendation, checkout.shipping, stageIndex);
  if (!assessment || assessment.amountCents !== amountCents) return null;
  const kind = recommendation.test.kind === "capped_fixed_discount" ? "fixed"
    : recommendation.test.kind === "capped_shipping_discount" ? "shipping"
    : recommendation.test.kind === "capped_progressive_discount" ? "progressive" : "percentage";
  const display = incentiveBenefitDisplay(recommendation, amountCents, kind === "progressive" ? stageIndex : undefined);
  return { id: assignment.id, kind, name: display.title, description: display.message,
    currency: "BRL", amountCents, maxDiscountCents, discountPercent, deliveryMode: delivery?.mode ?? "automatic",
    ...(delivery?.mode === "coupon_code" ? { couponCode: delivery.code } : {}), sessionId: session.sessionId,
    expiresAt: new Date(Math.min(+execution.endsAt, +consentExpiresAt)).toISOString(), status: "applied",
    condition: "Válido somente para este pedido, enquanto as condições do carrinho forem mantidas. Não acumulável com outros descontos." };
}
