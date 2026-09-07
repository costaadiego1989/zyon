import test from "node:test";
import assert from "node:assert/strict";
import { ClassifyCustomerIntentUseCase, RecordIntentIfConsentedUseCase } from "../application/use-cases/classify-customer-intent.use-case.js";
import { InMemoryBuyerIntentConsentRepository } from "../infrastructure/repositories/in-memory-buyer-intent-consent.repository.js";
import { InMemoryIntentMemoryRepository } from "../infrastructure/repositories/in-memory-intent-memory.repository.js";

const input = {
  merchantId: "merchant-intent",
  globalUserId: "buyer-intent",
  sessionEvents: ["checkout_started", "shipping_objection_detected"],
  cart: { total: 120, items: [{ name: "Produto", sku: "sku-1", price: 120 }] },
};

test("intent records are persisted only while consent is active", async () => {
  const consents = new InMemoryBuyerIntentConsentRepository();
  const records = new InMemoryIntentMemoryRepository();
  const recorder = new RecordIntentIfConsentedUseCase(consents, records, new ClassifyCustomerIntentUseCase());

  assert.deepEqual(await recorder.execute(input), { recorded: false });
  assert.equal(await records.getLatest(input.merchantId, input.globalUserId), null);

  await consents.saveConsent({
    merchant_id: input.merchantId,
    global_user_id: input.globalUserId,
    opted_in: true,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  const accepted = await recorder.execute(input);
  assert.equal(accepted.recorded, true);
  assert.equal(accepted.record?.merchant_id, input.merchantId);
  assert.ok(await records.getLatest(input.merchantId, input.globalUserId));

  await consents.deleteConsent(input.merchantId, input.globalUserId);
  assert.deepEqual(await recorder.execute(input), { recorded: false });
});
