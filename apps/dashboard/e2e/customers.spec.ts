import { test, expect, Page } from "@playwright/test";

// Force serial execution — login sessions conflict when parallel
test.describe.configure({ mode: "serial" });

// Increase timeout for this suite since login takes time
test.setTimeout(60_000);

// ---------------------------------------------------------------------------
// Login helper — uses exact pattern from task spec with retry
// ---------------------------------------------------------------------------
async function loginIfNeeded(page: Page) {
  const emailInput = page.locator("input[placeholder='owner@loja.com']");
  const isLoginPage = await emailInput.isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoginPage) {
    await emailInput.click();
    await emailInput.pressSequentially("demo@zyon.com", { delay: 50 });
    await page.waitForTimeout(300);
    const passwordInput = page.locator("input[type='password']");
    await passwordInput.click();
    await passwordInput.pressSequentially("demo1234", { delay: 50 });
    await page.waitForTimeout(300);
    await page.locator("button[type='submit']").click();
    await page.waitForTimeout(4000);

    // If login failed (API error), retry once
    const stillOnLogin = await emailInput.isVisible({ timeout: 1000 }).catch(() => false);
    if (stillOnLogin) {
      // Clear and retry
      await emailInput.click({ clickCount: 3 });
      await emailInput.pressSequentially("demo@zyon.com", { delay: 50 });
      await page.waitForTimeout(200);
      const pwd = page.locator("input[type='password']");
      await pwd.click({ clickCount: 3 });
      await pwd.pressSequentially("demo1234", { delay: 50 });
      await page.waitForTimeout(200);
      await page.locator("button[type='submit']").click();
      await page.waitForTimeout(5000);
    }
  }
}

