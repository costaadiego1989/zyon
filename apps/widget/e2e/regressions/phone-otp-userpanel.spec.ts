/**
 * @regression T002 — UserPanel must render buyer email after phone OTP authentication.
 *
 * Regression for commit aacbfc0. The buyer email did not appear in the UserPanel
 * after phone OTP verification because the camelCase globalUserId/buyerEmail
 * mapping from the OTP response was not being applied.
 */
import { test, expect } from "@playwright/test";
import { setupApiMocks } from "../fixtures/api-mocks.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test("@regression UserPanel shows buyer email after phone OTP login", async ({ page }) => {
  await setupApiMocks(page, { authenticateViaPhone: true, buyerEmail: "buyer@regression.test" });
  await page.goto(BASE);
  await page.waitForSelector(".aacp-thread", { timeout: 10_000 });

  // Open user panel
  const userIcon = page.locator("[aria-label='Minha conta'], .aacp-user-btn").first();
  if (await userIcon.isVisible()) {
    await userIcon.click();
  }

  // UserPanel must show the authenticated email
  const panel = page.locator(".aacp-user-panel");
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await expect(panel).toContainText("buyer@regression.test", { timeout: 3_000 });
});
