import { test, expect, type Page } from "@playwright/test";

// Force serial execution — parallel login floods the API with rate-limited requests
test.describe.configure({ mode: "serial" });

// Increase timeout for login + navigation overhead
test.setTimeout(60_000);

// ── Login helper (exact pattern from instructions) ─────────────────────────────

async function loginIfNeeded(page: Page) {
  const emailInput = page.locator("input[placeholder='owner@loja.com']");
  const isLoginPage = await emailInput.isVisible({ timeout: 4000 }).catch(() => false);
  if (isLoginPage) {
    await emailInput.click();
    await emailInput.pressSequentially("demo@zyon.com", { delay: 50 });
    await page.waitForTimeout(300);
    const passwordInput = page.locator("input[type='password']");
    await passwordInput.click();
    await passwordInput.pressSequentially("demo1234", { delay: 50 });
    await page.waitForTimeout(300);
    await page.locator("button[type='submit']").click();
    await page.waitForTimeout(3000);
  }
}

// ── Navigate to Orders page ────────────────────────────────────────────────────

async function navigateToOrders(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await loginIfNeeded(page);
  // Wait for the dashboard shell — the nav element with aria-label
  await expect(page.locator("nav[aria-label='Módulos do painel']")).toBeVisible({ timeout: 15_000 });
  // Navigate to orders
  await page.locator("text=Pedidos e envios").first().click();
  await page.waitForTimeout(2000);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe("Orders & Shipments Module", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToOrders(page);
  });

  test("@orders-load Table renders with correct columns", async ({ page }) => {
    // The table or empty state should be visible
    const table = page.locator("table");
    const emptyState = page.locator("text=Nenhum pedido registrado");
    const loadingState = page.locator("text=Carregando pedidos...");

    // Wait for loading to finish
    await expect(loadingState).toBeHidden({ timeout: 15_000 });

    const tableVisible = await table.isVisible().catch(() => false);
    const emptyVisible = await emptyState.isVisible().catch(() => false);

    // Either table or empty state should be present
    expect(tableVisible || emptyVisible).toBe(true);

    if (tableVisible) {
      // Verify all column headers exist
      const expectedColumns = ["PEDIDO", "COMPRADOR", "VALOR", "RASTREIO", "STATUS", "DATA"];
      for (const col of expectedColumns) {
        await expect(page.locator(`th:has-text("${col}")`)).toBeVisible();
      }
    }

    if (emptyVisible) {
      // Verify the empty state message content
      await expect(
        page.locator("text=Pedidos aparecerão aqui quando compradores concluírem o checkout.")
      ).toBeVisible();
    }
  });

  test("@orders-filter-all 'Todos os pedidos' tab shows all orders", async ({ page }) => {
    // The "Todos os pedidos" tab should be visible
    const allTab = page.locator("text=Todos os pedidos").first();
    await expect(allTab).toBeVisible({ timeout: 5_000 });

    // Click it to ensure it's active
    await allTab.click();
    await page.waitForTimeout(500);

    // Verify either table rows or empty state
    const table = page.locator("table");
    const emptyState = page.locator("text=Nenhum pedido registrado");
    const tableVisible = await table.isVisible().catch(() => false);
    const emptyVisible = await emptyState.isVisible().catch(() => false);

    expect(tableVisible || emptyVisible).toBe(true);
  });

  test("@orders-filter-approved 'Aprovados' tab filters to approved only", async ({ page }) => {
    // Click the "Aprovados" filter tab
    const approvedTab = page.locator("text=Aprovados").first();
    await expect(approvedTab).toBeVisible({ timeout: 5_000 });
    await approvedTab.click();
    await page.waitForTimeout(500);

    // After filtering, either:
    // - Table shows rows (all with "Aprovado" status badge)
    // - "Nenhum pedido corresponde ao filtro" message
    // - Empty state (no orders at all)
    const rows = page.locator("tbody tr");
    const noMatchMsg = page.locator("text=Nenhum pedido corresponde ao filtro");
    const emptyState = page.locator("text=Nenhum pedido registrado");

    const rowCount = await rows.count();
    const noMatch = await noMatchMsg.isVisible().catch(() => false);
    const empty = await emptyState.isVisible().catch(() => false);

    if (rowCount > 0 && !noMatch && !empty) {
      // All visible status badges should say "Aprovado"
      const statusBadges = page.locator("tbody tr td:nth-child(5) span");
      const badgeCount = await statusBadges.count();
      for (let i = 0; i < badgeCount; i++) {
        const text = await statusBadges.nth(i).textContent();
        expect(text).toBe("Aprovado");
      }
    } else {
      // Either no-match or empty state is acceptable
      expect(noMatch || empty).toBe(true);
    }
  });

  test("@orders-filter-cancelled 'Cancelados' tab filters to cancelled only", async ({ page }) => {
    // Click the "Cancelados" filter tab
    const cancelledTab = page.locator("text=Cancelados").first();
    await expect(cancelledTab).toBeVisible({ timeout: 5_000 });
    await cancelledTab.click();
    await page.waitForTimeout(500);

    // After filtering, verify state
    const rows = page.locator("tbody tr");
    const noMatchMsg = page.locator("text=Nenhum pedido corresponde ao filtro");
    const emptyState = page.locator("text=Nenhum pedido registrado");

    const rowCount = await rows.count();
    const noMatch = await noMatchMsg.isVisible().catch(() => false);
    const empty = await emptyState.isVisible().catch(() => false);

    if (rowCount > 0 && !noMatch && !empty) {
      // All visible status badges should say "Cancelado"
      const statusBadges = page.locator("tbody tr td:nth-child(5) span");
      const badgeCount = await statusBadges.count();
      for (let i = 0; i < badgeCount; i++) {
        const text = await statusBadges.nth(i).textContent();
        expect(text).toBe("Cancelado");
      }
    } else {
      // Either no-match or empty state is acceptable
      expect(noMatch || empty).toBe(true);
    }
  });

  test("@orders-search Search input filters by order ID", async ({ page }) => {
    // Find search input
    const searchInput = page.locator("input[placeholder*='Buscar']");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Type a search query
    await searchInput.click();
    await searchInput.fill("#12345-nonexistent");
    await page.waitForTimeout(500);

    // With a nonsense query, expect either "Nenhum pedido corresponde ao filtro" or empty table
    const noMatchMsg = page.locator("text=Nenhum pedido corresponde ao filtro");
    const emptyState = page.locator("text=Nenhum pedido registrado");
    const rows = page.locator("tbody tr");

    const noMatch = await noMatchMsg.isVisible().catch(() => false);
    const empty = await emptyState.isVisible().catch(() => false);
    const rowCount = await rows.count();

    // Either filter message shows or no rows exist (empty state)
    expect(noMatch || empty || rowCount === 0).toBe(true);

    // Clear and verify search resets
    await searchInput.fill("");
    await page.waitForTimeout(500);

    // After clearing, either rows come back or empty state remains
    const table = page.locator("table");
    const tableVisible = await table.isVisible().catch(() => false);
    const emptyAfterClear = await emptyState.isVisible().catch(() => false);
    expect(tableVisible || emptyAfterClear).toBe(true);
  });

  test("@orders-expand Click order row expands detail grid", async ({ page }) => {
    // Check if there are orders to expand
    const emptyState = page.locator("text=Nenhum pedido registrado");
    const empty = await emptyState.isVisible().catch(() => false);

    if (empty) {
      // No orders — skip expansion but test passes (empty state is valid)
      expect(empty).toBe(true);
      return;
    }

    const rows = page.locator("tbody tr");
    const rowCount = await rows.count();
    if (rowCount === 0) {
      // No rows rendered — pass
      return;
    }

    // Click the first data row to expand it
    await rows.first().click();
    await page.waitForTimeout(500);

    // Verify detail grid sections appear
    const detailSections = ["Itens do carrinho", "Cliente", "Envio"];
    for (const section of detailSections) {
      const sectionEl = page.locator(`h4:has-text("${section}")`).first();
      await expect(sectionEl).toBeVisible({ timeout: 3_000 });
    }

    // Click again to collapse
    await rows.first().click();
    await page.waitForTimeout(300);

    // Detail sections should be hidden
    const detailGrid = page.locator(".order-detail-grid");
    await expect(detailGrid).toBeHidden({ timeout: 3_000 });
  });

  test("@orders-stats Stats strip renders with all metrics", async ({ page }) => {
    // Stats strip labels (rendered with mono font)
    const expectedStats = ["PEDIDOS", "APROVADOS", "RECEITA", "RASTREADOS", "TICKET MÉDIO"];

    for (const stat of expectedStats) {
      const statEl = page.locator(`text=${stat}`).first();
      await expect(statEl).toBeVisible({ timeout: 5_000 });
    }

    // Each stat should have a value (not undefined/null)
    for (const stat of expectedStats) {
      const container = page.locator(`div:has(> div:has-text("${stat}"))`).first();
      const visible = await container.isVisible().catch(() => false);
      expect(visible).toBe(true);
    }
  });

  test("@orders-no-js-errors No critical JS errors", async ({ page }) => {
    const errors: string[] = [];

    page.on("pageerror", (error) => {
      errors.push(error.message);
    });

    // Navigate again to capture any errors from page load
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await loginIfNeeded(page);
    await expect(page.locator("nav[aria-label='Módulos do painel']")).toBeVisible({ timeout: 15_000 });
    await page.locator("text=Pedidos e envios").first().click();
    await page.waitForTimeout(2000);

    // Filter out non-critical errors (network issues, etc.)
    const criticalErrors = errors.filter((msg) => {
      if (msg.includes("net::ERR_")) return false;
      if (msg.includes("Failed to fetch")) return false;
      if (msg.includes("NetworkError")) return false;
      if (msg.includes("ResizeObserver")) return false;
      return true;
    });

    expect(criticalErrors).toEqual([]);
  });
});
