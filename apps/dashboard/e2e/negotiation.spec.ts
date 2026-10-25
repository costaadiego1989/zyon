import { test, expect, type Page } from '@playwright/test';

// Tests run serially (workers: 1)

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

async function navigateToNegotiation(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await loginIfNeeded(page);
  await page.waitForTimeout(2000);

  const negNav = page.locator('aside').locator('span').filter({ hasText: 'Negociação' });
  await negNav.first().click();
  await page.waitForTimeout(3000);
}

// ────────────────────────────────────────────────────────────────────────────────

test('@negotiation-load', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToNegotiation(page);

  // Title pattern: NEGOCIAÇÃO M2M + h1
  const eyebrow = page.locator('text=NEGOCIAÇÃO M2M').first();
  await expect(eyebrow).toBeVisible({ timeout: 10000 });

  const h1 = page.locator('h1').filter({ hasText: /Política de Negociação/i });
  await expect(h1).toBeVisible();

  // Lead italic paragraph
  const lead = page.locator('div').filter({ hasText: /Configure regras de negociação automática/i }).first();
  await expect(lead).toBeVisible();
});

// ────────────────────────────────────────────────────────────────────────────────

test('@negotiation-tabs', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToNegotiation(page);

  // Pill tabs render
  const tablist = page.locator('[role="tablist"][aria-label="Seções de negociação automática"]');
  await expect(tablist).toBeVisible({ timeout: 10000 });

  const tabs = tablist.locator('[role="tab"]');
  await expect(tabs).toHaveCount(3);

  await expect(tabs.nth(0)).toHaveText('Sessões e custos');
  await expect(tabs.nth(1)).toHaveText('Regras de negociação');
  await expect(tabs.nth(2)).toHaveText('Testar cenários');
});

// ────────────────────────────────────────────────────────────────────────────────

test('@negotiation-tab-switch', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToNegotiation(page);

  const tablist = page.locator('[role="tablist"][aria-label="Seções de negociação automática"]');
  await expect(tablist).toBeVisible({ timeout: 10000 });

  const tabs = tablist.locator('[role="tab"]');

  // Overview (default) — metrics section visible
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.metrics').first()).toBeVisible();

  // Switch to Policy
  await tabs.nth(1).click();
  await page.waitForTimeout(500);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  // Policy tab renders the toggle row "Negociação habilitada"
  await expect(page.locator('text=Negociação habilitada').first()).toBeVisible();

  // Switch to Simulator
  await tabs.nth(2).click();
  await page.waitForTimeout(500);
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  // Policy-only fields should disappear (neg-global-max input is policy tab)
  await expect(page.locator('#neg-global-max')).toHaveCount(0);
});

// ────────────────────────────────────────────────────────────────────────────────

test('@negotiation-metrics', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToNegotiation(page);

  // Overview tab is default — wait for metrics
  await expect(page.locator('.metrics').first()).toBeVisible({ timeout: 10000 });

  // Metric labels
  await expect(page.locator('text=Sessões').first()).toBeVisible();
  await expect(page.locator('text=Custo IA').first()).toBeVisible();
  await expect(page.locator('text=Acordo').first()).toBeVisible();
  await expect(page.locator('text=Desconto médio').first()).toBeVisible();

  // Each metric has a strong value
  const metrics = page.locator('.metric');
  await expect(metrics).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const strong = metrics.nth(i).locator('strong');
    await expect(strong).toBeVisible();
  }
});

// ────────────────────────────────────────────────────────────────────────────────

test('@negotiation-date-filter', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToNegotiation(page);

  // Period pills are in the overview tab
  await expect(page.locator('.metrics').first()).toBeVisible({ timeout: 10000 });

  // Default selected should be 30d (aria-pressed=true)
  const sevenD = page.locator('button[aria-pressed]').filter({ hasText: /^7d$/ });
  const thirtyD = page.locator('button[aria-pressed]').filter({ hasText: /^30d$/ });
  const ninetyD = page.locator('button[aria-pressed]').filter({ hasText: /^90d$/ });
  const allBtn = page.locator('button[aria-pressed]').filter({ hasText: /^Tudo$/ });

  await expect(sevenD).toBeVisible();
  await expect(thirtyD).toBeVisible();
  await expect(ninetyD).toBeVisible();
  await expect(allBtn).toBeVisible();

  // 30d should start pressed
  await expect(thirtyD).toHaveAttribute('aria-pressed', 'true');

  // Track stats network response to confirm filter triggers a request
  let statsRequestUrl = '';
  page.on('request', (req) => {
    if (req.url().includes('/negotiations/stats')) {
      statsRequestUrl = req.url();
    }
  });

  // Click 7d
  await sevenD.click();
  await page.waitForTimeout(1500);
  await expect(sevenD).toHaveAttribute('aria-pressed', 'true');
  expect(statsRequestUrl).toContain('period=7d');

  // Click 90d
  await ninetyD.click();
  await page.waitForTimeout(1500);
  await expect(ninetyD).toHaveAttribute('aria-pressed', 'true');
  expect(statsRequestUrl).toContain('period=90d');

  // Click Tudo
  await allBtn.click();
  await page.waitForTimeout(1500);
  await expect(allBtn).toHaveAttribute('aria-pressed', 'true');
  expect(statsRequestUrl).toContain('period=all');
});

// ────────────────────────────────────────────────────────────────────────────────

