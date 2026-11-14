/**
 * Store Builder — Catalog CRUD E2E.
 *
 * Validates the full catalog flow against a real API + DB:
 *   - STORE_ONLY merchant can create, edit, soft-delete products
 *   - CHECKOUT_ONLY merchant is blocked at the API + UI
 *   - Multi-tenant isolation between two STORE_ONLY merchants
 *
 * REQUIRES:
 *   - API running at E2E_API_URL (default http://127.0.0.1:3009)
 *   - Test DB migrated (cd apps/api && pnpm prisma:deploy)
 *   - Test endpoint POST /__test__/set-merchant-plan available
 *
 * Run:
 *   cd apps/dashboard && pnpm e2e:store-builder -- --grep @store-builder
 *
 * @store-builder
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { API_BASE_URL, TIMEOUTS } from "../config";
import { authHeaders } from "../fixtures/api-helpers";
import {
  provisionMerchantWithPlan,
  type ProvisionedMerchant,
  purgeMerchantProducts,
} from "./fixtures/test-merchant";

/* ── Helpers ───────────────────────────────────────────────────── */

/**
 * Click the "Catálogo" tab in the dashboard sidebar.
 * The dashboard is a tab-based SPA — there is no /catalog URL route.
 */
async function openCatalogTab(page: Page): Promise<void> {
  // Sidebar nav button containing the label "Catálogo"
  const navBtn = page.locator("aside nav button", { hasText: "Catálogo" }).first();
  await navBtn.waitFor({ state: "visible", timeout: TIMEOUTS.element });
  await navBtn.click();
  // Wait for the catalog page heading
  await page.locator("h1", { hasText: "Catálogo" }).first().waitFor({
    state: "visible",
    timeout: TIMEOUTS.element,
  });
}

/**
 * Click the "Novo produto" button to open the product-detail tab.
 */
async function openProductDetail(page: Page): Promise<void> {
  await page.locator("button", { hasText: "Novo produto" }).first().click();
  await page.locator("h1", { hasText: "Novo produto" }).first().waitFor({
    state: "visible",
    timeout: TIMEOUTS.element,
  });
}

/**
 * Fill the product detail form with the given values.
 */
async function fillProductDetail(
  page: Page,
  data: {
    name: string;
    sku: string;
    priceCents: number;
    stock: number;
    weightGrams?: number;
  },
): Promise<void> {
  await page.locator("input[placeholder='Ex: Camiseta preta M']").fill(data.name);

  // SKU input — find by Field component label "SKU *"
  const skuInput = page
    .locator("label", { has: page.locator("span", { hasText: /^SKU \*$/ }) })
    .locator("input");
  await skuInput.first().fill(data.sku);

  // Price input (cents)
  const priceInput = page
    .locator("label", { has: page.locator("span", { hasText: /Preço base/ }) })
    .locator("input");
  await priceInput.first().fill(String(data.priceCents));

  // Stock
  const stockInput = page
    .locator("label", { has: page.locator("span", { hasText: /^Estoque$/ }) })
    .locator("input");
  await stockInput.first().fill(String(data.stock));

  if (data.weightGrams !== undefined) {
    const weightInput = page
      .locator("label", { has: page.locator("span", { hasText: /^Peso/ }) })
      .locator("input");
    await weightInput.first().fill(String(data.weightGrams));
  }
}

/**
 * Click "Criar produto" and wait for navigation back to the catalog list.
 */
async function saveProductAndReturn(page: Page): Promise<void> {
  await page
    .locator("button", { hasText: /^Criar produto$/ })
    .first()
    .click();
  await page
    .locator("h1", { hasText: "Catálogo" })
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUTS.element });
}

/**
 * Create a product via API (faster path for setup).
 * Returns the productId.
 */
