import { describe, expect, it } from "vitest";
import { brandInitials, filterCheckoutQuickReplies, resolveCartJourneyIndex, resolveStepperProgressPct, resolveStoreReturnUrl, shouldBootstrapShippingSelection, shouldSkipAutoRegistration, isBuyerHubEligible, isBuyerRegistrationComplete, COUPON_PROMPT_MESSAGE, COUPON_ENTRY_MESSAGE, COUPON_SKIP_REPLY_LABEL } from "../hooks/checkout-presentation.js";

describe("coupon copy", () => {
  it("uses accented 'código' in agent coupon messages", () => {
    expect(COUPON_PROMPT_MESSAGE).toContain("código");
    expect(COUPON_ENTRY_MESSAGE).toContain("código");
    expect(COUPON_PROMPT_MESSAGE).not.toMatch(/\bcodigo\b/);
    expect(COUPON_ENTRY_MESSAGE).not.toMatch(/\bcodigo\b/);
  });

  it("exposes a proceed-without-coupon label", () => {
    expect(COUPON_SKIP_REPLY_LABEL).toBe("Continuar sem cupom");
  });
});

describe("brandInitials", () => {
  it("returns first letters for multi-word brands", () => {
    expect(brandInitials("MRC Athom Tech")).toBe("MA");
  });

  it("returns prefix for single-word brands", () => {
    expect(brandInitials("Shopify")).toBe("SH");
  });

  it("falls back when empty", () => {
    expect(brandInitials("---")).toBe("AC");
  });
});

describe("resolveStoreReturnUrl", () => {
  it("prefers explicit storeUrl", () => {
    expect(
      resolveStoreReturnUrl({
        storeUrl: "https://loja.com",
        emptyCartRedirectUrl: "https://fallback.com",
        cart: { currency: "BRL", source: "storefront", total: 0, items: [] }
      })
    ).toBe("https://loja.com");
  });
});

describe("resolveCartJourneyIndex", () => {
  it("maps checkout stages to cart journey", () => {
    expect(resolveCartJourneyIndex("data_collection", 0)).toBe(0);
    expect(resolveCartJourneyIndex("data_collection", 2)).toBe(1);
    expect(resolveCartJourneyIndex("shipping", 2)).toBe(2);
    expect(resolveCartJourneyIndex("payment", 2)).toBe(3);
  });
});

describe("resolveStepperProgressPct", () => {
  it("includes the active step in fill percentage", () => {
    expect(resolveStepperProgressPct(0, 4)).toBe(12.5);
    expect(resolveStepperProgressPct(1, 4)).toBe(37.5);
    expect(resolveStepperProgressPct(3, 4)).toBe(100);
  });
});

describe("shouldSkipAutoRegistration", () => {
  it("skips when email is verified", () => {
    expect(shouldSkipAutoRegistration({ email: "a@b.com", email_verified: true })).toBe(true);
  });

  it("skips when email and otp are pending", () => {
    expect(shouldSkipAutoRegistration({ email: "a@b.com", otp_code: "123456" })).toBe(true);
  });

  it("does not skip when embed only prefills email", () => {
    expect(shouldSkipAutoRegistration({ email: "a@b.com", isReturning: false })).toBe(false);
  });

  it("does not skip when customer is empty", () => {
    expect(shouldSkipAutoRegistration(undefined)).toBe(false);
  });

  it("skips cadastro when returning buyer profile is complete", () => {
    expect(
      shouldSkipAutoRegistration({
        email: "a@b.com",
        email_verified: true,
        recognized_buyer: true,
        fullName: "Diego",
        cpf: "12345678901",
        phone: "11988887777",
        phone_verified: true
      })
    ).toBe(true);
  });
});

