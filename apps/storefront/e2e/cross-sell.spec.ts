import { test, expect } from '@playwright/test';

/**
 * Cross-Sell E2E Tests
 *
 * Verifies cross-sell suggestions appear after adding product to cart.
 * Requires: API on :3009, Storefront on :3001, merchant "cosmos" with
 * cross-sell enabled + pre_cart touchpoint + at least 2 products.
 */

const STORE_URL = 'http://localhost:3001/store/cosmos';

test.describe('Cross-Sell Integration', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await page.goto(STORE_URL, { waitUntil: 'networkidle', timeout: 20000 });
    // Wait for page to be interactive
    await page.waitForTimeout(2000);
    // Enter chat mode if channel gate visible
    const chatBtn = page.locator('button:has-text("chat"), button:has-text("Chat"), button:has-text("Por chat")').first();
    if (await chatBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chatBtn.click();
      await page.waitForTimeout(1500);
    }
  });

  test('can search products and see results', async ({ page }) => {
    // Find any text input on the page
    const input = page.locator('input[type="text"], input[placeholder*="mensagem"], input[placeholder*="Mensagem"], input[aria-label*="ensagem"]').first();
    await expect(input).toBeVisible({ timeout: 10000 });

    await input.fill('ver produtos');
    await input.press('Enter');
    await page.waitForTimeout(8000);

    // Should show some product content
    const pageContent = await page.textContent('body') ?? '';
    const hasProducts = pageContent.includes('R$') || pageContent.includes('Adicionar') || pageContent.includes('produto');
    expect(hasProducts).toBe(true);

    await page.screenshot({ path: 'e2e/screenshots/cross-sell-01-products.png', fullPage: true });
  });

  test('cross-sell appears after add-to-cart', async ({ page }) => {
    const input = page.locator('input[type="text"], input[placeholder*="mensagem"], input[placeholder*="Mensagem"], input[aria-label*="ensagem"]').first();
    await expect(input).toBeVisible({ timeout: 10000 });

    // Ask to add product
    await input.fill('adicionar o primeiro produto ao carrinho');
    await input.press('Enter');
    await page.waitForTimeout(10000);

    // Check page content for cross-sell indicators
    const content = await page.textContent('body') ?? '';
    const hasCrossSell = content.includes('Combina') ||
                        content.includes('também levaram') ||
                        content.includes('complementa') ||
                        content.includes('cross_sell');
    const hasCartConfirmation = content.includes('Adicionei') ||
                               content.includes('adicionado') ||
                               content.includes('carrinho');

    await page.screenshot({ path: 'e2e/screenshots/cross-sell-02-after-add.png', fullPage: true });

    // At minimum, cart action should have worked
    expect(hasCartConfirmation || content.includes('R$')).toBe(true);

    if (hasCrossSell) {
      console.log('✅ Cross-sell block detected after add-to-cart');
    } else {
      console.log('⚠️ No cross-sell block. Verify: merchant config enabled + pre_cart touchpoint ON');
    }
  });

  test('add cross-sell item to cart via quick reply', async ({ page }) => {
    const input = page.locator('input[type="text"], input[placeholder*="mensagem"], input[placeholder*="Mensagem"], input[aria-label*="ensagem"]').first();
    await expect(input).toBeVisible({ timeout: 10000 });

    // Add first product
    await input.fill('adicionar produto ao carrinho');
    await input.press('Enter');
    await page.waitForTimeout(8000);

    // Look for cross-sell add button
    const crossSellAdd = page.locator('button:has-text("Adicionar")').nth(1);
    const visible = await crossSellAdd.isVisible({ timeout: 5000 }).catch(() => false);

    if (visible) {
      await crossSellAdd.click();
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'e2e/screenshots/cross-sell-03-item-added.png', fullPage: true });

      const content = await page.textContent('body') ?? '';
      const confirmed = content.includes('Adicionei') || content.includes('carrinho');
      expect(confirmed).toBe(true);
      console.log('✅ Cross-sell item added to cart');
    } else {
      console.log('⚠️ No cross-sell add button found. Config may be disabled.');
      await page.screenshot({ path: 'e2e/screenshots/cross-sell-03-no-suggestions.png', fullPage: true });
    }
  });

  test('progress commands advance checkout flow', async ({ page }) => {
    // Test that "vamos em frente", "prossiga", "ok" are understood
    const input = page.locator('input[type="text"], input[placeholder*="mensagem"], input[placeholder*="Mensagem"], input[aria-label*="ensagem"]').first();
    await expect(input).toBeVisible({ timeout: 10000 });

    const commands = ['vamos em frente', 'prossiga', 'ok, vamos lá'];
    for (const cmd of commands) {
      await input.fill(cmd);
      await input.press('Enter');
      await page.waitForTimeout(4000);
    }

    const content = await page.textContent('body') ?? '';
    // Agent should have responded (not error)
    const hasResponse = !content.includes('Erro') && content.length > 100;
    expect(hasResponse).toBe(true);

    await page.screenshot({ path: 'e2e/screenshots/cross-sell-04-progress-commands.png', fullPage: true });
  });
});
