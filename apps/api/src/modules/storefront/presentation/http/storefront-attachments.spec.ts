import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontController } from "./storefront.controller.js";
import { StorefrontAttachmentInterpreter } from "../../application/services/storefront-attachment-interpreter.service.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { resolveDeterministicShortcut, type DeterministicShortcutDeps } from "../../infrastructure/shortcuts/deterministic-shortcuts.service.js";

function fixture() {
  const capabilities = new RealtimeCapabilityService("attachment-test-secret-32-characters");
  const calls: Record<string, unknown>[] = [];
  const controller = Object.assign(Object.create(StorefrontController.prototype), {
    capabilities,
    attachmentInterpreter: new StorefrontAttachmentInterpreter(),
    conversationRateLimiter: { consume: () => ({ allowed: true, limit: 10, remaining: 9, resetAt: Date.now() + 60_000 }) },
    sendStoreMessage: { execute: async (input: Record<string, unknown>) => { calls.push(input); return { message: "Produtos encontrados", blocks: [] }; } },
  }) as StorefrontController;
  const access = capabilities.issue({ purpose: "storefront-conversation", merchantId: "merchant_a", resourceId: "cart_a", origin: "https://store.example" });
  const request = { headers: { authorization: `Bearer ${access.token}`, origin: "https://store.example" } };
  return { controller, calls, request };
}

test("a short catalog command with an attachment reaches the matching agent", async () => {
  let catalogCalls = 0;
  const deps = { productRepo: { search: async () => { catalogCalls++; return { products: [] }; } } } as unknown as DeterministicShortcutDeps;
  const input = { merchantId: "merchant_a", sessionId: "cart_a", storeCategory: "beauty", history: [], userMessage: "Ver produtos" };
  assert.equal(await resolveDeterministicShortcut(deps, { ...input, attachmentContext: "Creme reparador,2" }), null);
  assert.equal(catalogCalls, 0);
  await resolveDeterministicShortcut(deps, input);
  assert.equal(catalogCalls, 1);
});

test("a scoped attachment turn passes quantities to the agent without persisting file bytes", async () => {
  const { controller, calls, request } = fixture();
  const attachment = { kind: "shopping_list" as const, name: "compras.csv", mimeType: "text/csv" as const, text: "produto,quantidade\nCreme reparador,2\nBruma,1" };
  await controller.sendMessage("cart_a", { merchant_id: "merchant_a", cart_id: "cart_a", user_message: "Busque no catálogo", attachment }, request);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].merchant_id, "merchant_a");
  assert.equal(calls[0].cart_id, "cart_a");
  assert.match(String(calls[0].attachment_context), /Creme reparador,2/);
  assert.equal(calls[0].attachment, undefined);
});

test("another merchant or cart cannot send an attachment through an existing capability", async () => {
  const { controller, calls, request } = fixture();
  await assert.rejects(controller.sendMessage("cart_a", { merchant_id: "merchant_b", user_message: "buscar" }, request), /conversation_access_denied/);
  await assert.rejects(controller.sendMessage("cart_a", { merchant_id: "merchant_a", cart_id: "cart_b", user_message: "buscar" }, request), /conversation_cart_mismatch/);
  assert.deepEqual(calls, []);
});

test("invalid files fail before the commerce agent runs; ordinary messages still work", async () => {
  const { controller, calls, request } = fixture();
  await assert.rejects(controller.sendMessage("cart_a", { merchant_id: "merchant_a", user_message: "buscar", attachment: { kind: "image", name: "imagem.gif", mimeType: "image/gif", dataBase64: "YWJj" } as never }, request), (error: { getStatus(): number }) => error.getStatus() === 400);
  assert.equal(calls.length, 0);
  await controller.sendMessage("cart_a", { merchant_id: "merchant_a", user_message: "Ver produtos" }, request);
  assert.equal(calls[0].attachment_context, undefined);
});