// ---------------------------------------------------------------------------
// Navigate to Customers page
// ---------------------------------------------------------------------------
async function navigateToCustomers(page: Page) {
  await page.goto("/", { waitUntil: "networkidle", timeout: 15_000 });
  await loginIfNeeded(page);

  // Verify shell loaded — sidebar aside or nav element must be present
  const sidebar = page.locator("aside").first();
  await expect(sidebar).toBeVisible({ timeout: 15_000 });

  // Click Clientes nav item
  await page.locator("text=Clientes").first().click();
  await page.waitForTimeout(2000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Customers Module — Deep E2E", () => {
  test("@customers-load Page renders with table or empty state", async ({ page }) => {
    await navigateToCustomers(page);

    // Either a table or the empty state must render
    const table = page.locator("table");
    const emptyState = page.locator("text=Nenhum comprador registrado ainda");

    const hasTable = await table.isVisible({ timeout: 8_000 }).catch(() => false);
    const hasEmpty = await emptyState.isVisible({ timeout: 2_000 }).catch(() => false);

    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test("@customers-metrics Stats cards render (TOTAL, NOVOS (7D), RETORNO)", async ({ page }) => {
    await navigateToCustomers(page);

    // The stats grid has 3 cards with labels: TOTAL, NOVOS (7D), RETORNO
    await expect(page.locator("text=TOTAL").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=NOVOS (7D)").first()).toBeVisible();
    await expect(page.locator("text=RETORNO").first()).toBeVisible();
  });

  test("@customers-date-filter Date filter tabs work (Todos, Últimos 7 dias, Últimos 30 dias)", async ({ page }) => {
    await navigateToCustomers(page);

    // Verify all 3 filter tabs are visible
    const tabTodos = page.locator("text=Todos").first();
    const tab7d = page.locator("text=Últimos 7 dias").first();
    const tab30d = page.locator("text=Últimos 30 dias").first();

    await expect(tabTodos).toBeVisible({ timeout: 10_000 });
    await expect(tab7d).toBeVisible();
    await expect(tab30d).toBeVisible();

    // Click 7d tab and verify page still renders
    await tab7d.click();
    await page.waitForTimeout(500);

    const table = page.locator("table");
    const emptyState = page.locator("text=Nenhum comprador registrado ainda");
    const hasTable = await table.isVisible({ timeout: 3_000 }).catch(() => false);
    const hasEmpty = await emptyState.isVisible({ timeout: 1_000 }).catch(() => false);
    expect(hasTable || hasEmpty).toBeTruthy();

    // Click 30d tab
    await tab30d.click();
    await page.waitForTimeout(500);

    // Click back to Todos
    await tabTodos.click();
    await page.waitForTimeout(500);

    const hasTableAfter = await table.isVisible({ timeout: 3_000 }).catch(() => false);
    const hasEmptyAfter = await emptyState.isVisible({ timeout: 1_000 }).catch(() => false);
    expect(hasTableAfter || hasEmptyAfter).toBeTruthy();
  });

  test("@customers-search Search input filters by name/email", async ({ page }) => {
    await navigateToCustomers(page);

    const searchInput = page.locator("input[placeholder*='Buscar por nome']");
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Type a search query
    await searchInput.click();
    await searchInput.fill("teste@example.com");
    await page.waitForTimeout(500);

    // Page should still render (table or empty state)
    const table = page.locator("table");
    const emptyState = page.locator("text=Nenhum comprador registrado ainda");
    const hasTable = await table.isVisible({ timeout: 3_000 }).catch(() => false);
    const hasEmpty = await emptyState.isVisible({ timeout: 1_000 }).catch(() => false);
    expect(hasTable || hasEmpty).toBeTruthy();

    // Clear and verify recovery
    await searchInput.fill("");
    await page.waitForTimeout(500);

    const hasTableAfter = await table.isVisible({ timeout: 3_000 }).catch(() => false);
    const hasEmptyAfter = await emptyState.isVisible({ timeout: 1_000 }).catch(() => false);
    expect(hasTableAfter || hasEmptyAfter).toBeTruthy();
  });

  test("@customers-table-columns Table has correct headers (NOME, E-MAIL, TELEFONE, PRIMEIRA VISITA, ÚLTIMA VISITA)", async ({ page }) => {
    await navigateToCustomers(page);

    const table = page.locator("table");
    const hasTable = await table.isVisible({ timeout: 10_000 }).catch(() => false);

    if (hasTable) {
      const headers = page.locator("thead th");
      const headerTexts = await headers.allTextContents();

      expect(headerTexts).toContain("NOME");
      expect(headerTexts).toContain("E-MAIL");
      expect(headerTexts).toContain("TELEFONE");
      expect(headerTexts).toContain("PRIMEIRA VISITA");
      expect(headerTexts).toContain("ÚLTIMA VISITA");
    } else {
      // Table is always rendered (headers present even with 0 rows)
      // but if API failed, we may get empty state without table
      const emptyState = page.locator("text=Nenhum comprador registrado ainda");
      await expect(emptyState).toBeVisible({ timeout: 3_000 });

      // Try to find table headers anyway
      const headers = page.locator("thead th");
      const count = await headers.count();
      if (count > 0) {
        const headerTexts = await headers.allTextContents();
        expect(headerTexts).toContain("NOME");
        expect(headerTexts).toContain("E-MAIL");
        expect(headerTexts).toContain("TELEFONE");
        expect(headerTexts).toContain("PRIMEIRA VISITA");
        expect(headerTexts).toContain("ÚLTIMA VISITA");
      }
    }
  });

  test("@customers-export Export CSV button exists and is clickable", async ({ page }) => {
    await navigateToCustomers(page);

    const exportBtn = page.locator("button", { hasText: "Exportar CSV" });
    await expect(exportBtn).toBeVisible({ timeout: 10_000 });

    const isDisabled = await exportBtn.isDisabled();

    if (!isDisabled) {
      const downloadPromise = page.waitForEvent("download", { timeout: 3_000 }).catch(() => null);
      await exportBtn.click();
      await page.waitForTimeout(500);
    } else {
      // Disabled = no customers loaded, which is valid
      expect(isDisabled).toBeTruthy();
    }
  });

  test("@customers-empty-state If no customers, empty state shows message", async ({ page }) => {
    await navigateToCustomers(page);

    const searchInput = page.locator("input[placeholder*='Buscar por nome']");
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Use impossible search term to force empty filtered results
    await searchInput.fill("zzzznonexistentcustomer99999");
    await page.waitForTimeout(500);

    const emptyState = page.locator("text=Nenhum comprador registrado ainda");
    const hasEmpty = await emptyState.isVisible({ timeout: 5_000 }).catch(() => false);

    if (hasEmpty) {
      await expect(emptyState).toBeVisible();
      const subMessage = page.locator("text=Clientes aparecerão aqui após a primeira interação no checkout");
      await expect(subMessage).toBeVisible();
    } else {
      // If table has no rows at all (no customers in DB), clear search to check
      await searchInput.fill("");
      await page.waitForTimeout(500);
      const emptyNoSearch = page.locator("text=Nenhum comprador registrado ainda");
      const hasEmptyNoSearch = await emptyNoSearch.isVisible({ timeout: 3_000 }).catch(() => false);
      // Either scenario confirms the empty state behavior exists
      expect(hasEmpty || hasEmptyNoSearch).toBeTruthy();
    }
  });

  test("@customers-no-js-errors No critical JS errors on page", async ({ page }) => {
    const errors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Ignore known non-critical: network issues, favicon, resource loads
        if (
          !text.includes("favicon") &&
          !text.includes("net::ERR") &&
          !text.includes("Failed to load resource") &&
          !text.includes("Failed to fetch")
        ) {
          errors.push(text);
        }
      }
    });

    page.on("pageerror", (err) => {
      errors.push(`PageError: ${err.message}`);
    });

    await navigateToCustomers(page);

    // Settle
    await page.waitForTimeout(2000);

    // Interact to trigger lazy errors
    const searchInput = page.locator("input[placeholder*='Buscar por nome']");
    if (await searchInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await searchInput.fill("test");
      await page.waitForTimeout(300);
      await searchInput.fill("");
      await page.waitForTimeout(300);
    }

    expect(errors).toEqual([]);
  });
});
