/**
 * Phone OTP login — chat channel (mocked).
 *
 * Selectors derived from GlobalAuthModal.tsx and ExperienceHeader.tsx:
 *   - Auth modal open button: aria-label "Entrar" (anonymous) or "Minha conta"
 *   - Phone input:  aria-label "Numero do celular"  (type="tel")
 *   - Code input:   aria-label "Codigo de verificacao"
 *   - Primary CTA:  .zyon-auth-primary (text changes: "Enviar codigo por SMS" → "Confirmar codigo")
 *   - Error region: role="alert" (.zyon-auth-error)
 *   - UserPanel:    .zyon-user-panel / .zyon-side-email
 *   - Account chip (after auth): aria-label "Minha conta" (.zyon-user-chip)
 */
import { test, expect } from "@playwright/test";
import { openChatCheckout } from "./fixtures/chat-helpers.js";

const TEST_PHONE = "(11) 98765-4321";
const TEST_CODE = "123456";
const TEST_EMAIL = "otp-user@e2e.test";

// ─── Happy path ───────────────────────────────────────────────────────────────

test("chat: phone OTP — enter phone, receive code, verify → shows buyer email in UserPanel", async ({ page }) => {
  await openChatCheckout(page, {
    chatSequence: [],
    authenticateViaPhone: true,
    buyerEmail: TEST_EMAIL,
  });

  // Click "Entrar" button in the header to open the GlobalAuthModal
  const entrarBtn = page.getByRole("button", { name: /Entrar/i });
  await expect(entrarBtn).toBeVisible({ timeout: 8_000 });
  await entrarBtn.click();

  // The phone input should be visible (first step)
  const phoneInput = page.getByLabel("Numero do celular");
  await expect(phoneInput).toBeVisible({ timeout: 5_000 });

  // Code input should NOT be visible yet
  const codeInput = page.getByLabel("Codigo de verificacao");
  await expect(codeInput).not.toBeVisible();

  // Fill phone (masked format is handled by the component; we fill digits via aria-label)
  await phoneInput.fill(TEST_PHONE);

  // "Enviar codigo por SMS" button should become enabled
  const sendBtn = page.locator(".zyon-auth-primary");
  await expect(sendBtn).toBeEnabled({ timeout: 3_000 });
  await expect(sendBtn).toContainText(/Enviar codigo por SMS/i);

  await sendBtn.click();

  // After send, code input appears and button text changes
  await expect(codeInput).toBeVisible({ timeout: 5_000 });
  await expect(sendBtn).toContainText(/Confirmar codigo/i, { timeout: 3_000 });

  // Fill 6-digit code
  await codeInput.fill(TEST_CODE);
  await expect(sendBtn).toBeEnabled({ timeout: 3_000 });

  await sendBtn.click();

  // Modal should close and user chip updates to "Minha conta"
  await expect(page.locator(".zyon-auth-dialog")).not.toBeVisible({ timeout: 8_000 });

  // Account chip should now show "Minha conta" (authenticated state)
  const accountChip = page.getByRole("button", { name: /Minha conta/i });
  await expect(accountChip).toBeVisible({ timeout: 8_000 });
  await accountChip.click();

  // UserPanel should show the buyer email
  const panel = page.locator(".zyon-user-panel");
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await expect(panel.locator(".zyon-side-email")).toContainText(TEST_EMAIL, { timeout: 3_000 });
});

// ─── Rejected code path ──────────────────────���────────────────────────────────

test("chat: phone OTP — wrong code shows error, does NOT authenticate", async ({ page }) => {
  await openChatCheckout(page, {
    chatSequence: [],
    authenticateViaPhone: true,
    buyerEmail: TEST_EMAIL,
    rejectPhoneCode: true,
  });

  const entrarBtn = page.getByRole("button", { name: /Entrar/i });
  await expect(entrarBtn).toBeVisible({ timeout: 8_000 });
  await entrarBtn.click();

  const phoneInput = page.getByLabel("Numero do celular");
  await expect(phoneInput).toBeVisible({ timeout: 5_000 });
  await phoneInput.fill(TEST_PHONE);

  const sendBtn = page.locator(".zyon-auth-primary");
  await expect(sendBtn).toBeEnabled({ timeout: 3_000 });
  await sendBtn.click();

  const codeInput = page.getByLabel("Codigo de verificacao");
  await expect(codeInput).toBeVisible({ timeout: 5_000 });
  await codeInput.fill(TEST_CODE);

  await sendBtn.click();

  // An error should appear (role="alert")
  const errorRegion = page.locator("[role='alert']");
  await expect(errorRegion).toBeVisible({ timeout: 8_000 });
  await expect(errorRegion).not.toBeEmpty();

  // The modal must still be open (auth was NOT granted)
  await expect(page.locator(".zyon-auth-dialog")).toBeVisible({ timeout: 3_000 });

  // "Entrar" button must still exist (not replaced by account chip)
  const accountChip = page.getByRole("button", { name: /Minha conta/i });
  await expect(accountChip).not.toBeVisible();
});
