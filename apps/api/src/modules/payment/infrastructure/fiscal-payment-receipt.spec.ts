import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { StripePaymentAdapter } from "./stripe-payment.adapter.js";
import { AsaasPaymentAdapter } from "./asaas-payment.adapter.js";
import { MercadoPagoPaymentAdapter } from "./mercadopago-payment.adapter.js";
import { RoutingPaymentAdapter } from "./routing-payment.adapter.js";
import type {
  CreateProviderPaymentInput,
  PaymentProviderPort,
} from "../domain/ports/payment-provider.port.js";
const original: CreateProviderPaymentInput = {
  merchantId: "original_merchant",
  sessionId: "original_session",
  intentId: "original_intent",
  amountCents: 1000,
  currency: "BRL",
  method: "card",
  provider: "stripe",
};
function stripe(change: (payment: any) => void = () => {}) {
  let calls = 0;
  const a = new StripePaymentAdapter("sk_test_synthetic", "pk_test_synthetic");
  const payment = {
    id: "pi_original",
    object: "payment_intent",
    livemode: false,
    amount: 1000,
    amount_received: 1000,
    currency: "brl",
    metadata: {
      merchant_id: original.merchantId,
      session_id: original.sessionId,
      intent_id: original.intentId,
    },
    status: "succeeded",
    latest_charge: {
      id: "ch_original",
      object: "charge",
      payment_intent: "pi_original",
      livemode: false,
      paid: true,
      captured: true,
      status: "succeeded",
      amount: 1000,
      amount_captured: 1000,
      amount_refunded: 0,
      currency: "brl",
      refunded: false,
      disputed: false,
      created: 1794792600,
      payment_method_details: {
        type: "card",
        card: {
          funding: "credit",
          brand: "visa",
          authorization_code: "AUTH123",
        },
      },
    },
  };
  change(payment);
  const fetcher = (async (url, init) => {
    calls++;
    assert.equal(
      String(url),
      "https://api.stripe.com/v1/payment_intents/pi_original?expand[0]=latest_charge"
    );
    assert.equal(init?.method, "GET");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer sk_test_synthetic"
    );
    return Response.json(payment);
  }) as typeof fetch;
  (a as any).stripe = new Stripe("sk_test_synthetic", {
    httpClient: Stripe.createFetchHttpClient(fetcher),
    maxNetworkRetries: 0,
  });
  const o = {
    ...original,
    providerAccountFingerprint: a.creationAccountFingerprint(),
  };
  return {
    adapter: a,
    input: {
      original: o,
      merchantId: o.merchantId,
      provider: "stripe",
      providerAccountFingerprint: o.providerAccountFingerprint,
      providerPaymentId: "pi_original",
    },
    calls: () => calls,
  };
}
test("FISCAL-16/19 actual Stripe SDK performs authenticated GET for original captured card receipt", async () => {
  const a = stripe();
  const r = await a.adapter.readPaymentReceipt(a.input);
  assert.equal(r.instrument, "credit");
  assert.equal(r.authorizationCode, "AUTH123");
  assert.equal(r.environment, "test");
  assert.equal(r.amountCents, 1000);
  assert.equal(a.calls(), 1);
});
test("FISCAL-19 nullable Stripe authorization cannot become network id or receipt number", async () => {
  const a = stripe((p) => {
    p.latest_charge.payment_method_details.card.authorization_code = null;
    p.latest_charge.receipt_number = "not-an-auth";
    p.latest_charge.payment_method_details.card.network_transaction_id =
      "not-an-auth";
  });
  await assert.rejects(
    a.adapter.readPaymentReceipt(a.input),
    /card_authorization_unavailable/
  );
});
test("FISCAL-16 Stripe wrong original destination and amount are rejected", async () => {
  for (const change of [
    (p: any) => {
      p.transfer_data = { destination: "acct_foreign" };
    },
    (p: any) => {
      p.latest_charge.amount_captured = 900;
    },
  ]) {
    const a = stripe(change);
    await assert.rejects(a.adapter.readPaymentReceipt(a.input), /mismatch/);
  }
});
test("FISCAL-16 routing selects exact frozen platform account and rejects replacement before GET", async () => {
  const a = stripe();
  const route = new RoutingPaymentAdapter(a.adapter, null, null, {} as any);
  assert.equal(
    (await route.readPaymentReceipt(a.input)).operationId,
    "pi_original"
  );
  const before = a.calls();
  await assert.rejects(
    route.readPaymentReceipt({
      ...a.input,
      providerAccountFingerprint: "changed",
      original: { ...a.input.original, providerAccountFingerprint: "changed" },
    }),
    /account_changed/
  );
  assert.equal(a.calls(), before);
});
function asaas(method = "pix", mutate: (p: any, pix: any) => void = () => {}) {
  const paths: string[] = [];
  const payment = {
    id: "pay_original",
    object: "payment",
    externalReference: original.intentId,
    customer: "cus_original",
    value: 10,
    status: "RECEIVED",
    billingType:
      method === "pix" ? "PIX" : method === "boleto" ? "BOLETO" : "CREDIT_CARD",
    pixTransaction: "pix_original",
    clientPaymentDate: "2026-11-16",
    billingInfo: { creditCard: { token: "NEVER_AUTHORIZATION" } },
  };
  const pix = {
    id: "pix_original",
    status: "DONE",
    type: "CREDIT",
    value: 10,
    effectiveDate: "2026-11-15 22:30:00",
    endToEndIdentifier: "E1234567820261116000000000000000",
    originType: "DYNAMIC_QRCODE",
  };
  mutate(payment, pix);
  const a = new AsaasPaymentAdapter(
    "https://api-sandbox.asaas.com",
    "synthetic-original-key",
    (async (url, init) => {
      paths.push(String(url));
      assert.equal(
        new Headers(init?.headers).get("access_token"),
        "synthetic-original-key"
      );
      assert.equal(init?.body, undefined);
      return Response.json(
        String(url).includes("/pix/transactions/") ? pix : payment
      );
    }) as typeof fetch
  );
  const o = {
    ...original,
    provider: "asaas" as const,
    method,
    asaasCustomerId: "cus_original",
    providerAccountFingerprint: a.creationAccountFingerprint(),
  };
  return {
    adapter: a,
    input: {
      original: o,
      merchantId: o.merchantId,
      provider: "asaas",
      providerAccountFingerprint: o.providerAccountFingerprint,
      providerPaymentId: "pay_original",
    },
    paths,
  };
}
test("FISCAL-19 actual Asaas original Pix transaction authenticated GET supplies genuine modality and E2E", async () => {
  const a = asaas();
  const r = await a.adapter.readPaymentReceipt(a.input);
  assert.deepEqual(a.paths, [
    "https://api-sandbox.asaas.com/v3/payments/pay_original",
    "https://api-sandbox.asaas.com/v3/pix/transactions/pix_original",
  ]);
  assert.equal(r.instrument, "dynamic_pix");
  assert.equal(r.authorizationCode, "E1234567820261116000000000000000");
  assert.equal(r.nsu, undefined);
});
test("FISCAL-19 Asaas refund E2E or billingInfo token cannot replace original Pix/card receipt", async () => {
  const a = asaas("pix", (p) => {
    delete p.pixTransaction;
    p.refunds = [{ endToEndIdentifier: "REFUND_IS_NOT_ORIGINAL" }];
  });
  await assert.rejects(
    a.adapter.readPaymentReceipt(a.input),
    /pix_transaction_unavailable/
  );
  const b = asaas("card");
  await assert.rejects(
    b.adapter.readPaymentReceipt(b.input),
    /card_authorization_unavailable/
  );
});
test("FISCAL-19 actual Asaas boleto receipt retains code15 classification without fake card data", async () => {
  const a = asaas("boleto");
  const r = await a.adapter.readPaymentReceipt(a.input);
  assert.equal(r.instrument, "boleto");
  assert.equal(r.paidAt, "2026-11-16");
  assert.equal(r.authorizationCode, undefined);
});
test("FISCAL-16 Asaas original Pix identity or amount mismatch fails after authenticated GET", async () => {
  for (const change of [
    (p: any) => {
      p.id = "foreign";
    },
    (_p: any, pix: any) => {
      pix.value = 9;
    },
  ]) {
    const a = asaas("pix", change);
    await assert.rejects(
      a.adapter.readPaymentReceipt(a.input),
      /mismatch|unavailable/
    );
  }
});
test("FISCAL-19 actual Mercado Pago card receipt uses authorization_code and date_approved", async () => {
  const a = new MercadoPagoPaymentAdapter(
    "https://api.mercadopago.com",
    "synthetic-mp",
    undefined,
    (async (url, init) => {
      assert.equal(String(url), "https://api.mercadopago.com/v1/payments/123");
      assert.equal(init?.method, "GET");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer synthetic-mp"
      );
      return Response.json({
        id: 123,
        external_reference: original.intentId,
        status: "approved",
        transaction_amount: 10,
        currency_id: "BRL",
        live_mode: false,
        payment_type_id: "credit_card",
        payment_method_id: "visa",
        authorization_code: "MPAUTH",
        date_approved: "2026-11-15T22:30:00-03:00",
      });
    }) as typeof fetch
  );
  const o = {
    ...original,
    provider: "mercadopago" as const,
    providerAccountFingerprint: a.creationAccountFingerprint(),
  };
  const r = await a.readPaymentReceipt({
    original: o,
    merchantId: o.merchantId,
    provider: o.provider,
    providerAccountFingerprint: o.providerAccountFingerprint,
    providerPaymentId: "123",
  });
  assert.equal(r.authorizationCode, "MPAUTH");
  assert.equal(r.paidAt, "2026-11-15T22:30:00-03:00");
});
