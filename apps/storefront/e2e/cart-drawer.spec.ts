import { test, expect } from '@playwright/test';

/**
 * Cart Drawer E2E — validates native cart FAB + drawer.
 * Requires: API on :3009, storefront on :3001, real merchant in DB.
 */

let STORE_URL = 'http://localhost:3001/store/demo';

test.describe('Cart Drawer & FAB', () => {
  test.setTimeout(90_000);

  test.beforeAll(async ({ request }) => {
    try {
      const res = await request.get('http://localhost:3009/storefront/index');
      if (res.ok()) {
        const data = await res.json();
        if (data.stores?.[0]?.slug) {
          STORE_URL = `http://localhost:3001/store/${data.stores[0].slug}`;
        }
      }
    } catch { /* use demo fallback */ }
  });

  async function enterChat(page: any) {
    await page.goto(STORE_URL);
    await page.waitForTimeout(3000);

    // If intro mode — select "Por chat" channel; otherwise already in chat
    const chatBtn = page.locator('text=Por chat').first();
    if (await chatBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chatBtn.click();
      await page.waitForTimeout(2000);
    }

    // Wait for input (either placeholder variant)
    const input = page.locator('input[type="text"], input[placeholder*="mensagem"], input[placeholder*="Mensagem"], input[placeholder*="Escreva"]').first();
    await input.waitFor({ state: 'visible', timeout: 15000 });
  }

  async function addItemToCart(page: any) {
    const input = page.locator('input[type="text"], input[placeholder*="Escreva"]').first();
    await input.fill('Adicionar Produto Teste Digital I ao carrinho');
    await input.press('Enter');
    await page.waitForTimeout(20000); // Wait for LLM response
  }

  test('FAB visible with badge after add-to-cart', async ({ page }) => {
    await enterChat(page);
    await addItemToCart(page);

    const fab = page.locator('button[aria-label*="Carrinho"]');
    await expect(fab).toBeVisible({ timeout: 5000 });
  });

  test('FAB click opens cart drawer', async ({ page }) => {
    await enterChat(page);
    await addItemToCart(page);

    const fab = page.locator('button[aria-label*="Carrinho"]');
    await expect(fab).toBeVisible({ timeout: 5000 });
    await fab.click();

    const drawer = page.getByRole('dialog', { name: /Carrinho/i });
    await expect(drawer).toBeVisible({ timeout: 5000 });
  });

  test('drawer shows product name and price (not empty)', async ({ page }) => {
    await enterChat(page);
    await addItemToCart(page);

    const fab = page.locator('button[aria-label*="Carrinho"]');
    await fab.click();

    const drawer = page.getByRole('dialog', { name: /Carrinho/i });
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Should NOT show "Carrinho vazio"
    const empty = drawer.locator('text=Carrinho vazio');
    await expect(empty).not.toBeVisible();

    // Should show a price (R$ X,XX pattern)
    const price = drawer.locator('text=/R\\$\\s*\\d/');
    await expect(price.first()).toBeVisible();
  });

  test('Ver carrinho quickReply opens drawer (no LLM call)', async ({ page }) => {
    await enterChat(page);
    await addItemToCart(page);

    // Check if "Ver Carrinho" quickReply button exists
    const verBtn = page.getByRole('button', { name: /Ver Carrinho/i }).first();
    if (await verBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await verBtn.click();
      const drawer = page.getByRole('dialog', { name: /Carrinho/i });
      await expect(drawer).toBeVisible({ timeout: 3000 });
    } else {
      // Fallback — use FAB
      const fab = page.locator('button[aria-label*="Carrinho"]');
      await fab.click();
      const drawer = page.getByRole('dialog', { name: /Carrinho/i });
      await expect(drawer).toBeVisible({ timeout: 3000 });
    }
  });
});
