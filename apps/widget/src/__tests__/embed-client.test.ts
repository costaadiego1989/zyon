import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkoutErrorCode,
  checkoutErrorStatus,
  checkoutJson,
  CheckoutHttpError,
  CHECKOUT_EMBED_PATHS
} from "../lib/embed-client.js";

describe("checkoutJson", () => {
  const origin = "http://localhost:3001";

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true })
        } as Response)
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("envia embed token no cabeçalho quando modo embed", async () => {
    const spy = vi.mocked(fetch);
    await checkoutJson(origin, CHECKOUT_EMBED_PATHS.start, {
      embedToken: "tok.test",
      body: { cart: { currency: "BRL", total: 1, items: [] } }
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0]!;
    expect(init!.method).toBe("POST");
    expect(init!.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer tok.test"
    });
  });

  it("não inclui embed token quando ausente", async () => {
    const spy = vi.mocked(fetch);
    await checkoutJson(origin, CHECKOUT_EMBED_PATHS.track, {
      body: {
        merchant_id: "m1",
        session_id: "s1",
        event: "checkout_started"
      }
    });

    const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("CHECKOUT_EMBED_PATHS.paymentIntents aponta para rota POST embed", async () => {
    const spy = vi.mocked(fetch);
    await checkoutJson(origin, CHECKOUT_EMBED_PATHS.paymentIntents, {
      embedToken: "tok.embed.pay",
      body: { session_id: "sess_1", idempotency_key: "idem_abc" }
    });
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:3001/embed/payment/intents",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tok.embed.pay"
        }),
        body: JSON.stringify({
          session_id: "sess_1",
          idempotency_key: "idem_abc"
        })
      })
    );
  });

  it("envia dados reais do carrinho da loja com credencial embed", async () => {
    const spy = vi.mocked(fetch);
    await checkoutJson(origin, CHECKOUT_EMBED_PATHS.start, {
      embedToken: "tok.storefront",
      body: {
        customer: { email: "buyer@example.com", isReturning: true },
        cart: {
          currency: "BRL",
          source: "storefront",
          total: 899.8,
          items: [
            {
              sku: "bag-001",
              name: "Bolsa Executiva Couro Safiano",
              price: 449.9,
              cost: 210,
              quantity: 2,
              imageUrl: "https://cdn.example.com/bag.png",
              productUrl: "https://shop.example.com/bag-001",
              category: "Bolsas",
              variant: "Preta"
            }
          ]
        },
        shipping: { customerPrice: 29.9, realCost: 31, carrier: "Loggi", method: "Express", deliveryDays: 2, region: "SP" }
      }
    });

    expect(spy).toHaveBeenCalledWith(
      "http://localhost:3001/embed/start",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer tok.storefront"
        }),
        body: JSON.stringify({
          customer: { email: "buyer@example.com", isReturning: true },
          cart: {
            currency: "BRL",
            source: "storefront",
            total: 899.8,
            items: [
              {
                sku: "bag-001",
                name: "Bolsa Executiva Couro Safiano",
                price: 449.9,
                cost: 210,
                quantity: 2,
                imageUrl: "https://cdn.example.com/bag.png",
                productUrl: "https://shop.example.com/bag-001",
                category: "Bolsas",
                variant: "Preta"
              }
            ]
          },
          shipping: { customerPrice: 29.9, realCost: 31, carrier: "Loggi", method: "Express", deliveryDays: 2, region: "SP" }
        })
      })
    );
  });

  it("valida resposta com schema antes de retornar payload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: "not_boolean" })
    } as Response);

    await expect(
      checkoutJson(origin, CHECKOUT_EMBED_PATHS.start, {
        body: {},
        schema: {
          parse(input: unknown) {
            if ((input as { ok?: unknown }).ok !== true) throw new Error("invalid_payload");
            return input;
          }
        }
      })
    ).rejects.toThrow("invalid_payload");
  });

  it("preserva problem+json em erro HTTP", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: "https://docs.aacp.dev/problems/stripe_provider_not_configured",
          title: "Conflict",
          status: 409,
          code: "stripe_provider_not_configured",
          detail: "stripe_provider_not_configured",
          correlation_id: "corr_test"
        }),
        { status: 409, headers: { "content-type": "application/problem+json" } }
      )
    );

    let captured: unknown;
    try {
      await checkoutJson(origin, CHECKOUT_EMBED_PATHS.paymentIntents, {
        body: { session_id: "sess_1", idempotency_key: "idem_abc", method: "card" }
      });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(CheckoutHttpError);
    expect(checkoutErrorStatus(captured)).toBe(409);
    expect(checkoutErrorCode(captured)).toBe("stripe_provider_not_configured");
  });
});
