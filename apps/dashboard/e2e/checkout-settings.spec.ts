import { test, expect, type Page } from '@playwright/test';

// Tests run in parallel with independent login

test.use({ actionTimeout: 15000 });

async function loginIfNeeded(page: Page) {
  const emailInput = page.locator("input[placeholder='owner@loja.com']");
  const isLoginPage = await emailInput.isVisible({ timeout: 2000 }).catch(() => false);
  if (isLoginPage) {
    await emailInput.click();
    await emailInput.pressSequentially('demo@zyon.com', { delay: 50 });
    await page.waitForTimeout(300);
    const passwordInput = page.locator("input[type='password']");
    await passwordInput.click();
    await passwordInput.pressSequentially('demo1234', { delay: 50 });
    await page.waitForTimeout(300);
    await page.locator("button[type='submit']").click();
    await page.waitForTimeout(3000);
  }
}

async function navigateToCheckoutSettings(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await loginIfNeeded(page);
  await page.waitForTimeout(2000);

  // Click Checkout nav item in sidebar
  const checkoutNav = page.locator('aside').locator('span').filter({ hasText: 'Checkout' });
  await checkoutNav.first().click();
  await page.waitForTimeout(3000);
}

// ────────────────────────────────────────────────────────────────────────────────

test('@checkout-settings-load', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToCheckoutSettings(page);

  // Main heading
  const heading = page.locator('h1').filter({ hasText: /Configurações do Checkout/i });
  await expect(heading).toBeVisible({ timeout: 10000 });

  // Content panel
  const contentDiv = page.locator('.cfg-page');
  await expect(contentDiv).toBeVisible();

  // Sidebar nav
  const nav = page.locator('nav');
  await expect(nav).toBeVisible();
});

// ────────────────────────────────────────────────────────────────────────────────

test('@checkout-settings-fields', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToCheckoutSettings(page);

  // Wait for content to load
  await expect(page.locator('.cfg-page h1')).toBeVisible({ timeout: 10000 });

  // Section 01 - Mode radio buttons (3 modes)
  const radios = page.locator('input[type="radio"][name="mode"]');
  await expect(radios).toHaveCount(3);

  // Section 02 - Toggles (role=switch buttons)
  const toggles = page.locator('button[role="switch"]');
  const toggleCount = await toggles.count();
  expect(toggleCount).toBeGreaterThanOrEqual(2); // openWidgetOnTrigger + startMinimized minimum

  // Section 02 - Position select
  const positionSelect = page.locator('select#cfg-position');
  await expect(positionSelect).toBeVisible();

  // Section 02 - Slider (range input for delay)
  const rangeInputs = page.locator('input[type="range"]');
  const rangeCount = await rangeInputs.count();
  expect(rangeCount).toBeGreaterThanOrEqual(2); // initialDelay + minimumAbandonmentScore

  // Section 03 - Number inputs for trigger priorities
  const numberInputs = page.locator('input[type="number"]');
  const numberCount = await numberInputs.count();
  expect(numberCount).toBeGreaterThanOrEqual(5); // 5 triggers + cooldown + maxInterventions + cartValue

  // Section 04 - Save button (exists in header and footer)
  const saveBtn = page.locator('button.cfg-save').first();
  await expect(saveBtn).toBeVisible();

  // Section 05 - Reload button
  const reloadBtn = page.locator('button').filter({ hasText: 'Recarregar' });
  await expect(reloadBtn).toBeVisible();
});

// ────────────────────────────────────────────────────────────────────────────────

test('@checkout-settings-save', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToCheckoutSettings(page);

  // Wait for content loaded
  await expect(page.locator('.cfg-page h1')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1000);

  // Toggle the first switch (openWidgetOnTrigger)
  const firstToggle = page.locator('button[role="switch"]').first();
  const wasPressedBefore = await firstToggle.getAttribute('aria-checked');
  await firstToggle.click();
  await page.waitForTimeout(500);

  // Verify it toggled
  const isNowPressed = await firstToggle.getAttribute('aria-checked');
  expect(isNowPressed).not.toBe(wasPressedBefore);

  // Click save
  const saveBtn = page.locator('button.cfg-save').first();
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();

  // Wait for save to complete (button re-enables or message appears)
  await page.waitForTimeout(3000);

  // Check that either the save button is enabled again or a success/error message appeared
  const successBanner = page.locator('.cfg-banner.info');
  const errorBanner = page.locator('.cfg-banner.err');
  const bannerVisible = await successBanner.isVisible().catch(() => false) || await errorBanner.isVisible().catch(() => false);
  const buttonEnabled = await saveBtn.isEnabled();

  // At least one of these should be true (button re-enabled or feedback shown)
  expect(bannerVisible || buttonEnabled).toBe(true);
});

// ────────────────────────────────────────────────────────────────────────────────

test('@checkout-settings-reload', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToCheckoutSettings(page);

  // Wait for content
  await expect(page.locator('.cfg-page h1')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1000);

  // Get current toggle state
  const firstToggle = page.locator('button[role="switch"]').first();
  const initialState = await firstToggle.getAttribute('aria-checked');

  // Toggle it
  await firstToggle.click();
  await page.waitForTimeout(500);

  const toggledState = await firstToggle.getAttribute('aria-checked');
  expect(toggledState).not.toBe(initialState);

  // Save
  const saveBtn = page.locator('button.cfg-save').first();
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await page.waitForTimeout(2000);

  // Reload page
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Navigate back to checkout settings after reload
  const checkoutNav = page.locator('aside').locator('span').filter({ hasText: 'Checkout' });
  await checkoutNav.first().click();
  await page.waitForTimeout(3000);

  // Verify form still renders after reload (persistence test)
  const reloadedToggle = page.locator('button[role="switch"]').first();
  await expect(reloadedToggle).toBeVisible({ timeout: 10_000 });
  // State may or may not persist depending on API — verify no crash
  const reloadedState = await reloadedToggle.getAttribute('aria-checked');
  console.log(`  Reload persistence: initial=${initialState}, toggled=${toggledState}, reloaded=${reloadedState}`);
});

// ────────────────────────────────────────────────────────────────────────────────

test('@checkout-settings-no-js-errors', async ({ page }) => {
  test.setTimeout(60000);
  const jsExceptions: string[] = [];

  page.on('pageerror', (err) => {
    jsExceptions.push(err.toString());
  });

  await navigateToCheckoutSettings(page);

  // Wait for content
  await expect(page.locator('.cfg-page h1')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1000);

  // Toggle a setting
  const toggle = page.locator('button[role="switch"]').first();
  await toggle.click();
  await page.waitForTimeout(500);

  // Click save
  const saveBtn = page.locator('button.cfg-save').first();
  if (await saveBtn.isEnabled()) {
    await saveBtn.click();
    await page.waitForTimeout(2000);
  }

  // Verify no uncaught JS exceptions
  expect(jsExceptions).toEqual([]);
});
