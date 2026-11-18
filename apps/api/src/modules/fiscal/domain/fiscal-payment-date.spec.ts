import assert from "node:assert/strict";
import test from "node:test";
import {
  fiscalCalendarDate,
  fiscalProviderInstant,
} from "./fiscal-payment-date.js";
import {
  admitFiscalPaymentEvidence,
  focusPaymentFields,
} from "./fiscal-payment-evidence.port.js";
test("FISCAL-16/19 issuer calendar midnight uses confirmed timezone and preserves original instant", () => {
  const instant = "2026-11-16T01:30:00.000Z";
  assert.equal(fiscalCalendarDate(instant, "America/Sao_Paulo"), "2026-11-15");
  assert.equal(fiscalCalendarDate(instant, "UTC"), "2026-11-16");
  assert.equal(fiscalProviderInstant("2026-11-15T22:30:00-03:00"), instant);
});
test("FISCAL-16/19 provider local datetime requires explicit confirmed timezone", () => {
  assert.throws(() => fiscalProviderInstant("2026-11-15 22:30:00"), /timezone/);
  assert.equal(
    fiscalProviderInstant("2026-11-15 22:30:00", "America/Sao_Paulo"),
    "2026-11-16T01:30:00.000Z"
  );
});
test("FISCAL-16/19 ambiguous and missing local DST instants are rejected", () => {
  assert.throws(() =>
    fiscalProviderInstant("2026-03-08 02:30:00", "America/New_York")
  );
  assert.throws(() =>
    fiscalProviderInstant("2026-11-01 01:30:00", "America/New_York")
  );
});

test("FISCAL-16/19 provider date-only receipt must be a real calendar day", () => {
  assert.throws(
    () => fiscalCalendarDate("2026-02-30", "America/Sao_Paulo"),
    /date_invalid/
  );
  assert.throws(() => fiscalProviderInstant("2026-02-30"), /date_invalid/);
  assert.equal(
    fiscalCalendarDate("2028-02-29", "America/Sao_Paulo"),
    "2028-02-29"
  );
});
test("FISCAL-16/19 boleto code15 has no invented electronic acquirer and crypto99 has actual description", () => {
  assert.deepEqual(
    focusPaymentFields({
      code: "15",
      amountCents: 1000,
      paidAt: "2026-11-16",
      fiscalDate: "2026-11-16",
      evidenceReference: "authenticated_boleto",
    }),
    { forma_pagamento: "15", valor_pagamento: 10, data_pagamento: "2026-11-16" }
  );
  const result = focusPaymentFields({
    code: "99",
    amountCents: 1000,
    paidAt: "2026-11-16T01:30:00Z",
    fiscalDate: "2026-11-15",
    description: "USDC recebido na rede original",
    evidenceReference: "chain_receipt",
  });
  assert.equal(result.descricao_pagamento, "USDC recebido na rede original");
  assert.equal(result.tipo_integracao, undefined);
  assert.equal(result.data_pagamento, "2026-11-15");
});
test("FISCAL-04 trusted TEST payment cannot admit production NF before fiscal transport", () => {
  let fiscalCalls = 0;
  const binding = {
    merchantId: "merchant",
    proofRef: "original",
    provider: "stripe",
    accountId: "frozen-account",
    environment: "test",
    operationId: "pi_original",
    amountCents: 1000,
    currency: "BRL",
  };
  assert.throws(() => {
    admitFiscalPaymentEvidence({ environment: "production" } as any, {
      binding,
      receipt: {
        ...binding,
        captured: true,
        instrument: "credit",
        authorizationCode: "auth",
        acquirerTaxId: "11222333000181",
        brandCode: "01",
        paidAt: "2026-11-16T01:30:00Z",
        evidenceReference: "authenticated",
      },
    });
    fiscalCalls++;
  }, /environment_mismatch/);
  assert.equal(fiscalCalls, 0);
});
