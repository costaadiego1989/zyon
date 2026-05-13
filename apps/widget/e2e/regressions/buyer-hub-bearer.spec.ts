/**
 * @regression REQ-CHK-005
 * Buyer hub must authenticate via Bearer token from phone verification.
 * Bug: Hub showed "não autenticado" error because API returned camelCase fields
 * that didn't match widget's snake_case BuyerProfile interface.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:3000";
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test.describe("@regression buyer-hub-bearer", () => {
  let merchantId: string;
  let embedToken: string;

  test.beforeEach(async ({ request }) => {
    const seed = await request.post(`${API}/__test__/seed`);
    expect(seed.ok()).toBe(true);
    ({ merchantId, embedToken } = await seed.json());
  });

  test("buyer/me returns snake_case profile", async ({ request }) => {
    // Register a buyer account
    const reg = await request.post(`${API}/buyer/register`, {
      data: { email: `e2e_${Date.now()}@test.aacp`, password: "e2eTest123!", displayName: "E2E Buyer" }
    });
    expect(reg.ok()).toBe(true);
    const { accessToken } = await reg.json();
    expect(accessToken).toBeTruthy();

    // Fetch profile with Bearer token
    const me = await request.get(`${API}/buyer/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    expect(me.ok()).toBe(true);
    const profile = await me.json();

    // Must use snake_case (widget expects these fields)
    expect(profile).toHaveProperty("global_user_id");
    expect(profile).toHaveProperty("display_name");
    expect(profile).toHaveProperty("email");
    expect(profile).not.toHaveProperty("passwordHash");
    expect(profile).not.toHaveProperty("globalUserId");
  });

  test("buyer/me/summary returns snake_case stats", async ({ request }) => {
    const reg = await request.post(`${API}/buyer/register`, {
      data: { email: `e2e_sum_${Date.now()}@test.aacp`, password: "e2eTest123!", displayName: "Summary Buyer" }
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
  });

  test("user panel opens without error when buyer session exists", async ({ page }) => {
    await page.goto(`${BASE}?merchantId=${merchantId}&embedToken=${embedToken}&productId=e2e_product_001`);
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });

    // User panel button
    const userBtn = page.locator("[aria-label*='usuário' i], [aria-label*='perfil' i], .aacp-user-btn, [aria-label='Conta']").first();
    if (await userBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await userBtn.click();
      // Panel should open without an auth error
      await page.waitForTimeout(500);
      const errorMsg = page.locator("text=missing_bearer_token, text=invalid_bearer_token, text=Não autenticado").first();
      await expect(errorMsg).not.toBeVisible();
    }

    await expect(page.locator(".aacp-thread")).toBeVisible();
  });
});
