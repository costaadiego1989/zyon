import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession, authorizedOffer } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import type { ApplyOfferRequest, ApplyOfferResponse } from "@aacp/shared-types";

test("embed offers apply uses merchant from token and ignores body merchant_id", async () => {
  const tokens = new EmbedTokenService({
    value: Buffer.from("embed-apply-spec-secret32chars!!!!!x")
  });
  const now = Math.floor(Date.now() / 1000);
  const claims = tokens.verify(
    tokens.sign({
      typ: "aacp_embed_v1",
      merchantId: "m_embed",
      issuedAtUnix: now,
      expiresAtUnix: now + 7200,
      nonce: randomUUID()
    })
  );

  const checkout = new InMemoryCheckoutRepository();
  checkout.saveSession(
    checkoutSession({
      merchantId: "m_embed",
      sessionId: "s1",
      cart: {
        currency: "BRL",
        total: 100,
        items: [{ sku: "k", name: "N", price: 100, quantity: 1, cost: 40 }]
      }
    })
  );

  checkout.saveOffer(
    authorizedOffer({
      merchantId: "m_embed",
      sessionId: "s1",
      id: "off_z",
      approved: true,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    })
  );

  let seen: ApplyOfferRequest | undefined;
  const applyUc = {
    async execute(input: ApplyOfferRequest): Promise<ApplyOfferResponse> {
      seen = input;
      return { success: false, reason: "commerce_stub_ok" };
    }
  };

  const helper = new EmbedCheckoutGuardHelper(checkout);
  const c = new EmbedCheckoutController({} as never, {} as never, {} as never, helper, applyUc as never, {} as never, {} as never);

  await c.applyOffer(
    { embedClaims: claims },
    { merchant_id: "m_evil_body", session_id: "s1", offer_id: "off_z" }
  );

  assert.equal(seen?.merchant_id, "m_embed");
  assert.equal(seen?.offer_id, "off_z");
});
