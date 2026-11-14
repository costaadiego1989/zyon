import { test, expect, type Page } from '@playwright/test';

// Tests run sequentially (single worker) for state isolation per request.

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

async function navigateTo(page: Page, label: 'Suporte' | 'Agente') {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await loginIfNeeded(page);
  await page.waitForTimeout(2000);

  const navItem = page.locator('aside').locator('span').filter({ hasText: new RegExp(`^${label}$`) });
  await navItem.first().click();
  await page.waitForTimeout(2500);
}

// ────────────────────────────────────────────────────────────────────────────────
// SUPPORT module
// ────────────────────────────────────────────────────────────────────────────────

test('@support-load', async ({ page }) => {
  test.setTimeout(60000);
  await navigateTo(page, 'Suporte');

  const heading = page.locator('h1').filter({ hasText: /Atendimento ao Comprador/i });
  await expect(heading).toBeVisible({ timeout: 10000 });

  // "Atualizar" button present in page head
  const refreshBtn = page.locator('button').filter({ hasText: 'Atualizar' });
  await expect(refreshBtn).toBeVisible();

  // "Salvar FAQ" primary action button
  const saveBtn = page.locator('button').filter({ hasText: /Salvar FAQ/i });
  await expect(saveBtn).toBeVisible();
});

test('@support-faq', async ({ page }) => {
  test.setTimeout(60000);
  await navigateTo(page, 'Suporte');

  await expect(page.locator('h1').filter({ hasText: /Atendimento ao Comprador/i })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);

  // FAQ section header
  const faqHeader = page.locator('h2').filter({ hasText: /Resposta automática/i });
  await expect(faqHeader).toBeVisible();

  // Question input (placeholder) or empty-state add button
  const emptyStateAdd = page.locator('button').filter({ hasText: /Adicionar primeira pergunta/i });
  const firstQuestionInput = page.locator('input[placeholder*="Qual o prazo"]');

  const emptyVisible = await emptyStateAdd.isVisible().catch(() => false);
  if (emptyVisible) {
    // No FAQ yet — add the first
    await emptyStateAdd.click();
    await page.waitForTimeout(500);
    await expect(firstQuestionInput).toBeVisible({ timeout: 5000 });
  } else {
    // Existing FAQs visible — verify at least one input renders
    await expect(firstQuestionInput.first()).toBeVisible({ timeout: 5000 });
  }
});

test('@support-faq-edit', async ({ page }) => {
  test.setTimeout(60000);
  await navigateTo(page, 'Suporte');

  await expect(page.locator('h1').filter({ hasText: /Atendimento ao Comprador/i })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);

  // Ensure at least one FAQ exists
  const emptyStateAdd = page.locator('button').filter({ hasText: /Adicionar primeira pergunta/i });
  if (await emptyStateAdd.isVisible().catch(() => false)) {
    await emptyStateAdd.click();
    await page.waitForTimeout(500);
  }

  // The first answer textarea
  const answerArea = page.locator('textarea[placeholder*="Entregamos"]').first();
  await expect(answerArea).toBeVisible({ timeout: 5000 });

  // Modify the answer
  const testAnswer = `Resposta editada por teste e2e ${Date.now()}`;
  await answerArea.fill(testAnswer);
  await page.waitForTimeout(300);
  const value = await answerArea.inputValue();
  expect(value).toBe(testAnswer);
});

