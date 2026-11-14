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

async function navigateToIntegrations(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await loginIfNeeded(page);
  // Wait for shell/sidebar to render
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
  // Navigate to Desenvolvedores
  await page.locator('text=Desenvolvedores').first().click();
  await page.waitForTimeout(2000);
}

test.describe('Integrations (Desenvolvedores) Module', () => {
  const jsErrors: string[] = [];

  test('@integrations-load page loads with main sections visible', async ({ page }) => {
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await navigateToIntegrations(page);

    // Page header
    await expect(page.locator('h1', { hasText: 'Desenvolvedores' })).toBeVisible();
    await expect(page.locator('text=Integration API V1')).toBeVisible();
    await expect(page.locator('text=Conecte sua plataforma ao Zyon via API')).toBeVisible();

    // Metrics bar
    await expect(page.locator('text=API').first()).toBeVisible();
    await expect(page.locator('text=Chaves').first()).toBeVisible();
    await expect(page.locator('text=Webhooks').first()).toBeVisible();

    // Main action buttons in header
    await expect(page.locator('text=Abrir Scalar')).toBeVisible();
    await expect(page.locator('text=Postman')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Atualizar' })).toBeVisible();
  });

  test('@integrations-api-keys API Keys section renders with table', async ({ page }) => {
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await navigateToIntegrations(page);

    // Section title
    await expect(page.locator('h2', { hasText: 'Chaves de acesso' })).toBeVisible();
    await expect(page.locator('text=Autentique chamadas à API do Zyon')).toBeVisible();

    // Table headers
    const keysTable = page.locator('table.data-table').first();
    await expect(keysTable).toBeVisible();
    await expect(keysTable.locator('th', { hasText: 'Nome' })).toBeVisible();
    await expect(keysTable.locator('th', { hasText: 'Prefixo' })).toBeVisible();
    await expect(keysTable.locator('th', { hasText: 'Escopos' })).toBeVisible();
    await expect(keysTable.locator('th', { hasText: 'Status' })).toBeVisible();

    // Name input for new key
    const nameInput = page.locator('label', { hasText: 'Nome' }).locator('input');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue('Backend principal');

    // Scopes disclosure
    await expect(page.locator('summary', { hasText: 'Escopos da nova chave' })).toBeVisible();
  });

  test('@integrations-create-key Create API key button exists and is clickable', async ({ page }) => {
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await navigateToIntegrations(page);

    // The "Gerar nova chave" button
    const createBtn = page.locator('button', { hasText: 'Gerar nova chave' });
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeEnabled();

    // Click it to create a key
    await createBtn.click();
    await page.waitForTimeout(2000);

    // After creation, either a secret is shown or an error message panel appears
    const secretBox = page.locator('.secret-box');
    const messagePanel = page.locator('.panel-info');
    const eitherVisible = await secretBox.isVisible().catch(() => false) ||
      await messagePanel.isVisible().catch(() => false);
    expect(eitherVisible).toBe(true);
  });

  test('@integrations-webhooks Webhooks section renders', async ({ page }) => {
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await navigateToIntegrations(page);

    // Section title
    await expect(page.locator('h2', { hasText: 'Webhooks' })).toBeVisible();
    await expect(page.locator('text=Receba notificações em tempo real')).toBeVisible();

    // Endpoint input
    const endpointInput = page.locator("input[placeholder='https://api.sualoja.com/aacp/webhooks']");
    await expect(endpointInput).toBeVisible();

    // Event chips (at least some)
    await expect(page.locator('button', { hasText: 'checkout.started' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'order.approved' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'payment.approved' })).toBeVisible();

    // Add endpoint button (disabled when input empty)
    const addBtn = page.locator('button', { hasText: 'Adicionar endpoint' });
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toBeDisabled();

    // Delivery log section
    await expect(page.locator('h2', { hasText: 'Delivery log' })).toBeVisible();
    const deliveryTable = page.locator('table.data-table').nth(1);
    await expect(deliveryTable).toBeVisible();
    await expect(deliveryTable.locator('th', { hasText: 'Evento' })).toBeVisible();
    await expect(deliveryTable.locator('th', { hasText: 'Endpoint' })).toBeVisible();
    await expect(deliveryTable.locator('th', { hasText: 'Tentativas' })).toBeVisible();
  });

  test('@integrations-quickstart Quickstart/code block section visible', async ({ page }) => {
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await navigateToIntegrations(page);

    // Quickstart section
    await expect(page.locator('text=Backend quickstart')).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Emita uma sessão curta para o widget' })).toBeVisible();

    // Steps list
    await expect(page.locator('text=Crie uma chave de sandbox')).toBeVisible();
    await expect(page.locator('text=Cadastre a origem permitida')).toBeVisible();
    await expect(page.locator('text=Emita a embed session')).toBeVisible();
    await expect(page.locator('text=Inicialize o widget com o token')).toBeVisible();

    // Code block with cURL
    const codeBlock = page.locator('pre.code-block');
    await expect(codeBlock).toBeVisible();
    await expect(codeBlock).toContainText('curl');
    await expect(codeBlock).toContainText('/v1/embed/sessions');
    await expect(codeBlock).toContainText('Authorization: Bearer');

    // Copy button
    await expect(page.locator('.developer-code button', { hasText: 'Copiar' })).toBeVisible();

    // OpenAPI link
    await expect(page.locator('text=Ver OpenAPI machine-readable')).toBeVisible();

    // Session tokens section
    await expect(page.locator('h2', { hasText: 'Tokens de sessão' })).toBeVisible();
  });

  test('@integrations-no-js-errors no critical JS errors during interaction', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await navigateToIntegrations(page);

    // Interact with the page: expand scopes, toggle events
    await page.locator('summary', { hasText: 'Escopos da nova chave' }).click();
    await page.waitForTimeout(500);

    // Toggle a scope chip
    const scopeChip = page.locator('button', { hasText: 'audit:read' });
    if (await scopeChip.isVisible().catch(() => false)) {
      await scopeChip.click();
      await page.waitForTimeout(300);
    }

    // Toggle an event chip
    const eventChip = page.locator('button', { hasText: 'payment.failed' });
    if (await eventChip.isVisible().catch(() => false)) {
      await eventChip.click();
      await page.waitForTimeout(300);
    }

    // Type in webhook URL
    const endpointInput = page.locator("input[placeholder='https://api.sualoja.com/aacp/webhooks']");
    await endpointInput.fill('https://test.example.com/webhook');
    await page.waitForTimeout(300);

    // Click Atualizar (refresh)
    await page.locator('button', { hasText: 'Atualizar' }).first().click();
    await page.waitForTimeout(2000);

    // Filter critical errors (ignore minor/expected ones)
    const criticalErrors = errors.filter(err =>
      !err.includes('ResizeObserver') &&
      !err.includes('Non-Error promise rejection')
    );

    expect(criticalErrors).toHaveLength(0);
  });
});
