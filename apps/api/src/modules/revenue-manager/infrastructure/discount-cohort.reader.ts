import type { Prisma } from "@prisma/client";
import type { Cart } from "@zyon/shared-types";
import { assessIncentiveMargin, moneyCents } from "@zyon/rules-engine";
import type { CohortStats } from "../domain/services/discount-rule-hypothesis.service.js";

const WINDOW_MS = 168 * 3_600_000;
const LIMIT = 10_000;
const record = (value: unknown): Record<string, any> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;

/** Read under a repeatable-read transaction. Personal identifiers never leave this reader. */
export async function loadDiscountCohorts(tx: Prisma.TransactionClient, merchantId: string, asOf: Date,
  lookbackDays: number): Promise<CohortStats[]> {
  const end = new Date(asOf.getTime() - WINDOW_MS);
  const start = new Date(end.getTime() - lookbackDays * 86_400_000);
  const sessions = await tx.checkoutSession.findMany({
    where: { merchantId, createdAt: { gte: start, lt: end }, globalUserId: { not: "" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: LIMIT + 1,
    select: { globalUserId: true, createdAt: true, cart: true,
      completedOrders: { where: { merchantId, status: "approved", currency: "BRL" }, select: { completedAt: true } } },
  });
  // A truncated sample must not silently be presented as the full cohort.
  if (sessions.length > LIMIT) return [];
  const firstByBuyer = new Map<string, typeof sessions[number]>();
  for (const session of sessions) if (session.globalUserId?.trim() && !firstByBuyer.has(session.globalUserId)) firstByBuyer.set(session.globalUserId, session);
  if (!firstByBuyer.size) return [];
  const intentRecords = await tx.customerIntentRecord.findMany({
    where: { merchantId, globalUserId: { in: [...firstByBuyer.keys()] }, generatedAt: { lt: end },
      consent: { is: { optedIn: true, expiresAt: { gt: asOf } } } },
    orderBy: [{ generatedAt: "desc" }, { id: "asc" }], take: LIMIT + 1,
    select: { globalUserId: true, primaryIntent: true, generatedAt: true },
  });
  if (intentRecords.length > LIMIT) return [];
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
  if (!variantIds.length) return [];
  const prices = await tx.productPrice.findMany({ where: { variantId: { in: variantIds }, currency: "BRL",
    costInCents: { not: null }, variant: { isActive: true, product: { merchantId, isActive: true, deletedAt: null } } },
    select: { variantId: true, basePriceInCents: true, costInCents: true } });
  const catalog = new Map(prices.map(price => [price.variantId, price]));
  const groups = new Map<string, { carts: Cart[]; converted: number }>();
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
    const group = groups.get(entry.intent) ?? { carts: [], converted: 0 };
    group.carts.push(cart);
    if (entry.session.completedOrders.some(order => order.completedAt >= entry.session.createdAt
      && order.completedAt.getTime() < entry.session.createdAt.getTime() + WINDOW_MS)) group.converted++;
    groups.set(entry.intent, group);
  }
  return [...groups].map(([intent, group]) => ({ intent, carts: group.carts, sampleSize: group.carts.length,
    conversionRate: group.converted / group.carts.length }));
}
