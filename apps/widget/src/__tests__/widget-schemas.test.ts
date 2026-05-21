import { describe, expect, it } from "vitest";
import {
  checkoutExperienceSnapshotSchema,
  parseWidgetConfig,
  startCheckoutResponseSchema
} from "../lib/widget-schemas.js";

describe("parseWidgetConfig", () => {
  it("falls back to safe defaults when config input is incomplete", () => {
    const config = parseWidgetConfig({
      merchantId: "",
      apiBaseUrl: "",
      cart: undefined,
      uiPresentation: "floating"
    });

    expect(config.mode).toBe("legacy");
    expect(config.merchantId).toBe("mrc_demo");
    expect(config.apiBaseUrl).toBe("http://localhost:3009");
    expect(config.cart.currency).toBe("BRL");
    expect(config.cart.items).toEqual([]);
  });

  it("switches to embed mode when an embed token is present", () => {
    const config = parseWidgetConfig({
      merchantId: "mrc_demo",
      embedSessionToken: "tok_123",
      apiBaseUrl: "https://api.example.com"
    });

    expect(config.mode).toBe("embed");
    expect(config.embedSessionToken).toBe("tok_123");
  });
});

describe("checkout response schemas", () => {
  const validExperience = {
    brand: {
      merchant_id: "mrc_1",
      name: "Loja",
      theme: {
        accentColor: "#0F766E",
        textColor: "#0F172A",
        backgroundColor: "#FFFFFF",
        fontFamily: "Inter"
      }
    },
    rules: { couponBoxEnabled: true },
    items: [],
    totals: { currency: "BRL", subtotal: 10, shipping: 0, discount: 0, total: 10 },
    agent: { name: "Bot", greeting: "Ola", tone: "consultative", language: "pt-BR" },
    copy: { headline: "Checkout", subheadline: "", trust_badges: [], quick_replies: [] }
  };

  it("rejects malformed start-checkout responses before render", () => {
    expect(() =>
      startCheckoutResponseSchema.parse({
        conversation_id: "conv_1",
        session_id: "sess_1",
        global_user_id: "usr_1",
        agent_enabled: true,
        initial_mode: "open",
        tracking_token: "trk_1",
        experience: {
          totals: { currency: "BRL", subtotal: 10, shipping: 0, discount: 0, total: 10 }
        }
      })
    ).toThrow();
  });

  it("accepts empty address complement returned by checkout data collection", () => {
    expect(() =>
      checkoutExperienceSnapshotSchema.parse({
        ...validExperience,
        customer: {
          email: "buyer@example.com",
          address: {
            zip: "01310100",
            street: "Avenida Paulista",
            number: "1000",
            complement: "",
            city: "Sao Paulo",
            state: "SP"
          }
        }
      })
    ).not.toThrow();
  });
});
