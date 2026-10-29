import test from "node:test";
import assert from "node:assert/strict";
import { MercadoPagoPaymentAdapter } from "./mercadopago-payment.adapter.js";
import { PaymentCreationRejectedError } from "../domain/payment-creation-rejected.error.js";
import type { CreateProviderPaymentInput } from "../domain/ports/payment-provider.port.js";

const input: CreateProviderPaymentInput = {
  merchantId: "merchant", sessionId: "session", intentId: "intent",
  providerIdempotencyKey: "stable-key", method: "pix", amountCents: 9804,
  currency: "BRL", payerEmail: "buyer@example.test",
  payerName: "Cliente de Teste", payerIdentification: { type: "CPF", number: "52998224725" },
  description: "Athom Technologies — 1x Sérum, 2x Bruma",
};
const payment = {
  id: 123, status: "pending", payment_method_id: "pix", external_reference: "intent",
  metadata: { intent_id: "intent", session_id: "session" },
  transaction_amount: 98.04, currency_id: "BRL", date_of_expiration: "2026-10-01T12:00:00Z",
  point_of_interaction: { transaction_data: {
    qr_code: "000201-pix", qr_code_base64: "base64-image",
    ticket_url: "https://www.mercadopago.com.br/payments/123/ticket",
  } },
};

test("Mercado Pago partial creation hydrates Pix by ID and preserves description and expiry", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const fetcher = (async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? "GET" });
    if (init?.method === "POST") {
      assert.equal(JSON.parse(String(init.body)).description, input.description);
      assert.deepEqual(JSON.parse(String(init.body)).payer, {
        email: "buyer@example.test", first_name: "Cliente", last_name: "de Teste",
        identification: { type: "CPF", number: "52998224725" },
      });
      assert.equal(new Headers(init.headers).get("X-Idempotency-Key"), "stable-key");
      return Response.json({ id: 123 });
    }
    return Response.json(payment);
  }) as typeof fetch;
  const result = await new MercadoPagoPaymentAdapter("https://mp.test", "fake", "", fetcher).createPayment(input);
  assert.deepEqual(requests.map(r => r.method), ["POST", "GET"]);
  assert.equal(requests[1].url, "https://mp.test/v1/payments/123");
  assert.equal(result.buyerFacingPayload.qrCodeCopyPaste, "000201-pix");
  assert.equal(result.buyerFacingPayload.encodedQrImage, "base64-image");
  assert.equal(result.buyerFacingPayload.invoiceUrl, payment.point_of_interaction.transaction_data.ticket_url);
  assert.equal(result.buyerFacingPayload.quoteExpiresAt, payment.date_of_expiration);
});

test("Mercado Pago lost creation response recovers the same Pix without another POST", async () => {
  let posts = 0;
  const fetcher = (async (url, init) => {
    if (init?.method === "POST") { posts++; throw new Error("timeout"); }
    assert.equal(new URL(String(url)).searchParams.get("external_reference"), "intent");
    return Response.json({ results: [payment], paging: { total: 1 } });
  }) as typeof fetch;
  const result = await new MercadoPagoPaymentAdapter("https://mp.test", "fake", "", fetcher).createPayment(input);
  assert.equal(posts, 1);
  assert.equal(result.providerPaymentId, "123");
  assert.equal(result.buyerFacingPayload.qrCodeCopyPaste, "000201-pix");
});

test("Mercado Pago search without QR hydrates only the matched payment", async () => {
  const fetcher = (async (url, init) => {
    assert.notEqual(init?.method, "POST");
    return Response.json(String(url).includes("/search?")
      ? { results: [{ ...payment, point_of_interaction: undefined }], paging: { total: 1 } }
      : payment);
  }) as typeof fetch;
  const result = await new MercadoPagoPaymentAdapter("https://mp.test", "fake", "", fetcher).recoverPayment(input);
  assert.equal(result?.buyerFacingPayload.qrCodeCopyPaste, "000201-pix");
});

for (const scenario of ["missing_code", "wrong_reference", "wrong_amount", "wrong_method"] as const) {
  test(`Mercado Pago ${scenario} cannot become a payable Pix`, async () => {
    const details = { ...payment,
      ...(scenario === "missing_code" ? { point_of_interaction: undefined } : {}),
      ...(scenario === "wrong_reference" ? { external_reference: "other" } : {}),
      ...(scenario === "wrong_amount" ? { transaction_amount: 98.05 } : {}),
      ...(scenario === "wrong_method" ? { payment_method_id: "visa" } : {}),
    };
    const fetcher = (async (_url, init) => Response.json(init?.method === "POST" ? { id: 123 } : details)) as typeof fetch;
    await assert.rejects(
      new MercadoPagoPaymentAdapter("https://mp.test", "fake", "", fetcher).createPayment(input),
      scenario === "missing_code" ? /pix_payload_unavailable/ : /recovery_mismatch/,
    );
  });
}

