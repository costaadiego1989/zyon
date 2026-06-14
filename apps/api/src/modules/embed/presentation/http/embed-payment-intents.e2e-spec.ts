import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "../../../checkout/application/use-cases/track-checkout-event.use-case.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { InMemoryPaymentRepository } from "../../../payment/infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../../../payment/infrastructure/fake-payment-provider.js";

test("embed payment intents: merchant_id só do embed token após sessão válida", async () => {
  const repo = new InMemoryCheckoutRepository();
  const payments = new InMemoryPaymentRepository();
  const provider = new FakePaymentProvider();
  const tokens = new EmbedTokenService({
    value: Buffer.from("embed-pay-intents-e2e-32-characters!!")
  });
  const now = Math.floor(Date.now() / 1000);
  const embedClaims = tokens.verify(
    tokens.sign({
      typ: "aacp_embed_v1",
      merchantId: "m_embed_pay_token",
      issuedAtUnix: now,
      expiresAtUnix: now + 4000,
      nonce: randomUUID()
    })
  );

  const start = new StartCheckoutUseCase(repo, repo, repo);
  const track = new TrackCheckoutEventUseCase(repo, repo);
  const helper = new EmbedCheckoutGuardHelper(repo);
  const createIntent = new CreatePaymentIntentUseCase(repo, repo, payments, provider);

  const c = new EmbedCheckoutController(start, track, {} as never, helper, {} as never, createIntent, {} as never, {} as never, {} as never);

  const started = await c.start({ embedClaims }, {
    merchant_id: "evil_body_merchant",
    cart: {
      currency: "BRL",
      total: 250,
      items: [{ sku: "sku", name: "N", price: 250, quantity: 1 }]
    },
    customer: { asaasCustomerId: "cus_embed_pay_fixture_ok" },
    shipping: { customerPrice: 0, realCost: 0, method: "Frete gratis" }
  });

  const snap = await c.intentFromEmbed(
    { embedClaims },
    { session_id: started.session_id, idempotency_key: randomUUID() }
  );

  assert.equal(snap.merchantId, "m_embed_pay_token");
  assert.equal(snap.sessionId, started.session_id);
  assert.equal(snap.amountCents, 250 * 100);
  assert.ok(snap.buyerFacing?.invoiceUrl);
});
