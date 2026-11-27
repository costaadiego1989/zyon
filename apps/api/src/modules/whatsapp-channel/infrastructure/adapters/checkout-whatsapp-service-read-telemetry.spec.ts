import assert from "node:assert/strict";
import test from "node:test";
import { CheckoutWhatsAppConversationAdapter } from "./checkout-whatsapp-conversation.adapter.js";
import { WHATSAPP_RECOVERY_ORIGIN_EVENT } from "../../../storefront/domain/ports/storefront-telemetry.port.js";
import type { WhatsAppStructuredResponse } from "../../domain/ui/meta-ui.types.js";

function fixture(serviceControls: boolean, options: { items?: unknown[]; checkoutSessionId?: string; retainedServiceState?: boolean } = {}) {
  const calls: unknown[] = [], response = {
    agentMessage: "Current response", quickReplies: [],
    blocks: serviceControls ? [{ type: "service_booking_controls", data: {} }] : [],
    state: { version: 1, conversationId: "conversation", stage: "store", history: [], revision: "inbox", page: 0,
      previousViews: [], ...(options.checkoutSessionId ? { checkoutSessionId: options.checkoutSessionId } : {}),
      ...(options.retainedServiceState ? { serviceBooking: { diagnostic: "retained" } } : {}) },
  } as unknown as WhatsAppStructuredResponse;
  const adapter = Object.create(CheckoutWhatsAppConversationAdapter.prototype) as CheckoutWhatsAppConversationAdapter;
  Object.defineProperties(adapter, {
    store: { value: {} },
    storeConfig: { value: { executeForMerchant: async () => ({ name: "Owned store", cashbackEnabled: false }) } },
    prisma: { value: { storefrontCart: { findUnique: async () => ({ items: options.items ?? [], expiresAt: new Date(Date.now() + 60_000) }) } } },
    telemetry: { value: { recordEvent: async (...args: unknown[]) => { calls.push(args); } } },
    serviceBooking: { value: serviceControls ? { entry: async () => response, decorateCheckout: async () => undefined,
      decorateMenu: async (_merchant: string, current: WhatsAppStructuredResponse) => current } : undefined },
    respondStoreTurn: { value: async () => response },
  });
  const run = () => adapter.respondStore({ merchantId: "owned-store", buyer: { globalUserId: "buyer", phone: "5511998000001" },
    message: "Current query", state: response.state, verifiedSender: { inboxId: "inbox", leaseToken: "lease", deviceId: "META_CLOUD:config", fromNumber: "5511998000001" } });
  return { run, calls, response };
}

test("native service read does not project an empty parent cart into a checkout", async () => {
  const f = fixture(true), result = await f.run();
  assert.equal(f.calls.length, 0); assert.equal(result.state.checkoutSessionId, undefined);
  assert.equal(result.state.cartHasItems, false); assert.equal(result.blocks[0]?.type, "service_booking_controls");
});

test("reviewing service availability preserves an existing nonempty commercial cart without recovery writes", async () => {
  const f = fixture(true, { items: [{ variantId: "existing-variant", quantity: 1 }] }), result = await f.run();
  assert.equal(f.calls.length, 0); assert.equal(result.state.cartHasItems, true);
  assert.equal(result.state.checkoutSessionId, undefined);
});

test("a prepared service checkout retains the verified origin telemetry of that actual checkout", async () => {
  const f = fixture(true, { checkoutSessionId: "wa_checkout_prepared" }); await f.run();
  assert.deepEqual(f.calls, [[{ merchantId: "owned-store", conversationId: "wa_checkout_prepared", cartId: "conversation",
    globalUserId: "buyer", event: WHATSAPP_RECOVERY_ORIGIN_EVENT, metadata: { source: "whatsapp" } }, { configId: "config" }]]);
});

test("ordinary product responses retain the original recovery projection even with retained service state", async () => {
  const f = fixture(false, { retainedServiceState: true }); await f.run();
  assert.deepEqual(f.calls, [[{ merchantId: "owned-store", conversationId: "conversation", cartId: "conversation",
    globalUserId: "buyer", event: "cart_viewed", metadata: { source: "whatsapp" } }, { configId: "config" }]]);
});
