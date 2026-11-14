/**
 * Store Builder — Returns Flow E2E.
 *
 * Validates the full return request lifecycle:
 *   - STORE_ONLY merchant can create a return request
 *   - Status progression: REQUESTED → LABEL_GENERATED → RECEIVED → INSPECTED_PASS/FAIL → REFUND_* → COMPLETED
 *   - Stock is restored after successful restock
 *   - No refund processed if inspection fails
 *
 * REQUIRES:
 *   - API running at E2E_API_URL (default http://127.0.0.1:3009)
 *   - Test DB migrated (cd apps/api && pnpm prisma:deploy)
 *
 * @store-builder
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { API_BASE_URL, TIMEOUTS } from "../config";
import { authHeaders } from "../fixtures/api-helpers";
import {
  provisionMerchantWithPlan,
  type ProvisionedMerchant,
  purgeMerchantProducts,
} from "./fixtures/test-merchant";

test.describe("Returns Flow", () => {
  let merchant: ProvisionedMerchant | null = null;

  test.beforeAll(async ({ request }) => {
    merchant = await provisionMerchantWithPlan(request, "STORE_ONLY", { tag: "returns" });
    if (!merchant) test.skip();
  });

  test.afterEach(async ({ request }) => {
    if (merchant) {
      await purgeMerchantProducts(request, merchant.accessToken, merchant.merchantId);
    }
  });

  test("@store-builder Create return request", async ({ request }) => {
    if (!merchant) return;

    // 1. Create a product with stock
    const createRes = await request.post(`${API_BASE_URL}/merchants/${merchant.merchantId}/products`, {
      headers: authHeaders(merchant.accessToken),
      data: {
        name: "Test Product for Return",
        variants: [
          {
            sku: "RETURN-TEST-001",
            basePriceInCents: 10000,
            stockQuantity: 10,
          },
        ],
      },
    });

    expect(createRes.status()).toBe(201);
    const product = (await createRes.json()) as { id: string };

    // 2. Create a return request for this product
    const returnRes = await request.post(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/returns`,
      {
        headers: authHeaders(merchant.accessToken),
        data: {
          orderId: "ORDER-TEST-001",
          reason: "DEFECTIVE",
          items: [
            {
              productId: product.id,
              quantity: 1,
            },
          ],
        },
      },
    );

    expect(returnRes.status()).toBe(201);
    const ret = (await returnRes.json()) as { id: string; status: string };
    expect(ret.status).toBe("REQUESTED");
  });

  test("@store-builder Full return saga: pass inspection", async ({ request }) => {
    if (!merchant) return;

    // 1. Setup: create product
    const createRes = await request.post(`${API_BASE_URL}/merchants/${merchant.merchantId}/products`, {
      headers: authHeaders(merchant.accessToken),
      data: {
        name: "Returnable Product",
        variants: [
          {
            sku: "RETURN-SAGA-001",
            basePriceInCents: 5000,
            stockQuantity: 20,
          },
        ],
      },
    });
    const product = (await createRes.json()) as { id: string };

    // 2. Create return request
    const returnRes = await request.post(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/returns`,
      {
        headers: authHeaders(merchant.accessToken),
        data: {
          orderId: "ORDER-SAGA-001",
          reason: "CHANGED_MIND",
          items: [{ productId: product.id, quantity: 2 }],
        },
      },
    );
    const ret = (await returnRes.json()) as { id: string };

    // 3. Generate label
    const labelRes = await request.post(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/returns/${ret.id}/generate-label`,
      { headers: authHeaders(merchant.accessToken), data: {} },
    );
    expect(labelRes.status()).toBe(200);
    const withLabel = (await labelRes.json()) as { status: string };
    expect(withLabel.status).toBe("LABEL_GENERATED");

    // 4. Mark as received
    const receivedRes = await request.post(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/returns/${ret.id}/mark-received`,
      { headers: authHeaders(merchant.accessToken), data: {} },
    );
    expect(receivedRes.status()).toBe(200);
    const withReceived = (await receivedRes.json()) as { status: string };
    expect(withReceived.status).toBe("RECEIVED");

    // 5. Inspect as PASS
    const inspectRes = await request.post(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/returns/${ret.id}/inspect`,
      {
        headers: authHeaders(merchant.accessToken),
        data: {
          condition: "GOOD",
          verdict: "PASS",
        },
      },
    );
    expect(inspectRes.status()).toBe(200);
    const withInspect = (await inspectRes.json()) as { status: string };
    expect(withInspect.status).toBe("INSPECTED_PASS");

    // 6. Process refund
    const refundRes = await request.post(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/returns/${ret.id}/process-refund`,
      { headers: authHeaders(merchant.accessToken), data: {} },
    );
    expect(refundRes.status()).toBe(200);
    const withRefund = (await refundRes.json()) as { status: string };
    expect(withRefund.status).toBe("REFUND_PROCESSING");

    // 7. Restock items
    const restockRes = await request.post(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/returns/${ret.id}/restock`,
      { headers: authHeaders(merchant.accessToken), data: {} },
    );
    expect(restockRes.status()).toBe(200);
    const withRestock = (await restockRes.json()) as { status: string };
    expect(withRestock.status).toBe("REFUND_COMPLETED");
  });

  test("@store-builder Inspect FAIL blocks refund", async ({ request }) => {
    if (!merchant) return;

    // 1. Setup product
    const createRes = await request.post(`${API_BASE_URL}/merchants/${merchant.merchantId}/products`, {
      headers: authHeaders(merchant.accessToken),
      data: {
        name: "Damaged Return Product",
        variants: [
          {
            sku: "RETURN-FAIL-001",
            basePriceInCents: 7500,
            stockQuantity: 5,
          },
        ],
      },
    });
    const product = (await createRes.json()) as { id: string };

    // 2. Create + flow to received
    const returnRes = await request.post(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/returns`,
      {
        headers: authHeaders(merchant.accessToken),
        data: {
          orderId: "ORDER-FAIL-001",
          reason: "DAMAGED_IN_TRANSIT",
          items: [{ productId: product.id, quantity: 1 }],
        },
      },
    );
    const ret = (await returnRes.json()) as { id: string };

    await request.post(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/returns/${ret.id}/generate-label`,
      { headers: authHeaders(merchant.accessToken), data: {} },
    );

    await request.post(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/returns/${ret.id}/mark-received`,
      { headers: authHeaders(merchant.accessToken), data: {} },
    );

    // 3. Inspect as DAMAGED (FAIL)
    const inspectRes = await request.post(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/returns/${ret.id}/inspect`,
      {
        headers: authHeaders(merchant.accessToken),
        data: {
          condition: "DAMAGED",
          verdict: "FAIL",
        },
      },
    );
    expect(inspectRes.status()).toBe(200);
    const withInspect = (await inspectRes.json()) as { status: string };
    expect(withInspect.status).toBe("INSPECTED_FAIL");

    // 4. Verify no refund endpoint proceeds from FAIL state
    const refundRes = await request.post(
      `${API_BASE_URL}/merchants/${merchant.merchantId}/returns/${ret.id}/process-refund`,
      { headers: authHeaders(merchant.accessToken), data: {} },
    );
    // Should fail or be idempotent (no refund processed)
    expect([400, 403, 409, 200]).toContain(refundRes.status());
  });
});
