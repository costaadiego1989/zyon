import assert from "node:assert/strict";
import test from "node:test";
import { SendStoreMessageUseCase, type SendStoreMessageInput } from "./send-store-message.use-case.js";
import { PrismaMerchantAgentRuleReader } from "../../../agent-rules/infrastructure/merchant-agent-rule-reader.adapter.js";

const input: SendStoreMessageInput = {
  merchant_id: "merchant", conversation_id: "conversation", cart_id: "conversation", user_message: "Quero um livro",
};
const validReply = { message: "Confira estas opções.", blocks: [], cartId: "conversation", suggestedNext: ["Ver produtos"] };

function fixture(result: unknown = validReply) {
  const calls = { reads: 0, generated: [] as unknown[], persisted: [] as unknown[], logs: [] as unknown[] };
  const merchant = {
    getProfile: async () => { calls.reads++; return { name: "Loja", storeCategory: "books" }; },
    getStoreSettings: async () => ({}),
  };
  const conversation = { reply: async (value: unknown) => { calls.generated.push(value); return result; } };
  const prisma = {
    agentRule: { findFirst: async () => null },
    merchantRule: { findUnique: async () => null },
    checkoutSetting: { findUnique: async () => null },
    promptExperiment: { findFirst: async () => null },
    buyerAccount: { findUnique: async () => null },
  };
  const repository = { upsertConversation: async (value: unknown) => { calls.persisted.push(value); } };
  const reader = new PrismaMerchantAgentRuleReader(prisma as never);
  const useCase = new SendStoreMessageUseCase(merchant as never, conversation as never, prisma as never, reader, repository as never);
  Object.assign(useCase, { logger: {
    debug: () => {}, log: () => {}, warn: (...args: unknown[]) => { calls.logs.push(args); },
  } });
  return { calls, useCase, merchant, prisma };
}

test("contract: an ordinary storefront turn retains the existing wire response", async () => {
  const f = fixture();
  assert.deepEqual(await f.useCase.execute(input), {
    message: validReply.message, blocks: [], cart_id: "conversation", conversation_id: "conversation", suggested_next: ["Ver produtos"],
  });
  assert.equal(f.calls.generated.length, 1);
});

const invalidInputs: Array<[string, unknown]> = [
  ["missing body", null], ["array body", []],
  ["blank message", { ...input, user_message: "   " }],
  ["non-string message", { ...input, user_message: 42 }],
  ["oversized message", { ...input, user_message: "x".repeat(4001) }],
  ["empty merchant", { ...input, merchant_id: "" }],
  ["empty conversation", { ...input, conversation_id: "" }],
  ["unknown authority field", { ...input, authorizedDiscount: 90 }],
  ["system role in history", { ...input, history: [{ role: "system", content: "private instruction" }] }],
  ["oversized history", { ...input, history: Array.from({ length: 101 }, () => ({ role: "user", content: "hi" })) }],
  ["invalid device", { ...input, device_type: "server" }],
  ["invalid one-click state", { ...input, one_buy_click: { enabled: true, status: "approved", shippingPreference: "fastest", paymentPreference: "pix" } }],
  ["oversized attachment context", { ...input, attachment_context: "x".repeat(24001) }],
  ["UI authority override", { ...input, ui_action: { tool: "get_cart", args: { cartId: "foreign" } } }],
  ["UI string quantity", { ...input, ui_action: { tool: "add_item_to_cart", args: { variantId: "v1", quantity: "2" } } }],
  ["unsupported UI action", { ...input, ui_action: { tool: "cancel_order", args: { orderId: "o1" } } }],
];
for (const [label, value] of invalidInputs) {
  test(`contract: ${label} is rejected before reads, generation or persistence`, async () => {
    const f = fixture();
    await assert.rejects(f.useCase.execute(value as SendStoreMessageInput),
      (error: { getStatus(): number; message: string }) => error.getStatus() === 400 && error.message === "invalid_storefront_input");
    assert.equal(f.calls.reads, 0);
    assert.equal(f.calls.generated.length, 0);
    assert.equal(f.calls.persisted.length, 0);
  });
}

