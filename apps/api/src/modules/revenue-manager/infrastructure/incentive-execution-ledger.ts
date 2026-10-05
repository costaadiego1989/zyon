import { randomUUID } from "node:crypto";
import type { CheckoutSession, Prisma, StrategyIncentiveAssignment } from "@prisma/client";
import type { Cart, ShippingQuote } from "@zyon/shared-types";
import { moneyCents } from "@zyon/rules-engine";
import { assessExecutableIncentive } from "../domain/executable-incentive.js";
import { incentiveBenefitDisplay } from "../domain/incentive-benefit-display.js";
export { assessExecutableIncentive } from "../domain/executable-incentive.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import type { StrategyProposal } from "../domain/strategy-proposal.js";
import type { StrategyIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";
import { recommendedIncentiveBudgetTerms } from "../domain/incentive-budget.js";
import { lockCheckoutBaselineRows } from "./checkout-baseline.reader.js";
import { merchantRulesSnapshot } from "./hypothesis-merchant-context.adapter.js";
import { readIncentivePolicy } from "./incentive-policy.reader.js";
import { registerReviewedIncentiveBudget, reserveIncentiveBudget, resolveIncentiveBudget } from "./incentive-budget-ledger.js";
import { assertStoredDiscountStudy, commercialModesEnabled } from "./strategy-discount-study.js";
import { publishStrategyIncentiveCoupon } from "../../coupons/infrastructure/strategy-incentive-coupon.js";
import { toCheckoutSession } from "../../checkout/infrastructure/prisma/checkout-session.mapper.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import type { PaymentIntentSnapshot } from "../../payment/domain/payment-intent.entity.js";
import { assertPaymentAmount, paymentReviewFingerprint } from "../../payment/domain/payment-amount.js";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const clock = async (tx: Tx) => (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now;
const commercialRecommendation = (recommendation: StrategyIncentiveRecommendation) =>
  ["weekly-incentive-recommendation-v3", "weekly-incentive-recommendation-v4"].includes(recommendation.definition);
const progressiveRecommendation = (recommendation: StrategyIncentiveRecommendation) =>
  recommendation.definition === "weekly-incentive-recommendation-v4" && recommendation.status === "recommended"
    && recommendation.test.kind === "capped_progressive_discount";
export const STRATEGY_INCENTIVE_STAGE_EVENT = "strategy_incentive_stage";
export const incentiveExecutionEnabled = (merchantId: string) => process.env.REVENUE_INCENTIVE_EXECUTION_ENABLED === "true"
  && (process.env.REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS ?? "").split(",").map(s => s.trim()).includes(merchantId);

/** Serializes with both kinds of activation through the merchant lock. */
export async function hasOpenIncentiveExecution(tx: Tx, merchantId: string, now: Date) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT e.id FROM strategy_incentive_executions e
    JOIN strategy_incentive_budgets b ON b.id = e.budget_id AND b.merchant_id = e.merchant_id
    WHERE e.merchant_id = ${merchantId} AND e.ends_at > ${now} AND b.closed_at IS NULL LIMIT 1`;
  return rows.length > 0;
}

export async function incentiveActivationBlockers(tx: Tx, merchantId: string, now: Date) {
  const blockers: string[] = [];
  if (!incentiveExecutionEnabled(merchantId)) blockers.push("incentive_execution_disabled");
  if (process.env.REVENUE_INCENTIVE_BUDGET_ENABLED !== "true"
    || !(process.env.REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS ?? "").split(",").map(s => s.trim()).includes(merchantId)) blockers.push("incentive_budget_disabled");
  if (await tx.promptExperiment.count({ where: { merchantId, status: "running" } })
    || await tx.strategyExecution.count({ where: { merchantId, status: { in: ["running", "paused"] } } })
    || await hasOpenIncentiveExecution(tx, merchantId, now)) blockers.push("experiment_already_active");
  return blockers;
}

/** Composed atomically with the separate approval; no LLM, provider or public coupon. */
export async function activateApprovedIncentive(tx: Tx, merchantId: string, strategyId: string) {
  await lockCheckoutBaselineRows(tx, merchantId);
  const existing = await tx.strategyIncentiveExecution.findUnique({ where: { strategyId_merchantId: { strategyId, merchantId } } });
  if (existing) return existing;
  const blockers = await incentiveActivationBlockers(tx, merchantId, await clock(tx));
  if (blockers.length) throw new Error(`INCENTIVE_ACTIVATION_${blockers.join("_").toUpperCase()}`);
  const strategy = await tx.revenueStrategy.findFirstOrThrow({ where: { id: strategyId, merchantId } });
  const version = await tx.revenueStrategyVersion.findUniqueOrThrow({ where: { strategyId_merchantId_version: {
    strategyId, merchantId, version: strategy.currentVersion } } });
  const proposal = version.proposal as unknown as StrategyProposal;
  if (!proposal.discountStudy || !proposal.incentiveRecommendation) throw new Error("INCENTIVE_STUDY_REQUIRED");
  if (commercialRecommendation(proposal.incentiveRecommendation)
    && !commercialModesEnabled(merchantId)) throw new Error("INCENTIVE_COMMERCIAL_MODES_DISABLED");
  const review = await tx.strategyIncentiveReview.findFirstOrThrow({ where: { strategyId, merchantId,
    version: version.version, kind: "approve" } });
  const rules = merchantRulesSnapshot(await tx.merchantRule.findUniqueOrThrow({ where: { merchantId } }));
  const policy = await readIncentivePolicy(tx, merchantId);
  const now = await clock(tx);
  const terms = recommendedIncentiveBudgetTerms({ merchantId, strategyId, version: version.version,
    proposalHash: version.proposalHash, study: proposal.discountStudy, rules, policy, recommendation: proposal.incentiveRecommendation },
    new Date(now.getTime() + 5_000).toISOString());
  const budget = await registerReviewedIncentiveBudget(tx, { merchantId, terms, termsHash: digest(terms),
    actorId: review.actorId, requestKey: `incentive-execution:${review.id}` });
  const execution = await tx.strategyIncentiveExecution.create({ data: { id: randomUUID(), merchantId, strategyId,
    version: version.version, reviewId: review.id, budgetId: budget.id,
    recommendation: json(proposal.incentiveRecommendation), recommendationHash: digest(proposal.incentiveRecommendation),
    startedAt: budget.startsAt, endsAt: budget.endsAt, createdAt: now } });
  await publishStrategyIncentiveCoupon(tx, execution);
  return execution;
}

export function incentiveAssignmentArm(executionId: string, buyerId: string): "control" | "treatment" {
  return parseInt(digest(["incentive-assignment-v1", executionId, buyerId]).slice(0, 8), 16) % 2 ? "treatment" : "control";
}

/** Bind economic product identities while allowing later contact/shipping selection. */
export function incentiveCartHash(cart: Cart): string {
  return digest({ currency: cart.currency, total: cart.total, items: cart.items.map(item => ({ variantId: item.variantId,
    sku: item.sku, price: item.price, quantity: item.quantity, selected_options: item.selected_options ?? [] })) });
}

/** v3 also pins carrier economics; a shipping change must be reviewed again. */
function assignmentCartHash(cart: Cart, recommendation: StrategyIncentiveRecommendation, shipping?: ShippingQuote) {
  return commercialRecommendation(recommendation)
    ? digest({ cart: incentiveCartHash(cart), shipping: shipping ?? null }) : incentiveCartHash(cart);
}

/** Locked, current catalog is the only price/cost authority. Unknown/customized
 * baskets and subsidized shipping are ineligible for this first runtime. */
async function authoritativeCart(tx: Tx, session: CheckoutSession, lockPrices = true): Promise<Cart | null> {
  const snapshot = toCheckoutSession(session), cart = snapshot.cart;
  if (!cart || cart.currency !== "BRL" || !Array.isArray(cart.items) || !cart.items.length || cart.items.length > 100
    || snapshot.crossStoreItems?.length || (cart as Cart & { crossStoreItems?: unknown[] }).crossStoreItems?.length
    || (snapshot.shipping && (moneyCents(snapshot.shipping.realCost) === null
      || snapshot.shipping.customerPrice < snapshot.shipping.realCost!))) return null;
  if (cart.items.some(item => !item.variantId || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99
    || (item.selected_options !== undefined && (!Array.isArray(item.selected_options) || item.selected_options.length)))) return null;
  const ids = cart.items.map(item => item.variantId!);
  // Price/variant/product writers cannot invalidate costs between assessment and commit.
  if (lockPrices) await tx.$queryRaw`SELECT p.id FROM product_prices p JOIN product_variants v ON v.id = p.variant_id
    JOIN products product ON product.id = v.product_id WHERE product.merchant_id = ${session.merchantId}
    AND v.id = ANY(${ids}) AND p.currency = 'BRL' FOR SHARE OF p, v, product`;
  const prices = await tx.productPrice.findMany({ where: { variantId: { in: ids }, currency: "BRL",
    variant: { isActive: true, product: { merchantId: session.merchantId, isActive: true, deletedAt: null } } } });
  const items: Cart["items"] = [];
  let total = 0;
  for (const item of cart.items) {
    const price = prices.find(p => p.variantId === item.variantId);
    if (!price || !Number.isSafeInteger(price.costInCents) || price.costInCents! < 0
      || moneyCents(item.price) !== price.basePriceInCents) return null;
    total += price.basePriceInCents * item.quantity;
    items.push({ ...item, cost: price.costInCents! / 100 });
  }
  return Number.isSafeInteger(total) && moneyCents(cart.total) === total ? { ...cart, items } : null;
}

/** Presentation reads use a consistent database snapshot, without admitting a
 * buyer or granting financial authority. Payment paths retain the price locks. */
export function readAuthoritativeIncentiveCart(tx: Tx, session: CheckoutSession): Promise<Cart | null> {
  return authoritativeCart(tx, session, false);
}

async function eligibleIntent(tx: Tx, merchantId: string, buyerId: string, intent: string, now: Date) {
  await tx.$queryRaw`SELECT merchant_id FROM buyer_intent_memory_consents WHERE merchant_id = ${merchantId}
    AND global_user_id = ${buyerId} FOR SHARE`;
  const latest = await tx.customerIntentRecord.findFirst({ where: { merchantId, globalUserId: buyerId,
    generatedAt: { lte: now }, consent: { is: { optedIn: true, expiresAt: { gt: now } } } },
    orderBy: [{ generatedAt: "desc" }, { id: "asc" }] });
  return latest?.primaryIntent === intent;
}

/** Called after a versioned checkout persistence, before commit. Both arms are
 * admitted before payment/outcome. Identity can become eligible after creation.
 * The caller holds merchant BEFORE session, and uses the returned cart/version. */
export async function applyEligibleIncentive(tx: Tx, session: CheckoutSession): Promise<CheckoutSession> {
  const merchantId = session.merchantId;
  if (!incentiveExecutionEnabled(merchantId) || session.cohort !== "treatment" || !session.globalUserId?.trim()
    || session.promptVariantId || !session.shipping) return session;
  const now = await clock(tx);
  const execution = await tx.strategyIncentiveExecution.findFirst({ where: { merchantId, startedAt: { lte: now }, endsAt: { gt: now } }, orderBy: { startedAt: "desc" } });
  if (!execution || session.createdAt < execution.startedAt) return session;
  const budget = await tx.strategyIncentiveBudget.findUniqueOrThrow({ where: { id: execution.budgetId } });
  if (budget.closedAt || budget.reservedCount + budget.spentCount >= budget.maxRedemptions
    || budget.reservedCents + budget.spentCents + budget.maxDiscountCents > budget.limitCents) return session;
  if (await tx.strategyIncentiveAssignment.findFirst({ where: { merchantId, OR: [
    { sessionId: session.sessionId }, { executionId: execution.id, buyerId: session.globalUserId }] } })
    || await tx.strategyAssignment.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: session.sessionId } } })
    || await tx.strategyExecution.count({ where: { merchantId, status: { in: ["running", "paused"] } } })
    || await tx.promptExperiment.count({ where: { merchantId, status: "running" } })
    || await tx.paymentIntent.count({ where: { merchantId, sessionId: session.sessionId } })
    || await tx.completedOrder.count({ where: { merchantId, sessionId: session.sessionId } })
    || await tx.acceptedOffer.count({ where: { merchantId, sessionId: session.sessionId } })
    || await tx.couponRedemption.count({ where: { merchantId, sessionId: session.sessionId, status: "applied" } })) return session;
  const recommendation = execution.recommendation as unknown as StrategyIncentiveRecommendation;
  if (digest(recommendation) !== execution.recommendationHash || recommendation.status !== "recommended") throw new Error("INCENTIVE_EXECUTION_CORRUPT");
  const commercial = commercialRecommendation(recommendation);
  if (commercial && !commercialModesEnabled(merchantId)) return session;
  if (recommendation.test.delivery?.mode === "coupon_code") {
    const coupon = await tx.coupon.findUnique({ where: { strategyIncentiveExecutionId: execution.id } });
    if (!coupon || coupon.merchantId !== merchantId || coupon.code !== recommendation.test.delivery.code || coupon.status !== "active") return session;
  }
  if (!await eligibleIntent(tx, merchantId, session.globalUserId, recommendation.test.audience.intent, now)) return session;
  await lockCheckoutBaselineRows(tx, merchantId);
  const rules = merchantRulesSnapshot(await tx.merchantRule.findUniqueOrThrow({ where: { merchantId } }));
  const version = await tx.revenueStrategyVersion.findUniqueOrThrow({ where: { strategyId_merchantId_version: {
    strategyId: execution.strategyId, merchantId, version: execution.version } }, include: { strategy: true } });
  const proposal = version.proposal as unknown as StrategyProposal;
  if (version.strategy.currentVersion !== execution.version || digest(rules) !== digest(proposal.rules)
    || digest(await readIncentivePolicy(tx, merchantId)) !== digest(recommendation.financialPolicy)) return session;
  await assertStoredDiscountStudy(tx, merchantId, version.strategy.runId, proposal.observation.id, rules, proposal.discountStudy, recommendation);
  const shipping = toCheckoutSession(session).shipping;
  const cart = await authoritativeCart(tx, session);
  const assessment = cart && assessExecutableIncentive(cart, rules, recommendation, shipping);
  if (!cart || !assessment) return session;
  const arm = incentiveAssignmentArm(execution.id, session.globalUserId);
  const id = randomUUID();
  const reservation = arm === "treatment" ? await reserveIncentiveBudget(tx, { merchantId, budgetId: budget.id,
    sessionId: session.sessionId, buyerId: session.globalUserId, requestKey: `assignment:${id}`, amountCents: assessment.amountCents }) : null;
  const assignment = await tx.strategyIncentiveAssignment.create({ data: { id, merchantId, executionId: execution.id, sessionId: session.sessionId,
    buyerId: session.globalUserId, arm, assignedAt: now, cartHash: assignmentCartHash(cart, recommendation, shipping),
    amountCents: arm === "treatment" ? assessment.amountCents : 0, costCents: assessment.costCents, reservationId: reservation?.id } });
  let amountCents = assessment.amountCents;
  if (progressiveRecommendation(recommendation)) {
    const initial = assessExecutableIncentive(cart, rules, recommendation, shipping, 0);
    if (!initial) throw new Error("INCENTIVE_PROGRESSIVE_STAGE_INVALID");
    amountCents = initial.amountCents;
    await recordProgressiveGrant(tx, assignment, 0, arm === "control" ? 0 : amountCents, now);
  }
  if (arm === "control") return session;
  return tx.checkoutSession.update({ where: { id: session.id }, data: {
    cart: json(cartWithIncentive(cart, id, amountCents, recommendation, progressiveRecommendation(recommendation) ? 0 : undefined)), updatedAt: now } });
}

function cartWithIncentive(cart: Cart, assignmentId: string, amountCents: number, recommendation: StrategyIncentiveRecommendation, stage?: 0 | 1): Cart {
  if (recommendation.status !== "recommended") throw new Error("INCENTIVE_EXECUTION_CORRUPT");
  const couponCode = recommendation.test.delivery?.mode === "coupon_code" ? recommendation.test.delivery.code : undefined;
  const display = incentiveBenefitDisplay(recommendation, amountCents, stage);
  return { ...cart, currentDiscount: amountCents / 100, commercialNudge: {
    kind: stage !== undefined ? "progressive_discount" : "coupon", ruleId: assignmentId, ...(couponCode ? { couponCode } : {}),
    ...display,
    badge: `−${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amountCents / 100)}` } };
}

async function recordProgressiveGrant(tx: Tx, assignment: StrategyIncentiveAssignment, stageIndex: 0 | 1, amountCents: number, now: Date, method?: string) {
  const trigger = stageIndex === 0 ? "enrollment" : "checkout_payment_ready";
  const event = await tx.checkoutEvent.create({ data: { merchantId: assignment.merchantId, sessionId: assignment.sessionId,
    eventName: STRATEGY_INCENTIVE_STAGE_EVENT, occurredAt: now,
    metadata: { source: "revenue_engine", assignmentId: assignment.id, stageIndex, trigger, ...(method ? { method } : {}) } } });
  return tx.strategyIncentiveStageGrant.create({ data: { id: randomUUID(), merchantId: assignment.merchantId,
    assignmentId: assignment.id, stageIndex, trigger, amountCents, eventId: event.id, createdAt: now } });
}

async function grantedIncentive(tx: Tx, assignment: StrategyIncentiveAssignment) {
  const stage = await tx.strategyIncentiveStageGrant.findFirst({ where: { merchantId: assignment.merchantId,
    assignmentId: assignment.id }, orderBy: { stageIndex: "desc" } });
  return { amountCents: stage?.amountCents ?? assignment.amountCents, stageIndex: stage?.stageIndex };
}

/** Internal payment preparation only. Client telemetry cannot advance stages.
 * Reservation/assignment stay immutable; each additional grant is append-only.
 * No increase is allowed once any provider attempt exists. */
export async function prepareProgressiveIncentivePayment(tx: Tx, merchantId: string, sessionId: string, method: string): Promise<CheckoutSession | null> {
  await lockCheckoutBaselineRows(tx, merchantId);
  await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${merchantId} AND session_id = ${sessionId} FOR UPDATE`;
  const session = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } } });
  if (!session || !incentiveExecutionEnabled(merchantId) || !commercialModesEnabled(merchantId)
    || !["pix", "card", "boleto", "crypto"].includes(method)) return session;
  const assignment = await tx.strategyIncentiveAssignment.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } } });
  if (!assignment) return session;
  const execution = await tx.strategyIncentiveExecution.findUniqueOrThrow({ where: { id: assignment.executionId } });
  const recommendation = execution.recommendation as unknown as StrategyIncentiveRecommendation;
  if (!progressiveRecommendation(recommendation) || recommendation.status !== "recommended") return session;
  if (digest(recommendation) !== execution.recommendationHash) throw new Error("INCENTIVE_EXECUTION_CORRUPT");
  const granted = await grantedIncentive(tx, assignment);
  if (granted.stageIndex !== 0) return session;
  const now = await clock(tx), checkout = toCheckoutSession(session);
  const budget = await tx.strategyIncentiveBudget.findUniqueOrThrow({ where: { id: execution.budgetId } });
  if (budget.closedAt || now < execution.startedAt || now >= execution.endsAt || !checkout.shipping
    || assignment.buyerId !== session.globalUserId || session.cohort !== "treatment" || session.promptVariantId
    || assignmentCartHash(checkout.cart, recommendation, checkout.shipping) !== assignment.cartHash
    || await tx.paymentIntent.count({ where: { merchantId, sessionId } })
    || await tx.completedOrder.count({ where: { merchantId, sessionId } })
    || await tx.acceptedOffer.count({ where: { merchantId, sessionId } })
    || await tx.couponRedemption.count({ where: { merchantId, sessionId, status: "applied" } })
    || !await eligibleIntent(tx, merchantId, assignment.buyerId, recommendation.test.audience.intent, now)) return session;
  if (assignment.arm === "treatment") {
    const reservation = await tx.strategyIncentiveReservation.findUniqueOrThrow({ where: { id: assignment.reservationId! } });
    if (reservation.status !== "reserved" || reservation.amountCents !== assignment.amountCents
      || moneyCents(checkout.cart.currentDiscount) !== granted.amountCents || checkout.cart.commercialNudge?.ruleId !== assignment.id) return session;
  } else if ((checkout.cart.currentDiscount ?? 0) !== 0 || checkout.cart.commercialNudge) return session;
  const rules = merchantRulesSnapshot(await tx.merchantRule.findUniqueOrThrow({ where: { merchantId } }));
  const version = await tx.revenueStrategyVersion.findUniqueOrThrow({ where: { strategyId_merchantId_version: {
    strategyId: execution.strategyId, merchantId, version: execution.version } }, include: { strategy: true } });
  const proposal = version.proposal as unknown as StrategyProposal;
  if (version.strategy.currentVersion !== execution.version || digest(rules) !== digest(proposal.rules)
    || digest(await readIncentivePolicy(tx, merchantId)) !== digest(recommendation.financialPolicy)) return session;
  await assertStoredDiscountStudy(tx, merchantId, version.strategy.runId, proposal.observation.id, rules, proposal.discountStudy, recommendation);
  const current = await authoritativeCart(tx, session);
  if (!current) return session;
  const { commercialNudge: _nudge, ...base } = current;
  const cart = { ...base, currentDiscount: 0 };
  const assessment = assessExecutableIncentive(cart, rules, recommendation, checkout.shipping, 1);
  if (!assessment || (assignment.arm === "treatment" && assessment.amountCents !== assignment.amountCents)) return session;
  await recordProgressiveGrant(tx, assignment, 1, assignment.arm === "treatment" ? assessment.amountCents : 0, now, method);
  if (assignment.arm === "control") return session;
  return tx.checkoutSession.update({ where: { id: session.id }, data: {
    cart: json(cartWithIncentive(cart, assignment.id, assessment.amountCents, recommendation, 1)), updatedAt: now } });
}

