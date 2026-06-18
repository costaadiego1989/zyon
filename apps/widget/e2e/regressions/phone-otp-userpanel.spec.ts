/**
 * @regression T002 — UserPanel must render buyer email after phone OTP authentication.
 *
 * Regression for commit aacbfc0. The buyer email did not appear in the UserPanel
 * after phone OTP verification because the camelCase globalUserId/buyerEmail
 * mapping from the OTP response was not being applied.
 *
 * Fix: extended setupApiMocks with authenticateViaPhone / buyerEmail options and
 * phone OTP route handlers. This spec drives the full OTP UI flow so the session
 * is established via the real widget code path (not localStorage pre-seeding).
 */
import { test, expect } from "@playwright/test";
import { setupApiMocks } from "../fixtures/api-mocks.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test("@regression UserPanel shows buyer email after phone OTP login", async ({ page }) => {
  await setupApiMocks(page, { authenticateViaPhone: true, buyerEmail: "buyer@regression.test" });
  await page.goto(BASE);

  // Dismiss channel gate if visible (AgentChannelWelcome dialog)
  const channelGate = page.locator(".aacp-channel-gate__panel[role='dialog']");
  if (await channelGate.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const chatBtn = page.getByRole("button", { name: /Comprar por chat/i });
    if (await chatBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await chatBtn.click();
    }
  }

  // Wait for the chat thread to load
  await page.waitForSelector(".aacp-thread", { timeout: 10_000 });

  // Click "Entrar" in the header to open the GlobalAuthModal
  const entrarBtn = page.locator(".aacp-login-btn.aacp-google-login");
  await expect(entrarBtn).toBeVisible({ timeout: 8_000 });
  await entrarBtn.click();

  // Fill phone number
  const phoneInput = page.getByLabel("Numero do celular");
  await expect(phoneInput).toBeVisible({ timeout: 5_000 });
  await phoneInput.fill("(11) 98765-4321");

  // Send code
  const primaryBtn = page.locator(".aacp-auth-primary");
  await expect(primaryBtn).toBeEnabled({ timeout: 3_000 });
  await primaryBtn.click();

  // Fill 6-digit code
  const codeInput = page.getByLabel("Codigo de verificacao");
  await expect(codeInput).toBeVisible({ timeout: 5_000 });
  await codeInput.fill("123456");

  // Confirm code — triggers phone/verify → returns payload with buyerEmail
  await expect(primaryBtn).toBeEnabled({ timeout: 3_000 });
  await primaryBtn.click();

  // Auth modal closes on success
  await expect(page.locator(".aacp-auth-dialog")).not.toBeVisible({ timeout: 8_000 });

  // Open user panel via the account chip (now shows "Minha conta")
  const accountChip = page.locator(".aacp-user-chip");
  await expect(accountChip).toBeVisible({ timeout: 8_000 });
  await accountChip.click();

  // UserPanel must show the authenticated email
  const panel = page.locator(".aacp-user-panel");
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await expect(panel).toContainText("buyer@regression.test", { timeout: 3_000 });
});
