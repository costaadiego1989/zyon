import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import type { CartItem, CheckoutSession } from "@zyon/shared-types";
import { AcpLineItemsResolver } from "./acp-line-items.resolver.js";
import type { CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import type { ProductVariantLookupPort } from "../../checkout/domain/ports/product-variant-lookup.port.js";
import type { UpdateCartUseCase } from "../../checkout/application/use-cases/update-cart.use-case.js";

const NOW = "2026-09-03T12:00:00.000Z";

function buildSession(): CheckoutSession {
  return {
    merchantId: "mrc_test",
    sessionId: "chk_test",
    globalUserId: "g_test",
    conversationId: "conv_test",
    cart: {
      currency: "BRL",
      total: 200,
      items: [{ sku: "sku_1", name: "P1", price: 100, quantity: 2 }],
    },
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createSessionRepo(): CheckoutSessionRepository & {
  saved: CheckoutSession[];
} {
  const saved: CheckoutSession[] = [];
  return {
    saved,
    async saveSession(s) {
      saved.push(s);
    },
    async getSession() {
      return undefined;
    },
    async findSessionsByEmail() {
      return [];
    },
    async appendChatTurn(_m, _s, t) {
      return t as unknown as CheckoutSession;
    },
    async recordEvent() {},
    async findSessionsWithTrigger() {
      return [];
    },
    async getSessionEvents() {
      return [];
    },
  };
}

function createVariantLookup(
  variants: Map<string, { name?: string; price?: number }>,
): ProductVariantLookupPort {
  return {
    async findBySku(_m, sku) {
      return variants.get(sku);
    },
  };
}

function createUpdateCartSpy(calls: unknown[]): UpdateCartUseCase {
  return {
    async execute(input: unknown) {
      calls.push(input);
      return { session_id: "chk_test", experience: undefined };
    },
  } as unknown as UpdateCartUseCase;
}

test("line-items: when every SKU is existing, delegates to UpdateCartUseCase", async () => {
  const calls: unknown[] = [];
  const repo = createSessionRepo();
  const resolver = new AcpLineItemsResolver(
    createUpdateCartSpy(calls),
    repo,
    createVariantLookup(new Map()),
  );
  await resolver.resolveAndApply("mrc_test", buildSession(), [
    { id: "sku_1", quantity: 3 },
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as { items: CartItem[] }).items, [
    { sku: "sku_1", quantity: 3 },
  ]);
  assert.equal(repo.saved.length, 0);
});

test("line-items: new SKU is resolved via variant lookup and merged", async () => {
  const repo = createSessionRepo();
  const calls: unknown[] = [];
  const lookup = createVariantLookup(
    new Map([["sku_new", { name: "NewProduct", price: 50 }]]),
  );
  const resolver = new AcpLineItemsResolver(
    createUpdateCartSpy(calls),
    repo,
    lookup,
  );
  await resolver.resolveAndApply("mrc_test", buildSession(), [
    { id: "sku_1", quantity: 2 },
    { id: "sku_new", quantity: 1 },
  ]);
  assert.equal(calls.length, 0);
  assert.equal(repo.saved.length, 1);
  const merged = repo.saved[0].cart.items;
  assert.equal(merged.length, 2);
  const newItem = merged.find((i) => i.sku === "sku_new");
  assert.ok(newItem);
  assert.equal(newItem.name, "NewProduct");
  assert.equal(newItem.price, 50);
  assert.equal(repo.saved[0].cart.total, 250);
});

test("line-items: existing SKU with quantity 0 is removed via UpdateCartUseCase", async () => {
  const calls: unknown[] = [];
  const repo = createSessionRepo();
  const resolver = new AcpLineItemsResolver(
    createUpdateCartSpy(calls),
    repo,
    createVariantLookup(new Map()),
  );
  await resolver.resolveAndApply("mrc_test", buildSession(), [
    { id: "sku_1", quantity: 0 },
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as { items: { sku: string; quantity: number }[] }).items, [
    { sku: "sku_1", quantity: 0 },
  ]);
  assert.equal(repo.saved.length, 0);
});

test("line-items: throws when SKU not found in catalog", async () => {
  const repo = createSessionRepo();
  const resolver = new AcpLineItemsResolver(
    createUpdateCartSpy([]),
    repo,
    createVariantLookup(new Map()),
  );
  await assert.rejects(
    () =>
      resolver.resolveAndApply("mrc_test", buildSession(), [
        { id: "sku_missing", quantity: 1 },
      ]),
    (err: unknown) =>
      err instanceof BadRequestException &&
      (err.getResponse() as { message: string }).message === "acp_sku_not_found:sku_missing",
  );
});

test("line-items: throws when quantity is negative for new SKU", async () => {
  const repo = createSessionRepo();
  const resolver = new AcpLineItemsResolver(
    createUpdateCartSpy([]),
    repo,
    createVariantLookup(new Map([["sku_x", { price: 10 }]])),
  );
  await assert.rejects(
    () =>
      resolver.resolveAndApply("mrc_test", buildSession(), [
        { id: "sku_x", quantity: -1 },
      ]),
    (err: unknown) => err instanceof BadRequestException,
  );
});

test("line-items: throws when variantLookup is missing", async () => {
  const repo = createSessionRepo();
  const resolver = new AcpLineItemsResolver(createUpdateCartSpy([]), repo, undefined);
  await assert.rejects(
    () =>
      resolver.resolveAndApply("mrc_test", buildSession(), [
        { id: "sku_unknown", quantity: 1 },
      ]),
    (err: unknown) =>
      err instanceof BadRequestException &&
      (err.getResponse() as { message: string }).message === "acp_catalog_unavailable",
  );
});

test("line-items: clears shipping when new SKUs are merged", async () => {
  const repo = createSessionRepo();
  const lookup = createVariantLookup(new Map([["sku_new", { price: 50 }]]));
  const resolver = new AcpLineItemsResolver(createUpdateCartSpy([]), repo, lookup);
  const session = buildSession();
  session.shipping = { customerPrice: 10, carrier: "C", method: "M" };
  await resolver.resolveAndApply("mrc_test", session, [{ id: "sku_new", quantity: 1 }]);
  assert.equal(repo.saved[0].shipping, undefined);
});
