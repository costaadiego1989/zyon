import assert from "node:assert/strict";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ProductPromotionCandidate } from "../../../catalog/domain/services/best-product-promotion.service.js";
import type { OwnDeliveryConfig } from "../../../shipping/domain/ports/own-delivery-config.port.js";
import { PrismaWidgetCrossSellCheckoutAdapter } from "./prisma-widget-cross-sell-checkout.adapter.js";
import { PrismaWidgetCheckoutProviderShippingRepository } from "./prisma-widget-checkout-provider-shipping.repository.js";
import { readAcceptedWidgetCheckoutInTransaction } from "./widget-checkout-accepted-reader.js";

// Real canonical acceptance/read/revision functions over serialized delegates.
// This is NOT PostgreSQL lock, rollback, bridge or provider evidence.
export const scope = { merchantId: "merchant", sessionId: "checkout" };
export const request = { suggestionId: "suggestion", variantId: "target", quantity: 1 };
export const at = new Date("2026-10-20T12:00:00.000Z");
export const address = { zip: "01310100", street: "Synthetic Street", number: "10", complement: "",
  neighborhood: "Synthetic District", city: "Synthetic City", state: "SP" };
function catalogRow(id: string, sku: string, price: number) {
  return { id, sku, isActive: true, product: { id: id + "-product", merchantId: "merchant", name: "Product " + id, type: "physical",
    isActive: true, deletedAt: null, metadata: {}, categoryId: null },
    price: { variantId: id, basePriceInCents: price, currency: "BRL" }, stock: [{ quantity: 100, reserved: 0 }],
    weightGrams: null as number | null, heightCm: null as number | null, widthCm: null as number | null, lengthCm: null as number | null,
    media: [] as Array<{ url: string }> };
}
export function providerShippingFixture() {
  let state = { session: { id: "row", ...scope, version: 4, strategyContextVersion: 2, shipping: null as unknown,
    shippingOptions: null as unknown, globalUserId: "buyer", customer: null as Record<string, unknown> | null,
    cart: { currency: "BRL", total: 100, items: [{ sku: "TRIGGER", name: "Original", price: 100, quantity: 1 }] } as Record<string, unknown> },
    suggestion: { id: "suggestion", ...scope, promoId: "promo", status: "pending", rankedItems: ["TARGET"] },
    outbox: [] as unknown[], events: [] as unknown[] };
  const calls: string[] = [];
  const payments: Array<Record<string, unknown>> = [];
  const rows = [catalogRow("trigger", "TRIGGER", 10000), catalogRow("target", "TARGET", 2000)];
  const promotion = { id: "promo", merchantId: "merchant", updatedAt: new Date("2026-10-20T00:00:00.000Z"), status: "active",
    startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: null as Date | null, recommendedSkus: ["TARGET"],
    discountPercent: new Prisma.Decimal(10), maxDiscountPercent: new Prisma.Decimal(100), trigger: { sku_in_cart: ["TRIGGER"] } };
  const faults = { payment: false, order: false, chat: false, coupon: false, assignment: false, reservation: false,
    abandoned: false, checkoutCas: false, suggestionCas: false, outbox: false, event: false, clock: false, commitUnknown: false,
    postWriteVersion:false };
  const ceiling = { value: 20 };
  const productPromotions: ProductPromotionCandidate[] = [];
  const clock = { value: at };
  const shippingRules = { allowFreeShipping: false, allowStackDiscountAndFreeShipping: false,
    freeShippingMinCartValue: 0, maxShippingSubsidy: 0, blockedRegions: [] as string[] };
  const origin = { value: { merchantId: scope.merchantId, originZip: "01001000" as string | null } };
  const manual = { value: { id: "manual", merchantId: "merchant", enabled: true, mode: "radius", flatPriceCents: null,
    freeAboveCents: 10000, neighborhoods: null, radiusZones: [{ maxKm: 10, priceCents: 900 }, { maxKm: null, priceCents: 1500 }], estimatedValue: 60, estimatedUnit: "minutes", createdAt: at, updatedAt: at } as (OwnDeliveryConfig & { createdAt: Date; updatedAt: Date }) | null };
  let serialization = Promise.resolve();
  const prisma = { async $transaction<T>(work: (tx: unknown) => Promise<T>, config: unknown): Promise<T> {
    calls.push("transaction"); assert.deepEqual(config, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 15000 });
    const previous = serialization; let release!: () => void;
    serialization = new Promise<void>(resolve => { release = resolve; }); await previous;
    const draft = structuredClone(state);
    let wroteCheckout=false;
    const tx = {
      async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
        const sql = parts.join("?").replace(/\s+/g, " ").trim(); calls.push(sql);
        if (sql.includes("clock_timestamp")) { if (faults.clock) throw new Error("clock_failure"); return [{ now: clock.value }]; }
        if (sql.includes("FROM merchants")) return [{ id: "merchant" }];
        assert.ok(values.includes("merchant") || sql.includes("pg_advisory_xact_lock"), sql);
        return [];
      },
      checkoutSession: {
        async findUnique(args?: { select?: Record<string, boolean> }) {
          calls.push("session-read"); const row = structuredClone(draft.session);
          if(faults.postWriteVersion&&wroteCheckout)row.version++;
          return args?.select ? Object.fromEntries(Object.entries(args.select).filter(([, included]) => included)
            .map(([key]) => [key, (row as Record<string, unknown>)[key]])) : row;
        },
        async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
          calls.push("cart-write"); assert.deepEqual(args.where, { id: "row", ...scope, version: draft.session.version });
          if (faults.checkoutCas) return { count: 0 };
          wroteCheckout=true;
          draft.session.cart = structuredClone(args.data.cart as Record<string, unknown>); draft.session.version++;
          assert.equal(Object.hasOwn(args.data,"version"),false,"CHECKOUT_SESSION_VERSION_READ_ONLY");
          assert.equal(Object.hasOwn(args.data,"strategyContextVersion"),false,"STRATEGY_CONTEXT_VERSION_DB_OWNED");
          if (args.data.shipping === Prisma.DbNull) draft.session.shipping = null;
          else if (args.data.shipping !== undefined) draft.session.shipping = structuredClone(args.data.shipping);
          if (args.data.shippingOptions === Prisma.DbNull) draft.session.shippingOptions = null;
          else if (args.data.shippingOptions !== undefined) draft.session.shippingOptions = structuredClone(args.data.shippingOptions);
          if (args.data.customer !== undefined) draft.session.customer = structuredClone(args.data.customer as Record<string, unknown>);
          if (args.data.globalUserId !== undefined) draft.session.globalUserId = String(args.data.globalUserId);
          return { count: 1 };
        },
      },
      crossSellSuggestion: {
        async findFirst() {
          calls.push("suggestion-read");
          const result = structuredClone(draft.suggestion) as typeof draft.suggestion & { computedDiscount?: number };
          return { ...result, ...(result.computedDiscount === undefined ? {} : { computedDiscount: new Prisma.Decimal(result.computedDiscount) }) };
        },
        async updateMany(args: { where: Record<string, unknown>; data: { status: string; rankedItems: string[]; resolvedAt: Date } }) {
          calls.push("suggestion-write"); assert.deepEqual(args.where, { id: "suggestion", ...scope, promoId: "promo", status: "pending" });
          if (faults.suggestionCas) return { count: 0 };
          Object.assign(draft.suggestion, args.data); return { count: 1 };
        },
      },
      paymentIntent: { async findFirst(args?: { where?: { id?: string | { not: string } } }) {
        calls.push("payment-read");
        const id = args?.where?.id;
        if (typeof id === "string") return structuredClone(payments.find(row => row.id === id) ?? null);
        const matching = payments.find(row => typeof id !== "object" || row.id !== id.not);
        return faults.payment ? { id: "payment" } : structuredClone(matching ?? null);
      } },
      completedOrder: { async findFirst() { return faults.order ? { id: "order" } : null; } },
      checkoutChatRequest: { async findFirst() { return faults.chat ? { id: "chat" } : null; } },
      couponRedemption: { async findFirst() { return faults.coupon ? { id: "coupon" } : null; } },
      strategyAssignment: { async findUnique() { return faults.assignment ? { id: "assignment" } : null; } },
      strategyIncentiveReservation: { async findFirst() { return faults.reservation ? { id: "reservation" } : null; } },
      merchantRule: { async findUnique() { return { maxDiscountPercent: new Prisma.Decimal(ceiling.value), ...shippingRules,
        freeShippingMinCartValue: new Prisma.Decimal(shippingRules.freeShippingMinCartValue),
        maxShippingSubsidy: new Prisma.Decimal(shippingRules.maxShippingSubsidy), ...origin.value }; } },
      ownDeliveryConfig: { async findUnique(args: { where: { merchantId: string } }) {
        calls.push("manual-config-read"); assert.deepEqual(args.where, { merchantId: scope.merchantId }); return structuredClone(manual.value);
      } },
      checkoutSetting: { async findUnique() { return { merchantId: "merchant", advancedRules: [] }; } },
      crossSellPromotion: { async findFirst() { return promotion; } },
      productPromotion: { async findMany() { return productPromotions; } },
      productVariant: { async findMany(args: { where: { sku?: string | { in: string[] } } }) {
        calls.push("catalog-read"); const skus = args.where.sku;
        return typeof skus === "string" ? rows.filter(row => row.sku === skus) : skus ? rows.filter(row => skus.in.includes(row.sku)) : rows;
      } },
      checkoutEvent: {
        async findMany(args: { where: { merchantId: string; sessionId: string; eventName: string; metadata: { path: string[]; equals: string } }; take: number }) {
          calls.push("history-event-read"); assert.equal(args.where.merchantId, scope.merchantId); assert.equal(args.where.sessionId, scope.sessionId);
          return structuredClone(draft.events.filter(raw => {
            const event = raw as { merchantId: string; sessionId: string; eventName: string; metadata: Record<string, unknown> };
            return event.merchantId === args.where.merchantId && event.sessionId === args.where.sessionId
              && event.eventName === args.where.eventName && event.metadata[args.where.metadata.path[0]!] === args.where.metadata.equals;
          }).slice(0, args.take));
        },
        async findFirst(args?: { where: { eventName?: string; id?: string } }) {
          if (args?.where.eventName === "cross_sell_accepted") return structuredClone(draft.events[0] ?? null);
          if (["cross_sell_checkout_customer_updated", "cross_sell_checkout_address_updated", "cross_sell_checkout_email_verified", "cross_sell_checkout_email_otp_issued", "cross_sell_checkout_manual_shipping_quoted", "cross_sell_checkout_manual_shipping_selected", "cross_sell_checkout_provider_shipping_begun", "cross_sell_checkout_provider_shipping_completed", "cross_sell_checkout_provider_shipping_unknown"].includes(args?.where.eventName ?? ""))
            return structuredClone(draft.events.find(event => (event as { id?: string }).id === args?.where.id) ?? null);
          return faults.abandoned ? { id: "closed" } : null;
        },
        async create(args: { data: unknown }) { calls.push("event-write"); if (faults.event) throw new Error("event_failure"); draft.events.push(args.data); },
      },
      outboxMessage: {
        async findFirst(args: { where: { merchantId: string; eventId: string } }) {
          assert.equal(args.where.merchantId, scope.merchantId); assert.ok(args.where.eventId);
          return structuredClone(draft.outbox.find(row => (row as { eventId?: string }).eventId === args.where.eventId) ?? null);
        },
        async create(args: { data: unknown }) { calls.push("outbox-write"); if (faults.outbox) throw new Error("outbox_failure"); draft.outbox.push(args.data); },
        async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
          calls.push("outbox-write"); if (faults.outbox) throw new Error("outbox_failure");
          const matches = draft.outbox.filter(row => Object.entries(args.where).every(([key, value]) => (row as Record<string, unknown>)[key] === value));
          for (const row of matches) Object.assign(row as object, args.data); return { count: matches.length };
        },
      },
    };
    try {
      const result = await work(tx); state = draft;
      if (faults.commitUnknown) throw new Error("commit_outcome_unknown");
      return result;
    } finally { release(); }
  } };
  const adapter = new PrismaWidgetCrossSellCheckoutAdapter(prisma as unknown as PrismaClient);
  return { adapter, repository: new PrismaWidgetCheckoutProviderShippingRepository(prisma as unknown as PrismaClient), origin, state: () => structuredClone(state), mutate: (work: (value: typeof state) => void) => work(state), rows, calls, faults, promotion, ceiling, productPromotions, manual, clock, shippingRules,
    payments, readPaymentCheckout: (options?: { ownPaymentIntentId?: string }) => prisma.$transaction(
      tx => readAcceptedWidgetCheckoutInTransaction(tx as Prisma.TransactionClient, scope, options),
      { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 15000 }) };
}