test('@negotiation-policy-fields', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToNegotiation(page);

  // Switch to policy tab
  const tablist = page.locator('[role="tablist"][aria-label="Seções de negociação automática"]');
  await expect(tablist).toBeVisible({ timeout: 10000 });
  await tablist.locator('[role="tab"]').nth(1).click();
  await page.waitForTimeout(1500);

  // Required form fields for margin / discount limits
  await expect(page.locator('#neg-global-min')).toBeVisible();
  await expect(page.locator('#neg-global-max')).toBeVisible();
  await expect(page.locator('#neg-max-rounds')).toBeVisible();
  await expect(page.locator('#neg-cost-per-call')).toBeVisible();
  await expect(page.locator('#neg-max-ai-cost')).toBeVisible();

  // Save / Reload buttons
  await expect(page.locator('button').filter({ hasText: 'Salvar política' })).toBeVisible();
  await expect(page.locator('button').filter({ hasText: 'Recarregar' })).toBeVisible();
});

// ────────────────────────────────────────────────────────────────────────────────

test('@negotiation-policy-save', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToNegotiation(page);

  // Switch to policy tab
  const tablist = page.locator('[role="tablist"][aria-label="Seções de negociação automática"]');
  await expect(tablist).toBeVisible({ timeout: 10000 });
  await tablist.locator('[role="tab"]').nth(1).click();
  await page.waitForTimeout(2000);

  // Wait for policy to load (status banner no longer says "carregando")
  await expect(page.locator('#neg-global-max')).toBeVisible();

  // Capture initial value
  const maxInput = page.locator('#neg-global-max');
  const initialMax = await maxInput.inputValue();
  const numericInitial = Number(initialMax);

  // Set a new value (different from initial)
  const newMax = numericInitial === 7 ? 12 : 7;
  await maxInput.fill(String(newMax));

  // Capture PUT response
  const putResponsePromise = page.waitForResponse(
    (resp) => resp.url().includes('/merchant-negotiation-policy') && resp.request().method() === 'PUT',
    { timeout: 10000 },
  );

  // Click save
  await page.locator('button').filter({ hasText: 'Salvar política' }).click();

  const putResponse = await putResponsePromise;
  expect(putResponse.status()).toBe(200);

  // Wait for the success indicator to render
  await page.waitForTimeout(1500);
});

// ────────────────────────────────────────────────────────────────────────────────

test('@negotiation-policy-persist', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToNegotiation(page);

  // Switch to policy tab
  const tablist = page.locator('[role="tablist"][aria-label="Seções de negociação automática"]');
  await expect(tablist).toBeVisible({ timeout: 10000 });
  await tablist.locator('[role="tab"]').nth(1).click();
  await page.waitForTimeout(2000);

  await expect(page.locator('#neg-global-max')).toBeVisible();

  const maxInput = page.locator('#neg-global-max');
  const initialValue = await maxInput.inputValue();
  const numericInitial = Number(initialValue);

  // Set new value & save
  const newMax = numericInitial === 9 ? 14 : 9;
  await maxInput.fill(String(newMax));

  const putResp = page.waitForResponse(
    (resp) => resp.url().includes('/merchant-negotiation-policy') && resp.request().method() === 'PUT',
    { timeout: 10000 },
  );
  await page.locator('button').filter({ hasText: 'Salvar política' }).click();
  const putResponse = await putResp;
  expect(putResponse.status()).toBe(200);
  await page.waitForTimeout(1500);

  // Reload page
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Re-navigate to negotiation tab
  const negNav = page.locator('aside').locator('span').filter({ hasText: 'Negociação' });
  await negNav.first().click();
  await page.waitForTimeout(2000);

  // Switch to policy tab again
  const tablistAfter = page.locator('[role="tablist"][aria-label="Seções de negociação automática"]');
  await expect(tablistAfter).toBeVisible({ timeout: 10000 });
  await tablistAfter.locator('[role="tab"]').nth(1).click();
  await page.waitForTimeout(2000);

  // Verify the value persisted
  const reloadedInput = page.locator('#neg-global-max');
  await expect(reloadedInput).toBeVisible();
  const reloadedValue = await reloadedInput.inputValue();
  expect(reloadedValue).toBe(String(newMax));
});

// ────────────────────────────────────────────────────────────────────────────────

test('@negotiation-no-js-errors', async ({ page }) => {
  test.setTimeout(60000);
  const jsExceptions: string[] = [];

  page.on('pageerror', (err) => {
    jsExceptions.push(err.toString());
  });

  await navigateToNegotiation(page);

  // Visit all three tabs to trigger renders
  const tablist = page.locator('[role="tablist"][aria-label="Seções de negociação automática"]');
  await expect(tablist).toBeVisible({ timeout: 10000 });

  await tablist.locator('[role="tab"]').nth(0).click();
  await page.waitForTimeout(1000);
  await tablist.locator('[role="tab"]').nth(1).click();
  await page.waitForTimeout(1000);
  await tablist.locator('[role="tab"]').nth(2).click();
  await page.waitForTimeout(1000);

  // Back to policy and save to exercise network + state path
  await tablist.locator('[role="tab"]').nth(1).click();
  await page.waitForTimeout(1500);

  await expect(page.locator('#neg-global-max')).toBeVisible();
  const maxInput = page.locator('#neg-global-max');
  await maxInput.fill('11');
  await page.locator('button').filter({ hasText: 'Salvar política' }).click();
  await page.waitForTimeout(2000);

  expect(jsExceptions).toEqual([]);
});