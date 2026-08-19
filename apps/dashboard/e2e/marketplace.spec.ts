import { test, expect, type Page } from '@playwright/test';

test.use({ actionTimeout: 15000 });

const DASHBOARD_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5175';
const API_BASE = process.env.E2E_API_URL ?? 'http://127.0.0.1:3009';

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

async function navigateToMarketplace(page: Page) {
  await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await loginIfNeeded(page);
  await page.waitForTimeout(2000);

  // Click Marketplace nav item in sidebar
  const marketplaceNav = page.locator('aside').locator('span').filter({ hasText: 'Marketplace' });
  await marketplaceNav.first().click();
  await page.waitForTimeout(2000);
}

// ────────────────────────────────────────────────────────────────────────────────

test.describe('Marketplace Dashboard', () => {

  test('@marketplace-settings-load', async ({ page }) => {
    test.setTimeout(60000);
    await navigateToMarketplace(page);

    // Settings tab visible by default
    await expect(page.locator('text=Configurações do Marketplace')).toBeVisible();
    await expect(page.locator('text=Habilitar Marketplace')).toBeVisible();
    await expect(page.locator('text=Comissão e Janelas de Pagamento')).toBeVisible();
  });

  test('@marketplace-settings-toggle-enable', async ({ page }) => {
    test.setTimeout(60000);
    await navigateToMarketplace(page);

    // Toggle marketplace enabled
    const checkbox = page.locator('#marketplace-enabled');
    await expect(checkbox).toBeVisible();

    const wasChecked = await checkbox.isChecked();
    await checkbox.click();
    await page.waitForTimeout(1000);

    // Should show toast
    const toast = page.locator('text=Configurações salvas');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Verify state changed
    const isNowChecked = await checkbox.isChecked();
    expect(isNowChecked).not.toBe(wasChecked);
  });

  test('@marketplace-settings-commission', async ({ page }) => {
    test.setTimeout(60000);
    await navigateToMarketplace(page);

    // Find commission input
    const commissionInput = page.locator('input[type="number"]').first();
    await expect(commissionInput).toBeVisible();

    // Clear and set new value
    await commissionInput.fill('20');
    await commissionInput.blur();
    await page.waitForTimeout(1000);

    // Value should be 20
    await expect(commissionInput).toHaveValue('20');
  });

  test('@marketplace-settings-timeline', async ({ page }) => {
    test.setTimeout(60000);
    await navigateToMarketplace(page);

    // Settlement timeline should render
    await expect(page.locator('text=Compra capturada')).toBeVisible();
    await expect(page.locator('text=Transfer agendada')).toBeVisible();
    await expect(page.locator('text=Settlement finalizado')).toBeVisible();
  });

  test('@marketplace-settings-blocked-merchants', async ({ page }) => {
    test.setTimeout(60000);
    await navigateToMarketplace(page);

    // Blocked merchants section
    await expect(page.locator('text=Lojas Bloqueadas')).toBeVisible();
    await expect(page.locator('text=Nenhuma loja bloqueada')).toBeVisible();
  });

  test('@marketplace-orders-tab', async ({ page }) => {
    test.setTimeout(60000);
    await navigateToMarketplace(page);

    // Switch to orders tab
    const ordersTab = page.locator('button[role="tab"]').filter({ hasText: 'Pedidos' });
    await ordersTab.click();
    await page.waitForTimeout(1000);

    // Should show orders section (empty or with data)
    await expect(page.locator('text=Pedidos do Marketplace')).toBeVisible();
  });

  test('@marketplace-orders-stats-cards', async ({ page }) => {
    test.setTimeout(60000);
    await navigateToMarketplace(page);

    // Switch to orders tab
    const ordersTab = page.locator('button[role="tab"]').filter({ hasText: 'Pedidos' });
    await ordersTab.click();
    await page.waitForTimeout(1000);

    // Stat cards visible
    await expect(page.locator('text=Pedidos Pendentes')).toBeVisible();
    await expect(page.locator('text=Receita (mês)')).toBeVisible();
    await expect(page.locator('text=Itens Enviados')).toBeVisible();
    await expect(page.locator('text=Taxa Fulfillment')).toBeVisible();
  });

  test('@marketplace-tabbar-style', async ({ page }) => {
    test.setTimeout(60000);
    await navigateToMarketplace(page);

    // TabBar component renders with correct role
    const tablist = page.locator('[role="tablist"]');
    await expect(tablist).toBeVisible();

    // Both tabs present
    const tabs = page.locator('button[role="tab"]');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.first()).toHaveText('Configurações');
    await expect(tabs.last()).toHaveText('Pedidos');
  });

});

// ────────────────────────────────────────────────────────────────────────────────

test.describe('Marketplace API Integration', () => {

  test('@marketplace-api-search-cross-store', async ({ request }) => {
    // Test federated product search directly via API
    const res = await request.get(`${API_BASE}/storefront/marketplace/search`, {
      params: { query: 'calça de couro', merchantId: 'mrc_marketplace_03', limit: '5' }
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.products.length).toBeGreaterThan(0);
    expect(data.products[0].sellerName).not.toBe('Loja parceira');
    expect(data.products.every((p: any) => p.sellerId !== 'mrc_marketplace_03')).toBeTruthy();
  });

  test('@marketplace-api-search-fone-bluetooth', async ({ request }) => {
    const res = await request.get(`${API_BASE}/storefront/marketplace/search`, {
      params: { query: 'fone bluetooth', merchantId: 'mrc_marketplace_01', limit: '5' }
    });
    const data = await res.json();
    expect(data.products.length).toBeGreaterThan(0);
    expect(data.products[0].name).toContain('Fone Bluetooth');
    expect(data.products[0].sellerId).toBe('mrc_marketplace_03');
  });

  test('@marketplace-api-search-excludes-host', async ({ request }) => {
    const res = await request.get(`${API_BASE}/storefront/marketplace/search`, {
      params: { query: 'calça jeans', merchantId: 'mrc_marketplace_01', limit: '10' }
    });
    const data = await res.json();
    // Host (mrc_marketplace_01) should not appear in own results
    expect(data.products.every((p: any) => p.sellerId !== 'mrc_marketplace_01')).toBeTruthy();
  });

  test('@marketplace-api-search-empty-query', async ({ request }) => {
    const res = await request.get(`${API_BASE}/storefront/marketplace/search`, {
      params: { query: '', merchantId: 'mrc_marketplace_01', limit: '5' }
    });
    const data = await res.json();
    expect(data.products).toEqual([]);
  });

  test('@marketplace-api-seller-name-resolved', async ({ request }) => {
    const res = await request.get(`${API_BASE}/storefront/marketplace/search`, {
      params: { query: 'fone bluetooth', merchantId: 'mrc_marketplace_01', limit: '5' }
    });
    const data = await res.json();
    // Should have real merchant name, not "Loja parceira"
    expect(data.products[0].sellerName).toBe('Tech House');
  });

});
