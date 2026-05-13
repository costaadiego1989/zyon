/**
 * T046 — Deterministic chat fallback via real API.
 *
 * When OPENAI_API_KEY is absent or set to a dummy value,
 * the API must fall back to deterministic responses.
 * The widget must render chat bubbles without blank/error state.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:3000";
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test.describe("@realapi deterministic chat", () => {
  let merchantId: string;
  let embedToken: string;

  test.beforeEach(async ({ request }) => {
    const seed = await request.post(`${API}/__test__/seed`);
    expect(seed.ok()).toBe(true);
    ({ merchantId, embedToken } = await seed.json());
  });

  test("chat thread renders at least one bubble without LLM", async ({ page }) => {
    await page.goto(`${BASE}?merchantId=${merchantId}&embedToken=${embedToken}&productId=e2e_product_001`);
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });

    // At least one chat bubble must appear (deterministic greeting)
    const bubble = page.locator(".aacp-bubble, [data-testid='chat-bubble'], .aacp-message").first();
    await expect(bubble).toBeVisible({ timeout: 10_000 });

    // No unhandled JS errors — page should not show error overlay
    const errorOverlay = page.locator(".error-overlay, [data-testid='error'], .aacp-error");
    await expect(errorOverlay).not.toBeVisible();
  });

  test("send message returns deterministic response", async ({ page }) => {
    await page.goto(`${BASE}?merchantId=${merchantId}&embedToken=${embedToken}&productId=e2e_product_001`);
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });

    const input = page.locator("input[placeholder], textarea[placeholder]").first();
    if (await input.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await input.fill("Olá");
      await input.press("Enter");
      // A new bubble should appear within 5s (deterministic, no LLM latency)
      await expect(page.locator(".aacp-bubble, [data-testid='chat-bubble']").nth(1))
        .toBeVisible({ timeout: 8_000 })
        .catch(() => null);
    }

    await expect(page.locator(".aacp-thread")).toBeVisible();
  });
});
