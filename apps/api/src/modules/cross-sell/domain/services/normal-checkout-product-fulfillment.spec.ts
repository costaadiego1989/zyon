import assert from "node:assert/strict";
import test from "node:test";
import { readNormalCheckoutProductFulfillment } from "./normal-checkout-product-fulfillment.js";

const now = new Date("2026-10-20T12:00:00.000Z");
for (const [type, strategy, stock] of [["physical", "carrier", true], ["food", "carrier", true],
  ["digital", "digital", false], ["service", "service", false]] as const) {
  test(`canonical ${type} keeps fulfillment and physical-stock requirement`, () => {
    assert.deepEqual(readNormalCheckoutProductFulfillment({ type, metadata: type === "digital" ? { downloadUrl: "https://example.test/file.pdf" } : null }, now),
      { productType: type, fulfillmentStrategy: strategy, requiresStock: stock });
  });
}
for (const mode of ["pickup", "local_delivery"] as const) test(`physical canonical ${mode} cannot override digital delivery`, () => {
  assert.equal(readNormalCheckoutProductFulfillment({ type: "physical", metadata: { fulfillmentStrategy: mode } }, now).fulfillmentStrategy, mode);
  assert.equal(readNormalCheckoutProductFulfillment({ type: "digital", metadata: { downloadUrl: "https://example.test/file.pdf", fulfillmentStrategy: mode } }, now).fulfillmentStrategy, "digital");
});
for (const metadata of [null, {}, { downloadUrl: "http://example.test/file.pdf" }, { downloadUrl: "https://example.test/file.pdf", downloadExpiryDays: 0 }])
  test(`undeliverable digital content never acquires a normal grant: ${JSON.stringify(metadata)}`, () => {
    assert.throws(() => readNormalCheckoutProductFulfillment({ type: "digital", metadata }, now), value =>
      value instanceof Error && ["digital_content_unavailable", "invalid_download_url", "invalid_download_expiry"].includes(value.message));
  });
test("actual service agenda requires a canonical selected slot, never inference", () => {
  assert.throws(() => readNormalCheckoutProductFulfillment({ type: "service", metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 30,
    slots: [{ id: "slot", date: "2026-10-21", startTime: "12:00" }] } } }, now), { message: "service_slot_required" });
});
test("invalid service metadata cannot become an unscheduled sale", () => {
  assert.throws(() => readNormalCheckoutProductFulfillment({ type: "service", metadata: { serviceType: "fabricated" } }, now), { message: "invalid_service_type" });
});
test("unknown catalog type cannot be promoted by a cast", () => {
  assert.throws(() => readNormalCheckoutProductFulfillment({ type: "unknown", metadata: {} }, now));
});
