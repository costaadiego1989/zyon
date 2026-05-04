import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import type { StartCheckoutRequest } from "@aacp/shared-types";

describe("EmbedCheckoutController", () => {
  it("start-checkout uses merchant from embed token not body merchant_id", async () => {
    const tokens = new EmbedTokenService({ value: Buffer.from("embed-ctrl-spec-secret-32chars!!!") });
    const now = Math.floor(Date.now() / 1000);
    const tok = tokens.sign({
      typ: "aacp_embed_v1",
      merchantId: "m_token",
      issuedAtUnix: now,
      expiresAtUnix: now + 3600,
      nonce: "n1"
    });

    let seen: StartCheckoutRequest | undefined;
    const start = {
      async execute(input: StartCheckoutRequest) {
        seen = input;
        return {
          conversation_id: "c",
          session_id: "s",
          global_user_id: "g",
          agent_enabled: true,
          initial_mode: "silent" as const,
          tracking_token: "t",
          experience: {
            brand: { merchant_id: input.merchant_id, name: "Token Merchant" },
            items: [],
            totals: { currency: "BRL", subtotal: 0, shipping: 0, discount: 0, total: 0 },
            agent: {
              name: "Assistente AACP",
              greeting: "Olá",
              tone: "consultative" as const,
              language: "pt-BR"
            },
            copy: {
              headline: "Checkout assistido",
              subheadline: "Sessão conectada",
              trust_badges: [],
              quick_replies: []
            }
          }
        };
      }
    };

    const checkout = new InMemoryCheckoutRepository();
    const helper = new EmbedCheckoutGuardHelper(checkout);

    const c = new EmbedCheckoutController(
      start as never,
      {} as never,
      {} as never,
      helper,
      {} as never,
      {} as never
    );

    await c.start(
      { embedClaims: tokens.verify(tok) },
      {
        merchant_id: "m_body",
        cart: {
          currency: "BRL",
          total: 10,
          items: [{ sku: "x", name: "X", price: 10, quantity: 1 }]
        }
      }
    );

    assert.equal(seen?.merchant_id, "m_token");
  });

  it("track rejects when session belongs to another merchant", async () => {
    const tokens = new EmbedTokenService({ value: Buffer.from("embed-ctrl-spec-secret-32chars!!!") });
    const now = Math.floor(Date.now() / 1000);

    const embedForM1 = tokens.verify(
      tokens.sign({
        typ: "aacp_embed_v1",
        merchantId: "m1",
        issuedAtUnix: now,
        expiresAtUnix: now + 3600,
        nonce: "a"
      })
    );

    const checkout = new InMemoryCheckoutRepository();
    checkout.saveSession(
      checkoutSession({
        merchantId: "m2",
        sessionId: "sess_cross",
        cart: {
          currency: "BRL",
          total: 5,
          items: [{ sku: "a", name: "A", price: 5, quantity: 1 }]
        }
      })
    );

    const helper = new EmbedCheckoutGuardHelper(checkout);

    await assert.rejects(
      helper.assertSessionBelongsToEmbedMerchant(embedForM1, "sess_cross"),
      (err: unknown) => err instanceof UnauthorizedException
    );
  });
});
