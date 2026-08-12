/**
 * WooCommerce Integration Test Fixtures
 *
 * Provides:
 * - wordpressSetup: WooCommerce page navigation helpers
 * - woocommerceProductFactory: Add products to WC cart programmatically
 * - woocommerceWebhookSimulator: Send signed webhook events to WC REST API
 */
import { type Page, type APIRequestContext } from "@playwright/test";
import crypto from "node:crypto";

// ─── Configuration ───────────────────────────────────────────────────────────

export const WOO_BASE = process.env.WOO_BASE_URL ?? "http://localhost:8080";
export const API_BASE = process.env.ZYON_API_URL ?? "http://localhost:3009";
export const MERCHANT_ID =
  process.env.WOO_MERCHANT_ID ??
  "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";
export const WEBHOOK_SECRET =
  process.env.WOO_WEBHOOK_SECRET ??
  "dev_webhook_secret_min_32_characters_required_here_okay";

export const TEST_PRODUCTS = {
  "Camiseta Zyon Dev": { id: 11, sku: "ZYON-SHIRT-001", price: 89 },
  "Hoodie Agentic Checkout": { id: 12, sku: "ZYON-HOODIE-001", price: 149 },
  "Sticker Pack AI Commerce": { id: 13, sku: "ZYON-STICKER-001", price: 19.9 },
} as const;

export type ProductName = keyof typeof TEST_PRODUCTS;

// ─── WordPress Setup ─────────────────────────────────────────────────────────

export const wordpressSetup = {
  /**
   * Navigate to WooCommerce store home.
   */
  async goToStore(page: Page): Promise<void> {
    await page.goto(`${WOO_BASE}/shop/`, { waitUntil: "domcontentloaded" });
  },

  /**
   * Navigate to WooCommerce checkout page.
   */
  async goToCheckout(page: Page): Promise<void> {
    await page.goto(`${WOO_BASE}/checkout/`, { waitUntil: "domcontentloaded" });
  },

  /**
   * Navigate to WooCommerce cart page.
   */
  async goToCart(page: Page): Promise<void> {
    await page.goto(`${WOO_BASE}/cart/`, { waitUntil: "domcontentloaded" });
  },

  /**
   * Navigate to WooCommerce admin → orders list.
   */
  async goToAdminOrders(page: Page): Promise<void> {
    await page.goto(`${WOO_BASE}/wp-admin/edit.php?post_type=shop_order`, {
      waitUntil: "domcontentloaded",
    });
  },

  /**
   * Login as WordPress admin.
   */
  async loginAsAdmin(
    page: Page,
    user = "admin",
    pass = "password",
  ): Promise<void> {
    await page.goto(`${WOO_BASE}/wp-login.php`, {
      waitUntil: "domcontentloaded",
    });
    await page.fill("#user_login", user);
    await page.fill("#user_pass", pass);
    await page.click("#wp-submit");
    await page.waitForURL("**/wp-admin/**", { timeout: 10000 });
  },

  /**
   * Wait for Zyon widget to be attached in the DOM.
   */
  async waitForWidget(page: Page, timeout = 20000): Promise<void> {
    await page
      .locator("zyon-checkout-agent")
      .waitFor({ state: "attached", timeout });
  },

  /**
   * Get all attributes from the widget element.
   */
  async getWidgetAttributes(
    page: Page,
  ): Promise<Record<string, string | null>> {
    return page.evaluate(() => {
      const el = document.querySelector("zyon-checkout-agent");
      if (!el) return {};
      const attrs: Record<string, string | null> = {};
      for (const attr of el.attributes) {
        attrs[attr.name] = attr.value;
      }
      return attrs;
    });
  },
};

// ─── WooCommerce Product Factory ─────────────────────────────────────────────

