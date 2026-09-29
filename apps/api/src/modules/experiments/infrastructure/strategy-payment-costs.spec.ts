import test from "node:test";
import assert from "node:assert/strict";
import type { MeasurementPlan } from "../domain/services/measurement-plan.js";
import { strategyPaymentCosts } from "./strategy-measurement.reader.js";

const plan = { controlVariantId: "c", treatmentVariantId: "t" } as MeasurementPlan;
test("payment cost aggregation rejects overflow including a sum of individually safe amounts", () => {
  for (const fields of [ { platform_fees: BigInt(Number.MAX_SAFE_INTEGER) + 1n, provider_fees: 0 },
    { platform_fees: Number.MAX_SAFE_INTEGER, provider_fees: 1 }, { platform_fees: -1, provider_fees: 1 } ]) {
    const result = strategyPaymentCosts([{ variant: "c", orders: 1, linked_payments: 1, confirmed_payments: 1, ...fields }], plan);
    assert.equal(result.control.confirmedPlatformFeeCents, null);
    assert.equal(result.control.confirmedProviderFeeCents, null);
    assert.equal(result.control.confirmedPaymentFeesCents, null);
    assert.equal(result.control.knownConfirmedPaymentFeesCents, null);
  }
});
