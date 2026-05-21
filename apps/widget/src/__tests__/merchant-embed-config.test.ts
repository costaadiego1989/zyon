import { afterEach, describe, expect, it } from "vitest";
import { readMerchantEmbedOptions } from "../lib/merchant-embed-config.js";

describe("readMerchantEmbedOptions", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("reads enterprise embed credentials and storefront payload from host dataset", () => {
    const host = {
      dataset: {
        merchantId: "mrc_enterprise",
        apiBaseUrl: "https://api.aacp.ai",
        embedSessionToken: "tok.secure.embed",
        brandTitle: "Northstar Atelier",
        brandSubtitle: "Checkout premium assistido por IA",
        cartJson: JSON.stringify({
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
    }),
        customerJson: JSON.stringify({
      email: "buyer@example.com",
      isReturning: true
    }),
        shippingJson: JSON.stringify({
      customerPrice: 29.9,
      realCost: 31,
      carrier: "Loggi",
      method: "Express",
      deliveryDays: 2,
      region: "SP"
    })
      }
    } as unknown as HTMLElement;

    const options = readMerchantEmbedOptions(host);

    expect(options).toMatchObject({
      merchantId: "mrc_enterprise",
      apiBaseUrl: "https://api.aacp.ai",
      embedSessionToken: "tok.secure.embed",
      brandTitle: "Northstar Atelier",
      brandSubtitle: "Checkout premium assistido por IA",
      customer: { email: "buyer@example.com", isReturning: true },
      shipping: { customerPrice: 29.9, carrier: "Loggi", method: "Express" }
    });
    expect(options.cart.items[0]).toMatchObject({
      sku: "bag-001",
      name: "Bolsa Executiva Couro Safiano",
      quantity: 2,
      imageUrl: "https://cdn.example.com/bag.png"
    });
  });

  it("falls back to a demo storefront payload when optional JSON is absent", () => {
    const host = { dataset: {} } as unknown as HTMLElement;

    const options = readMerchantEmbedOptions(host);

    expect(options.merchantId).toBe("mrc_athom_tech");
    expect(options.apiBaseUrl).toBe("http://localhost:3009");
    expect(options.embedSessionToken).toBeUndefined();
    expect(options.cart.total).toBeGreaterThan(0);
    expect(options.cart.items[0]?.sku).toBe("athom-kit-001");
    expect(options.shipping).toBeUndefined();
  });

  it("lets real-api e2e override merchant credentials from query params", () => {
    const customer = {
      fullName: "Cliente E2E",
      email: "buyer@example.com",
      email_verified: true
    };
    window.history.pushState(
      {},
      "",
      `/?merchantId=e2e_mrc&embedToken=tok.embed&apiBaseUrl=http%3A%2F%2Flocalhost%3A3000&productId=e2e_product_001&qty=2&customerJson=${encodeURIComponent(JSON.stringify(customer))}`
    );
    const host = {
      dataset: {
        merchantId: "mrc_static",
        apiBaseUrl: "http://localhost:3009"
      }
    } as unknown as HTMLElement;

    const options = readMerchantEmbedOptions(host);

    expect(options.merchantId).toBe("e2e_mrc");
    expect(options.embedSessionToken).toBe("tok.embed");
    expect(options.apiBaseUrl).toBe("http://localhost:3000");
    expect(options.productSelection).toEqual([{ sku: "e2e_product_001", quantity: 2 }]);
    expect(options.customer).toMatchObject(customer);
  });
});
