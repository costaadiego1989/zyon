import assert from "node:assert/strict";
import test from "node:test";
import { resolveCheckoutPaymentCapabilities } from "./checkout-payment-routing.js";

const ready = {
  asaas: true,
  mercadoPagoPix: true,
  mercadoPagoHostedCard: true,
  stripeCard: true,
  asaasHostedCard: true,
};

test("merchant route pins Pix to Asaas even when Mercado Pago is active", () => {
  assert.deepEqual(
    resolveCheckoutPaymentCapabilities({ pix: "asaas" }, ready),
    {
      pix: true,
      boleto: true,
      card: true,
      providers: { pix: "asaas", boleto: "asaas", card: "stripe" },
    },
  );
});

test("merchant can select Asaas hosted card checkout", () => {
  assert.deepEqual(
    resolveCheckoutPaymentCapabilities({ card: "asaas" }, ready),
    {
      pix: true,
      boleto: true,
      card: true,
      providers: { pix: "mercadopago", boleto: "asaas", card: "asaas" },
    },
  );
});

test("merchant can select Mercado Pago hosted card checkout", () => {
  assert.deepEqual(
    resolveCheckoutPaymentCapabilities({ card: "mercadopago" }, ready),
    {
      pix: true,
      boleto: true,
      card: true,
      providers: { pix: "mercadopago", boleto: "asaas", card: "mercadopago" },
    },
  );
});

test("unready explicit provider never falls back to another gateway", () => {
  assert.deepEqual(
    resolveCheckoutPaymentCapabilities({ pix: "mercadopago", card: "mercadopago" }, {
      asaas: true,
      mercadoPagoPix: false,
      mercadoPagoHostedCard: false,
      stripeCard: true,
      asaasHostedCard: true,
    }),
    {
      pix: false,
      boleto: true,
      card: false,
      providers: { boleto: "asaas" },
    },
  );
});