/** A strategy code identifies the approved execution. Both arms are enrolled
 * through ordinary checkout persistence, independently of entering the code. */
export async function applyIncentiveCoupon(tx: Tx, session: CheckoutSession,
  input: { executionId: string; code: string }): Promise<CheckoutSession | null> {
  const execution = await tx.strategyIncentiveExecution.findFirst({ where: { id: input.executionId, merchantId: session.merchantId } });
  if (!execution || !incentiveExecutionEnabled(session.merchantId) || !commercialModesEnabled(session.merchantId)) return null;
  const recommendation = execution.recommendation as unknown as StrategyIncentiveRecommendation;
  const now = await clock(tx);
  if (!commercialRecommendation(recommendation) || recommendation.status !== "recommended"
    || digest(recommendation) !== execution.recommendationHash || recommendation.test.delivery?.mode !== "coupon_code"
    || recommendation.test.delivery.code !== input.code || now < execution.startedAt || now >= execution.endsAt) return null;
  const budget = await tx.strategyIncentiveBudget.findUniqueOrThrow({ where: { id: execution.budgetId } });
  if (budget.closedAt) return null;
  // Never assign only after a buyer elects to enter a coupon; that would bias
  // the A/B denominator. An unassigned session waits for normal persistence.
  const assignment = await tx.strategyIncentiveAssignment.findUnique({ where: {
    merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.sessionId } } });
  if (!assignment || assignment.executionId !== execution.id || assignment.arm !== "treatment"
    || assignment.buyerId !== session.globalUserId || session.cohort !== "treatment" || !assignment.reservationId) return null;
  const reservation = await tx.strategyIncentiveReservation.findUniqueOrThrow({ where: { id: assignment.reservationId } });
  const checkout = toCheckoutSession(session);
  if (reservation.status !== "reserved" || checkout.cart.commercialNudge?.ruleId !== assignment.id
    || checkout.cart.commercialNudge?.couponCode !== input.code || moneyCents(checkout.cart.currentDiscount) !== assignment.amountCents
    || assignmentCartHash(checkout.cart, recommendation, checkout.shipping) !== assignment.cartHash) return null;
  const rules = merchantRulesSnapshot(await tx.merchantRule.findUniqueOrThrow({ where: { merchantId: session.merchantId } }));
  if (digest(await readIncentivePolicy(tx, session.merchantId)) !== digest(recommendation.financialPolicy)
    || !await eligibleIntent(tx, session.merchantId, assignment.buyerId, recommendation.test.audience.intent, now)) return null;
  const current = await authoritativeCart(tx, session);
  if (!current) return null;
  const { commercialNudge: _nudge, ...base } = current;
  const assessment = assessExecutableIncentive({ ...base, currentDiscount: 0 }, rules, recommendation, checkout.shipping);
  return assessment?.amountCents === assignment.amountCents ? session : null;
}

