/**
 * Store Builder — Stock Reservation E2E.
 *
 * Validates the stock reservation flow end-to-end:
 *   - happy path: reserve succeeds, reservationId + expiresAt returned
 *   - idempotency: repeated requests with the same key return same id
 *   - insufficient stock: rejects with 409
 *
 * REQUIRES: API + DB running. See catalog-crud.spec.ts header.
 *
 * @store-builder
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { API_BASE_URL } from "../config";
import { authHeaders } from "../fixtures/api-helpers";
import {
  provisionMerchantWithPlan,
  purgeMerchantProducts,
  type ProvisionedMerchant,
} from "./fixtures/test-merchant";

/* ── Helpers ───────────────────────────────────────────────────── */

interface SeededProduct {
  productId: string;
  variantId: string;
  stock: number;
}

async function createProductWithStock(
  request: APIRequestContext,
  merchant: ProvisionedMerchant,
  data: { name: string; sku: string; priceCents: number; stock: number },
): Promise<SeededProduct> {
  const res = await request.post(
    `${API_BASE_URL}/merchants/${encodeURIComponent(merchant.merchantId)}/products`,
    {
      headers: authHeaders(merchant.accessToken),
      data: {
        name: data.name,
        variants: [
          {
            sku: data.sku,
            basePriceInCents: data.priceCents,
            stockQuantity: data.stock,
          },
        ],
      },
    },
  );
  if (!res.ok()) {
    throw new Error(`createProductWithStock failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    id: string;
    variants: Array<{ id: string }>;
  };
  if (!body.variants[0]) {
    throw new Error("createProductWithStock: no variant in response");
  }
  return {
    productId: body.id,
    variantId: body.variants[0].id,
    stock: data.stock,
  };
}

async function fetchStock(
  request: APIRequestContext,
  merchant: ProvisionedMerchant,
  productId: string,
): Promise<{ quantity: number; reserved: number }> {
  const res = await request.get(
    `${API_BASE_URL}/merchants/${encodeURIComponent(merchant.merchantId)}/products/${encodeURIComponent(productId)}`,
    { headers: authHeaders(merchant.accessToken) },
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    variants: Array<{
      stockQuantity: number;
      stockReserved: number;
    }>;
  };
  const variant = body.variants[0]!;
  return {
    quantity: variant.stockQuantity,
    reserved: variant.stockReserved,
  };
}

/* ── Suite ─────────────────────────────────────────────────────── */

test.describe("@store-builder Stock Reservation", () => {
  let merchant: ProvisionedMerchant | null = null;

  test.beforeAll(async ({ request }) => {
    merchant = await provisionMerchantWithPlan(request, "STORE_ONLY", { tag: "stock" });
  });

  test.afterAll(async ({ request }) => {
    if (merchant) await purgeMerchantProducts(request, merchant.accessToken, merchant.merchantId);
  });

  /* ── Test 1: reserve succeeds ──────────────────────────────── */

  test("@store-builder reserve succeeds with idempotencyKey", async ({ request }) => {
    test.skip(!merchant, "merchant not provisioned");
    if (!merchant) return;

    const seeded = await createProductWithStock(request, merchant, {
      name: `Stock Test ${Date.now()}`,
      sku: `STK-${Date.now().toString(36)}`.toUpperCase(),
      priceCents: 1000,
      stock: 10,
    });

    const idempotencyKey = `test-${Date.now()}`;
    const reserveRes = await request.post(
      `${API_BASE_URL}/merchants/${encodeURIComponent(merchant.merchantId)}/stock/reserve`,
      {
        headers: authHeaders(merchant.accessToken),
        data: {
          variantId: seeded.variantId,
          quantity: 3,
          idempotencyKey,
        },
      },
    );

    expect(reserveRes.ok()).toBeTruthy();
    const body = (await reserveRes.json()) as {
      reservationId: string;
      expiresAt: string;
    };
    expect(body.reservationId).toBeTruthy();
    expect(body.expiresAt).toBeTruthy();
    expect(() => new Date(body.expiresAt).toISOString()).not.toThrow();

    // Stock.reserved should have increased to 3
    const after = await fetchStock(request, merchant, seeded.productId);
    expect(after.reserved).toBeGreaterThanOrEqual(3);

    // Track for idempotency test
    (reserveRes as any)._reservationId = body.reservationId;
  });

  /* ── Test 2: idempotency ───────────────────────────────────── */

  test("@store-builder idempotency returns same reservationId", async ({ request }) => {
    test.skip(!merchant, "merchant not provisioned");
    if (!merchant) return;

    const seeded = await createProductWithStock(request, merchant, {
      name: `Idempotent ${Date.now()}`,
      sku: `IDM-${Date.now().toString(36)}`.toUpperCase(),
      priceCents: 500,
      stock: 10,
    });

    const idempotencyKey = `idem-${Date.now()}`;
    const payload = {
      variantId: seeded.variantId,
      quantity: 2,
      idempotencyKey,
    };
    const url = `${API_BASE_URL}/merchants/${encodeURIComponent(merchant.merchantId)}/stock/reserve`;

    const first = await request.post(url, {
      headers: authHeaders(merchant.accessToken),
      data: payload,
    });
    expect(first.ok()).toBeTruthy();
    const firstBody = (await first.json()) as { reservationId: string };

    // Same key + quantity → same reservation
    const second = await request.post(url, {
      headers: authHeaders(merchant.accessToken),
      data: payload,
    });
    expect(second.ok()).toBeTruthy();
    const secondBody = (await second.json()) as { reservationId: string };

    expect(secondBody.reservationId).toBe(firstBody.reservationId);

    // Reserved should NOT have doubled
    const after = await fetchStock(request, merchant, seeded.productId);
    expect(after.reserved).toBeLessThanOrEqual(2);
  });

  /* ── Test 3: insufficient stock ───────────────────────────── */

  test("@store-builder insufficient stock returns 409", async ({ request }) => {
    test.skip(!merchant, "merchant not provisioned");
    if (!merchant) return;

    const seeded = await createProductWithStock(request, merchant, {
      name: `Low Stock ${Date.now()}`,
      sku: `LOW-${Date.now().toString(36)}`.toUpperCase(),
      priceCents: 500,
      stock: 5,
    });

    const res = await request.post(
      `${API_BASE_URL}/merchants/${encodeURIComponent(merchant.merchantId)}/stock/reserve`,
      {
        headers: authHeaders(merchant.accessToken),
        data: {
          variantId: seeded.variantId,
          quantity: 10, // exceeds 5 in stock
          idempotencyKey: `over-${Date.now()}`,
        },
      },
    );

    expect(res.status()).toBe(409);

    // Reserved should not have changed
    const after = await fetchStock(request, merchant, seeded.productId);
    expect(after.reserved).toBe(0);
  });
});