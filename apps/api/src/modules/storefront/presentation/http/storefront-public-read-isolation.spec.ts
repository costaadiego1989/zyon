import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { StorefrontController } from "./storefront.controller.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { SendStoreMessageUseCase, type SendStoreMessageInput } from "../../application/use-cases/send-store-message.use-case.js";
import { StorefrontConversationAdapter } from "../../infrastructure/adapters/storefront-conversation.adapter.js";
import { STOREFRONT_CONTRACT_FALLBACK } from "../../domain/contracts/storefront-conversation.schemas.js";

const origin = "https://read-isolation.example.test";
const label = "Detalhes do produto";
const admission = () => ({ allowed: true, limit: 10, remaining: 9, resetAt: Date.now() + 60_000, retryAfterMs: 0 });
const payload = () => ({ user_message: label, ui_action_version: 1,
  ui_action: { tool: "get_product_details", args: { productId: "original_product" } } });

function fixture() {
  const capabilities = new RealtimeCapabilityService("read-isolation-only-synthetic-secret-at-least-32-chars");
  const executions: SendStoreMessageInput[] = [];
  const quotas: unknown[][] = [];
  const voices: unknown[][] = [];
  let attachments = 0;
  const quota = { consume: async (...args: unknown[]) => { quotas.push(args); return admission(); } };
  const voice = { consumeVoicePermit: async (...args: unknown[]) => { voices.push(args); return false; } };
  const controller = Object.assign(Object.create(StorefrontController.prototype), {
    capabilities, conversationRateLimiter: quota, aiUserLimiter: voice,
    attachmentInterpreter: { interpret: async () => { attachments += 1; return undefined; } },
    sendStoreMessage: { execute: async (input: SendStoreMessageInput) => {
      executions.push(input);
      return { message: "Resposta segura", blocks: [], conversation_id: input.conversation_id, suggested_next: [] };
    } },
  }) as StorefrontController;
  const request = (merchantId = "merchant_a", conversationId = "conversation_a") => {
    const issued = capabilities.issue({ purpose: "storefront-conversation", merchantId, resourceId: conversationId,
      origin, aiUserId: "visitor:read_isolation" });
    return { headers: { origin, authorization: `Bearer ${issued.token}` } };
  };
  return { controller, executions, quotas, voices, quota, voice, request, attachmentCount: () => attachments };
}

test("public parsing snapshots the action before asynchronous admission mutates the original request", async () => {
  const f = fixture();
  const body = payload();
  const originalAction = body.ui_action;
  f.quota.consume = async () => {
    originalAction.args.productId = "changed_during_admission";
    body.ui_action = { tool: "get_product_details", args: { productId: "another_changed_product" } };
    return admission();
  };
  await f.controller.sendMessage("conversation_a", body, f.request());
  assert.equal(f.executions.length, 1);
  assert.deepEqual(f.executions[0].ui_action, { tool: "get_product_details", args: { productId: "original_product" } });
  assert.notEqual(f.executions[0].ui_action, originalAction);
  assert.notEqual(f.executions[0].ui_action?.args, originalAction.args);
});

test("overlapping requests sharing one caller-owned action keep independent tenant, session and parsed ID snapshots", async () => {
  const f = fixture();
  const release: Array<() => void> = [];
  f.quota.consume = async (...args: unknown[]) => {
    f.quotas.push(args);
    await new Promise<void>(resolve => release.push(resolve));
    return admission();
  };
  const shared = payload();
  const first = f.controller.sendMessage("conversation_a", shared, f.request());
  shared.ui_action.args.productId = "second_product";
  const second = f.controller.sendMessage("conversation_b", shared, f.request("merchant_b", "conversation_b"));
  // Both requests first await the existing voice-permit admission hook.
  await Promise.resolve();
  assert.equal(release.length, 2);
  release[1]();
  await second;
  release[0]();
  await first;
  assert.deepEqual(f.executions.map(input => [input.merchant_id, input.conversation_id, input.cart_id, input.ui_action]), [
    ["merchant_b", "conversation_b", "conversation_b", { tool: "get_product_details", args: { productId: "second_product" } }],
    ["merchant_a", "conversation_a", "conversation_a", { tool: "get_product_details", args: { productId: "original_product" } }],
  ]);
  assert.deepEqual(f.quotas, [["merchant_a", "conversation_a", "visitor:read_isolation"], ["merchant_b", "conversation_b", "visitor:read_isolation"]]);
});

test("unknown top-level authority hints are ignored while signed scope and the narrow action remain authoritative", async () => {
  const f = fixture();
  const body = { ...payload(), merchantId: "merchant_spoof", conversation_id: "conversation_spoof", cartId: "cart_spoof",
    global_user_id: "buyer_spoof", trusted_buyer_context: { globalUserId: "buyer_spoof" },
    ui_action_capability: { version: 999, tools: ["create_checkout_session"] }, authorizedDiscount: 99 };
  await f.controller.sendMessage("conversation_a", body, f.request());
  assert.equal(f.executions.length, 1);
  const input = f.executions[0];
  assert.equal(input.merchant_id, "merchant_a");
  assert.equal(input.conversation_id, "conversation_a");
  assert.equal(input.cart_id, "conversation_a");
  assert.equal(input.global_user_id, undefined);
  assert.equal(input.trusted_buyer_context, undefined);
  for (const key of ["merchantId", "cartId", "ui_action_capability", "authorizedDiscount"]) assert.ok(!Object.hasOwn(input, key));
  assert.deepEqual(input.ui_action, payload().ui_action);
});

