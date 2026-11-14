/**
 * Store Builder — Analytics E2E.
 *
 * Validates that the analytics dashboard endpoints return correctly structured data:
 *   - GET /merchants/me/analytics/dashboard?period=week
 *   - GET /merchants/me/analytics/products?month=2026-08
 *
 * @store-builder
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { API_BASE_URL } from "../config";
import { authHeaders } from "../fixtures/api-helpers";
import {
  provisionMerchantWithPlan,
  type ProvisionedMerchant,
} from "./fixtures/test-merchant";

test.describe("Store Analytics", () => {
  let merchant: ProvisionedMerchant | null = null;

  test.beforeAll(async ({ request }) => {
    merchant = await provisionMerchantWithPlan(request, "STORE_ONLY", { tag: "analytics" });
    if (!merchant) test.skip();
  });

  test("@store-builder Dashboard metrics endpoint responds", async ({ request }) => {
    if (!merchant) return;

    const res = await request.get(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/analytics/dashboard?period=week`,
      { headers: authHeaders(merchant.accessToken) },
    );

    expect(res.status()).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;

    // Verify response structure
    expect(data).toHaveProperty("totalRevenue");
    expect(data).toHaveProperty("totalOrders");
    expect(data).toHaveProperty("avgOrderValue");
    expect(data).toHaveProperty("conversionRate");

    // Verify types
    expect(typeof data.totalRevenue).toBe("number");
    expect(typeof data.totalOrders).toBe("number");
    expect(typeof data.avgOrderValue).toBe("number");
    expect(typeof data.conversionRate).toBe("number");
  });

  test("@store-builder Product performance endpoint responds", async ({ request }) => {
    if (!merchant) return;

    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const res = await request.get(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/analytics/products?month=${monthStr}`,
      { headers: authHeaders(merchant.accessToken) },
    );

    expect(res.status()).toBe(200);
    const data = (await res.json()) as { products?: Array<Record<string, unknown>> };

    // Verify response is array
    expect(Array.isArray(data.products)).toBe(true);

    // If products exist, verify structure
    if (data.products && data.products.length > 0) {
      const product = data.products[0];
      expect(product).toHaveProperty("productId");
      expect(product).toHaveProperty("impressions");
      expect(product).toHaveProperty("purchases");
      expect(product).toHaveProperty("revenue");
    }
  });
});
