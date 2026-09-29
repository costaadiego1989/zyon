import { randomUUID } from "node:crypto";
import type { CheckoutSession, Prisma } from "@prisma/client";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import { assessIncentiveMargin, evaluateDiscountOffer, moneyCents } from "@zyon/rules-engine";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import type { StrategyProposal } from "../domain/strategy-proposal.js";
import type { StrategyIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";
import { recommendedIncentiveBudgetTerms } from "../domain/incentive-budget.js";
import { lockCheckoutBaselineRows } from "./checkout-baseline.reader.js";
import { merchantRulesSnapshot } from "./hypothesis-merchant-context.adapter.js";
import { readIncentivePolicy } from "./incentive-policy.reader.js";
import { registerReviewedIncentiveBudget, reserveIncentiveBudget, resolveIncentiveBudget } from "./incentive-budget-ledger.js";
import { assertStoredDiscountStudy } from "./strategy-discount-study.js";
import { toCheckoutSession } from "../../checkout/infrastructure/prisma/checkout-session.mapper.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import type { PaymentIntentSnapshot } from "../../payment/domain/payment-intent.entity.js";
import { assertPaymentAmount, paymentReviewFingerprint } from "../../payment/domain/payment-amount.js";

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const clock = async (tx: Tx) => (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now;
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
  return tx.strategyIncentiveExecution.create({ data: { id: randomUUID(), merchantId, strategyId,
    version: version.version, reviewId: review.id, budgetId: budget.id,
    recommendation: json(proposal.incentiveRecommendation), recommendationHash: digest(proposal.incentiveRecommendation),
    startedAt: budget.startsAt, endsAt: budget.endsAt, createdAt: now } });
}

export function incentiveAssignmentArm(executionId: string, buyerId: string): "control" | "treatment" {
  return parseInt(digest(["incentive-assignment-v1", executionId, buyerId]).slice(0, 8), 16) % 2 ? "treatment" : "control";
}

/** Bind economic product identities while allowing later contact/shipping selection. */
export function incentiveCartHash(cart: Cart): string {
  return digest({ currency: cart.currency, total: cart.total, items: cart.items.map(item => ({ variantId: item.variantId,
    sku: item.sku, price: item.price, quantity: item.quantity, selected_options: item.selected_options ?? [] })) });
}

export function assessExecutableIncentive(cart: Cart, rules: MerchantRules, recommendation: StrategyIncentiveRecommendation) {
  if (recommendation.status !== "recommended" || cart.currency !== "BRL" || !Array.isArray(cart.items) || !cart.items.length
    || cart.items.length > 100 || cart.commercialNudge || (cart.currentDiscount ?? 0) !== 0) return null;
  const total = moneyCents(cart.total), test = recommendation.test;
  if (total === null || total < test.audience.minCartTotalCents || total > test.audience.maxCartTotalCents
    || rules.autonomousEngineEnabled !== true || test.discountPercent > rules.maxDiscountPercent
    || rules.minimumMarginPercent !== test.minimumMarginPercent) return null;
  const offer = evaluateDiscountOffer(cart, rules, test.discountPercent, test.maxDiscountCents / 100);
  if (!offer.approved) return null;
  const amountCents = Math.min(test.maxDiscountCents, Math.floor(Number((total * test.discountPercent / 100).toFixed(6))));
  const margin = assessIncentiveMargin(cart, { totalDiscount: amountCents / 100 });
  return margin.status === "estimated" && margin.productCostCents !== null && amountCents > 0
    ? { amountCents, costCents: margin.productCostCents } : null;
}

/** Locked, current catalog is the only price/cost authority. Unknown/customized
 * baskets and subsidized shipping are ineligible for this first runtime. */
async function authoritativeCart(tx: Tx, session: CheckoutSession): Promise<Cart | null> {
  const snapshot = toCheckoutSession(session), cart = snapshot.cart;
  if (!cart || cart.currency !== "BRL" || !Array.isArray(cart.items) || !cart.items.length || cart.items.length > 100
    || snapshot.crossStoreItems?.length || (cart as Cart & { crossStoreItems?: unknown[] }).crossStoreItems?.length
    || (snapshot.shipping && (moneyCents(snapshot.shipping.realCost) === null
      || snapshot.shipping.customerPrice < snapshot.shipping.realCost!))) return null;
  if (cart.items.some(item => !item.variantId || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99
    || (item.selected_options !== undefined && (!Array.isArray(item.selected_options) || item.selected_options.length)))) return null;
  const ids = cart.items.map(item => item.variantId!);
  // Price/variant/product writers cannot invalidate costs between assessment and commit.
  await tx.$queryRaw`SELECT p.id FROM product_prices p JOIN product_variants v ON v.id = p.variant_id
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
  if (!await eligibleIntent(tx, merchantId, session.globalUserId, recommendation.test.audience.intent, now)) return session;
  await lockCheckoutBaselineRows(tx, merchantId);
  const rules = merchantRulesSnapshot(await tx.merchantRule.findUniqueOrThrow({ where: { merchantId } }));
  const version = await tx.revenueStrategyVersion.findUniqueOrThrow({ where: { strategyId_merchantId_version: {
    strategyId: execution.strategyId, merchantId, version: execution.version } }, include: { strategy: true } });
  const proposal = version.proposal as unknown as StrategyProposal;
  if (version.strategy.currentVersion !== execution.version || digest(rules) !== digest(proposal.rules)
    || digest(await readIncentivePolicy(tx, merchantId)) !== digest(recommendation.financialPolicy)) return session;
  await assertStoredDiscountStudy(tx, merchantId, version.strategy.runId, proposal.observation.id, rules, proposal.discountStudy, recommendation);
  const cart = await authoritativeCart(tx, session);
  const assessment = cart && assessExecutableIncentive(cart, rules, recommendation);
  if (!cart || !assessment) return session;
  const arm = incentiveAssignmentArm(execution.id, session.globalUserId);
  const id = randomUUID();
  const reservation = arm === "treatment" ? await reserveIncentiveBudget(tx, { merchantId, budgetId: budget.id,
    sessionId: session.sessionId, buyerId: session.globalUserId, requestKey: `assignment:${id}`, amountCents: assessment.amountCents }) : null;
  await tx.strategyIncentiveAssignment.create({ data: { id, merchantId, executionId: execution.id, sessionId: session.sessionId,
    buyerId: session.globalUserId, arm, assignedAt: now, cartHash: incentiveCartHash(cart),
    amountCents: arm === "treatment" ? assessment.amountCents : 0, costCents: assessment.costCents, reservationId: reservation?.id } });
  if (arm === "control") return session;
  const discounted = { ...cart, currentDiscount: assessment.amountCents / 100, commercialNudge: {
    kind: "coupon", ruleId: id, title: "Desconto aplicado", message: "Um desconto foi aplicado a este pedido.",
    badge: `−${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(assessment.amountCents / 100)}` } };
  return tx.checkoutSession.update({ where: { id: session.id }, data: { cart: json(discounted),
    updatedAt: now } });
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
  if (moneyCents(checkout.cart.currentDiscount ?? 0) !== assignment.amountCents
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
  const now = await clock(tx);
  if (!incentiveExecutionEnabled(merchantId) || budget.closedAt || now >= execution.endsAt || reservation.status !== "reserved"
    || recommendation.status !== "recommended" || digest(recommendation) !== execution.recommendationHash
    || session.globalUserId !== assignment.buyerId || session.cohort !== "treatment"
    || incentiveCartHash(checkout.cart) !== assignment.cartHash || breakdown.discountCents !== assignment.amountCents
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
  const assessment = assessExecutableIncentive({ ...base, currentDiscount: 0 }, rules, recommendation);
  if (!assessment || assessment.amountCents !== assignment.amountCents) throw new Error("INCENTIVE_PAYMENT_MARGIN_CHANGED");
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
  await tx.strategyIncentivePaymentEvidence.createMany({ data: [{ id: randomUUID(), merchantId, assignmentId: assignment.id,
    paymentId: snapshot.id, paymentVersion: (snapshot.version ?? 0) + 1, status: snapshot.status,
    amountCents: snapshot.approvedAmountCents ?? snapshot.amountCents, discountCents, occurredAt: await clock(tx) }], skipDuplicates: true });
  if (!assignment.reservationId) return;
  const reservation = await tx.strategyIncentiveReservation.findUniqueOrThrow({ where: { id: assignment.reservationId } });
  if (reservation.status !== "reserved") return;
  if (["approved", "refunded"].includes(snapshot.status)) {
    if (!snapshot.providerPaymentId || snapshot.currency !== "BRL" || discountCents !== assignment.amountCents
      || snapshot.approvedAmountCents !== snapshot.amountCents) throw new Error("INCENTIVE_PAYMENT_EVIDENCE_INVALID");
    await resolveIncentiveBudget(tx, { merchantId, reservationId: reservation.id, status: "spent", spentCents: assignment.amountCents,
      evidenceKey: `payment:${snapshot.id}` });
  }
}
