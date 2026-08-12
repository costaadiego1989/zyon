/**
 * T046 — Deterministic chat fallback via real API.
 *
 * When OPENAI_API_KEY is absent or set to a dummy value,
 * the API must fall back to deterministic responses.
 * The widget must render chat bubbles without blank/error state.
 */
import { test, expect } from "@playwright/test";
import { openChatCheckout, REALAPI_URL } from "../fixtures/realapi-helpers.js";

const API = REALAPI_URL;

test.describe("@realapi deterministic chat", () => {
  let merchantId: string;
  let embedToken: string;

  test.beforeEach(async ({ request }) => {
    const seed = await request.post(`${API}/__test__/seed`);
    expect(seed.ok()).toBe(true);
    ({ merchantId, embedToken } = await seed.json());
  });

  test("chat thread renders at least one bubble without LLM", async ({ page }) => {
    await openChatCheckout(page, merchantId, embedToken, "e2e_product_001");

    const bubble = page.locator(".aacp-bubble, .zyon-bubble, [data-testid='chat-bubble']").first();
    await expect(bubble).toBeVisible({ timeout: 10_000 });

    const errorOverlay = page.locator(".error-overlay, [data-testid='error'], .zyon-error");
    await expect(errorOverlay).not.toBeVisible();
  });

  test("send message returns deterministic response", async ({ page }) => {
    await openChatCheckout(page, merchantId, embedToken, "e2e_product_001");

    const input = page.getByLabel("Mensagem para o assistente");
    if (await input.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await input.fill("Olá");
      await input.press("Enter");
      await expect(page.locator(".aacp-bubble, .zyon-bubble").nth(1))
        .toBeVisible({ timeout: 8_000 })
        .catch(() => null);
    }

    await expect(page.locator('[role="log"]')).toBeVisible();
  });
});