test("Mercado Pago card checkout receives the same readable store and product description", async () => {
  const fetcher = (async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).items[0].title, input.description);
    return Response.json({ id: "pref_1", init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref_1" });
  }) as typeof fetch;
  await new MercadoPagoPaymentAdapter("https://mp.test", "fake", "", fetcher).createPayment({ ...input, method: "card" });
});

test("Mercado Pago rejection exposes only status and cause codes for diagnosis", async () => {
  const fetcher = (async () => Response.json({
    message: "private payer data must never enter the exception",
    cause: [{ code: 132, description: "private details" }],
  }, { status: 400 })) as typeof fetch;
  await assert.rejects(
    new MercadoPagoPaymentAdapter("https://mp.test", "fake", "", fetcher).createPayment(input),
    { message: "mercadopago_payment_create_failed:400:132" },
  );
});

test("Mercado Pago missing recovery result preserves uncertainty without another POST", async () => {
  let posts = 0;
  const fetcher = (async (_url, init) => {
    if (init?.method === "POST") { posts++; throw new Error("request_timeout"); }
    return Response.json({ results: [], paging: { total: 0 } });
  }) as typeof fetch;
  await assert.rejects(
    new MercadoPagoPaymentAdapter("https://mp.test", "fake", "", fetcher).createPayment(input),
    /request_timeout/,
  );
  assert.equal(posts, 1);
});

for (const scenario of ["same_account", "different_account", "unavailable", "invalid_identity"] as const) {
  for (const method of ["pix", "card"] as const) {
    test(`Mercado Pago ${method} fee decision authenticates both accounts: ${scenario}`, async () => {
      const reads: string[] = [];
      let posts = 0;
      const fetcher = (async (url, init) => {
        const auth = new Headers(init?.headers).get("authorization")!;
        if (String(url).endsWith("/users/me")) {
          reads.push(auth);
          if (auth === "Bearer platform" && scenario === "unavailable") return Response.json({}, { status: 503 });
          return Response.json({ id: scenario === "invalid_identity" ? null : auth === "Bearer seller" || scenario === "same_account" ? 123 : 456 });
        }
        posts++;
        const body = JSON.parse(String(init?.body));
        const fee = method === "pix" ? body.application_fee : body.marketplace_fee;
        assert.equal(fee, scenario === "same_account" ? undefined : 2.98);
        assert.equal(method === "pix" ? body.transaction_amount : body.items[0].unit_price, 98.04);
        assert.equal(auth, "Bearer seller");
        assert.equal(new Headers(init?.headers).get("X-Idempotency-Key"), "stable-key");
        return Response.json(method === "pix" ? payment : { id: "pref", init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref" });
      }) as typeof fetch;
      const platform = new MercadoPagoPaymentAdapter("https://mp.test", "platform", "", fetcher);
      const seller = new MercadoPagoPaymentAdapter("https://mp.test", "seller", "", fetcher, true, true, platform);
      const prepared = await seller.preparePayment({ ...input, method, platformFeeCents: 298 });
      assert.equal(prepared.mercadoPagoFeeMode, scenario === "same_account" ? "same_account" : "split");
      assert.equal(prepared.platformFeeCents, 298);
      const result = await seller.createPayment(prepared);
      assert.equal(posts, 1);
      assert.deepEqual(reads.sort(), ["Bearer platform", "Bearer seller"]);
      if (method === "pix") assert.ok(result.buyerFacingPayload.qrCodeCopyPaste);
    });
  }
}

test("Mercado Pago 2059 is a definite refusal and never retries without the platform commission", async () => {
  let posts = 0;
  const fetcher = (async (_url, init) => {
    assert.equal(init?.method, "POST"); posts++;
    assert.equal(JSON.parse(String(init?.body)).application_fee, 2.98);
    return Response.json({ cause: [{ code: 2059, description: "private" }] }, { status: 400 });
  }) as typeof fetch;
  await assert.rejects(
    new MercadoPagoPaymentAdapter("https://mp.test", "seller", "", fetcher, true, true)
      .createPayment({ ...input, platformFeeCents: 298 }),
    error => error instanceof PaymentCreationRejectedError && error.code === "mercadopago_oauth_required_for_platform_fee",
  );
  assert.equal(posts, 1);
});

test("Mercado Pago 13253 identifies a missing Pix key without retrying the rejected charge", async () => {
  let posts = 0;
  const fetcher = (async (_url, init) => {
    assert.equal(init?.method, "POST"); posts++;
    return Response.json({message:"Collector user without key enabled for QR rendernull",cause:[{code:13253,description:"Error in Financial Identity Use Case"}]},{status:400});
  }) as typeof fetch;
  await assert.rejects(new MercadoPagoPaymentAdapter("https://mp.test","seller","",fetcher).createPayment(input),
    error=>error instanceof PaymentCreationRejectedError&&error.code==="mercadopago_pix_key_required"&&error.providerCode==="13253");
  assert.equal(posts,1);
});