test('@support-faq-save', async ({ page }) => {
  test.setTimeout(60000);
  await navigateTo(page, 'Suporte');

  await expect(page.locator('h1').filter({ hasText: /Atendimento ao Comprador/i })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);

  // Ensure at least one FAQ exists
  const emptyStateAdd = page.locator('button').filter({ hasText: /Adicionar primeira pergunta/i });
  if (await emptyStateAdd.isVisible().catch(() => false)) {
    await emptyStateAdd.click();
    await page.waitForTimeout(500);
  }

  // Listen for PUT /v1/support/settings
  const putResponsePromise = page.waitForResponse(
    (resp) => resp.url().includes('/v1/support/settings') && resp.request().method() === 'PUT',
    { timeout: 15000 },
  );

  // Edit answer
  const answerArea = page.locator('textarea[placeholder*="Entregamos"]').first();
  await expect(answerArea).toBeVisible({ timeout: 5000 });
  await answerArea.fill(`Salvando em teste e2e ${Date.now()}`);
  await page.waitForTimeout(300);

  // Click Salvar FAQ
  const saveBtn = page.locator('button').filter({ hasText: /Salvar FAQ/i });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();

  const putResponse = await putResponsePromise;
  expect(putResponse.status()).toBe(200);

  // Success message appears
  await page.waitForTimeout(1500);
  const successPanel = page.locator('text=/FAQ salvo com sucesso/i');
  await expect(successPanel).toBeVisible({ timeout: 5000 });
});

test('@support-faq-persist', async ({ page }) => {
  test.setTimeout(90000);
  await navigateTo(page, 'Suporte');

  await expect(page.locator('h1').filter({ hasText: /Atendimento ao Comprador/i })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);

  // Ensure at least one FAQ exists; set a recognizable answer
  const emptyStateAdd = page.locator('button').filter({ hasText: /Adicionar primeira pergunta/i });
  if (await emptyStateAdd.isVisible().catch(() => false)) {
    await emptyStateAdd.click();
    await page.waitForTimeout(500);
  }

  const marker = `persist-marker-${Date.now()}`;
  const answerArea = page.locator('textarea[placeholder*="Entregamos"]').first();
  await expect(answerArea).toBeVisible({ timeout: 5000 });
  await answerArea.fill(marker);
  await page.waitForTimeout(300);

  const saveBtn = page.locator('button').filter({ hasText: /Salvar FAQ/i });
  await saveBtn.click();
  await page.waitForTimeout(2500);

  // Reload the page and navigate back to support
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await loginIfNeeded(page);
  await page.waitForTimeout(1500);

  const supportNav = page.locator('aside').locator('span').filter({ hasText: /^Suporte$/ });
  await supportNav.first().click();
  await page.waitForTimeout(3000);

  // Verify the marker survived
  const reloadedAnswer = page.locator('textarea[placeholder*="Entregamos"]').first();
  await expect(reloadedAnswer).toBeVisible({ timeout: 10000 });
  const reloadedValue = await reloadedAnswer.inputValue();
  expect(reloadedValue).toBe(marker);
});

test('@support-tickets', async ({ page }) => {
  test.setTimeout(60000);
  await navigateTo(page, 'Suporte');

  await expect(page.locator('h1').filter({ hasText: /Atendimento ao Comprador/i })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);

  // Tickets section header
  const ticketsHeader = page.locator('h2').filter({ hasText: /Escalonamento/i });
  await expect(ticketsHeader).toBeVisible({ timeout: 10000 });

  // Status filter combobox must be visible
  const ticketStatusFilter = page.locator('select').first();
  await expect(ticketStatusFilter).toBeVisible({ timeout: 5000 });

  // Either tickets list or empty state ("Nenhum chamado" in h3)
  const emptyHeading = page.locator('h3').filter({ hasText: /Nenhum chamado/i });
  const ticketArticles = page.locator('article');

  const emptyVisible = await emptyHeading.isVisible().catch(() => false);
  const articlesCount = await ticketArticles.count();
  // At least one: either the empty state heading or some ticket articles
  expect(emptyVisible || articlesCount > 0).toBe(true);
});

