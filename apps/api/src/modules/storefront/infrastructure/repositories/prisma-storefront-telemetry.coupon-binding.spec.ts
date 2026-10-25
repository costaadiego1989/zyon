import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { PrismaStorefrontTelemetryRepository } from "./prisma-storefront-telemetry.repository.js";

type Fields = Record<string, unknown>;
const PRIVATE_KEY = "_storefrontCouponBinding";
const CANARY = "PRIVATE_TELEMETRY_BINDING_CANARY";
const MERCHANT = "merchant-telemetry-synthetic";
const CONVERSATION = "conversation-telemetry-synthetic";
const CART = "cart-telemetry-synthetic";
const NOW = new Date("2026-10-18T12:00:00.000Z");

function fields(value: unknown): Fields {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Fields;
}

function canonicalBinding(state: "active" | "released" | "redeemed" = "active") {
  return {
    version: 1, bindingId: "11111111-1111-4111-8111-111111111111",
    merchantId: MERCHANT, cartId: CART, checkoutSessionId: CONVERSATION,
    buyerId: "buyer-synthetic", reservationBuyerId: "buyer-synthetic",
    redemptionId: "redemption-synthetic", couponId: "coupon-synthetic",
    discountCents: 137, basisHash: "ab".repeat(32), state,
    ...(state === "redeemed" ? { orderId: "order-synthetic" } : {}),
  };
}

function checkoutRow(cart: unknown = { items: [], total: 0 }) {
  return { id: "checkout-row-synthetic", merchantId: MERCHANT, sessionId: CONVERSATION,
    globalUserId: "buyer-synthetic", conversationId: CONVERSATION, cart,
    abandonmentScore: 0, triggerAgent: false, chatHistory: [], createdAt: NOW, updatedAt: NOW };
}

type HarnessOptions = {
  current?: Fields | null;
  existingEvent?: boolean;
  lockPublishesBinding?: boolean;
  commitFailure?: boolean;
  eventFailure?: boolean;
  cartHasPrivateField?: boolean;
  anchorFailure?: boolean;
};

function harness(options: HarnessOptions = {}) {
  const calls: string[] = [];
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const writes: Array<{ delegate: string; args: unknown }> = [];
  let row: Fields | null = options.current === undefined ? checkoutRow() : structuredClone(options.current);
  let eventExists = options.existingEvent ?? false;
  let transactionActive = false;

  function delegates(owner: "root" | "tx") {
    return {
      checkoutSession: {
        async findUnique(args: unknown) {
          calls.push(`${owner}:read`);
          assert.deepEqual(fields(fields(args).where).merchantId_sessionId,
            { merchantId: MERCHANT, sessionId: CONVERSATION });
          return row ? structuredClone(row) : null;
        },
        async upsert(args: unknown) {
          calls.push(`${owner}:upsert`);
          writes.push({ delegate: "checkoutSession.upsert", args: structuredClone(args) });
          const input = fields(args);
          assert.deepEqual(fields(input.where).merchantId_sessionId,
            { merchantId: MERCHANT, sessionId: CONVERSATION });
          row = row ? { ...row, ...fields(input.update) } : { id: "checkout-row-synthetic", ...fields(input.create) };
          return structuredClone(row);
        },
        async update(args: unknown) {
          calls.push(`${owner}:score`);
          writes.push({ delegate: "checkoutSession.update", args: structuredClone(args) });
          row = { ...row, ...fields(fields(args).data) };
          return structuredClone(row);
        },
        async findMany() { return []; },
      },
      checkoutEvent: {
        async findFirst(args: unknown) {
          calls.push(`${owner}:event-read`);
          const where = fields(fields(args).where);
          assert.equal(where.merchantId, MERCHANT);
          assert.equal(where.sessionId, CONVERSATION);
          return eventExists ? { id: "existing-event" } : null;
        },
        async create(args: unknown) {
          calls.push(`${owner}:event-create`);
          writes.push({ delegate: "checkoutEvent.create", args: structuredClone(args) });
          if (options.eventFailure) throw new Error("synthetic_event_failed");
          eventExists = true;
          return fields(args).data;
        },
      },
    };
  }

  const tx = {
    ...delegates("tx"),
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      const text = parts.join("?");
      statements.push({ text, values });
      if (text.includes("pg_advisory_xact_lock")) {
        calls.push("tx:anchor");
        if (options.anchorFailure) throw new Error("synthetic_anchor_failed");
        return [];
      }
      calls.push("tx:lock");
      if (options.lockPublishesBinding) row = checkoutRow({ items: [], total: 0, [PRIVATE_KEY]: canonicalBinding() });
      return row ? [{ id: row.id }] : [];
    },
  };
  const prisma = {
    ...delegates("root"),
    async $transaction<T>(work: (client: typeof tx) => Promise<T>): Promise<T> {
      calls.push("tx:begin");
      assert.equal(transactionActive, false);
      transactionActive = true;
      const before = structuredClone(row);
      const beforeEvent = eventExists;
      try {
        const result = await work(tx);
        if (options.commitFailure) throw new Error("synthetic_commit_unknown");
        calls.push("tx:commit");
        return result;
      } catch (error) {
        row = before;
        eventExists = beforeEvent;
        calls.push("tx:rollback");
        throw error;
      } finally { transactionActive = false; }
    },
    promptExperiment: {
      async findFirst() {
        calls.push("experiment:read");
        assert.equal(transactionActive, false, "experiments_must_not_run_inside_funnel_transaction");
        return { id: "experiment-synthetic", variants: [{ id: "variant-synthetic", weight: 1 }] };
      },
    },
    promptVariantResult: {
      async upsert(args: unknown) {
        calls.push("experiment:upsert");
        writes.push({ delegate: "promptVariantResult.upsert", args: structuredClone(args) });
        return {};
      },
    },
  };
  const cartPort: Pick<StorefrontCartPort, "getOrCreate"> = {
    async getOrCreate(merchantId, sessionId) {
      calls.push("cart:start");
      assert.equal(transactionActive, false, "cart_io_finishes_before_checkout_row_lock");
      assert.equal(merchantId, MERCHANT);
      assert.equal(sessionId, CART);
      await Promise.resolve();
      calls.push("cart:done");
      return { id: CART, merchantId, sessionId,
        items: [{ variantId: "variant-synthetic", productId: "product-synthetic", sku: "SKU", name: "Synthetic", quantity: 1, unitPriceCents: 9900 }],
        couponCode: null, discount: 0, freeShipping: false, total: 9900,
        createdAt: NOW, updatedAt: NOW,
        ...(options.cartHasPrivateField ? { [PRIVATE_KEY]: { canary: CANARY } } : {}),
      };
    },
  };
  const repository = new PrismaStorefrontTelemetryRepository(prisma as unknown as PrismaClient,
    cartPort as StorefrontCartPort);
  const record = (event = "product_viewed") => repository.recordEvent({ merchantId: MERCHANT,
    conversationId: CONVERSATION, cartId: CART, globalUserId: "buyer-synthetic", event });
  return { record, calls, statements, writes, row: () => structuredClone(row) };
}

