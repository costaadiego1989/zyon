import assert from "node:assert/strict";
import test from "node:test";
import { StripePlatformAdapter } from "./stripe-platform.adapter.js";

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