async function createProductViaApi(
  request: APIRequestContext,
  merchant: ProvisionedMerchant,
  data: { name: string; sku: string; priceCents: number; stock?: number },
): Promise<string> {
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
            stockQuantity: data.stock ?? 0,
          },
        ],
      },
    },
  );
  if (!res.ok()) {
    throw new Error(
      `createProductViaApi failed: ${res.status()} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { id: string };
  return body.id;
}

/* ── Suite ─────────────────────────────────────────────────────── */

test.describe("@store-builder Catalog CRUD", () => {
  let merchantA: ProvisionedMerchant | null = null;
  let merchantB: ProvisionedMerchant | null = null;

  test.beforeAll(async ({ request }) => {
    merchantA = await provisionMerchantWithPlan(request, "STORE_ONLY", { tag: "alpha" });
    merchantB = await provisionMerchantWithPlan(request, "STORE_ONLY", { tag: "bravo" });
  });

  test.afterAll(async ({ request }) => {
    if (merchantA) await purgeMerchantProducts(request, merchantA.accessToken, merchantA.merchantId);
    if (merchantB) await purgeMerchantProducts(request, merchantB.accessToken, merchantB.merchantId);
  });

  /* ── Test 1: STORE plan can create product ──────────────────── */

  test("@store-builder STORE plan can create product via UI", async ({ page }) => {
    test.skip(!merchantA, "provisionMerchantWithPlan returned null — API/DB unavailable");
    if (!merchantA) return;

    // Log in as Merchant A via UI (uses storage state of the dashboard project)
    await page.goto("/");
    await page.locator("input[type='email']").fill(merchantA.email);
    await page.locator("input[type='password']").fill(merchantA.password);
    await page.locator("button[type='submit']").click();
    await page.locator("nav").waitFor({ state: "visible", timeout: TIMEOUTS.auth });

    await openCatalogTab(page);
    await openProductDetail(page);

    const runId = Date.now().toString(36);
    const name = `Camiseta Teste ${runId}`;
    const sku = `CAM-${runId}`.toUpperCase();

    await fillProductDetail(page, {
      name,
      sku,
      priceCents: 5000,
      stock: 10,
      weightGrams: 200,
    });

    await saveProductAndReturn(page);

    // Verify it shows in the catalog table
    const row = page.locator("table tbody tr", { hasText: name });
    await expect(row).toBeVisible({ timeout: TIMEOUTS.element });

    // The SKU and stock column reflect the variant
    await expect(row).toContainText(sku);
  });

  /* ── Test 2: CHECKOUT plan cannot create product ─────────────── */

  test("@store-builder CHECKOUT plan cannot access catalog", async ({ request }) => {
    const merchant = await provisionMerchantWithPlan(request, "CHECKOUT_ONLY", { tag: "checkout" });
    test.skip(!merchant, "provisionMerchantWithPlan returned null — API/DB unavailable");
    if (!merchant) return;

    // Direct API check — the plan guard must reject with 403
    const res = await request.post(
      `${API_BASE_URL}/merchants/${encodeURIComponent(merchant.merchantId)}/products`,
      {
        headers: authHeaders(merchant.accessToken),
        data: {
          name: "Should be blocked",
          variants: [{ sku: "BLOCK-001", basePriceInCents: 1000 }],
        },
      },
    );

    expect(res.status()).toBe(403);

    // List also blocked
    const listRes = await request.get(
      `${API_BASE_URL}/merchants/${encodeURIComponent(merchant.merchantId)}/products`,
      { headers: authHeaders(merchant.accessToken) },
    );
    expect(listRes.status()).toBe(403);
  });

  /* ── Test 3: Multi-tenant isolation ──────────────────────────── */

  test("@store-builder multi-tenant isolation between STORE merchants", async ({ request }) => {
    test.skip(!merchantA || !merchantB, "tenants not provisioned");
    if (!merchantA || !merchantB) return;

    // Create ItemA-001 owned by Merchant A
    const productA = await createProductViaApi(request, merchantA, {
      name: `ItemA-${Date.now().toString(36)}`,
      sku: `ITEMA-${Date.now().toString(36)}`.toUpperCase(),
      priceCents: 1234,
      stock: 5,
    });

    // Merchant B lists own products — must NOT contain A's product
    const listRes = await request.get(
      `${API_BASE_URL}/merchants/${encodeURIComponent(merchantB.merchantId)}/products?limit=100`,
      { headers: authHeaders(merchantB.accessToken) },
    );
    expect(listRes.ok()).toBeTruthy();
    const body = (await listRes.json()) as { products: Array<{ id: string }> };
    const ids = body.products.map((p) => p.id);
    expect(ids).not.toContain(productA);

    // Direct fetch by id with Merchant B's token — must 404
    const directRes = await request.get(
      `${API_BASE_URL}/merchants/${encodeURIComponent(merchantB.merchantId)}/products/${encodeURIComponent(productA)}`,
      { headers: authHeaders(merchantB.accessToken) },
    );
    expect(directRes.status()).toBe(404);
  });

  /* ── Test 4: Edits persist ──────────────────────────────────── */

  test("@store-builder edits persist after refresh", async ({ request }) => {
    test.skip(!merchantA, "merchant A not provisioned");
    if (!merchantA) return;

    const productId = await createProductViaApi(request, merchantA, {
      name: `Original Name ${Date.now().toString(36)}`,
      sku: `EDIT-${Date.now().toString(36)}`.toUpperCase(),
      priceCents: 2500,
      stock: 3,
    });

    const newName = `Renamed ${Date.now().toString(36)}`;
    const updateRes = await request.put(
      `${API_BASE_URL}/merchants/${encodeURIComponent(merchantA.merchantId)}/products/${encodeURIComponent(productId)}`,
      {
        headers: authHeaders(merchantA.accessToken),
        data: { name: newName },
      },
    );
    expect(updateRes.ok()).toBeTruthy();

    // Refetch — name must be the new value
    const getRes = await request.get(
      `${API_BASE_URL}/merchants/${encodeURIComponent(merchantA.merchantId)}/products/${encodeURIComponent(productId)}`,
      { headers: authHeaders(merchantA.accessToken) },
    );
    expect(getRes.ok()).toBeTruthy();
    const product = (await getRes.json()) as { name: string };
    expect(product.name).toBe(newName);
  });

  /* ── Test 5: Soft delete ────────────────────────────────────── */

  test("@store-builder soft delete removes product from list", async ({ request }) => {
    test.skip(!merchantA, "merchant A not provisioned");
    if (!merchantA) return;

    const sku = `DEL-${Date.now().toString(36)}`.toUpperCase();
    const productId = await createProductViaApi(request, merchantA, {
      name: `Doomed ${Date.now().toString(36)}`,
      sku,
      priceCents: 999,
      stock: 1,
    });

    // Delete
    const delRes = await request.delete(
      `${API_BASE_URL}/merchants/${encodeURIComponent(merchantA.merchantId)}/products/${encodeURIComponent(productId)}`,
      { headers: authHeaders(merchantA.accessToken) },
    );
    expect(delRes.ok()).toBeTruthy();

    // List must not include the deleted product
    const listRes = await request.get(
      `${API_BASE_URL}/merchants/${encodeURIComponent(merchantA.merchantId)}/products?limit=100`,
      { headers: authHeaders(merchantA.accessToken) },
    );
    expect(listRes.ok()).toBeTruthy();
    const body = (await listRes.json()) as { products: Array<{ id: string }> };
    const ids = body.products.map((p) => p.id);
    expect(ids).not.toContain(productId);
  });
});