function assertGuardedTransaction(subject: ReturnType<typeof harness>): void {
  assert.equal(subject.calls.filter(call => call === "tx:begin").length, 1);
  assert.equal(subject.calls.filter(call => call === "tx:anchor").length, 1);
  assert.equal(subject.calls.filter(call => call === "tx:lock").length, 1);
  assert.ok(subject.calls.indexOf("cart:done") < subject.calls.indexOf("tx:begin"));
  assert.ok(subject.calls.indexOf("tx:begin") < subject.calls.indexOf("tx:anchor"));
  assert.ok(subject.calls.indexOf("tx:anchor") < subject.calls.indexOf("tx:lock"));
  assert.ok(subject.calls.indexOf("tx:lock") < subject.calls.indexOf("tx:read"));
  assert.equal(subject.calls.some(call => call.startsWith("root:")), false, "no_unlocked_root_checkout_delegates");
  const [anchor, lock] = subject.statements;
  assert.equal(subject.statements.length, 2);
  assert.match(anchor.text, /pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*\?\s*,\s*0\s*\)\s*\)/i);
  assert.deepEqual(anchor.values, [JSON.stringify(["checkout-session", MERCHANT, CONVERSATION])]);
  assert.match(lock.text, /SELECT\s+id\s+FROM\s+checkout_sessions\b/i);
  assert.match(lock.text, /merchant_id\s*=\s*\?/i);
  assert.match(lock.text, /session_id\s*=\s*\?/i);
  assert.match(lock.text, /FOR\s+UPDATE/i);
  assert.deepEqual(lock.values, [MERCHANT, CONVERSATION]);
  assert.doesNotMatch(lock.text, /advisory|storefront_carts/i);
}

for (const state of ["active", "released", "redeemed"] as const) {
  test(`telemetry refuses a canonical ${state} binding before recovery/event/scoring/experiment writes`, async () => {
    const original = checkoutRow({ items: [], total: 0, [PRIVATE_KEY]: canonicalBinding(state) });
    const subject = harness({ current: original });
    await assert.rejects(subject.record(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "checkout_coupon_binding_conflict");
      assert.equal("cause" in error, false);
      assert.equal(JSON.stringify(error).includes(CANARY), false);
      return true;
    });
    assertGuardedTransaction(subject);
    assert.deepEqual(subject.writes, []);
    assert.deepEqual(subject.row(), original);
    assert.equal(subject.calls.includes("experiment:read"), false);
    assert.equal(subject.calls.at(-1), "tx:rollback");
  });
}

for (const value of [undefined, null, { canary: CANARY }]) {
  test(`telemetry refuses even malformed/undefined/null stored private-field presence (${String(value)})`, async () => {
    const subject = harness({ current: checkoutRow({ items: [], [PRIVATE_KEY]: value }) });
    await assert.rejects(subject.record(), { message: "checkout_coupon_binding_conflict" });
    assertGuardedTransaction(subject);
    assert.deepEqual(subject.writes, []);
    assert.equal(subject.calls.includes("experiment:read"), false);
  });
}

