/**
 * Nuvemshop E2E Fixtures
 *
 * Builders, simulators, and factories for Nuvemshop integration testing.
 * These are used by both API and Widget E2E tests.
 *
 * Usage:
 *   import { nuvemshopStoreBuilder, nuvemshopWebhookSimulator, nuvemshopProductFactory } from "./nuvemshop-fixtures";
 */

import { randomUUID } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────

export interface NuvemshopStoreConfig {
  storeId: string;
  storeName: string;
  currency: string;
  locale: string;
  storeUrl: string;
  accessToken: string;
}

export interface NuvemshopProduct {
  id: number;
  name: { pt?: string; es?: string; en?: string };
  description: { plain?: string; html?: string };
  price: number;
  stock: number;
  sku: string;
  canonical_url: string;
  images: Array<{ src: string }>;
  categories: Array<{ name: string }>;
  variants: Array<{
    id: number;
    sku: string;
    price: number;
    stock: number;
    values: string[];
  }>;
}

export interface NuvemshopWebhookPayload {
  store_id: string | number;
  event: string;
  id: string | number;
  [key: string]: unknown;
}

export interface NuvemshopOrder {
  id: number;
  currency: string;
  status: string;
  products: Array<{
    sku: string;
    name: string;
    quantity: number;
    price: number;
  }>;
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// STORE BUILDER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Builder for creating Nuvemshop store configurations.
 *
 * Example:
 *   const store = nuvemshopStoreBuilder()
 *     .withCurrency("ARS")
 *     .withLocale("es")
 *     .build();
 */
export function nuvemshopStoreBuilder() {
  const config: NuvemshopStoreConfig = {
    storeId: String(Math.floor(100000 + Math.random() * 900000)),
    storeName: "Zyon QA Nuvemshop",
    currency: "BRL",
    locale: "pt",
    storeUrl: "https://zyon-qa.tiendanube.com",
    accessToken: `test_token_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
  };

  return {
    withStoreId(storeId: string) {
      config.storeId = storeId;
      return this;
    },
    withStoreName(name: string) {
      config.storeName = name;
      return this;
    },
    withCurrency(currency: string) {
      config.currency = currency;
      return this;
    },
    withLocale(locale: string) {
      config.locale = locale;
      return this;
    },
    withStoreUrl(url: string) {
      config.storeUrl = url;
      return this;
    },
    withAccessToken(token: string) {
      config.accessToken = token;
      return this;
    },
    /** Build from env vars (for integration tests). */
    fromEnv() {
      if (process.env.NUVEMSHOP_STORE_ID) config.storeId = process.env.NUVEMSHOP_STORE_ID;
      if (process.env.NUVEMSHOP_ACCESS_TOKEN) config.accessToken = process.env.NUVEMSHOP_ACCESS_TOKEN;
      return this;
    },
    build(): NuvemshopStoreConfig {
      return { ...config };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// WEBHOOK SIMULATOR
// ─────────────────────────────────────────────────────────────────────────

/**
 * Simulates Nuvemshop webhooks for testing.
 *
 * Example:
 *   const sim = nuvemshopWebhookSimulator({ storeId: "12345", merchantId: "mrc_1" });
 *   await sim.sendOrderCreated(orderId);
 *   await sim.sendOrderPaid(orderId);
 *   await sim.sendProductUpdated(productId);
 */
export function nuvemshopWebhookSimulator(opts: {
  storeId: string;
  merchantId: string;
  apiBase?: string;
}) {
  const { storeId, merchantId, apiBase = "http://localhost:3009" } = opts;

  async function sendWebhook(payload: NuvemshopWebhookPayload): Promise<{
    status: number;
    body: unknown;
  }> {
    const res = await fetch(`${apiBase}/webhooks/nuvemshop/${merchantId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    return { status: res.status, body };
  }

  return {
    /** Send order/created webhook */
    async sendOrderCreated(orderId: number | string = Math.floor(Math.random() * 99999)) {
      return sendWebhook({
        store_id: storeId,
        event: "order/created",
        id: orderId,
      });
    },

    /** Send order/paid webhook (dedup-aware) */
    async sendOrderPaid(orderId: number | string) {
      return sendWebhook({
        store_id: storeId,
        event: "order/paid",
        id: orderId,
      });
    },

    /** Send order/updated webhook */
    async sendOrderUpdated(orderId: number | string) {
      return sendWebhook({
        store_id: storeId,
        event: "order/updated",
        id: orderId,
      });
    },

    /** Send order/cancelled webhook */
    async sendOrderCancelled(orderId: number | string) {
      return sendWebhook({
        store_id: storeId,
        event: "order/cancelled",
        id: orderId,
      });
    },

    /** Send product/created webhook */
    async sendProductCreated(productId: number | string) {
      return sendWebhook({
        store_id: storeId,
        event: "product/created",
        id: productId,
      });
    },

    /** Send product/updated webhook */
    async sendProductUpdated(productId: number | string) {
      return sendWebhook({
        store_id: storeId,
        event: "product/updated",
        id: productId,
      });
    },

    /** Send product/deleted webhook */
    async sendProductDeleted(productId: number | string) {
      return sendWebhook({
        store_id: storeId,
        event: "product/deleted",
        id: productId,
      });
    },

    /** Send an unknown/unsupported event (should be ignored) */
    async sendUnknownEvent(event: string, id: number | string = 1) {
      return sendWebhook({
        store_id: storeId,
        event,
        id,
      });
    },

    /** Send webhook with wrong store_id (should be rejected) */
    async sendWithWrongStoreId(event: string = "order/created") {
      return sendWebhook({
        store_id: "9999999", // Intentionally wrong
        event,
        id: Math.floor(Math.random() * 99999),
      });
    },

    /** Send duplicate paid webhooks (dedup test) */
    async sendDuplicatePaid(orderId: number | string) {
      const first = await this.sendOrderPaid(orderId);
      await new Promise((r) => setTimeout(r, 50));
      const second = await this.sendOrderPaid(orderId);
      return { first, second };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PRODUCT FACTORY
// ─────────────────────────────────────────────────────────────────────────

/**
 * Creates mock Nuvemshop product data for test fixtures.
 *
 * Example:
 *   const product = nuvemshopProductFactory().withVariants(3).build();
 *   const electronics = nuvemshopProductFactory().electronics().build();
 */
export function nuvemshopProductFactory() {
  let productId = Math.floor(10000 + Math.random() * 90000);
  let productName = "Produto Teste";
  let productPrice = 99.90;
  let productStock = 50;
  let productSku = `SKU${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  let productCategory = "Geral";
  let productDescription = "Descrição do produto de teste";
  let variants: NuvemshopProduct["variants"] = [];
  let currency = "BRL";
  let locale: "pt" | "es" | "en" = "pt";

  return {
    withId(id: number) {
      productId = id;
      return this;
    },
    withName(name: string) {
      productName = name;
      return this;
    },
    withPrice(price: number) {
      productPrice = price;
      return this;
    },
    withStock(stock: number) {
      productStock = stock;
      return this;
    },
    withSku(sku: string) {
      productSku = sku;
      return this;
    },
    withCategory(category: string) {
      productCategory = category;
      return this;
    },
    withDescription(desc: string) {
      productDescription = desc;
      return this;
    },
    withCurrency(cur: string) {
      currency = cur;
      return this;
    },
    withLocale(loc: "pt" | "es" | "en") {
      locale = loc;
      return this;
    },

    /** Add N variants with random SKUs and prices */
    withVariants(count: number) {
      variants = Array.from({ length: count }, (_, i) => ({
        id: productId * 10 + i + 1,
        sku: `${productSku}-V${i + 1}`,
        price: productPrice + (i * 10),
        stock: Math.max(0, productStock - (i * 5)),
        values: [`Option ${i + 1}`],
      }));
      return this;
    },

    /** Preset: electronics product with size variants */
    electronics() {
      productName = "Caixa de Som Bluetooth";
      productPrice = 199.90;
      productStock = 30;
      productCategory = "Eletrônicos";
      productDescription = "Caixa de som portátil com Bluetooth 5.0";
      variants = [
        { id: productId * 10 + 1, sku: `${productSku}-S`, price: 199.90, stock: 10, values: ["Pequena"] },
        { id: productId * 10 + 2, sku: `${productSku}-M`, price: 249.90, stock: 15, values: ["Média"] },
        { id: productId * 10 + 3, sku: `${productSku}-L`, price: 349.90, stock: 5, values: ["Grande"] },
      ];
      return this;
    },

    /** Preset: clothing product with color/size variants */
    clothing() {
      productName = "Camiseta Premium";
      productPrice = 89.90;
      productStock = 100;
      productCategory = "Vestuário";
      productDescription = "Camiseta 100% algodão premium";
      variants = [
        { id: productId * 10 + 1, sku: `${productSku}-PP-BRA`, price: 89.90, stock: 20, values: ["PP", "Branca"] },
        { id: productId * 10 + 2, sku: `${productSku}-P-BRA`, price: 89.90, stock: 25, values: ["P", "Branca"] },
        { id: productId * 10 + 3, sku: `${productSku}-M-BRA`, price: 89.90, stock: 30, values: ["M", "Branca"] },
        { id: productId * 10 + 4, sku: `${productSku}-G-BRA`, price: 89.90, stock: 25, values: ["G", "Branca"] },
        { id: productId * 10 + 5, sku: `${productSku}-PP-PRT`, price: 89.90, stock: 15, values: ["PP", "Preta"] },
        { id: productId * 10 + 6, sku: `${productSku}-P-PRT`, price: 89.90, stock: 20, values: ["P", "Preta"] },
        { id: productId * 10 + 7, sku: `${productSku}-M-PRT`, price: 89.90, stock: 30, values: ["M", "Preta"] },
        { id: productId * 10 + 8, sku: `${productSku}-G-PRT`, price: 89.90, stock: 20, values: ["G", "Preta"] },
      ];
      return this;
    },

    /** Preset: out-of-stock product */
    outOfStock() {
      productName = "Produto Esgotado";
      productPrice = 299.90;
      productStock = 0;
      variants = [
        { id: productId * 10 + 1, sku: `${productSku}-U`, price: 299.90, stock: 0, values: ["Único"] },
      ];
      return this;
    },

    /** Preset: ARS product for multi-currency tests */
    argentinePeso() {
      productName = "Producto de Prueba";
      productPrice = 15000;
      productStock = 20;
      currency = "ARS";
      locale = "es";
      productCategory = "General";
      productDescription = "Producto para pruebas de integración";
      return this;
    },

    /** Build the Nuvemshop product fixture */
    build(): NuvemshopProduct {
      const name: NuvemshopProduct["name"] = {};
      if (locale === "pt") name.pt = productName;
      if (locale === "es") name.es = productName;
      if (locale === "en") name.en = productName;
      // Always include at least one locale
      if (!name.pt && !name.es && !name.en) name.pt = productName;

      return {
        id: productId,
        name,
        description: { plain: productDescription },
        price: productPrice,
        stock: productStock,
        sku: productSku,
        canonical_url: `https://zyon-qa.tiendanube.com/productos/${productSku.toLowerCase()}`,
        images: [{ src: `https://d2r9epyceweg5n.cloudfront.net/test/${productSku}.png` }],
        categories: [{ name: productCategory }],
        variants: variants.length > 0 ? variants : [{
          id: productId * 10 + 1,
          sku: productSku,
          price: productPrice,
          stock: productStock,
          values: ["Default"],
        }],
      };
    },

    /** Build a catalog page (array of products) */
    buildCatalogPage(count: number = 5): NuvemshopProduct[] {
      return Array.from({ length: count }, (_, i) =>
        nuvemshopProductFactory()
          .withId(productId + i)
          .withName(`${productName} ${i + 1}`)
          .withPrice(productPrice + (i * 20))
          .withStock(productStock - (i * 5))
          .withVariants(2)
          .build()
      );
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// MOCK API RESPONSES (for mocked widget tests)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Creates mock Nuvemshop API response payloads for Playwright route interceptors.
 *
 * Usage in Playwright tests:
 *   await page.route('**/api/tiendanube.com/**', (route) => {
 *     route.fulfill({ body: JSON.stringify(mockApi.storeInfo()) });
 *   });
 */
export const nuvemshopMockApi = {
  storeInfo(overrides?: Partial<{ name: string; currency: string; url: string }>): Record<string, unknown> {
    return {
      id: 123456,
      name: overrides?.name ?? "Zyon QA Store",
      url: overrides?.url ?? "https://zyon-qa.tiendanube.com",
      currency: overrides?.currency ?? "BRL",
      contact: "e2e-qa@zyon.dev",
    };
  },

  catalogSearchResponse(products?: NuvemshopProduct[]): NuvemshopProduct[] {
    return products ?? nuvemshopProductFactory().buildCatalogPage(3);
  },

  orderCreatedResponse(orderId?: number): Record<string, unknown> {
    return {
      id: orderId ?? Math.floor(10000 + Math.random() * 90000),
      status: "open",
      currency: "BRL",
      products: [
        { sku: "SKU001", name: "Test Product", quantity: 1, price: 99.90 },
      ],
    };
  },

  webhookResponse(outcome: "processed" | "ignored", event?: string): Record<string, unknown> {
    if (outcome === "processed") return { outcome, event: event ?? "order/created" };
    return { outcome, reason: `unhandled_event:${event ?? "unknown"}` };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

/** Generate a unique merchant ID for test isolation */
export function testMerchantId(prefix = "mrc_nvs"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Wait helper for rate-limited operations */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Verify that a field is never exposed in response (security assertion) */
export function assertTokenNotExposed(responseBody: Record<string, unknown>): void {
  const sensitiveFields = ["accessToken", "access_token", "secret", "password", "token"];
  for (const field of sensitiveFields) {
    if (field in responseBody && typeof responseBody[field] === "string") {
      throw new Error(`Security: sensitive field '${field}' exposed in response`);
    }
  }
}
