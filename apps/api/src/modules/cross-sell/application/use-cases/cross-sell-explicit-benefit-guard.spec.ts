import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import type { ProductEntity } from "../../../catalog/domain/entities/product.entity.js";
import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { CrossSellSuggestionRepository } from "../../domain/ports/cross-sell-suggestion-repository.port.js";
import type { CrossSellPromotionRepository } from "../../domain/ports/cross-sell-promotion-repository.port.js";
import { CrossSellSuggestionEntity } from "../../domain/entities/cross-sell-suggestion.entity.js";
import type { OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { AcceptCrossSellSuggestionUseCase } from "./accept-cross-sell-suggestion.use-case.js";
import { AcceptCrossSellFromWidgetUseCase } from "./accept-cross-sell-from-widget.use-case.js";

// Explicit narrow delegate fakes; no provider, database or payment authority.
const request = () => ({ suggestion_id: "suggestion", merchant_id: "merchant", session_id: "session", accepted_skus: ["SKU-Y"] });
const session = (): CheckoutSession => ({ merchantId: "merchant", sessionId: "session", conversationId: "conversation", globalUserId: "buyer",
  cart: { currency: "BRL", total: 100, items: [{ sku: "SKU-X", name: "Existing", price: 100, cost: 1, quantity: 1 }] },
  abandonmentScore: 0, triggerAgent: false, chatHistory: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() });
function fixture(discount: unknown) {
  const calls: string[] = [], initial = session(); let saved = structuredClone(initial);
  let suggestion = CrossSellSuggestionEntity.rehydrate({ id: "suggestion", merchant_id: "merchant", session_id: "session", promo_id: "promo",
    ranked_items: ["SKU-Y"], computed_discount: discount as never, agent_copy: "Fixture", status: "pending", suggested_at: new Date(0).toISOString(), resolved_at: null });
  const suggestions: CrossSellSuggestionRepository = {
    async findById(id, merchantId) { calls.push("suggestion-read"); return id === suggestion.id && merchantId === suggestion.merchant_id ? suggestion : null; },
    async save(value) { calls.push("suggestion-write"); suggestion = value; }, async findBySession() { assert.fail("unexpected-list"); },
  };
  const promotions: CrossSellPromotionRepository = { async findById() { calls.push("promotion-read"); return null; },
    async save() { assert.fail("promotion-write"); }, async findActiveByMerchant() { assert.fail("promotion-list"); }, async findAllByMerchant() { assert.fail("promotion-list"); } };
  const unexpectedOutbox = (): never => assert.fail("unexpected-outbox-dispatch");
  const outbox: OutboxRepository = {
    async appendOutbox(event) { calls.push("outbox-write"); return event; }, listOutbox() { return []; },
    listPending: unexpectedOutbox, markDelivered: unexpectedOutbox, markFailed: unexpectedOutbox,
    claimBatch: unexpectedOutbox, recordFailure: unexpectedOutbox, isProcessed: unexpectedOutbox,
    isHandlerProcessed: unexpectedOutbox, markHandlerProcessed: unexpectedOutbox,
  };
  const prisma = { checkoutEvent: { async findFirst() { calls.push("event-read"); return null; }, async create() { calls.push("event-write"); return {}; } } };
  const accept = new AcceptCrossSellSuggestionUseCase(suggestions, promotions, outbox, prisma as unknown as PrismaClient);
  const sessions = { getSession: async () => { calls.push("session-read"); return structuredClone(saved); },
    saveSession: async (value: CheckoutSession) => { calls.push("cart-write"); saved = structuredClone(value); },
    appendChatTurn: async (_merchantId: string, _sessionId: string, turn: CheckoutSession["chatHistory"][number]) => {
      calls.push("chat-write"); saved.chatHistory.push(turn); return structuredClone(saved);
    },
  } satisfies Pick<CheckoutSessionRepository, "getSession" | "saveSession" | "appendChatTurn">;
  const merchants = { getRules: async () => { calls.push("rules"); return { ...DEFAULT_MERCHANT_RULES, maxDiscountPercent: 100, minimumMarginPercent: 0 }; },
    getProfile: async () => { calls.push("profile"); return { id: "merchant", name: "Fixture" }; },
  } satisfies Pick<MerchantRepository, "getRules" | "getProfile">;
  const product = { id: "product", name: "Complement", isActive: true, type: "physical", variants: [
    { id: "variant", sku: "SKU-Y", isActive: true, basePriceInCents: 10000, costInCents: 100, stockQuantity: 100, stockReserved: 0, media: [] },
  ] };
  const catalog = { async findById() { calls.push("catalog"); return product as unknown as ProductEntity; } } satisfies Pick<ProductRepositoryPort, "findById">;
  const widget = new AcceptCrossSellFromWidgetUseCase(accept, sessions as unknown as CheckoutSessionRepository,
    merchants as unknown as MerchantRepository, catalog as unknown as ProductRepositoryPort);
  return { calls, accept, widget, saved: () => structuredClone(saved), status: () => suggestion.status, initial };
}
const review = (error: unknown) => {
  if (error === null || typeof error !== "object" || !("getStatus" in error) || !("getResponse" in error)) return false;
  const http = error as { getStatus(): number; getResponse(): unknown };
  const body = http.getResponse(); return http.getStatus() === 422 && body !== null && typeof body === "object"
    && "code" in body && body.code === "cross_sell_quote_review_required";
};
const noEffects = (f: ReturnType<typeof fixture>) => {
  assert.ok(!f.calls.some(call => ["rules", "catalog", "profile", "promotion-read", "suggestion-write", "outbox-write", "event-read", "event-write", "cart-write", "chat-write"].includes(call)), f.calls.join(","));
  assert.equal(f.status(), "pending"); assert.deepEqual(f.saved(), f.initial);
};
for (const discount of [10, .125, 100, -1, NaN, undefined, null, "10"]) for (const mode of ["direct", "widget"] as const) {
  test(`${mode} explicit or malformed benefit ${String(discount)} requires review before policy/default/cart/outbox IO`, async () => {
    const f = fixture(discount);
    await assert.rejects(mode === "widget" ? f.widget.execute(request()) : f.accept.execute({ ...request(), cart: f.initial.cart,
      merchantRules: { ...DEFAULT_MERCHANT_RULES, maxDiscountPercent: 100, minimumMarginPercent: 0 } }), review);
    noEffects(f);
  });
}
test("positive benefit without caller cart/policy cannot use promotion-cap-only fallback", async () => {
  const f = fixture(10); await assert.rejects(f.accept.execute(request()), review); noEffects(f);
});
test("zero-benefit direct recommendation remains accepted without a financial grant", async () => {
  const f = fixture(0), result = await f.accept.execute(request());
  assert.equal(result.status, "accepted"); assert.equal(result.computed_discount, 0); assert.equal(f.saved().cart.currentDiscount, undefined);
  assert.equal(f.calls.filter(call => call === "suggestion-write").length, 1); assert.equal(f.calls.filter(call => call === "outbox-write").length, 1);
});
test("zero-benefit widget recommendation adds base item without creating a discount", async () => {
  const f = fixture(0), result = await f.widget.execute(request());
  assert.equal(result.suggestion.status, "accepted"); assert.equal(result.suggestion.computed_discount, 0);
  assert.equal(f.saved().cart.items.length, 2); assert.equal(f.saved().cart.total, 200); assert.equal(f.saved().cart.currentDiscount, undefined);
  assert.equal(f.calls.filter(call => call === "cart-write").length, 1); assert.equal(f.calls.filter(call => call === "outbox-write").length, 1);
});
for (const mode of ["direct", "widget"] as const) test(`${mode} unknown suggestion keeps not-found semantics without writes or provisioning`, async () => {
  const f = fixture(10); await assert.rejects(mode === "widget" ? f.widget.execute({ ...request(), suggestion_id: "missing" })
    : f.accept.execute({ ...request(), suggestion_id: "missing" }), /cross_sell_suggestion_not_found/); noEffects(f);
});