test("forged capability metadata never authorizes an action and authentication precedes protocol diagnostics", async () => {
  const f = fixture();
  const body = { ...payload(), ui_action_version: 999, ui_action_capability: { version: 1, tools: ["get_product_details"] } };
  await assert.rejects(f.controller.sendMessage("conversation_a", body, { headers: { origin } }),
    (error: { getStatus(): number; message: string }) => error.getStatus() === 401 && error.message === "invalid_conversation_token");
  await assert.rejects(f.controller.sendMessage("conversation_a", { ...body, cart_id: "foreign" }, f.request()),
    (error: { getStatus(): number; message: string }) => error.getStatus() === 403 && error.message === "conversation_cart_mismatch");
  assert.deepEqual(f.executions, []);
  assert.deepEqual(f.quotas, []);
  assert.deepEqual(f.voices, []);
  assert.equal(f.attachmentCount(), 0);
});

test("a valid scoped voice admission avoids a second quota charge without changing the typed action", async () => {
  const f = fixture();
  f.voice.consumeVoicePermit = async (...args: unknown[]) => { f.voices.push(args); return true; };
  await f.controller.sendMessage("conversation_a", { ...payload(), voice_turn_token: "synthetic_valid_permit" }, f.request());
  assert.deepEqual(f.voices, [["synthetic_valid_permit", {
    userId: "visitor:read_isolation", merchantId: "merchant_a", resourceId: "conversation_a", origin,
  }]]);
  assert.deepEqual(f.quotas, []);
  assert.equal(f.executions.length, 1);
  assert.deepEqual(f.executions[0].ui_action, payload().ui_action);
});

test("quota provider failures propagate before attachment or execution and never become a text retry", async () => {
  const f = fixture();
  const failure = new Error("synthetic_quota_authority_unavailable");
  let attempts = 0;
  f.quota.consume = async () => { attempts += 1; throw failure; };
  await assert.rejects(f.controller.sendMessage("conversation_a", payload(), f.request()), error => error === failure);
  assert.equal(attempts, 1);
  assert.equal(f.attachmentCount(), 0);
  assert.deepEqual(f.executions, []);
});

test("invalid typed catalog results are blocked at the real tool boundary without replay or LLM execution", async () => {
  const f = fixture();
  let searches = 0;
  let llmCalls = 0;
  let cartCalls = 0;
  const badVariant = { id: "bad_variant", sku: "BAD", attributes: {}, basePriceInCents: -100,
    stockQuantity: 1, stockReserved: 0, isActive: true, media: [] };
  const prisma = {
    merchantRule: { findUnique: async () => null },
    checkoutSetting: { findUnique: async () => ({ advancedRules: [] }) },
    promptExperiment: { findFirst: async () => null },
  } as unknown as PrismaClient;
  const merchant = { getProfile: async () => ({ name: "Store", storeCategory: "others" }), getStoreSettings: async () => ({}) };
  const adapter = Object.assign(Object.create(StorefrontConversationAdapter.prototype), {
    structuredRouting: true, emitFunnelEvent: async () => {},
    agent: { run: async () => { llmCalls += 1; assert.fail("Invalid tool output must not fall back to the LLM"); } },
    handlerDeps: { prisma, merchantRepo: merchant, stockRepo: {}, loadCrossSellConfig: async () => ({ enabled: false }),
      productRepo: { search: async (args: { merchantId: string; categoryId?: string }) => {
        searches += 1;
        assert.equal(args.merchantId, "merchant_a");
        assert.equal(args.categoryId, "category_a");
        return { products: [{ id: "bad_product", name: "UNSAFE_NEGATIVE_PRICE", type: "physical", description: "",
          variants: [badVariant], defaultVariant: badVariant, hasStock: true, averageRating: null, reviewCount: 0 }], nextCursor: null };
      } },
      cartRepo: new Proxy({}, { get() { cartCalls += 1; throw new Error("Unexpected cart access"); } }),
    },
  }) as StorefrontConversationAdapter;
  const useCase = new SendStoreMessageUseCase(merchant as never, adapter, prisma, { findForMerchant: async () => null });
  Object.assign(f.controller, { sendStoreMessage: useCase });
  const output = await f.controller.sendMessage("conversation_a", {
    user_message: "Texto irrelevante: adicionar produto", ui_action_version: 1,
    ui_action: { tool: "search_products", args: { query: "*", categoryId: "category_a" } },
  }, f.request());
  assert.equal(output.message, STOREFRONT_CONTRACT_FALLBACK);
  assert.deepEqual(output.blocks, []);
  assert.equal(output.cart_id, "conversation_a");
  assert.equal(output.conversation_id, "conversation_a");
  assert.ok(!JSON.stringify(output).includes("UNSAFE_NEGATIVE_PRICE"));
  assert.equal(searches, 1);
  assert.equal(llmCalls, 0);
  assert.equal(cartCalls, 0);
});

