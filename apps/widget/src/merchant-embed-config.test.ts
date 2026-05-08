import { describe, expect, it } from "vitest";
import { readMerchantEmbedOptions } from "./merchant-embed-config";

describe("readMerchantEmbedOptions", () => {
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

    expect(options.merchantId).toBe("mrc_demo");
    expect(options.apiBaseUrl).toBe("http://localhost:3009");
    expect(options.embedSessionToken).toBeUndefined();
    expect(options.cart.total).toBeGreaterThan(0);
    expect(options.cart.items[0]?.sku).toBe("bag-001");
    expect(options.shipping?.customerPrice).toBeGreaterThan(0);
  });
});