export const woocommerceProductFactory = {
  /**
   * Add a product to WooCommerce cart via REST API (add-to-cart POST).
   * Returns the redirect URL (usually /cart/).
   */
  async addToCart(
    page: Page,
    productName: ProductName = "Camiseta Zyon Dev",
    quantity = 1,
  ): Promise<void> {
    const product = TEST_PRODUCTS[productName];
    await page.goto(
      `${WOO_BASE}/?add-to-cart=${product.id}&quantity=${quantity}`,
      { waitUntil: "domcontentloaded" },
    );
  },

  /**
   * Add multiple products to cart and navigate to checkout.
   */
  async addProductsAndCheckout(
    page: Page,
    products: Array<{ name: ProductName; quantity?: number }>,
  ): Promise<void> {
    for (const { name, quantity } of products) {
      await this.addToCart(page, name, quantity ?? 1);
    }
    await wordpressSetup.goToCheckout(page);
    await wordpressSetup.waitForWidget(page);
  },

  /**
   * Clear WooCommerce cart via page navigation.
   */
  async clearCart(page: Page): Promise<void> {
    await page.goto(`${WOO_BASE}/cart/`, { waitUntil: "domcontentloaded" });
    // Click "remove" on all items if any exist
    const removeButtons = page.locator(".remove");
    const count = await removeButtons.count();
    for (let i = 0; i < count; i++) {
      await removeButtons.first().click();
      await page.waitForTimeout(1000);
    }
  },

  /**
   * Get current cart contents via WooCommerce cart page.
   */
  async getCartContents(page: Page): Promise<{ itemCount: number; total: string }> {
    await page.goto(`${WOO_BASE}/cart/`, { waitUntil: "domcontentloaded" });
    const itemCount = await page
      .locator(".cart_item")
      .count()
      .catch(() => 0);
    const total = await page
      .locator(".order-total .woocommerce-Price-amount")
      .textContent()
      .catch(() => "0");
    return { itemCount, total: total ?? "0" };
  },
};

// ─── WooCommerce Webhook Simulator ───────────────────────────────────────────

export const woocommerceWebhookSimulator = {
  /**
   * Generate HMAC signature for webhook payload.
   */
  sign(timestamp: number, body: string, secret = WEBHOOK_SECRET): string {
    const data = `${timestamp}.${body}`;
    const hmac = crypto.createHmac("sha256", secret).update(data).digest("hex");
    return `sha256=${hmac}`;
  },

  /**
   * Send a signed webhook event to the WooCommerce REST API.
   */
  async sendWebhook(
    request: APIRequestContext,
    event: string,
    data: Record<string, unknown>,
    opts: { secret?: string; timestampOffset?: number } = {},
  ): Promise<{ status: number; body: unknown }> {
    const timestamp = Math.floor(Date.now() / 1000) + (opts.timestampOffset ?? 0);
    const payload = JSON.stringify({ event, data });
    const signature = this.sign(timestamp, payload, opts.secret ?? WEBHOOK_SECRET);

    const response = await request.post(`${WOO_BASE}/wp-json/zyon/v1/webhook`, {
      data: payload,
      headers: {
        "Content-Type": "application/json",
        "X-AACP-Signature": signature,
        "X-AACP-Timestamp": String(timestamp),
      },
    });

    const body = await response.json().catch(() => null);
    return { status: response.status(), body };
  },

  /**
   * Simulate order.paid webhook.
   */
  async orderPaid(
    request: APIRequestContext,
    orderId: string,
    opts: {
      transactionId?: string;
      amount?: number;
      currency?: string;
      trackingCode?: string;
    } = {},
  ) {
    return this.sendWebhook(request, "order.paid", {
      order_id: orderId,
      transaction_id: opts.transactionId ?? `txn_test_${Date.now()}`,
      amount: opts.amount ?? 8900,
      currency: opts.currency ?? "BRL",
      tracking_code: opts.trackingCode ?? null,
    });
  },

  /**
   * Simulate order.cancelled webhook.
   */
  async orderCancelled(
    request: APIRequestContext,
    orderId: string,
    reason = "Customer requested cancellation",
  ) {
    return this.sendWebhook(request, "order.cancelled", {
      order_id: orderId,
      reason,
    });
  },

  /**
   * Simulate order.tracking.updated webhook.
   */
  async trackingUpdated(
    request: APIRequestContext,
    orderId: string,
    tracking: {
      trackingCode: string;
      trackingUrl?: string;
      carrier?: string;
      status?: string;
    },
  ) {
    return this.sendWebhook(request, "order.tracking.updated", {
      order_id: orderId,
      tracking_code: tracking.trackingCode,
      tracking_url: tracking.trackingUrl ?? null,
      carrier: tracking.carrier ?? "correios",
      status: tracking.status ?? "in_transit",
    });
  },

  /**
   * Send webhook with invalid signature (for security testing).
   */
  async sendInvalidSignature(
    request: APIRequestContext,
    event = "order.paid",
    data: Record<string, unknown> = { order_id: "test" },
  ) {
    return this.sendWebhook(request, event, data, {
      secret: "wrong_secret_should_be_rejected",
    });
  },

  /**
   * Send webhook with stale timestamp (>5min old).
   */
  async sendStaleTimestamp(
    request: APIRequestContext,
    event = "order.paid",
    data: Record<string, unknown> = { order_id: "test" },
  ) {
    return this.sendWebhook(request, event, data, {
      timestampOffset: -400, // 6+ minutes in the past
    });
  },
};
