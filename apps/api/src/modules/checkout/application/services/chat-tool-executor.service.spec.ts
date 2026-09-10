import test from "node:test";
import assert from "node:assert/strict";
import { ChatToolExecutorService } from "./chat-tool-executor.service.js";

const executor = new ChatToolExecutorService();

test("apply_coupon without code asks for code and never claims success", async () => {
  const result = await executor.executeToolCalls(
    [{ function: { name: "apply_coupon", arguments: {} } }],
    { merchantId: "mrc_1" },
  );
  assert.match(result.message, /código do cupom/i);
  assert.doesNotMatch(result.message, /aplicado|aprovado|✅/i);
});

test("apply_coupon with code defers to coupon box", async () => {
  const result = await executor.executeToolCalls(
    [{ function: { name: "apply_coupon", arguments: { code: "SAVE10" } } }],
    { merchantId: "mrc_1" },
  );
  assert.match(result.message, /SAVE10/);
  assert.match(result.message, /campo de cupom/i);
  assert.doesNotMatch(result.message, /Verificando cupom/i);
});

test("apply_discount blocked without authorized offer", async () => {
  const result = await executor.executeToolCalls(
    [{ function: { name: "apply_discount", arguments: { percent: 10 } } }],
    { merchantId: "mrc_1" },
  );
  assert.doesNotMatch(result.message, /✅/);
  assert.match(result.message, /verificar/i);
});

test("malformed LLM tool arguments are rejected without breaking checkout chat", async () => {
  const result = await executor.executeToolCalls(
    [{ function: { name: "apply_discount", arguments: "{invalid" } }],
    { merchantId: "mrc_1" },
  );

  assert.match(result.message, /verificar/i);
});

test("authorized commercial tools do not claim the cart was mutated", async () => {
  const result = await executor.executeToolCalls(
    [{ function: { name: "apply_discount", arguments: { percent: 10 } } }],
    {
      merchantId: "mrc_1",
      authorizedOffer: { approved: true, type: "discount_percent", value: 10 } as any,
    },
  );

  assert.match(result.message, /disponível/i);
  assert.doesNotMatch(result.message, /aplicado/i);
});
