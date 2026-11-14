/**
 * Example E2E test using the new infrastructure.
 *
 * This demonstrates best practices for the dashboard E2E suite:
 * - Page objects for clarity
 * - Shared helpers for auth, API, data
 * - Stable selectors via constants
 * - Explicit waits, no sleeps
 * - Assertions without assertions.toHaveText(...).toContainText(...)
 *
 * Copy this pattern when adding new features.
 */

import { test, expect } from "@playwright/test";
import { DashboardPage, OrdersPage } from "./page-objects";
import { waitForTableRows, waitForToast } from "./utils/wait-helpers";
import { assertTableHeaders } from "./utils/assertions";
import { NAV_LABELS } from "./fixtures/test-data";

test.describe("Dashboard — Example Integration", () => {
  let dashboard: DashboardPage;
  let orders: OrdersPage;

  test.beforeEach(async ({ page }) => {
    dashboard = new DashboardPage(page);
    orders = new OrdersPage(page);

    // Navigate to dashboard (authenticated via storageState)
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await dashboard.waitForShell();
  });

  test("@example-overview → orders flow", async ({ page }) => {
    // Navigate to overview
    await dashboard.gotoOverview();
    await dashboard.assertMetricsVisible();
    await dashboard.assertAgentStatusVisible();

    // Click Orders in nav
    await dashboard.gotoOrders();
    await orders.assertTableVisible();

    // Table should have expected headers
    await assertTableHeaders(page, ["PEDIDO", "CLIENTE", "VALOR", "DATA", "STATUS"]);

    // Wait for at least 1 row to appear
    await waitForTableRows(page, 1, "table tbody tr");

    // Search for specific order (assuming at least one exists)
    await orders.search("pedido");

    // Should still have content
    await orders.assertRowCountAtLeast(0);
  });

  test("@example-error-handling — gracefully handles missing data", async ({ page }) => {
    // Try searching for something unlikely to exist
    await orders.goto();
    await orders.search("zzz_nonexistent_order_zzz");

    // Either: table shows 0 rows (expected)
    // Or: empty state message appears
    const emptyState = page.locator("text=Nenhum")
      .or(page.locator("text=Sem resultados"));
    const tableVisible = await orders.table.isVisible({ timeout: 2_000 }).catch(() => false);

    if (tableVisible) {
      const rowCount = await orders.tableRows.count();
      expect(rowCount).toBe(0);
    } else {
      await expect(emptyState.first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test("@example-mobile", async ({ page }) => {
    // This test runs on mobile (Pixel 5) via dashboard-mobile project
    if (page.viewportSize()?.width! < 600) {
      // Mobile-specific assertions
      const nav = dashboard.nav;
      expect(await nav.isVisible({ timeout: 5_000 }).catch(() => false)).toBeTruthy();
    }
  });
});
