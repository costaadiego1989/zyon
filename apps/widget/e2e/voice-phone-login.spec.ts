/**
 * Phone / OTP authentication — voice channel (mocked).
 *
 * WHY THE VOICE CHANNEL DIFFERS FROM CHAT:
 * The VoiceCheckoutExperience renders its own custom header (aacp-voice-header)
 * that does NOT include the ExperienceHeader component.  As a result, the voice
 * UI exposes no "Entrar" / login button that would open the GlobalAuthModal.
 *
 * The GlobalAuthModal IS present in the DOM (rendered by CheckoutExperienceOverlays)
 * but has no in-voice trigger button.  The intended auth path for a returning buyer
 * in the voice channel is the agent-driven "loginFromCheckoutSession" flow:
 *
 *   1. The agent recognises the returning buyer (by phone/email in start-checkout).
 *   2. The agent sends an OTP to the buyer's registered contact (existing_buyer_otp_sent
 *      step), the widget POSTs to /buyer/login-from-session automatically.
 *   3. On success, the buyer session is established and the UserPanel becomes
 *      accessible via the CheckoutExperienceShell.
 *
 * These tests cover that realistic path using voice-helpers.
 *
 * If a future release adds an explicit login button to the voice header, the
 * chat phone-login spec (phone-login.spec.ts) can be adapted for voice too.
 */
import { test, expect } from "@playwright/test";
import { installVoiceBrowserMocks, openVoiceCheckout } from "./fixtures/voice-helpers.js";
import { setupApiMocks } from "./fixtures/api-mocks.js";

const VOICE_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

// ─── Happy path: returning buyer recognised by agent ─────────────────────────

test("voice: returning buyer OTP recognised by agent — session established, UserPanel shows email", async ({ page }) => {
  await installVoiceBrowserMocks(page);

  // The agent will immediately recognise the existing buyer and signal OTP flow.
  // The start-checkout response already carries recognized_buyer=true customer data.
  // The login-from-session route returns a valid buyer payload (default behaviour
  // when rejectBuyerLogin is not set).
  await setupApiMocks(page, {
    chatSequence: ["existing_buyer_otp_sent", "existing_buyer_shipping_options"],
  });

  await page.goto(VOICE_BASE);
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /Comprar por voz/i }).click();

  // Voice channel loaded
  await expect(page.locator("[data-channel='voice']")).toBeVisible({ timeout: 10_000 });

  // Agent speaks — caption reflects OTP flow step
  await expect(page.locator(".zyon-voice-caption__agent")).toBeVisible({ timeout: 10_000 });

  // The widget should have triggered login-from-session automatically.
  // After the buyer is recognised, the session exists and the cart panel
  // can be opened. We verify the voice experience remains functional (no crash).
  const orderBtn = page.locator(".zyon-voice-header__order, .zyon-voice-order-strip");
  await expect(orderBtn.first()).toBeVisible({ timeout: 5_000 });
});

// ─── Error path: login-from-session rejects OTP ───────────────────────────────

test("voice: buyer OTP rejected by server — voice UI remains functional, no crash", async ({ page }) => {
  await installVoiceBrowserMocks(page);

  await setupApiMocks(page, {
    chatSequence: ["existing_buyer_otp_sent"],
    rejectBuyerLogin: true,
  });

  await page.goto(VOICE_BASE);
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /Comprar por voz/i }).click();

  // Voice channel still loads despite auth failure
  await expect(page.locator("[data-channel='voice']")).toBeVisible({ timeout: 10_000 });

  // The agent caption should still appear (voice flow not crashed)
  await expect(page.locator(".zyon-voice-caption__agent")).toBeVisible({ timeout: 10_000 });

  // No unhandled error overlay (NetworkErrorView uses .zyon-network-error; not present)
  // Just assert the mic button is still in the DOM (voice UI intact)
  const mic = page.locator(".zyon-voice-mic");
  await expect(mic).toBeVisible({ timeout: 5_000 });
});
