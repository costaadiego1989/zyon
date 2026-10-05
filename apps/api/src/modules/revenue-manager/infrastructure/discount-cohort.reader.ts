import type { Prisma } from "@prisma/client";
import type { Cart, MerchantRules, ShippingQuote } from "@zyon/shared-types";
import { assessIncentiveMargin, moneyCents } from "@zyon/rules-engine";
import { assessExecutableIncentive } from "../domain/executable-incentive.js";
import type { CohortStats } from "../domain/services/discount-rule-hypothesis.service.js";
import type { IncentivePlanningBaseline } from "../domain/incentive-measurement.js";
import type { StrategyIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";

const WINDOW_MS = 168 * 3_600_000;
const LIMIT = 10_000;
const record = (value: unknown): Record<string, any> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;

type DiscountHistory = { complete: boolean; buyers: Array<{ intent: string; cart: Cart; shipping?: ShippingQuote; converted: boolean; cohort: string | null }> };

/** Read under a repeatable-read transaction. Personal identifiers never leave this reader. */
export async function loadDiscountHistory(tx: Prisma.TransactionClient, merchantId: string, asOf: Date,
  lookbackDays: number): Promise<DiscountHistory> {
  const end = new Date(asOf.getTime() - WINDOW_MS);
  const start = new Date(end.getTime() - lookbackDays * 86_400_000);
  const sessions = await tx.checkoutSession.findMany({
    where: { merchantId, createdAt: { gte: start, lt: end }, globalUserId: { not: "" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: LIMIT + 1,
    select: { globalUserId: true, createdAt: true, cart: true, cohort: true, shipping: true,
      completedOrders: { where: { merchantId, status: "approved", currency: "BRL" }, select: { completedAt: true } } },
  });
  // A truncated sample must not silently be presented as the full cohort.
  if (sessions.length > LIMIT) return { complete: false, buyers: [] };
  const firstByBuyer = new Map<string, typeof sessions[number]>();
  for (const session of sessions) if (session.globalUserId?.trim() && !firstByBuyer.has(session.globalUserId)) firstByBuyer.set(session.globalUserId, session);
  if (!firstByBuyer.size) return { complete: true, buyers: [] };
  const intentRecords = await tx.customerIntentRecord.findMany({
    where: { merchantId, globalUserId: { in: [...firstByBuyer.keys()] }, generatedAt: { lt: end },
      consent: { is: { optedIn: true, expiresAt: { gt: asOf } } } },
    orderBy: [{ generatedAt: "desc" }, { id: "asc" }], take: LIMIT + 1,
    select: { globalUserId: true, primaryIntent: true, generatedAt: true },
  });
  if (intentRecords.length > LIMIT) return { complete: false, buyers: [] };
  const intents = new Map<string, string>();
  for (const intent of intentRecords) {
    const session = firstByBuyer.get(intent.globalUserId);
    if (session && intent.generatedAt <= session.createdAt && !intents.has(intent.globalUserId)) intents.set(intent.globalUserId, intent.primaryIntent);
  }
  const eligible = [...firstByBuyer.values()].flatMap(session => {
    const intent = intents.get(session.globalUserId), cart = record(session.cart);
    if (!intent || !cart || cart.currency !== "BRL" || !Array.isArray(cart.items) || !cart.items.length
      || (cart.currentDiscount ?? 0) !== 0 || cart.commercialNudge || cart.crossStoreItems?.length) return [];
    if (cart.items.some((item: unknown) => {
      const value = record(item);
      return !value || typeof value.variantId !== "string" || !value.variantId.trim()
        || !Number.isSafeInteger(value.quantity) || value.quantity <= 0 || value.quantity > 99
        || (value.selected_options !== undefined && (!Array.isArray(value.selected_options) || value.selected_options.length > 0));
    })) return [];
    return [{ session, intent, items: cart.items as Array<Record<string, any>> }];
  });
  const variantIds = [...new Set(eligible.flatMap(s => s.items.map(i => i.variantId as string)))];
  if (!variantIds.length) return { complete: true, buyers: [] };
  const prices = await tx.productPrice.findMany({ where: { variantId: { in: variantIds }, currency: "BRL",
    costInCents: { not: null }, variant: { isActive: true, product: { merchantId, isActive: true, deletedAt: null } } },
    select: { variantId: true, basePriceInCents: true, costInCents: true } });
  const catalog = new Map(prices.map(price => [price.variantId, price]));
  const buyers: DiscountHistory["buyers"] = [];
  for (const entry of eligible) {
    let totalCents = 0;
    const items: Cart["items"] = [];
    for (const item of entry.items) {
      const price = catalog.get(item.variantId);
      if (!price || price.costInCents === null || !Number.isSafeInteger(price.costInCents) || price.costInCents < 0
        || !Number.isSafeInteger(price.basePriceInCents) || price.basePriceInCents <= 0) break;
      totalCents += price.basePriceInCents * item.quantity;
      items.push({ sku: item.variantId, variantId: item.variantId, name: "Produto", quantity: item.quantity,
        price: price.basePriceInCents / 100, cost: price.costInCents / 100 });
    }
    if (items.length !== entry.items.length || !Number.isSafeInteger(totalCents)) continue;
    const cart: Cart = { currency: "BRL", total: totalCents / 100, items };
    if (moneyCents(cart.total) === null || assessIncentiveMargin(cart, { totalDiscount: 0 }).status !== "estimated") continue;
    const quote = record(entry.session.shipping);
    const shipping = quote && moneyCents(quote.customerPrice) !== null && moneyCents(quote.realCost) !== null
      ? { customerPrice: quote.customerPrice as number, realCost: quote.realCost as number,
        ...(typeof quote.region === "string" ? { region: quote.region } : {}) } : undefined;
    buyers.push({ intent: entry.intent, cart, shipping, cohort: entry.session.cohort,
      converted: entry.session.completedOrders.some(order => order.completedAt >= entry.session.createdAt
        && order.completedAt.getTime() < entry.session.createdAt.getTime() + WINDOW_MS) });
  }
  return { complete: true, buyers };
}

export function discountCohorts(history: DiscountHistory): CohortStats[] {
  const groups = new Map<string, { carts: Cart[]; shipping: Array<ShippingQuote | undefined>; converted: number }>();
  for (const buyer of history.buyers) {
    const group = groups.get(buyer.intent) ?? { carts: [], shipping: [], converted: 0 };
    group.carts.push(buyer.cart);
    group.shipping.push(buyer.shipping);
    if (buyer.converted) group.converted++;
    groups.set(buyer.intent, group);
  }
  return [...groups].map(([intent, group]) => ({ intent, carts: group.carts, sampleSize: group.carts.length,
    shipping: group.shipping, conversionRate: group.converted / group.carts.length }));
}

export async function loadDiscountCohorts(tx: Prisma.TransactionClient, merchantId: string, asOf: Date,
  lookbackDays: number): Promise<CohortStats[]> {
  return discountCohorts(await loadDiscountHistory(tx, merchantId, asOf, lookbackDays));
}

/** Same database snapshot as the study, restricted to the proposed incentive's
 * audience. All eligible non-buyers remain in the denominator; holdout does not. */
export function incentivePlanningBaseline(history: DiscountHistory, asOf: Date,
  recommendation: StrategyIncentiveRecommendation, rules: MerchantRules): IncentivePlanningBaseline | undefined {
  if (recommendation.status !== "recommended") return undefined;
  const t = recommendation.test;
  const buyers = history.complete ? history.buyers.filter(buyer => {
    const cents = moneyCents(buyer.cart.total);
    return buyer.cohort === "treatment" && buyer.intent === t.audience.intent && cents !== null
      && cents >= t.audience.minCartTotalCents && cents <= t.audience.maxCartTotalCents
      && !!assessExecutableIncentive(buyer.cart, rules, recommendation, buyer.shipping);
  }) : [];
  const windowEnd = new Date(asOf.getTime() - WINDOW_MS);
  return { buyers: buyers.length, conversions: buyers.filter(b => b.converted).length, complete: history.complete,
    windowEnd: windowEnd.toISOString(), windowStart: new Date(windowEnd.getTime() - 28 * 86_400_000).toISOString() };
}
