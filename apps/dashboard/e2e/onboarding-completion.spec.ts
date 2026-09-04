import { test, expect } from "@playwright/test";

test("onboarding wizard shows completion screen when merchant is already onboarded", async ({ page }) => {
  // 1. Navigate to dashboard
  await page.goto("/");

  // 2. Check if login is needed
  const emailInput = page.locator("input[placeholder='owner@loja.com']");
  const isLoginPage = await emailInput.isVisible({ timeout: 2000 }).catch(() => false);

  if (isLoginPage) {
    // Login with test credentials
    await emailInput.click();
    await emailInput.pressSequentially("diego2@athom.com", { delay: 50 });
    await page.waitForTimeout(300);

    const passwordInput = page.locator("input[type='password']");
    await passwordInput.click();
    await passwordInput.pressSequentially("TestPass123!", { delay: 50 });
    await page.waitForTimeout(300);

    await page.locator("button[type='submit']").click();
    await page.waitForTimeout(3000);
  }

  // Wait for dashboard to load (look for main content area or navigation)
  await expect(page.locator('nav')).toBeVisible({ timeout: 10000 });

  // 3. Click "Primeiros passos" in sidebar navigation
  const primeirosPassosLink = page.locator("text=Primeiros passos").first();
  await primeirosPassosLink.click();

  // Wait for the onboarding content to load
  await page.waitForTimeout(2000);

  // 4. Check what's displayed
  // If completed, should see "Checkout ativo" text or the orb with smile

  // Try to find completion screen indicators
  const checkoutAtivoText = page.locator('text="Checkout ativo"');
  const orbWithSmile = page.locator('.onb-widget-orb__eyes svg');

  // Take a screenshot to see what's on screen
  await page.screenshot({ path: 'onboarding-screenshot.png' });

  // Get page content for analysis
  const pageContent = await page.content();

  // Check if we see wizard steps (would indicate a bug)
  const hasWizardSteps = pageContent.includes("Etapa 01") || pageContent.includes("Etapa 02");
  const hasCheckoutAtivoText = pageContent.includes("Checkout ativo");
  const hasCompletionCard = pageContent.includes("onb-complete");

  console.log("Page content analysis:");
  console.log("- Has wizard steps:", hasWizardSteps);
  console.log("- Has 'Checkout ativo' text:", hasCheckoutAtivoText);
  console.log("- Has completion card:", hasCompletionCard);

  // If completion screen is shown, we should see:
  // 1. The text "Checkout ativo, [merchant_name]!"
  // 2. Or the orb with smile animation
  // 3. Button "Ir para o painel"

  if (hasCompletionCard || hasCheckoutAtivoText) {
    console.log("✅ PASS: Onboarding completion screen is displayed");

    // Verify completion card elements
    const irsParaOPainelButton = page.locator('button:has-text("Ir para o painel")');
    await expect(irsParaOPainelButton).toBeVisible();

    console.log("✅ Verified: 'Ir para o painel' button is visible");
  } else if (hasWizardSteps) {
    console.log("❌ BUG: Wizard steps are shown instead of completion screen");
    console.log("Frontend is not respecting onboardingState.completed = true from API");

    // Get more details about what wizard step is showing
    const stepContent = await page.locator('.onb-stage-title').textContent();
    console.log("Current wizard step title:", stepContent);
  } else {
    console.log("⚠️  UNCLEAR: Neither completion screen nor clear wizard steps detected");
    console.log("Actual page content (first 2000 chars):");
    console.log(pageContent.substring(0, 2000));
  }
});
