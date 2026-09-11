import test from "node:test";
import assert from "node:assert/strict";
import { PayoutSubmissionError } from "../domain/ports/payment-payout-provider.port.js";
import { AsaasPayoutAdapter } from "./asaas-payout.adapter.js";

test("Asaas payout creates a linked-wallet transfer with an external reference", async () => {
  const calls: Array<{ url: string; init: any }> = [];
  const adapter = new AsaasPayoutAdapter("https://api-sandbox.asaas.com", "asaas_test_key", (async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ id: "transfer_1", status: "DONE" }) } as Response;
  }) as typeof fetch);

  const result = await adapter.submitAsaasInternalPayout({
    payoutDestination: "wallet_merchant",
    amountCents: 9_850,
    payoutReference: "zyon:payment-hold:hold_1",
  });

  assert.deepEqual(result, { providerTransferId: "transfer_1", state: "submitted" });
  assert.equal(calls[0]?.url, "https://api-sandbox.asaas.com/v3/transfers/");
  assert.equal(calls[0]?.init.headers.access_token, "asaas_test_key");
  assert.deepEqual(JSON.parse(calls[0]?.init.body), {
    value: 98.5,
    walletId: "wallet_merchant",
    externalReference: "zyon:payment-hold:hold_1",
  });
});

test("Asaas payout treats a network failure as unresolved instead of retry-safe", async () => {
  const adapter = new AsaasPayoutAdapter("https://api-sandbox.asaas.com", "asaas_test_key", (async () => {
    throw new Error("network down");
  }) as typeof fetch);

  await assert.rejects(
    () => adapter.submitAsaasInternalPayout({ payoutDestination: "wallet_merchant", amountCents: 1, payoutReference: "ref_1" }),
    (error: unknown) => error instanceof PayoutSubmissionError && error.definitive === false,
  );
});
