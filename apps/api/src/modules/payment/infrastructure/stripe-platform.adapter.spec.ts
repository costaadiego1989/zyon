import assert from "node:assert/strict";
import test from "node:test";
import { StripePlatformAdapter } from "./stripe-platform.adapter.js";

test("Stripe Connect account creation uses the recovery idempotency generation", async () => {
  const adapter = new StripePlatformAdapter("sk_test_unused");
  let options: { idempotencyKey?: string } | undefined;
  (adapter as unknown as {
    stripe: {
      accounts: {
        create: (_input: unknown, nextOptions: { idempotencyKey?: string }) => Promise<{ id: string }>;
      };
    };
  }).stripe = {
    accounts: {
      create: async (_input, nextOptions) => {
        options = nextOptions;
        return { id: "acct_connect_recovery" };
      },
    },
  };

  const created = await adapter.createConnectAccount({
    merchantId: "mrc_recovery",
    merchantName: "Store",
    email: "owner@example.com",
  });

  assert.equal(created.accountId, "acct_connect_recovery");
  assert.equal(options?.idempotencyKey, "connect:v2:mrc_recovery");
});
