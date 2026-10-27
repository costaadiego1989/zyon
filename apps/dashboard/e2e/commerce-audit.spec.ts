import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

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

async function navigateToCommerce(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await loginIfNeeded(page);
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('text=Loja / Commerce').first().click();
  await page.waitForTimeout(2000);
}

async function navigateToAudit(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await loginIfNeeded(page);
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('text=Auditoria').first().click();
  await page.waitForTimeout(2000);
}

test.describe('Commerce (Loja / Commerce) Module', () => {
  const jsErrors: string[] = [];

  test('@commerce-load page loads with title', async ({ page }) => {
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await navigateToCommerce(page);

    await expect(page.locator('h1', { hasText: 'Conexões de Plataforma' })).toBeVisible();
    await expect(page.locator('text=Conecte sua loja para sincronizar produtos e pedidos automaticamente.').first()).toBeVisible();
  });

  test('@commerce-providers shows provider options (Shopify, WooCommerce, Nuvemshop, Tray)', async ({ page }) => {
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await navigateToCommerce(page);

    const select = page.locator('select').first();
    await expect(select).toBeVisible();
    await expect(select).toContainText('Shopify');
    await expect(select).toContainText('WooCommerce');
    await expect(select).toContainText('Nuvemshop');
    await expect(select).toContainText('Tray Commerce');
  });

  test('@commerce-empty-state shows "Nenhuma conexão configurada" empty state', async ({ page }) => {
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await navigateToCommerce(page);

    await expect(page.locator('text=Conexão Ativa').first()).toBeVisible();
    await expect(page.locator('strong', { hasText: 'Nenhuma conexão configurada' })).toBeVisible();
    await expect(page.locator('text=Conecte uma plataforma de e-commerce para importar catálogo e sincronizar pedidos.')).toBeVisible();
  });

  test('@commerce-upcoming "Em breve" section with badges (VTEX, Magento, etc)', async ({ page }) => {
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await navigateToCommerce(page);

    await expect(page.locator('h3', { hasText: 'Em breve' })).toBeVisible();
    await expect(page.locator('span', { hasText: /^VTEX$/ })).toBeVisible();
    await expect(page.locator('span', { hasText: /^Magento$/ })).toBeVisible();
  });

  test('@commerce-no-js-errors no critical JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await navigateToCommerce(page);

    await page.locator('button', { hasText: 'Atualizar' }).first().click();
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter(err =>
      !err.includes('ResizeObserver') &&
      !err.includes('Non-Error promise rejection')
    );

    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('Audit (Auditoria) Module', () => {
  const jsErrors: string[] = [];

  test('@audit-load page loads with title', async ({ page }) => {
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await navigateToAudit(page);

    await expect(page.locator('h1', { hasText: 'Log de Auditoria' })).toBeVisible();
    await expect(page.locator('text=Acompanhe todas as ações realizadas no painel.').first()).toBeVisible();
  });

  test('@audit-table audit events table renders with columns (Data, Ação, Recurso, Ator)', async ({ page }) => {
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await navigateToAudit(page);

    // The page either renders the table with events OR an empty state — either is valid evidence
    // that the audit surface mounted. Wait for one of them.
    const table = page.locator('table.data-table');
    const emptyState = page.locator('h3', { hasText: 'Nenhuma atividade registrada' });

    await expect(async () => {
      const hasTable = await table.isVisible().catch(() => false);
      const hasEmpty = await emptyState.isVisible().catch(() => false);
      if (!hasTable && !hasEmpty) {
        throw new Error('Neither table nor empty state rendered yet');
      }
    }).toPass({ timeout: 15_000 });

    if (await table.isVisible().catch(() => false)) {
      await expect(table.locator('th', { hasText: 'Data' })).toBeVisible();
      await expect(table.locator('th', { hasText: 'Ação' })).toBeVisible();
      await expect(table.locator('th', { hasText: 'Recurso' })).toBeVisible();
      await expect(table.locator('th', { hasText: 'Ator' })).toBeVisible();
    }
  });

  test('@audit-empty-state if no events, shows empty state', async ({ page }) => {
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await navigateToAudit(page);

    // Try filtering to a narrow range that likely has no events
    const periodSelect = page.locator('.audit-filter-bar select').first();
    if (await periodSelect.isVisible().catch(() => false)) {
      await periodSelect.selectOption('7d');
      await page.waitForTimeout(2000);
    }

    const table = page.locator('table.data-table');
    const emptyState = page.locator('h3', { hasText: 'Nenhuma atividade registrada' });

    await expect(async () => {
      const hasTable = await table.isVisible().catch(() => false);
      const hasEmpty = await emptyState.isVisible().catch(() => false);
      if (!hasTable && !hasEmpty) {
        throw new Error('Neither table nor empty state rendered yet');
      }
    }).toPass({ timeout: 15_000 });

    // If table is empty (no rows in tbody), expect empty state
    const rows = await table.locator('tbody tr').count();
    if (rows === 0) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('@audit-no-js-errors no critical JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await navigateToAudit(page);

    // Interact: change filter
    const periodSelect = page.locator('.audit-filter-bar select').first();
    if (await periodSelect.isVisible().catch(() => false)) {
      await periodSelect.selectOption('30d');
      await page.waitForTimeout(1000);
    }

    // Click Atualizar
    await page.locator('button', { hasText: 'Atualizar' }).first().click();
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter(err =>
      !err.includes('ResizeObserver') &&
      !err.includes('Non-Error promise rejection')
    );

    expect(criticalErrors).toHaveLength(0);
  });
});