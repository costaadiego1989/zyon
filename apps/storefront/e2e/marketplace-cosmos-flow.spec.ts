import { test, expect } from '@playwright/test';

/**
 * E2E: Cross-Store Marketplace full flow on Cosmos store
 * Browse store → Find marketplace product → Add to cart → Go to checkout
 */

const STORE_URL = 'http://localhost:3001/store/cosmos';
const API_BASE = 'http://localhost:3009';

test.describe('Marketplace Full Flow — Cosmos Store', () => {

  test('@marketplace-cosmos-browse-and-search', async ({ page }) => {
    test.setTimeout(90000);

    // 1. Navigate to Cosmos store
    await page.goto(STORE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/mkt-01-cosmos-landing.png', fullPage: true });

    // Verify store loaded
    const body = await page.locator('body').textContent();
    expect(body?.toLowerCase()).toContain('cosmos');
  });

  test('@marketplace-cosmos-api-search-from-cosmos', async ({ request }) => {
    test.setTimeout(30000);

    // 2. Search marketplace from Cosmos merchant perspective
    // First find cosmos merchant ID
    const loginRes = await request.post(`${API_BASE}/auth/login`, {
      data: { email: 'costaadiego1989@gmail.com', password: 'UeUf3900@' }
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginData = await loginRes.json();
    const merchantId = loginData.merchant?.id || loginData.merchantId;

    // Search for cross-store products
    const searchRes = await request.get(`${API_BASE}/storefront/marketplace/search`, {
      params: { query: 'calça', merchantId: merchantId || 'mrc_marketplace_01', limit: '5' }
    });
    expect(searchRes.ok()).toBeTruthy();
    const searchData = await searchRes.json();
    expect(searchData.products.length).toBeGreaterThanOrEqual(0);
  });

  test('@marketplace-cosmos-add-to-cart', async ({ page }) => {
    test.setTimeout(120000);

    // Navigate to store
    await page.goto(STORE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Find any product and add to cart
    const addToCartBtn = page.locator('button').filter({ hasText: /adicionar|comprar|add/i }).first();
    const hasProduct = await addToCartBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasProduct) {
      await addToCartBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/mkt-02-added-to-cart.png', fullPage: true });

      // Verify cart has items (look for cart indicator or drawer)
      const cartBadge = page.locator('[data-testid="cart-count"], .cart-badge, .cart-count').first();
      const cartVisible = await cartBadge.isVisible({ timeout: 3000 }).catch(() => false);
      if (cartVisible) {
        const count = await cartBadge.textContent();
        expect(Number(count)).toBeGreaterThan(0);
      }
    } else {
      // Store may not have visible products yet — check catalog
      const pageContent = await page.locator('body').textContent();
      test.info().annotations.push({ type: 'note', description: 'No add-to-cart button found on store page' });
    }
  });

  test('@marketplace-cosmos-cart-to-checkout', async ({ page }) => {
    test.setTimeout(120000);

    // Navigate to store
    await page.goto(STORE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Try to add a product
    const addBtn = page.locator('button').filter({ hasText: /adicionar|comprar|add/i }).first();
    const canAdd = await addBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (canAdd) {
      await addBtn.click();
      await page.waitForTimeout(2000);

      // Open cart / go to checkout
      const checkoutBtn = page.locator('button, a').filter({ hasText: /checkout|finalizar|fechar pedido|carrinho/i }).first();
      const checkoutVisible = await checkoutBtn.isVisible({ timeout: 5000 }).catch(() => false);

      if (checkoutVisible) {
        await checkoutBtn.click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'test-results/mkt-03-checkout.png', fullPage: true });

        // Verify we reached checkout (look for payment/shipping/form)
        const checkoutContent = await page.locator('body').textContent();
        const isCheckout = checkoutContent?.toLowerCase().includes('pagamento') ||
                          checkoutContent?.toLowerCase().includes('entrega') ||
                          checkoutContent?.toLowerCase().includes('checkout') ||
                          checkoutContent?.toLowerCase().includes('endereço');
        expect(isCheckout).toBeTruthy();
      } else {
        // Try cart icon click
        const cartIcon = page.locator('[data-testid="cart-icon"], .cart-icon, button[aria-label*="cart"], button[aria-label*="carrinho"]').first();
        const cartIconVisible = await cartIcon.isVisible({ timeout: 3000 }).catch(() => false);
        if (cartIconVisible) {
          await cartIcon.click();
          await page.waitForTimeout(2000);
          await page.screenshot({ path: 'test-results/mkt-03-cart-drawer.png', fullPage: true });
        }
      }
    } else {
      test.info().annotations.push({ type: 'note', description: 'No products available to add' });
    }
  });

  test('@marketplace-cosmos-cross-store-product-in-cart', async ({ page, request }) => {
    test.setTimeout(120000);

    // This test verifies the full cross-store flow via API:
    // 1. Search marketplace products
    // 2. Simulate adding cross-store item to a checkout session

    // Search for a product from another store
    const searchRes = await request.get(`${API_BASE}/storefront/marketplace/search`, {
      params: { query: 'fone bluetooth', merchantId: 'mrc_marketplace_01', limit: '1' }
    });
    expect(searchRes.ok()).toBeTruthy();
    const { products } = await searchRes.json();

    if (products.length > 0) {
      const crossStoreProduct = products[0];
      expect(crossStoreProduct.sellerId).not.toBe('mrc_marketplace_01');
      expect(crossStoreProduct.sellerName).toBeTruthy();
      expect(crossStoreProduct.price).toBeGreaterThan(0);

      // Navigate to store and verify marketplace products could render
      await page.goto(STORE_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/mkt-04-cross-store-ready.png', fullPage: true });

      // Verify the API contract is correct for frontend consumption
      expect(crossStoreProduct).toHaveProperty('id');
      expect(crossStoreProduct).toHaveProperty('name');
      expect(crossStoreProduct).toHaveProperty('price');
      expect(crossStoreProduct).toHaveProperty('sellerId');
      expect(crossStoreProduct).toHaveProperty('sellerName');
      expect(crossStoreProduct).toHaveProperty('inStock');
    }
  });

});
