/**
 * @regression REQ-CHK-005
 * Buyer hub must authenticate via Bearer token from phone verification.
 * Bug: Hub showed "não autenticado" error because API returned camelCase fields
 * that didn't match widget's snake_case BuyerProfile interface.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:3000";
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

// API-level tests — no seed needed, test buyer account endpoints directly
test.describe("@regression buyer-hub-bearer API", () => {
  test("buyer/me returns snake_case profile", async ({ request }) => {
    const email = `e2e_hub_${Date.now()}@test.aacp`;
    const reg = await request.post(`${API}/buyer/register`, {
      data: { email, password: "e2eTest123!", displayName: "Hub Test Buyer" }
    });
    expect(reg.ok()).toBe(true, `Register failed: ${await reg.text()}`);
    const { accessToken } = await reg.json();
    expect(accessToken).toBeTruthy();

    const me = await request.get(`${API}/buyer/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    expect(me.ok()).toBe(true, `GET /buyer/me failed: ${await me.text()}`);
    const profile = await me.json();

    // Must use snake_case (widget expects these fields)
    expect(profile).toHaveProperty("global_user_id");
    expect(profile).toHaveProperty("display_name");
    expect(profile).toHaveProperty("email");
    expect(profile).not.toHaveProperty("passwordHash");
    expect(profile).not.toHaveProperty("globalUserId");
    expect(profile.display_name).toBe("Hub Test Buyer");
    expect(profile.email).toBe(email);
  });

  test("buyer/me/summary returns snake_case stats", async ({ request }) => {
    const email = `e2e_sum_${Date.now()}@test.aacp`;
    const reg = await request.post(`${API}/buyer/register`, {
      data: { email, password: "e2eTest123!", displayName: "Summary Buyer" }
    });
    expect(reg.ok()).toBe(true);
    const { accessToken } = await reg.json();

    const summary = await request.get(`${API}/buyer/me/summary`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    expect(summary.ok()).toBe(true);
    const data = await summary.json();

    expect(data).toHaveProperty("orders_count");
    expect(data).toHaveProperty("total_spent");
    expect(data).toHaveProperty("currency");
    expect(typeof data.orders_count).toBe("number");
  });

  test("buyer/me/purchases returns items array with snake_case fields", async ({ request }) => {
    const email = `e2e_pur_${Date.now()}@test.aacp`;
    const reg = await request.post(`${API}/buyer/register`, {
      data: { email, password: "e2eTest123!", displayName: "Purchase Buyer" }
    });
    expect(reg.ok()).toBe(true);
    const { accessToken } = await reg.json();

    const purchases = await request.get(`${API}/buyer/me/purchases?limit=5`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    expect(purchases.ok()).toBe(true);
    const page = await purchases.json();

    expect(Array.isArray(page.items)).toBe(true);
    expect("next_cursor" in page).toBe(true);
  });

  test("buyer/me rejects request without token", async ({ request }) => {
    const me = await request.get(`${API}/buyer/me`);
    expect(me.status()).toBe(401);
  });
});

// UI test — needs seed, skip gracefully if seed not available
test.describe("@regression buyer-hub-bearer UI", () => {
  test("user panel opens without auth error when anonymous", async ({ page, request }) => {
    const seed = await request.post(`${API}/__test__/seed`);
    if (!seed.ok()) {
      test.skip(true, "Seed endpoint not available (E2E_SEED_ENABLED not set)");
      return;
    }
    const { merchantId, embedToken } = await seed.json();

    await page.goto(`${BASE}?merchantId=${merchantId}&embedToken=${embedToken}&productId=e2e_product_001`);
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });

    const userBtn = page.locator("[aria-label*='usuário' i], [aria-label*='perfil' i], .aacp-user-btn, [aria-label='Conta']").first();
    if (await userBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await userBtn.click();
      await page.waitForTimeout(500);
      const authError = page.locator("text=missing_bearer_token, text=invalid_bearer_token").first();
      await expect(authError).not.toBeVisible();
    }

    await expect(page.locator(".aacp-thread")).toBeVisible();
  });
});
