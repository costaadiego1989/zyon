import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

const MOCK_MERCHANT_PROFILE = {
  id: "mrc_e2e_test",
  name: "E2E Test Store",
  email: "e2e@test.com",
  shopify_domain: "e2e-test.myshopify.com",
  created_at: "2024-01-01T00:00:00.000Z"
};

const MOCK_ONBOARDING_STATE = {
  completed: true,
  current_step: null,
  steps: []
};

const NAV_TABS = [
  { key: "onboarding", label: "Primeiros passos", section: "Comecar" },
  { key: "overview", label: "Operacao", section: "Hoje" },
  { key: "shipments", label: "Pedidos e envios", section: "Hoje" },
  { key: "customers", label: "Clientes", section: "Hoje" },
  { key: "integrations", label: "Desenvolvedores", section: "Plataforma" },
  { key: "commerce-connections", label: "Loja / Commerce", section: "Plataforma" },
  { key: "embed", label: "Embed", section: "Plataforma" },
  { key: "preview", label: "Preview", section: "Plataforma" },
  { key: "theme", label: "Tema", section: "Plataforma" },
  { key: "support", label: "Suporte", section: "Atendimento" },
  { key: "settings", label: "Checkout", section: "Atendimento" },
  { key: "rules", label: "Agente", section: "Atendimento" },
  { key: "negotiation", label: "Negociação", section: "Atendimento" },
  { key: "billing", label: "Faturamento", section: "Conta" },
  { key: "payment-connections", label: "Pagamentos", section: "Conta" },
  { key: "audit-log", label: "Auditoria", section: "Conta" }
] as const;

async function setupMockApi(page: Page) {
  await page.route("**/v1/**", (route) => {
    const url = route.request().url();

    if (url.includes("/v1/merchants/me")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_MERCHANT_PROFILE)
      });
    }

    if (url.includes("/v1/onboarding")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_ONBOARDING_STATE)
      });
    }

    if (url.includes("/v1/auth/refresh")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true })
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([])
    });
  });
}

test.describe("Dashboard tab navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page);
  });

  test("loads the dashboard shell after auth bypass", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".dashboard-sidebar")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".dashboard-main")).toBeVisible();
  });

  test("navigate all 16 tabs and capture screenshots", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await expect(page.locator(".dashboard-sidebar")).toBeVisible({ timeout: 10_000 });

    const results: Array<{ key: string; label: string; passed: boolean; errors: string[] }> = [];

    for (const navItem of NAV_TABS) {
      const errors: string[] = [];
      const handler = (msg: ConsoleMessage) => {
        if (msg.type() === "error") errors.push(msg.text());
      };

      // Fresh page load for each tab to avoid cascading crashes
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      const sidebar = page.locator(".dashboard-sidebar");
      const sidebarVisible = await sidebar.isVisible().catch(() => false);
      if (!sidebarVisible) {
        await expect(sidebar).toBeVisible({ timeout: 10_000 });
      }

      page.on("console", handler);

      // Click nav button — use getByRole for resilience
      const navButton = page.locator(".sidebar-nav button", { hasText: navItem.label });
      const buttonCount = await navButton.count();

      if (buttonCount === 0) {
        results.push({ key: navItem.key, label: navItem.label, passed: false, errors: [`Nav button "${navItem.label}" not found`] });
        page.off("console", handler);
        continue;
      }

      await navButton.first().click();

      // Wait for content to settle
      await page.waitForTimeout(800);

      // Take screenshot regardless of errors
      await page.screenshot({
        path: `test-results/screenshots/${navItem.key}.png`,
        fullPage: true
      });

      page.off("console", handler);

      // Check for critical JS errors (ignore React boundary messages)
      const criticalErrors = errors.filter(
        (e) =>
          (e.includes("Uncaught") ||
          e.includes("Cannot read properties of") ||
          e.includes("is not a function") ||
          e.includes("is not defined")) &&
          !e.includes("error boundary") &&
          !e.includes("Consider adding")
      );

      results.push({
        key: navItem.key,
        label: navItem.label,
        passed: criticalErrors.length === 0,
        errors
      });
    }

    // Print report
    console.log("\n=== DASHBOARD TAB AUDIT REPORT ===");
    console.log(`Total: ${results.length} tabs`);
    console.log(`Passed: ${results.filter(r => r.passed).length}`);
    console.log(`Failed: ${results.filter(r => !r.passed).length}`);
    console.log("");

    for (const r of results) {
      const status = r.passed ? "PASS" : "FAIL";
      console.log(`[${status}] ${r.key} (${r.label})`);
      if (r.errors.length > 0) {
        for (const err of r.errors) {
          console.log(`  - ${err}`);
        }
      }
    }
    console.log("\n=== END REPORT ===");

    // Fail test only if there are critical crashes
    const crashes = results.filter(r => !r.passed);
    expect(crashes.length, `${crashes.length} tabs have critical JS errors: ${crashes.map(c => c.key).join(", ")}`).toBe(0);
  });
});
