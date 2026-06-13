import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "../../../checkout/application/use-cases/track-checkout-event.use-case.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";

test("embed smoke: start checkout then track with token-bound merchant", async () => {
  const repo = new InMemoryCheckoutRepository();
  const tokens = new EmbedTokenService({
    value: Buffer.from("embed-e2e-smoke-token-secret00000")
  });
  const now = Math.floor(Date.now() / 1000);
  const embedClaims = tokens.verify(
    tokens.sign({
      typ: "aacp_embed_v1",
      merchantId: "m_e2e_smoke",
      issuedAtUnix: now,
      expiresAtUnix: now + 4000,
      nonce: randomUUID()
    })
  );

  const start = new StartCheckoutUseCase(repo, repo, repo);
  const track = new TrackCheckoutEventUseCase(repo, repo);
  const helper = new EmbedCheckoutGuardHelper(repo);
  const c = new EmbedCheckoutController(start, track, {} as never, helper, {} as never, {} as never, {} as never, {} as never);

  const started = await c.start(
    { embedClaims },
    {
      merchant_id: "ignore_me",
      cart: {
        currency: "BRL",
        total: 50,
        items: [{ sku: "s", name: "S", price: 50, quantity: 1, cost: 20 }]
      }
    }
  );

  const tracked = await c.track(
    { embedClaims },
    {
      merchant_id: "ignore_me",
      session_id: started.session_id,
      event: "cart_viewed"
    }
  );

  assert.equal(tracked.received, true);
  assert.equal(typeof tracked.abandonment_score, "number");
});
