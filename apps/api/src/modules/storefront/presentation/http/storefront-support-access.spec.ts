import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontController } from "./storefront.controller.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { BuyerJwtService } from "../../../buyer-account/domain/services/buyer-jwt.service.js";
import { createSupportHandlers } from "../../infrastructure/tool-handlers/support.handlers.js";

test("guest support claim requires both private conversation capability and authenticated buyer in the same merchant", async () => {
  const capabilities = new RealtimeCapabilityService("support-capability-fixture-secret-32-chars");
  const buyerJwt = new BuyerJwtService("support-buyer-fixture-secret-32-characters");
  const calls: unknown[][] = [];
  const controller = Object.assign(Object.create(StorefrontController.prototype), {
    capabilities, buyerJwt,
    supportHandoff: { linkBuyerConversation: async (...args: unknown[]) => { calls.push(args); return { linked: 1 }; } },
  }) as StorefrontController;
  const access = capabilities.issue({ purpose: "storefront-conversation", merchantId: "merchant_a", resourceId: "conversation_a", origin: "https://store.example" });
  const buyer = (merchantId?: string) => buyerJwt.sign({ globalUserId: "buyer_a", email: "fixture@example.invalid", merchantId });
  const headers = { authorization: `Bearer ${access.token}`, origin: "https://store.example", "x-buyer-authorization": `Bearer ${buyer("merchant_a")}` };
  await assert.rejects(controller.linkSupportBuyer("conversation_a", { headers: {} }), /invalid_conversation_token/);
  await assert.rejects(controller.linkSupportBuyer("conversation_a", { headers: { ...headers, "x-buyer-authorization": undefined } }), /buyer_identity_required/);
  await assert.rejects(controller.linkSupportBuyer("conversation_a", { headers: { ...headers, "x-buyer-authorization": "Bearer forged" } }), /buyer_identity_required/);
  await assert.rejects(controller.linkSupportBuyer("conversation_a", { headers: { ...headers, "x-buyer-authorization": `Bearer ${buyer("merchant_b")}` } }), /buyer_identity_required/);
  await assert.rejects(controller.linkSupportBuyer("conversation_b", { headers }), /conversation_access_denied/);
  await assert.rejects(controller.linkSupportBuyer("conversation_a", { headers: { ...headers, origin: "https://other.example" } }), /invalid_conversation_token/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await controller.linkSupportBuyer("conversation_a", { headers }), { linked: 1 });
  assert.deepEqual(calls, [["merchant_a", "conversation_a", "buyer_a"]]);
});

test("handoff tool ignores model-supplied ownership and uses verified conversation context", async () => {
  const calls: unknown[] = [];
  const deps = { supportHandoff: { createHandoff: async (input: unknown) => { calls.push(input); return { ticketId: "ticket", reply: "Aberto" }; } } } as never;
  const args = { reason: "Não encontrei o produto", buyerId: "victim", merchantId: "foreign", sessionId: "foreign" };
  await createSupportHandlers(deps, { merchantId: "merchant", sessionId: "conversation", userMessage: "Falar com humano", buyer: { globalUserId: "verified_buyer" } }).escalateToHuman(args);
  await createSupportHandlers(deps, { merchantId: "merchant", sessionId: "guest" }).escalateToHuman(args);
  assert.deepEqual(calls, [
    { merchantId: "merchant", sessionId: "conversation", buyerMessage: args.reason, buyerId: "verified_buyer", initialMessage: "Falar com humano" },
    { merchantId: "merchant", sessionId: "guest", buyerMessage: args.reason, buyerId: undefined, initialMessage: undefined },
  ]);
});