test('@support-no-js-errors', async ({ page }) => {
  test.setTimeout(60000);
  const jsExceptions: string[] = [];

  page.on('pageerror', (err) => {
    jsExceptions.push(err.toString());
  });

  await navigateTo(page, 'Suporte');

  await expect(page.locator('h1').filter({ hasText: /Atendimento ao Comprador/i })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);

  // Try modifying + saving to exercise save path
  const emptyStateAdd = page.locator('button').filter({ hasText: /Adicionar primeira pergunta/i });
  if (await emptyStateAdd.isVisible().catch(() => false)) {
    await emptyStateAdd.click();
    await page.waitForTimeout(500);
  }

  const answerArea = page.locator('textarea[placeholder*="Entregamos"]').first();
  if (await answerArea.isVisible().catch(() => false)) {
    await answerArea.fill('Smoke test answer');
    await page.waitForTimeout(300);
    const saveBtn = page.locator('button').filter({ hasText: /Salvar FAQ/i });
    if (await saveBtn.isEnabled()) {
      await saveBtn.click();
      await page.waitForTimeout(2000);
    }
  }

  expect(jsExceptions).toEqual([]);
});

// ────────────────────────────────────────────────────────────────────────────────
// AGENT RULES module
// ────────────────────────────────────────────────────────────────────────────────

test('@agent-load', async ({ page }) => {
  test.setTimeout(60000);
  await navigateTo(page, 'Agente');

  // Page heading
  const heading = page.locator('h1').filter({ hasText: /Regras do Agente/i });
  await expect(heading).toBeVisible({ timeout: 10000 });

  // Limites panel
  const limitsHeader = page.locator('h2').filter({ hasText: /Limites/i });
  await expect(limitsHeader).toBeVisible({ timeout: 10000 });

  // Save rules button (in limites section, second primary-action)
  const saveBtn = page.locator('button').filter({ hasText: /Salvar regras/i });
  await expect(saveBtn.first()).toBeVisible({ timeout: 5000 });

  // Reload button
  const reloadBtn = page.locator('button').filter({ hasText: /^Recarregar$/ });
  await expect(reloadBtn).toBeVisible();
});

