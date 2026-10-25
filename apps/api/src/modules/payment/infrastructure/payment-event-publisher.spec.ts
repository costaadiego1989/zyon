import test from "node:test";
import assert from "node:assert/strict";
import { PaymentEventPublisher } from "./payment-event-publisher.js";

test("publishStatusChange publishes to the per-intent channel with correct payload", async () => {
  const publishCalls: Array<[string, string]> = [];
  const setCalls: unknown[][] = [];
  const redis = {
    publish: async (channel: string, message: string) => {
      publishCalls.push([channel, message]);
      return 1;
    },
    set: async (...args: unknown[]) => {
      setCalls.push(args);
      return "OK";
    },
  };

  const publisher = new PaymentEventPublisher(redis);
  const at = "2026-08-27T10:00:00.000Z";

  await publisher.publishStatusChange("pay_int_x", "approved", "merchant_1", at);

  assert.equal(publishCalls.length, 1);
  const [channel, serialized] = publishCalls[0];
  assert.equal(channel, "payment:status:pay_int_x");
  assert.deepEqual(JSON.parse(serialized), {
    intentId: "pay_int_x",
    status: "approved",
    merchantId: "merchant_1",
    at,
  });

  assert.equal(setCalls.length, 1);
  assert.deepEqual(setCalls[0], [
    "payment:status:last:pay_int_x",
    serialized,
    "EX",
    1800,
  ]);
});

test("publishStatusChange is a no-op when Redis client is null", async () => {
  const publisher = new PaymentEventPublisher(null);

  const result = await publisher.publishStatusChange(
    "pay_int_x",
    "approved",
    "merchant_1"
  );

  assert.equal(result, undefined);
});
