import { describe, expect, it } from "vitest";
import { parseWidgetConfig } from "./widget-schemas.js";

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
