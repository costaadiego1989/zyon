import assert from "node:assert/strict";
import test from "node:test";
import {
  fiscalStockStatus,
  fiscalPublicReasonCode,
} from "./fiscal-invoice-status.js";
test("FISCAL-58 provider stock remains pending independently of NF authorization", () => {
  assert.deepEqual(
    fiscalStockStatus("provider", [], "fiscal_stock_evidence_pending"),
    {
      owner: "provider",
      state: "awaiting_provider_evidence",
      reasonCode: "fiscal_stock_evidence_pending",
    }
  );
});
test("FISCAL-58 persisted provider stock evidence is distinct from committed barrier release", () => {
  assert.deepEqual(
    fiscalStockStatus(
      "provider",
      [{ action: "stock_effect_reconciled" }],
      null
    ),
    {
      owner: "provider",
      state: "evidence_confirmed",
      reasonCode: "fiscal_stock_release_pending",
    }
  );
});
test("FISCAL-58 persisted stock release takes precedence over an older pending reason", () => {
  assert.deepEqual(
    fiscalStockStatus(
      "provider",
      [
        { action: "stock_effect_reconciled" },
        { action: "stock_barrier_released" },
      ],
      "fiscal_stock_evidence_pending"
    ),
    { owner: "provider", state: "released" }
  );
});
test("FISCAL-58 Zyon ownership projection never invents a provider stock confirmation", () => {
  assert.deepEqual(fiscalStockStatus("zyon", [], null), {
    owner: "zyon",
    state: "managed_by_zyon",
  });
});
test("FISCAL-58 internal stock witness hashes never become human history reasons", () => {
  const hash = "a".repeat(64);
  assert.equal(fiscalPublicReasonCode(hash), null);
  assert.equal(fiscalPublicReasonCode("stock-v1:" + hash + ":12"), null);
  assert.equal(
    fiscalPublicReasonCode("fiscal_stock_evidence_pending"),
    "fiscal_stock_evidence_pending"
  );
});
test("FISCAL-58 unstructured provider text is never a projected human diagnostic", () => {
  assert.equal(fiscalPublicReasonCode('{"token":"private"}'), null);
  assert.equal(fiscalPublicReasonCode(null), null);
});
test("FISCAL-58 invalid persisted stock ownership cannot be presented as verified provider stock", () => { assert.throws(() => fiscalStockStatus("unknown", [], null), /fiscal_stock_owner_invalid/); });