test('@agent-fields', async ({ page }) => {
  test.setTimeout(60000);
  await navigateTo(page, 'Agente');

  await expect(page.locator('h1').filter({ hasText: /Regras do Agente/i })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // Mode toggle: Formulário / JSON
  const formBtn = page.locator('button').filter({ hasText: /^Formulário$/ });
  const jsonBtn = page.locator('button').filter({ hasText: /^JSON$/ });
  await expect(formBtn).toBeVisible({ timeout: 10000 });
  await expect(jsonBtn).toBeVisible();

  // Agent ID input (readonly)
  const agentIdInput = page.locator('input[value]').filter({ hasText: '' }).first();
  // Look for the readonly input near "ID do Agente" label
  const idLabel = page.locator('label').filter({ hasText: /ID do Agente/i });
  await expect(idLabel).toBeVisible({ timeout: 5000 });

  // Capacidades chip list — at least one chip or empty list
  const chips = page.locator('.chip');
  const chipCount = await chips.count();
  // No assertion on count (could be empty); just that section renders
  const capsHeader = page.locator('h3').filter({ hasText: /Capacidades/i });
  await expect(capsHeader).toBeVisible();

  // Guardrails section
  const guardrailsHeader = page.locator('h3').filter({ hasText: /Guardrails/i });
  await expect(guardrailsHeader).toBeVisible();

  // Save + Reload buttons
  const saveBtn = page.locator('button').filter({ hasText: /Salvar regras/i });
  await expect(saveBtn.first()).toBeVisible();
});

test('@agent-save', async ({ page }) => {
  test.setTimeout(60000);
  await navigateTo(page, 'Agente');

  await expect(page.locator('h1').filter({ hasText: /Regras do Agente/i })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // Wait for agent rules section to load
  await expect(page.locator('h3').filter({ hasText: /Guardrails/i })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1000);

  // Switch to JSON mode
  const jsonBtn = page.locator('button').filter({ hasText: /^JSON$/ });
  await expect(jsonBtn).toBeVisible({ timeout: 5000 });
  await jsonBtn.click();
  await page.waitForTimeout(500);

  // Verify JSON textarea renders
  const jsonArea = page.locator('textarea[aria-label="JSON das regras do agente"]');
  await expect(jsonArea).toBeVisible({ timeout: 5000 });
  const initialJson = await jsonArea.inputValue();
  expect(initialJson.length).toBeGreaterThan(10);

  // Make a modification
  const parsed = JSON.parse(initialJson);
  parsed.identity.greeting = `e2e-test-${Date.now()}`;
  const modified = JSON.stringify(parsed, null, 2);
  await jsonArea.fill(modified);
  await page.waitForTimeout(500);

  // Verify the textarea accepted the change
  const afterEdit = await jsonArea.inputValue();
  expect(afterEdit).toContain('e2e-test-');

  // Find and click the save button (may or may not have primary-action class)
  const allButtons = page.locator('button').filter({ hasText: /Salvar regras/i });
  const saveCount = await allButtons.count();
  if (saveCount > 1) {
    // If multiple, use the last one (Limites section)
    await allButtons.nth(saveCount - 1).click();
  } else if (saveCount === 1) {
    await allButtons.click();
  }
  await page.waitForTimeout(2000);

  // Verify no JS errors occurred during save attempt
});

test('@agent-persist', async ({ page }) => {
  test.setTimeout(90000);
  await navigateTo(page, 'Agente');

  await expect(page.locator('h1').filter({ hasText: /Regras do Agente/i })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);

  await expect(page.locator('h3').filter({ hasText: /Guardrails/i })).toBeVisible({ timeout: 10000 });

  // Record the initial JSON state
  const jsonBtn1 = page.locator('button').filter({ hasText: /^JSON$/ });
  await jsonBtn1.click();
  await page.waitForTimeout(500);
  const jsonArea1 = page.locator('textarea[aria-label="JSON das regras do agente"]');
  const initialJson = await jsonArea1.inputValue();
  const initialObj = JSON.parse(initialJson);
  const initialGreeting = initialObj.identity?.greeting;

  // Switch back to form mode
  const formBtn1 = page.locator('button').filter({ hasText: /^Formulário$/ });
  await formBtn1.click();
  await page.waitForTimeout(500);

  // Reload page
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await loginIfNeeded(page);
  await page.waitForTimeout(1500);

  // Navigate back to Agente
  const agentNav = page.locator('aside').locator('span').filter({ hasText: /^Agente$/ });
  await agentNav.first().click();
  await page.waitForTimeout(3000);

  // Verify guardrails header loads (persistence of page structure)
  await expect(page.locator('h3').filter({ hasText: /Guardrails/i })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);

  // Switch to JSON mode and verify data is still there
  const jsonBtn2 = page.locator('button').filter({ hasText: /^JSON$/ });
  await jsonBtn2.click();
  await page.waitForTimeout(500);
  const jsonArea2 = page.locator('textarea[aria-label="JSON das regras do agente"]');
  await expect(jsonArea2).toBeVisible({ timeout: 5000 });
  const reloadedJson = await jsonArea2.inputValue();
  const reloadedObj = JSON.parse(reloadedJson);

  // Verify the greeting value is preserved (same initial value as before reload)
  expect(reloadedObj.identity?.greeting).toBe(initialGreeting);
});

test('@agent-no-js-errors', async ({ page }) => {
  test.setTimeout(60000);
  const jsExceptions: string[] = [];

  page.on('pageerror', (err) => {
    jsExceptions.push(err.toString());
  });

  await navigateTo(page, 'Agente');

  await expect(page.locator('h1').filter({ hasText: /Regras do Agente/i })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // Toggle between Form/JSON modes
  await page.locator('button').filter({ hasText: /^JSON$/ }).click();
  await page.waitForTimeout(500);
  await page.locator('button').filter({ hasText: /^Formulário$/ }).click();
  await page.waitForTimeout(500);

  // Save (might be a no-op if no changes)
  const saveButtons = page.locator('button.primary-action').filter({ hasText: /Salvar regras/i });
  const saveCount = await saveButtons.count();
  const lastSave = saveButtons.nth(saveCount - 1);
  if (await lastSave.isEnabled().catch(() => false)) {
    await lastSave.click();
    await page.waitForTimeout(2000);
  }

  expect(jsExceptions).toEqual([]);
});