test("telemetry rereads raw checkout storage after acquiring its lock, seeing a binding published by a preceding writer", async () => {
  const subject = harness({ lockPublishesBinding: true });
  await assert.rejects(subject.record(), { message: "checkout_coupon_binding_conflict" });
  assertGuardedTransaction(subject);
  assert.deepEqual(subject.writes, []);
  assert.equal(subject.calls.includes("experiment:read"), false);
});

for (const absent of [false, true]) {
  test(`unbound ${absent ? "missing" : "existing"} checkout keeps recovery, event, score and postcommit experiment behavior`, async () => {
    const subject = harness({ ...(absent ? { current: null } : {}), cartHasPrivateField: true });
    await subject.record();
    assertGuardedTransaction(subject);
    assert.ok(subject.calls.indexOf("tx:read") < subject.calls.indexOf("tx:upsert"));
    assert.ok(subject.calls.indexOf("tx:upsert") < subject.calls.indexOf("tx:event-create"));
    assert.ok(subject.calls.indexOf("tx:event-create") < subject.calls.indexOf("tx:score"));
    assert.ok(subject.calls.indexOf("tx:score") < subject.calls.indexOf("tx:commit"));
    assert.ok(subject.calls.indexOf("tx:commit") < subject.calls.indexOf("experiment:read"));
    assert.ok(subject.calls.indexOf("experiment:read") < subject.calls.indexOf("experiment:upsert"));
    assert.equal(subject.row()?.globalUserId, "buyer-synthetic");
    const storedCart = fields(subject.row()?.cart);
    assert.deepEqual(Object.keys(storedCart).sort(), ["couponCode", "discount", "freeShipping", "items", "total"]);
    assert.equal(storedCart.total, 9900);
    assert.equal(JSON.stringify(subject.writes).includes(PRIVATE_KEY), false);
    assert.equal(JSON.stringify(subject.writes).includes(CANARY), false);
    assert.equal(subject.writes.filter(write => write.delegate === "checkoutEvent.create").length, 1);
    assert.equal(subject.writes.filter(write => write.delegate === "checkoutSession.update").length, 1);
  });
}

test("a previously recorded unbound event does not duplicate event/scoring, while recovery still commits", async () => {
  const subject = harness({ existingEvent: true });
  await subject.record();
  assertGuardedTransaction(subject);
  assert.equal(subject.writes.filter(write => write.delegate === "checkoutEvent.create").length, 0);
  assert.equal(subject.writes.filter(write => write.delegate === "checkoutSession.update").length, 0);
  assert.ok(subject.calls.indexOf("tx:upsert") < subject.calls.indexOf("tx:commit"));
  assert.ok(subject.calls.indexOf("tx:commit") < subject.calls.indexOf("experiment:read"));
});

for (const event of ["idle_30_seconds", "checkout_abandoned"]) {
  test(`${event} continues to preserve last-activity timestamps on recovery and score writes`, async () => {
    const subject = harness();
    await subject.record(event);
    assertGuardedTransaction(subject);
    const upsert = fields(subject.writes.find(write => write.delegate === "checkoutSession.upsert")?.args);
    const score = fields(subject.writes.find(write => write.delegate === "checkoutSession.update")?.args);
    assert.equal(Object.hasOwn(fields(upsert.update), "updatedAt"), false);
    assert.equal(Object.hasOwn(fields(score.data), "updatedAt"), false);
    assert.equal(subject.row()?.updatedAt?.valueOf(), NOW.valueOf());
  });
}

for (const fault of ["eventFailure", "commitFailure"] as const) {
  test(`${fault} never publishes experiment effects when funnel commit is not confirmed`, async () => {
    const initial = checkoutRow();
    const subject = harness({ current: initial, [fault]: true });
    await assert.rejects(subject.record(), { message: fault === "eventFailure" ? "synthetic_event_failed" : "synthetic_commit_unknown" });
    assertGuardedTransaction(subject);
    assert.deepEqual(subject.row(), initial);
    assert.equal(subject.calls.includes("experiment:read"), false);
    assert.equal(subject.calls.includes("experiment:upsert"), false);
    assert.equal(subject.calls.includes("tx:commit"), false);
  });
}

test("nonfunnel experiment telemetry keeps its prior path without touching carts or checkout delegates", async () => {
  const subject = harness({ current: checkoutRow({ [PRIVATE_KEY]: canonicalBinding() }) });
  await subject.record("conversation_started");
  assert.deepEqual(subject.calls, ["experiment:read", "experiment:upsert"]);
  assert.deepEqual(subject.statements, []);
});

test("an unavailable session anchor prevents raw reads, recovery writes and experiment effects even when the checkout row is absent", async () => {
  const subject = harness({ current: null, anchorFailure: true });
  await assert.rejects(subject.record(), { message: "synthetic_anchor_failed" });
  assert.deepEqual(subject.calls, ["cart:start", "cart:done", "tx:begin", "tx:anchor", "tx:rollback"]);
  assert.deepEqual(subject.writes, []);
  assert.equal(subject.row(), null);
});
