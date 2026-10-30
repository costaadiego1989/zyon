import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import type { QuoteShippingUseCase } from "../../shipping/application/use-cases/quote-shipping.use-case.js";

/** Accepted local transport responses for chat journey tests; never live quotes. */
export function localShippingQuotes(): QuoteShippingUseCase {
  return { execute: async (input: any) => ({
    id: "fixture-shipping-quote", merchant_id: input.merchant_id, session_id: input.session_id,
    destination_zip: input.destination_zip, quote_key: "fixture-shipping-key",
    created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString(), selected_carrier_key: null,
    results: [
      { carrier_key: "fixture-pac", label: "Correios PAC", price: 1990, eta_days: 7, is_free: false },
      { carrier_key: "fixture-sedex", label: "Correios Sedex", price: 2990, eta_days: 3, is_free: false },
      { carrier_key: "fixture-carrier", label: "Transportadora Parceira", price: 2490, eta_days: 5, is_free: false },
    ],
  }) } as unknown as QuoteShippingUseCase;
}

/** Persisted scope for local-only checkout fixtures. No real database or payment. */
export function localCheckoutScope(repository: InMemoryCheckoutRepository): PrismaClient {
  return {
    checkoutSession: { findUnique: async ({ where }: any) => {
      const { merchantId, sessionId } = where.merchantId_sessionId;
      assert.ok(merchantId && sessionId);
      const stored = repository.getSession(merchantId, sessionId);
      return stored ? { merchantId, sessionId, cart: stored.cart, shipping: stored.shipping } : null;
    } },
    crossStoreLineItem: { findFirst: async ({ where }: any) => {
      assert.ok(where.hostMerchantId);
      assert.ok(where.checkoutSessionId.in.length > 0);
      return null;
    } },
    paymentIntent: { findFirst: async ({ where }: any) => {
      assert.ok(where.merchantId && where.sessionId);
      assert.deepEqual(where.status.notIn, ["cancelled", "failed"]);
      return null;
    } },
  } as unknown as PrismaClient;
}
