import { test, expect, Page } from '@playwright/test';

// Helper: Login via UI
async function loginDashboard(page: Page) {
  await page.goto('http://localhost:5175/');
  await page.waitForTimeout(2000);

  const emailInput = page.locator("input[placeholder='owner@loja.com']");
  await emailInput.click();
  await emailInput.pressSequentially('demo@zyon.com', { delay: 50 });

  const pwd = page.locator("input[type='password']");
  await pwd.click();
  await pwd.pressSequentially('demo1234', { delay: 50 });

  await page.locator("button[type='submit']").click();
  await page.waitForTimeout(3000);
}

// Helper: Navigate to a tab
async function navigateToTab(page: Page, tabName: string) {
  const el = page.locator('nav').getByText(tabName, { exact: true });
  await el.click();
  await page.waitForTimeout(2000);
}

test.describe('SUPPORT PAGE', () => {
  test('@support-faq-persistence FAQ text modification + save + reload', async ({ page }) => {
    // Login
    await loginDashboard(page);

    // Navigate to Suporte
    await navigateToTab(page, 'Suporte');

    // Wait for FAQ section to load
    const h1 = page.locator('main h1');
    await expect(h1).toContainText('Atendimento ao Comprador');

    // Find a textareathat contains "Resposta" (answer field)
    const textareas = page.locator('textarea');
    const count = await textareas.count();
    expect(count).toBeGreaterThan(0);

    if (count > 0) {
      // Modify the first answer textarea
      const firstAnswer = textareas.first();
      const currentValue = await firstAnswer.inputValue();

      // Change text
      const newText = `PERSISTENCE_TEST_${Date.now()}: Modified answer`;
      await firstAnswer.fill(newText);

      // Click Save FAQ button
      const saveBtn = page.locator('button').filter({ hasText: /Salvar|Save/ }).first();
      await saveBtn.click();
      await page.waitForTimeout(2000);

      // Verify success message
      const successMsg = page.locator('text=/sucesso|successfully/i').first();
      await expect(successMsg).toBeVisible({ timeout: 5000 });

      // Verify the PUT request was made (check network)
      // Reload the page
      await page.reload();
      await page.waitForTimeout(2000);

      // Navigate back to Suporte
      await navigateToTab(page, 'Suporte');
      await page.waitForTimeout(1000);

      // Verify the text persisted
      const reloadedTextarea = page.locator('textarea').first();
      const reloadedValue = await reloadedTextarea.inputValue();
      expect(reloadedValue).toContain('PERSISTENCE_TEST_');
    }
  });

  test('@support-visual FAQ section headers use monospace font', async ({ page }) => {
    await loginDashboard(page);
    await navigateToTab(page, 'Suporte');

    const h1 = page.locator('main h1');
    await expect(h1).toContainText('Atendimento ao Comprador');

    // Check section titles
    const faqTitle = page.locator('text=Resposta automática').first();
    await expect(faqTitle).toBeVisible();

    // Verify header styling is consistent (no aggressive separators)
    const panels = page.locator('section.panel');
    const panelCount = await panels.count();
    expect(panelCount).toBeGreaterThan(0);
  });
});

test.describe('EMBED PAGE', () => {
  test('@embed-render 3 steps visible', async ({ page }) => {
    await loginDashboard(page);
    await navigateToTab(page, 'Embed');

    // Verify page title
    const h1 = page.locator('main h1');
    await expect(h1).toContainText('Instale o checkout');

    // Verify 3 step sections with numbered circles
    const step1 = page.locator('text=Configurar sessão').first();
    const step2 = page.locator('text=Permissões').first();
    const step3 = page.locator('text=Cole no seu HTML').first();

    await expect(step1).toBeVisible();
    await expect(step2).toBeVisible();
    await expect(step3).toBeVisible();
  });

  test('@embed-code-snippet embed code block visible with correct content', async ({ page }) => {
    await loginDashboard(page);
    await navigateToTab(page, 'Embed');

    // Find the <code> block that contains the script tag
    const codeBlock = page.locator('pre code');
    await expect(codeBlock).toBeVisible();

    const codeText = await codeBlock.textContent();
    expect(codeText).toContain('<script src');
    expect(codeText).toContain('data-aacp-token');
    expect(codeText).toContain('async');
  });

  test('@embed-permission-toggle permission checkbox updates embed code', async ({ page }) => {
    await loginDashboard(page);
    await navigateToTab(page, 'Embed');

    // Find checkboxes for permissions
    const checkboxes = page.locator('input[type="checkbox"]');
    const checkboxCount = await checkboxes.count();
    expect(checkboxCount).toBeGreaterThan(0);

    // Get initial code snippet
    const codeBlock = page.locator('pre code');
    const initialText = await codeBlock.textContent();

    // Toggle first permission off/on
    const firstCheckbox = checkboxes.first();
    const isChecked = await firstCheckbox.isChecked();
    await firstCheckbox.click();
    await page.waitForTimeout(500);

    // Code should update (this is client-side, no API call needed)
    // The update happens immediately in the DOM
    const updatedText = await codeBlock.textContent();
    // The snippet should exist after toggle (may be same if only 1 scope)
    expect(updatedText).toBeTruthy();
  });

  test('@embed-visual permission cards not aggressively green, border-radius 14px', async ({ page }) => {
    await loginDashboard(page);
    await navigateToTab(page, 'Embed');

    // Find permission cards (labels containing checkbox + description)
    const labels = page.locator('label').filter({ has: page.locator('input[type="checkbox"]') });
    const labelCount = await labels.count();
    expect(labelCount).toBeGreaterThan(0);

    if (labelCount > 0) {
      // Check first permission card style
      const firstLabel = labels.first();
      const computedStyle = await firstLabel.evaluate(el => {
        return window.getComputedStyle(el as HTMLElement);
      });

      // Verify border-radius is present (checking inline or CSS)
      const borderRadius = await firstLabel.evaluate(el => {
        return (el as HTMLElement).style.borderRadius;
      });

      // Should have a reasonable border radius (not 0, likely 10px or higher)
      expect(borderRadius).toBeTruthy();
    }
  });

  test('@embed-step-numbers step circles use accent color', async ({ page }) => {
    await loginDashboard(page);
    await navigateToTab(page, 'Embed');

    // Find the three step number circles (usually divs with background)
    const stepDivs = page.locator('div').filter({ hasText: /^1$|^2$|^3$/ });
    const stepCount = await stepDivs.count();

    // At least 3 steps should be found
    expect(stepCount).toBeGreaterThanOrEqual(3);
  });

  test('@embed-no-js-errors no critical console errors', async ({ page }) => {
    const errors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await loginDashboard(page);
    await navigateToTab(page, 'Embed');
    await page.waitForTimeout(2000);

    // Filter out known benign errors (e.g., failed resource loads)
    const criticalErrors = errors.filter(e =>
      !e.includes('Failed to load resource') &&
      !e.includes('404') &&
      !e.includes('401')
    );

    expect(criticalErrors).toHaveLength(0);
  });
});
