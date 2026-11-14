import { test, expect } from '@playwright/test';

test.describe('Storefront Chat Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/store/demo');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('button', { timeout: 10000 });
    // Enter chat mode
    await page.locator('button', { hasText: 'Por chat' }).click();
    await page.waitForTimeout(800);
  });

  test('typing and sending message creates user bubble', async ({ page }) => {
    const input = page.locator('input[aria-label="Mensagem"]').first();
    const sendButton = page.locator('button[aria-label*="Enviar"]').first();

    await input.fill('qual o preço do produto mais caro?');
    await sendButton.click();
    await page.waitForTimeout(2000);

    // User message should appear in main thread
    const main = page.locator('[role="main"]');
    const content = await main.textContent() ?? "";
    expect(content.toLowerCase()).toContain('qual o preço');
  }, { timeout: 20000 });

  test('pressing Enter sends message', async ({ page }) => {
    const input = page.locator('input[aria-label="Mensagem"]').first();

    await input.fill('oi');
    await input.press('Enter');
    await page.waitForTimeout(1500);

    await expect(input).toHaveValue('');
  }, { timeout: 15000 });

  test('message appears in chat thread', async ({ page }) => {
    const input = page.locator('input[aria-label="Mensagem"]').first();
    const sendButton = page.locator('button[aria-label*="Enviar"]').first();

    await input.fill('olá');
    await sendButton.click();
    await page.waitForTimeout(1500);

    const thread = page.locator('[role="main"]');
    const threadContent = await thread.textContent();
    expect(threadContent?.toLowerCase()).toContain('olá');
  }, { timeout: 15000 });

  test('message history accumulates in thread', async ({ page }) => {
    const input = page.locator('input[aria-label="Mensagem"]').first();
    const sendButton = page.locator('button[aria-label*="Enviar"]').first();
    const main = page.locator('[role="main"]');

    await input.fill('primeira');
    await sendButton.click();
    await page.waitForTimeout(1000);

    await input.fill('segunda');
    await sendButton.click();
    await page.waitForTimeout(1000);

    const threadContent = await main.textContent();
    expect(threadContent?.toLowerCase()).toContain('primeira');
    expect(threadContent?.toLowerCase()).toContain('segunda');
  }, { timeout: 15000 });

  test('send button disabled when input is empty', async ({ page }) => {
    const input = page.locator('input[aria-label="Mensagem"]').first();
    const sendButton = page.locator('button[aria-label*="Enviar"]').first();

    const isDisabledInitial = await sendButton.isDisabled();
    await input.fill('teste');
    const isEnabledAfterInput = await sendButton.isDisabled();
    await input.clear();
    const isDisabledAfterClear = await sendButton.isDisabled();

    expect(isEnabledAfterInput).toBe(false);
    expect(isDisabledAfterClear).toBe(true);
  });

  test('compose form remains visible during interaction', async ({ page }) => {
    const composer = page.locator('form').first();
    await expect(composer).toBeVisible();

    const input = page.locator('input[aria-label="Mensagem"]').first();
    const sendButton = page.locator('button[aria-label*="Enviar"]').first();

    await input.fill('teste');
    await sendButton.click();
    await page.waitForTimeout(2000);
    await expect(composer).toBeVisible();
  }, { timeout: 15000 });

  test('scroll area contains chat messages', async ({ page }) => {
    const input = page.locator('input[aria-label="Mensagem"]').first();
    const sendButton = page.locator('button[aria-label*="Enviar"]').first();
    const main = page.locator('[role="main"]');

    await input.fill('teste scroll');
    await sendButton.click();
    await page.waitForTimeout(1500);

    const contentLength = await main.textContent().then(t => t?.length || 0);
    expect(contentLength).toBeGreaterThan(0);
  }, { timeout: 15000 });

  test('input placeholder text visible', async ({ page }) => {
    const input = page.locator('input[aria-label="Mensagem"]').first();
    await expect(input).toBeVisible();

    const placeholder = await input.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
  });

  test('send button has icon', async ({ page }) => {
    const sendButton = page.locator('button[aria-label*="Enviar"]').first();
    const svg = sendButton.locator('svg');
    await expect(svg).toBeVisible();
  });
});