describe("shouldBootstrapShippingSelection", () => {
  it("bootstraps shipping for recognized buyer at shipping stage", () => {
    expect(
      shouldBootstrapShippingSelection(
        {
          email: "a@b.com",
          email_verified: true,
          recognized_buyer: true,
          fullName: "Diego",
          cpf: "12345678901",
          phone: "11988887777",
          phone_verified: true
        },
        "shipping"
      )
    ).toBe(true);
  });

  it("does not bootstrap shipping during cadastro", () => {
    expect(shouldBootstrapShippingSelection({ email: "a@b.com" }, "data_collection")).toBe(false);
  });
});

describe("filterCheckoutQuickReplies", () => {
  it("keeps shipping complement replies from leaking freight, coupon, offer, or payment chips", () => {
    const replies = filterCheckoutQuickReplies(
      [
        { label: "Nao tem" },
        { label: "Como informo o bloco?" },
        { label: "Correios PAC (7 dias) - R$ 19,90" },
        { label: "Aplicar desconto de 3%" },
        { label: "PIX" },
        { label: "Tenho um cupom" }
      ],
      { stage: "shipping", missingField: "complemento (ou responda que nao tem)" }
    );

    expect(replies.map((reply) => reply.label)).toEqual(["Nao tem", "Como informo o bloco?"]);
  });

  it("allows freight replies only when the current shipping field is freight", () => {
    const replies = filterCheckoutQuickReplies(
      [
        { label: "Correios PAC (7 dias) - R$ 19,90" },
        { label: "Transportadora Entrega padrao (5 dias) - R$ 24,90" },
        { label: "PIX" },
        { label: "Tenho um cupom" }
      ],
      { stage: "shipping", missingField: "frete" }
    );

    expect(replies.map((reply) => reply.label)).toEqual([
      "Correios PAC (7 dias) - R$ 19,90",
      "Transportadora Entrega padrao (5 dias) - R$ 24,90"
    ]);
  });

  it("uses cross-sell quick replies before payment methods", () => {
    const replies = filterCheckoutQuickReplies(
      [{ label: "PIX" }, { label: "Cartao de credito" }],
      {
        stage: "payment",
        prePaymentStep: "cross_sell",
        suggestedProducts: [{ sku: "CART-COE-01", name: "Carteira Slim RFID", unit_price: 89.9 }]
      }
    );

    expect(replies.map((reply) => reply.label)).toEqual([
      "Adicionar Carteira Slim RFID",
      "Não agora",
      "Ir para pagamento"
    ]);
  });

  it("uses the coupon gate before exposing payment methods", () => {
    const replies = filterCheckoutQuickReplies(
      [{ label: "PIX" }, { label: "Cartao de credito" }],
      { stage: "payment", prePaymentStep: "coupon_gate" }
    );

    expect(replies.map((reply) => reply.label)).toEqual(["Sim", "Não"]);
  });

  it("keeps a proceed-without-coupon escape while the coupon input is active", () => {
    const replies = filterCheckoutQuickReplies(
      [{ label: "PIX" }, { label: "Cartao de credito" }],
      { stage: "payment", prePaymentStep: "coupon_entry" }
    );

    expect(replies.map((reply) => reply.label)).toEqual(["Continuar sem cupom"]);
  });

  it("removes coupon prompts after the buyer skips the coupon gate", () => {
    const replies = filterCheckoutQuickReplies(
      [{ label: "Tenho um cupom" }, { label: "Nao tem" }, { label: "PIX" }, { label: "Cartao de credito" }],
      { stage: "payment", prePaymentStep: "payment_method" }
    );

    expect(replies.map((reply) => reply.label)).toEqual(["PIX", "Cartao de credito"]);
  });

  it("allows crypto payment chip in payment_method step", () => {
    const replies = filterCheckoutQuickReplies(
      [{ label: "Pagar com crypto" }, { label: "PIX" }],
      { stage: "payment", prePaymentStep: "payment_method" }
    );
    expect(replies.map((reply) => reply.label)).toEqual(["Pagar com crypto", "PIX"]);
  });
});
