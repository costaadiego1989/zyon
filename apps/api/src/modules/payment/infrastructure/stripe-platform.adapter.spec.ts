import assert from "node:assert/strict";
import test from "node:test";
import { StripePlatformAdapter } from "./stripe-platform.adapter.js";

for (const scenario of ["apply", "reuse", "remove"] as const) {
  test(`subscription checkout ${scenario}: session identity includes the validated promotion`, async () => {
    const adapter = new StripePlatformAdapter("sk_test_unused");
    const expired: string[] = []; const created: any[] = [];
    const sessions = [
      { id: "old-plain", mode: "subscription", url: "https://checkout.stripe.test/plain", metadata: { merchant_id: "m1", price_id: "price1" } },
      ...(scenario !== "apply" ? [{ id: "old-discount", mode: "subscription", url: "https://checkout.stripe.test/discount", metadata: { merchant_id: "m1", price_id: "price1", promotion_code_id: "promo_checked" } }] : []),
      { id: "other-merchant", mode: "subscription", metadata: { merchant_id: "m2", price_id: "price1" } },
    ];
    (adapter as any).stripe = { checkout: { sessions: {
      list: async () => ({ data: sessions }), expire: async (id: string) => { expired.push(id); },
      create: async (input: any) => { created.push(input); return { id: "new", url: "https://checkout.stripe.test/new" }; },
    } } };
    const result = await adapter.createSubscriptionCheckout({ merchantId: "m1", customerId: "cus1", priceId: "price1", promotionCodeId: scenario === "remove" ? undefined : "promo_checked", successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" });
    assert.ok(!expired.includes("other-merchant"));
    if (scenario === "apply") {
      assert.deepEqual(expired, ["old-plain"]); assert.equal(result.sessionId, "new");
      assert.deepEqual(created[0].discounts, [{ promotion_code: "promo_checked" }]);
      assert.equal(created[0].allow_promotion_codes, undefined);
    } else {
      assert.equal(created.length, 0);
      assert.equal(result.sessionId, scenario === "reuse" ? "old-discount" : "old-plain");
      assert.deepEqual(expired, [scenario === "reuse" ? "old-plain" : "old-discount"]);
    }
  });
}

test("checkout without a campaign uses the app flow and hides native Stripe code entry", async () => {
  const adapter = new StripePlatformAdapter("sk_test_unused"); let created: any;
  (adapter as any).stripe = { checkout: { sessions: { list: async () => ({ data: [] }), create: async (input: any) => { created = input; return { id: "new", url: "https://checkout.stripe.test/new" }; } } } };
  await adapter.createSubscriptionCheckout({ merchantId: "m1", customerId: "cus1", priceId: "price1", successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" });
  assert.equal(created.allow_promotion_codes, false); assert.equal(created.discounts, undefined);
});

test("Stripe Connect account creation uses Accounts v2 Managed Risk configuration", async () => {
  const adapter = new StripePlatformAdapter("sk_test_unused");
  let input: Record<string, unknown> | undefined;
  let options: { idempotencyKey?: string } | undefined;
  (adapter as unknown as {
    stripe: {
      v2: { core: { accounts: {
        create: (_input: unknown, nextOptions: { idempotencyKey?: string }) => Promise<{ id: string }>;
      } } };
    };
  }).stripe = {
    v2: { core: { accounts: {
      create: async (_input, nextOptions) => {
        input = _input as Record<string, unknown>;
        options = nextOptions;
        return { id: "acct_connect_recovery" };
      },
    } } },
  };

  const created = await adapter.createConnectAccount({
    merchantId: "mrc_recovery",
    merchantName: "Store",
    email: "owner@example.com",
  });

  assert.equal(created.accountId, "acct_connect_recovery");
  assert.equal(options?.idempotencyKey, "connect:v3:mrc_recovery");
  assert.deepEqual(input, {
    contact_email: "owner@example.com",
    dashboard: "full",
    identity: { country: "BR" },
    defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
    display_name: "Store",
    metadata: { merchant_id: "mrc_recovery" },
  });
});