/** A changed cart/buyer cannot carry the old benefit to another sale. Pending
 * provider decisions keep their reservation and require payment resolution. */
export async function invalidateIncentiveCheckout(tx: Tx, merchantId: string, sessionId: string) {
  const assignment = await tx.strategyIncentiveAssignment.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } } });
  if (!assignment?.reservationId) return;
  const reservation = await tx.strategyIncentiveReservation.findUniqueOrThrow({ where: { id: assignment.reservationId } });
  if (reservation.status !== "reserved") return;
  if (await tx.paymentIntent.count({ where: { merchantId, sessionId, status: { in: ["pending", "requires_action", "approved"] } } })) {
    throw new Error("INCENTIVE_PAYMENT_RESOLUTION_REQUIRED");
  }
  await resolveIncentiveBudget(tx, { merchantId, reservationId: reservation.id, status: "released", spentCents: 0,
    evidenceKey: `checkout-invalidated:${assignment.id}` });
}

/** An explicit failed-payment review removes only this engine's unused offer.
 * The immutable release receipt pins the new cart fingerprint. A subsequent
 * payment must carry the buyer's confirmation; retries alone cannot charge. */
export async function reviseIncentiveForPaymentReview(tx: Tx, merchantId: string, sessionId: string) {
  await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${merchantId} AND session_id = ${sessionId} FOR UPDATE`;
  const assignment = await tx.strategyIncentiveAssignment.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } } });
  if (!assignment?.reservationId) return undefined;
  const session = await tx.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId } } });
  const reservation = await tx.strategyIncentiveReservation.findUniqueOrThrow({ where: { id: assignment.reservationId } });
  if (await tx.paymentIntent.count({ where: { merchantId, sessionId, status: { notIn: ["failed", "cancelled"] } } })) return undefined;
  if (reservation.status === "released" && reservation.evidenceKey?.startsWith("checkout-review:")) return toCheckoutSession(session);
  if (reservation.status !== "reserved") return undefined;
  const checkout = toCheckoutSession(session);
  const granted = await grantedIncentive(tx, assignment);
  if (moneyCents(checkout.cart.currentDiscount ?? 0) !== granted.amountCents
    || checkout.cart.commercialNudge?.ruleId !== assignment.id
    || await tx.couponRedemption.count({ where: { merchantId, sessionId, status: "applied" } })
    || await tx.acceptedOffer.count({ where: { merchantId, sessionId } })) return undefined;
  const { commercialNudge: _nudge, ...cart } = checkout.cart;
  const next = { ...checkout, cart: { ...cart, currentDiscount: 0 } };
  const fingerprint = paymentCartFingerprint(next);
  await resolveIncentiveBudget(tx, { merchantId, reservationId: reservation.id, status: "released", spentCents: 0,
    evidenceKey: `checkout-review:${fingerprint}` });
  const updated = await tx.checkoutSession.update({ where: { id: session.id }, data: { cart: json(next.cart), paymentMethod: null, updatedAt: await clock(tx) } });
  return toCheckoutSession(updated);
}

/** Payment creation is persisted before provider dispatch. It revalidates exact
 * cart/identity/costs/consent and keeps one payment per reserved treatment. */
export async function validateIncentivePayment(tx: Tx, snapshot: PaymentIntentSnapshot) {
  const { merchantId, sessionId } = snapshot;
  await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
  const assignment = await tx.strategyIncentiveAssignment.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } } });
  if (!assignment) return;
  await lockCheckoutBaselineRows(tx, merchantId);
  await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${merchantId} AND session_id = ${sessionId} FOR UPDATE`;
  const session = await tx.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId } } });
  const checkout = toCheckoutSession(session);
  const breakdown = snapshot.amountBreakdown;
  if (!breakdown || breakdown.cartFingerprint !== paymentCartFingerprint(checkout)) throw new Error("INCENTIVE_PAYMENT_CART_CHANGED");
  assertPaymentAmount(breakdown, snapshot.amountCents, snapshot.currency);
  if (breakdown.itemsSubtotalCents !== moneyCents(checkout.cart.total)
    || breakdown.shippingCents !== moneyCents(checkout.shipping?.customerPrice ?? 0)
    || breakdown.discountCents !== moneyCents(checkout.cart.currentDiscount ?? 0)) throw new Error("INCENTIVE_PAYMENT_AUTHORITY_CHANGED");
  if (assignment.arm === "control") return; // No financial authority granted to control.
  const reservation = await tx.strategyIncentiveReservation.findUniqueOrThrow({ where: { id: assignment.reservationId! } });
  // A released assignment may continue without the experimental benefit.
  if (reservation.status === "released" && breakdown.discountCents === 0) {
    if (reservation.evidenceKey?.startsWith("checkout-review:")
      && breakdown.confirmedCartFingerprint !== paymentReviewFingerprint(breakdown)) throw new Error("INCENTIVE_PAYMENT_REVIEW_REQUIRED");
    return;
  }
  const execution = await tx.strategyIncentiveExecution.findUniqueOrThrow({ where: { id: assignment.executionId } });
  const budget = await tx.strategyIncentiveBudget.findUniqueOrThrow({ where: { id: execution.budgetId } });
  const recommendation = execution.recommendation as unknown as StrategyIncentiveRecommendation;
  const granted = await grantedIncentive(tx, assignment);
  const now = await clock(tx);
  if (!incentiveExecutionEnabled(merchantId) || budget.closedAt || now >= execution.endsAt || reservation.status !== "reserved"
    || (commercialRecommendation(recommendation) && !commercialModesEnabled(merchantId))
    || recommendation.status !== "recommended" || digest(recommendation) !== execution.recommendationHash
    || session.globalUserId !== assignment.buyerId || session.cohort !== "treatment"
    || assignmentCartHash(checkout.cart, recommendation, checkout.shipping) !== assignment.cartHash || breakdown.discountCents !== granted.amountCents
    || checkout.cart.commercialNudge?.ruleId !== assignment.id
    || await tx.couponRedemption.count({ where: { merchantId, sessionId, status: "applied" } })
    || await tx.acceptedOffer.count({ where: { merchantId, sessionId } })
    || snapshot.acceptedOfferId || await tx.paymentIntent.count({ where: { merchantId, sessionId, id: { not: snapshot.id },
      status: { in: ["pending", "requires_action", "approved", "refunded"] } } })
    || !await eligibleIntent(tx, merchantId, assignment.buyerId, recommendation.test.audience.intent, now)) throw new Error("INCENTIVE_PAYMENT_AUTHORITY_CHANGED");
  const rules = merchantRulesSnapshot(await tx.merchantRule.findUniqueOrThrow({ where: { merchantId } }));
  const current = await authoritativeCart(tx, session);
  if (!current || digest(await readIncentivePolicy(tx, merchantId)) !== digest(recommendation.financialPolicy)) throw new Error("INCENTIVE_PAYMENT_POLICY_CHANGED");
  const { commercialNudge: _nudge, ...base } = current;
  if (progressiveRecommendation(recommendation) && granted.stageIndex !== 0 && granted.stageIndex !== 1) throw new Error("INCENTIVE_PAYMENT_AUTHORITY_CHANGED");
  const assessment = assessExecutableIncentive({ ...base, currentDiscount: 0 }, rules, recommendation, checkout.shipping,
    granted.stageIndex === 0 ? 0 : 1);
  if (!assessment || assessment.amountCents !== granted.amountCents) throw new Error("INCENTIVE_PAYMENT_MARGIN_CHANGED");
  if (progressiveRecommendation(recommendation) && granted.stageIndex === 1
    && breakdown.confirmedCartFingerprint !== paymentReviewFingerprint(breakdown)) throw new Error("INCENTIVE_PROGRESSIVE_REVIEW_REQUIRED");
}

