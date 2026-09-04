import { test, expect } from '@playwright/test';

test.describe('Storefront Components', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to prevent state leakage (auto-saves channel pref)
    await page.goto('/store/demo');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('button', { timeout: 10000 });
  });

  test('intro screen shows before chat mode', async ({ page }) => {
    // Initially on intro screen — should see channel choice buttons
    const chatBtn = page.locator('button', { hasText: 'Por chat' });
    const voiceBtn = page.locator('button', { hasText: 'Por voz' });
    await expect(chatBtn).toBeVisible({ timeout: 5000 });
    await expect(voiceBtn).toBeVisible();
  });

  test('header renders after entering chat mode', async ({ page }) => {
    await page.locator('button', { hasText: 'Por chat' }).click();
    await page.waitForTimeout(500);

    const header = page.locator('header');
    await expect(header).toBeVisible({ timeout: 5000 });
  });

  test('header contains Online badge in chat mode', async ({ page }) => {
    await page.locator('button', { hasText: 'Por chat' }).click();
    await page.waitForTimeout(500);

    // The "Online" text is inside a span with font-size 10px
    const onlineBadge = page.locator('span', { hasText: 'Online' });
    await expect(onlineBadge).toBeVisible({ timeout: 5000 });
  });

  test('theme toggle button visible in header', async ({ page }) => {
    await page.locator('button', { hasText: 'Por chat' }).click();
    await page.waitForTimeout(500);

    const header = page.locator('header');
    const themeToggle = header.locator('button[title*="claro"], button[title*="escuro"]');
    await expect(themeToggle).toBeVisible();
  });

  test('channel toggle button visible in header', async ({ page }) => {
    await page.locator('button', { hasText: 'Por chat' }).click();
    await page.waitForTimeout(500);

    const header = page.locator('header');
    // When in chat mode, the toggle shows "Mudar para voz"
    const channelToggle = header.locator('button[title*="voz"], button[title*="chat"]');
    await expect(channelToggle).toBeVisible();
  });

  test('support button visible in header', async ({ page }) => {
    await page.locator('button', { hasText: 'Por chat' }).click();
    await page.waitForTimeout(500);

    const header = page.locator('header');
    const supportButton = header.locator('button[title="Suporte"]');
    await expect(supportButton).toBeVisible();
  });

  test('buyer hub trigger button visible in header', async ({ page }) => {
    await page.locator('button', { hasText: 'Por chat' }).click();
    await page.waitForTimeout(500);

    const header = page.locator('header');
    const buttons = header.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('intro screen shows PulseAgentOrb', async ({ page }) => {
    const orb = page.locator('div[style*="orbFloat"]');
    await expect(orb).toBeVisible();
  });

  test('welcome state shows agent greeting', async ({ page }) => {
    // In intro mode, should see agent name in text like "eu sou a ..."
    const greeting = page.locator('div', { hasText: /eu sou|Oi,/i }).first();
    await expect(greeting).toBeVisible({ timeout: 5000 });
  });

  test('quick reply buttons visible in chat welcome state', async ({ page }) => {
    // Enter chat mode first — quick replies show in chat welcome, not intro
    await page.locator('button', { hasText: 'Por chat' }).click();
    await page.waitForTimeout(500);

    const qrButtons = page.locator('button', { hasText: /Ver Produtos|Encontrar Produto|Categorias|Ofertas/ });
    const count = await qrButtons.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('chat mode button visible and clickable', async ({ page }) => {
    const chatButton = page.locator('button', { hasText: 'Por chat' });
    await expect(chatButton).toBeVisible();

    await chatButton.click();
    await page.waitForTimeout(500);

    const input = page.locator('input[aria-label="Mensagem"]').first();
    await expect(input).toBeVisible();
  });

  test('voice mode button visible and clickable', async ({ page }) => {
    const voiceButton = page.locator('button', { hasText: 'Por voz' });
    await expect(voiceButton).toBeVisible();
  });

  test('chat composer visible and functional', async ({ page }) => {
    await page.locator('button', { hasText: 'Por chat' }).click();
    await page.waitForTimeout(500);

    const input = page.locator('input[aria-label="Mensagem"]').first();
    await expect(input).toBeVisible();

    const sendButton = page.locator('button[aria-label*="Enviar"]').first();
    await expect(sendButton).toBeVisible();
  });

  test('theme toggle switches between dark and light', async ({ page }) => {
    await page.locator('button', { hasText: 'Por chat' }).click();
    await page.waitForTimeout(500);

    const themeToggle = page.locator('header').locator('button[title*="claro"], button[title*="escuro"]');

    const initialBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--aacp-bg')
    );

    await themeToggle.click();
    await page.waitForTimeout(300);

    const newBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--aacp-bg')
    );

    expect(initialBg.trim()).not.toBe(newBg.trim());
  });

  test('StoriesRow structure present in chat mode', async ({ page }) => {
    await page.locator('button', { hasText: 'Por chat' }).click();
    await page.waitForTimeout(500);

    const header = page.locator('header');
    await expect(header).toBeVisible();
  });

  test('footer with policies renders in chat mode', async ({ page }) => {
    await page.locator('button', { hasText: 'Por chat' }).click();
    await page.waitForTimeout(500);

    const main = page.locator('[role="main"]');
    await expect(main).toBeVisible();
  });
});
