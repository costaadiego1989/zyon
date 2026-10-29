import test from "node:test";
import assert from "node:assert/strict";
import { OneBuyClickSessionService } from "./one-buy-click-session.service.js";

function createPrisma(preferences?: Record<string, unknown>) {
  let session: Record<string, any> | null = null;
  return {
    buyerPreference: {
      findUnique: async () => preferences ?? null,
    },
    oneBuyClickSession: {
      findUnique: async () => session && { ...session },
      upsert: async ({ create, update }: { create: Record<string, any>; update: Record<string, any> }) => {
        session = session ? { ...session, ...update, updatedAt: new Date() } : { ...create, id: "onebuy_session", updatedAt: new Date() };
        return { ...session };
      },
    },
  };
}

test("anonymous OneBuyClick sessions start paused with guest-safe defaults", async () => {
  const service = new OneBuyClickSessionService(createPrisma() as never);

  const state = await service.get({ merchantId: "merchant", conversationId: "conversation" });

  assert.deepEqual(state, {
    enabled: false,
    status: "paused",
    shippingPreference: "cheapest",
    paymentPreference: "pix",
    preferencesConfigured: false,
  });
});

test("the prepared checkout action is idempotent for the same cart and renews for a changed cart", async () => {
  const service = new OneBuyClickSessionService(createPrisma({
    oneBuyClickEnabled: true,
    shippingPreference: "cheapest",
    paymentPreference: "card",
    purchasePreferencesConfigured: true,
  }) as never);
  const input = { merchantId: "merchant", conversationId: "conversation", globalUserId: "buyer" };

  const initial = await service.get(input);
  const first = await service.prepareCheckout({ ...input, cartFingerprint: "cart-a" });
  const repeated = await service.prepareCheckout({ ...input, cartFingerprint: "cart-a" });
  const changed = await service.prepareCheckout({ ...input, cartFingerprint: "cart-b" });

  assert.equal(initial.enabled, true);
  assert.equal(first.status, "ready_for_payment");
  assert.equal(first.shippingPreference, "cheapest");
  assert.equal(first.paymentPreference, "card");
  assert.equal(first.preferencesConfigured, true);
  assert.equal(repeated.preparedActionId, first.preparedActionId);
  assert.notEqual(changed.preparedActionId, first.preparedActionId);
});

test("a session created before login is rehydrated with authenticated purchase preferences", async () => {
  const service = new OneBuyClickSessionService(createPrisma({
    oneBuyClickEnabled: true,
    shippingPreference: "fastest",
    paymentPreference: "pix",
    purchasePreferencesConfigured: true,
  }) as never);

  const anonymous = await service.get({ merchantId: "merchant", conversationId: "conversation" });
  const authenticated = await service.get({ merchantId: "merchant", conversationId: "conversation", globalUserId: "buyer" });

  assert.equal(anonymous.enabled, false);
  assert.equal(authenticated.enabled, true);
  assert.equal(authenticated.preferencesConfigured, true);
  assert.equal(authenticated.shippingPreference, "fastest");
});

test("a buyer cannot prepare a fast checkout before preferences are explicitly configured", async () => {
  const service = new OneBuyClickSessionService(createPrisma({
    oneBuyClickEnabled: true,
    shippingPreference: "cheapest",
    paymentPreference: "pix",
    purchasePreferencesConfigured: false,
  }) as never);
  const input = { merchantId: "merchant", conversationId: "conversation", globalUserId: "buyer" };

  const state = await service.prepareCheckout({ ...input, cartFingerprint: "cart-a" });

  assert.equal(state.enabled, false);
  assert.equal(state.preparedActionId, undefined);
});