/** Same transaction as the durable provider status. Flags/expiry/withdrawal
 * cannot prevent settling an already-dispatched payment. Refunds retain spend
 * history; they never replenish experimental budget for a second redemption. */
export async function recordIncentivePayment(tx: Tx, snapshot: PaymentIntentSnapshot) {
  const { merchantId, sessionId } = snapshot;
  const assignment = await tx.strategyIncentiveAssignment.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } } });
  if (!assignment) return;
  await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
  const discountCents = snapshot.amountBreakdown?.discountCents ?? 0;
  const granted = await grantedIncentive(tx, assignment);
  await tx.strategyIncentivePaymentEvidence.createMany({ data: [{ id: randomUUID(), merchantId, assignmentId: assignment.id,
    paymentId: snapshot.id, paymentVersion: (snapshot.version ?? 0) + 1, status: snapshot.status,
    amountCents: snapshot.approvedAmountCents ?? snapshot.amountCents, discountCents, occurredAt: await clock(tx) }], skipDuplicates: true });
  if (!assignment.reservationId) return;
  const reservation = await tx.strategyIncentiveReservation.findUniqueOrThrow({ where: { id: assignment.reservationId } });
  if (reservation.status !== "reserved") return;
  if (["approved", "refunded"].includes(snapshot.status)) {
    if (!snapshot.providerPaymentId || snapshot.currency !== "BRL" || discountCents !== granted.amountCents
      || snapshot.approvedAmountCents !== snapshot.amountCents) throw new Error("INCENTIVE_PAYMENT_EVIDENCE_INVALID");
    await resolveIncentiveBudget(tx, { merchantId, reservationId: reservation.id, status: "spent", spentCents: granted.amountCents,
      evidenceKey: `payment:${snapshot.id}` });
  }
}
