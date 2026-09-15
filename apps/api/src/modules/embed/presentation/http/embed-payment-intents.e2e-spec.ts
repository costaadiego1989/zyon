import { SelectShippingMethodUseCase } from "../../../shipping/application/use-cases/select-shipping-method.use-case.js";
import { InMemoryShippingQuoteRepository } from "../../../shipping/infrastructure/repositories/in-memory-shipping-quote.repository.js";
import { ShippingQuoteEntity } from "../../../shipping/domain/entities/shipping-quote.entity.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { createStartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.fixture.js";
import { TrackCheckoutEventUseCase } from "../../../checkout/application/use-cases/track-checkout-event.use-case.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { InMemoryPaymentRepository } from "../../../payment/infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../../../payment/infrastructure/fake-payment-provider.js";

test("embed payment intents: merchant_id só do embed token após sessão válida", async () => {
  const repo = new InMemoryCheckoutRepository();
  const payments = new InMemoryPaymentRepository();
  const provider = Object.assign(new FakePaymentProvider(), {
    async createCustomer(input: { merchantId: string; email: string }) {
      assert.equal(input.merchantId, "m_embed_pay_token");
      assert.equal(input.email, "embed-buyer@example.test");
      return "cus_embed_verified_provider";
    }
  });
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

  const start = createStartCheckoutUseCase(repo, repo);
  const track = new TrackCheckoutEventUseCase(repo, repo);
  const helper = new EmbedCheckoutGuardHelper(repo);
  const createIntent = new CreatePaymentIntentUseCase(repo, repo, payments, provider);

  const c = new EmbedCheckoutController(start, track, {} as never, helper, {} as never, createIntent, {} as never, {} as never, {} as never, {} as never, {} as never);

  const started = await c.start({ embedClaims }, {
    merchant_id: "evil_body_merchant",
    cart: {
      currency: "BRL",
      total: 250,
      items: [{ sku: "sku", name: "N", price: 250, quantity: 1 }]
    },
    customer: { fullName: "Embed Buyer", email: "embed-buyer@example.test", cpf: "12345678901", asaasCustomerId: "untrusted-browser-id" },
    shipping: { customerPrice: 0, realCost: 0, method: "Frete gratis" }
  });

  await assert.rejects(c.intentFromEmbed({ embedClaims }, { session_id: started.session_id, idempotency_key: "before-shipping" }), /shipping_method_required_before_payment/);
  const quotes = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  await quotes.saveWithEvents(ShippingQuoteEntity.create({ merchant_id: embedClaims.merchantId, session_id: started.session_id, destination_zip: "01310100" }).addResults([
    { carrier_key: "merchant-free-pac", label: "PAC gratuito", price: 0, eta_days: 7, is_free: true }
  ]));
  await new SelectShippingMethodUseCase(quotes, repo).execute({ merchant_id: embedClaims.merchantId, session_id: started.session_id, carrier_key: "merchant-free-pac" });

  const snap = await c.intentFromEmbed(
    { embedClaims },
    { session_id: started.session_id, idempotency_key: randomUUID() }
  );

  assert.equal(repo.getSession(embedClaims.merchantId, started.session_id)?.customer?.asaasCustomerId, "cus_embed_verified_provider");
  assert.equal(snap.merchantId, "m_embed_pay_token");
  assert.equal(snap.sessionId, started.session_id);
  assert.equal(snap.amountCents, 25099);
  assert.ok(snap.buyerFacing?.invoiceUrl);
});