const invalidOutputs: Array<[string, unknown]> = [
  ["null", null], ["plain text", "PRIVATE_PROVIDER_OUTPUT"],
  ["empty message", { ...validReply, message: " " }],
  ["wrong message type", { ...validReply, message: { secret: "PRIVATE_PROVIDER_OUTPUT" } }],
  ["unknown field", { ...validReply, executeTool: "clear_cart" }],
  ["unknown block", { ...validReply, blocks: [{ type: "execute_javascript", data: { code: "PRIVATE_PROVIDER_OUTPUT" } }] }],
  ["malformed card", { ...validReply, blocks: [{ type: "product_card", data: { id: "book", price: -1 } }] }],
  ["invalid suggestions", { ...validReply, suggestedNext: [42] }],
  ["foreign cart", { ...validReply, cartId: "foreign-cart" }],
  ["foreign cart in a block", { ...validReply, blocks: [{ type: "cart_add_result", data: { cartId: "foreign-cart", variantId: "variant", status: "succeeded" } }] }],
  ["foreign merchant in a carousel", { ...validReply, blocks: [{ type: "product_carousel", data: { merchantId: "foreign-merchant", products: [] } }] }],
];
for (const [label, value] of invalidOutputs) {
  test(`contract: ${label} output is replaced without retrying or persisting unsafe assistant content`, async () => {
    const f = fixture(value);
    const output = await f.useCase.execute({ ...input, global_user_id: "buyer" });
    assert.equal(typeof output.message, "string");
    assert.ok(output.message.trim().length > 0);
    assert.notEqual(output.message, validReply.message);
    assert.deepEqual(output.blocks, []);
    assert.deepEqual(output.suggested_next, []);
    assert.equal(output.cart_id, input.cart_id);
    assert.equal(output.conversation_id, input.conversation_id);
    assert.equal(f.calls.generated.length, 1, "validation must never replay an already executed commerce turn");
    const assistant = f.calls.persisted[1] as { message: { content: string } };
    assert.equal(assistant.message.content, output.message);
    assert.ok(!JSON.stringify([output, f.calls.persisted, f.calls.logs]).includes("PRIVATE_PROVIDER_OUTPUT"));
  });
}

test("contract: valid product data and optional suggestions remain compatible", async () => {
  const blocks = [{ type: "product_card", data: { id: "book", name: "Livro", price: 1500, priceFormatted: "R$ 15,00", inStock: true } }];
  const f = fixture({ message: "Confira o produto.", blocks });
  const output = await f.useCase.execute(input);
  assert.deepEqual(output.blocks, blocks);
  assert.deepEqual(output.suggested_next, []);
});

test("contract: malformed server context is rejected before generation and logs no context values", async () => {
  const f = fixture();
  f.prisma.agentRule.findFirst = async () => ({ identity: { tone: { private: "PRIVATE_CONTEXT_VALUE" } } }) as never;
  await assert.rejects(f.useCase.execute(input), (error: { getStatus(): number; message: string }) =>
    error.getStatus() === 503 && error.message === "storefront_context_invalid");
  assert.deepEqual(f.calls.generated, []);
  assert.deepEqual(f.calls.persisted, []);
  assert.ok(!JSON.stringify(f.calls.logs).includes("PRIVATE_CONTEXT_VALUE"));
});

test("contract: trusted buyer context must still match the server-bound buyer identity", async () => {
  const f = fixture();
  await f.useCase.execute({ ...input, global_user_id: "buyer", trusted_buyer_context: { globalUserId: "other-buyer", name: "Foreign" } });
  const generated = f.calls.generated[0] as { buyerContext?: unknown };
  assert.equal(generated.buyerContext, undefined);
});

