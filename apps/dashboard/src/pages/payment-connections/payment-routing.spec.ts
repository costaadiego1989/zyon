import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizePaymentRouting } from "./payment-routing.js";
import { PaymentRoutingPanel } from "./PaymentConnectionsPage.js";

describe("retired boleto routing", () => {
  it("removes stale boleto when reading or writing settings while preserving Pix, card and fallback", () => {
    for (const fallbackWhenUnavailable of [true, false]) {
      const expected = { pix: "mercadopago", card: "stripe", fallbackWhenUnavailable };
      const current = normalizePaymentRouting({ ...expected, boleto: "asaas", unrelated: "private" });
      expect(current).toEqual(expected);
      expect(normalizePaymentRouting(current)).toEqual(expected);
    }
  });

  it("preserves all supported providers and excludes unsupported values", () => {
    for (const pix of ["asaas", "mercadopago"]) for (const card of ["asaas", "stripe", "mercadopago"]) {
      expect(normalizePaymentRouting({ pix, card, boleto: "asaas" })).toEqual({ pix, card });
    }
    expect(normalizePaymentRouting({ pix: "stripe", card: "unknown", fallbackWhenUnavailable: "true", boleto: "asaas" })).toEqual({});
  });

  it("does not invent routes from absent or malformed settings", () => {
    for (const value of [undefined, null, [], "asaas", 1]) expect(normalizePaymentRouting(value)).toEqual({});
  });

  it("renders only Pix and card even when old settings contain boleto", () => {
    const html = renderToStaticMarkup(createElement(PaymentRoutingPanel, {
      routing: normalizePaymentRouting({ pix: "asaas", card: "stripe", boleto: "asaas" }),
      saving: false, asaasActive: true, stripeActive: true, mercadoPagoActive: false, onChange: () => {},
    }));
    expect(html).toContain("2 de 2 métodos disponíveis");
    expect(html).toContain("payment-routing-pix"); expect(html).toContain("payment-routing-card");
    expect(html).not.toMatch(/Boleto|boleto|de 3 métodos/);
  });

  it("keeps unavailable Pix and card explicit without a retired method in the count", () => {
    const html = renderToStaticMarkup(createElement(PaymentRoutingPanel, {
      routing: {}, saving: false, asaasActive: false, stripeActive: false, mercadoPagoActive: false, onChange: () => {},
    }));
    expect(html).toContain("0 de 2 métodos disponíveis"); expect(html).not.toMatch(/Boleto|boleto/);
  });
});
