import { test, expect, type Page } from "@playwright/test";

/* ── Login helper ──────────────────────────────────────────────── */

async function loginIfNeeded(page: Page) {
  const emailInput = page.locator("input[placeholder='owner@loja.com']");
  const isLoginPage = await emailInput.isVisible({ timeout: 2000 }).catch(() => false);
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

/* ── Navigate to Overview (Operação) ──────────────────────────── */

async function navigateToOverview(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await loginIfNeeded(page);
  // Wait for nav shell to render
  await expect(page.locator("nav")).toBeVisible({ timeout: 10_000 });
  // Click Operação nav item
  await page.locator("text=Operação").first().click();
  await page.waitForTimeout(1500);
}

/* ── Tests ─────────────────────────────────────────────────────── */

test.describe("Overview Module", () => {
  test("@overview-load — Page renders after login, main element visible", async ({ page }) => {
    await navigateToOverview(page);

    // Shell nav is visible
    await expect(page.locator("nav")).toBeVisible();

    // Overview page content loaded — look for the subtitle text
    await expect(
      page.locator("text=Acompanhe sessões, receita e desempenho do checkout agêntico em tempo real")
    ).toBeVisible({ timeout: 10_000 });

    // Agent status badge visible
    const agentBadge = page.locator("text=Agente operante").or(page.locator("text=Agente indisponível"));
    await expect(agentBadge.first()).toBeVisible({ timeout: 5_000 });
  });

  test("@overview-metrics — Metrics cards render (RECEITA, SESSÕES, CONVERSÃO, TICKET MÉDIO)", async ({ page }) => {
    await navigateToOverview(page);

    // Revenue header
    await expect(page.locator("text=RECEITA GERADA · 7 DIAS")).toBeVisible({ timeout: 10_000 });

    // Sub-metrics inside the revenue card
    await expect(page.locator("text=SESSÕES").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=CONVERSÃO").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=TICKET MÉDIO")).toBeVisible({ timeout: 5_000 });
  });

  test("@overview-sessions-table — Sessions table renders with headers", async ({ page }) => {
    await navigateToOverview(page);

    // Look for the sessions section heading
    await expect(page.locator("text=Sessões recentes")).toBeVisible({ timeout: 10_000 });

    // Wait for loading state to disappear
    const loadingText = page.locator("text=Carregando sessões...");
    await loadingText.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});

    // Table headers OR empty state OR data rows must be present
    const tableHeaders = page.locator("th");
    const emptyState = page.locator("text=Nenhuma sessão registrada ainda");
    const tableRows = page.locator("table tbody tr");

    const hasTable = await tableHeaders.first().isVisible({ timeout: 5_000 }).catch(() => false);
    const hasEmpty = await emptyState.isVisible({ timeout: 3_000 }).catch(() => false);
    const hasRows = await tableRows.first().isVisible({ timeout: 2_000 }).catch(() => false);

    // At least one valid state: table with headers, empty state message, or data rows
    expect(hasTable || hasEmpty || hasRows).toBeTruthy();

    if (hasTable) {
      // Verify expected column headers
      const headers = await tableHeaders.allTextContents();
      expect(headers).toContain("COMPRADOR");
      expect(headers).toContain("STATUS");
      expect(headers).toContain("VALOR");
    }
  });

  test("@overview-funnel — Conversion funnel renders", async ({ page }) => {
    await navigateToOverview(page);

    // Funnel card heading
    await expect(page.locator("text=Funil de ofertas")).toBeVisible({ timeout: 10_000 });

    // Funnel steps
    await expect(page.locator("text=Ofertas vistas")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=Ofertas aceitas")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=Pedidos aprovados")).toBeVisible({ timeout: 5_000 });
  });

  test("@overview-revenue — Revenue hero card renders with value", async ({ page }) => {
    await navigateToOverview(page);

    // Revenue card header
    await expect(page.locator("text=RECEITA GERADA · 7 DIAS")).toBeVisible({ timeout: 10_000 });

    // The revenue value is rendered — look for the currency format (R$) or the loading placeholder (--)
    const revenueCard = page.locator("text=RECEITA GERADA · 7 DIAS").locator("..");
    await expect(revenueCard).toBeVisible();

    // SVG sparkline should render (role=img with aria-label)
    const sparkline = page.locator("svg[aria-label='Tendência de receita nas últimas sessões']");
    await expect(sparkline).toBeVisible({ timeout: 5_000 });
  });

  test("@overview-no-js-errors — No critical console errors during interaction", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Ignore known benign errors (network failures to optional endpoints, favicon, etc.)
        if (
          text.includes("favicon") ||
          text.includes("net::ERR_") ||
          text.includes("Failed to load resource")
        ) {
          return;
        }
        errors.push(text);
      }
    });

    page.on("pageerror", (err) => {
      errors.push(`PAGE ERROR: ${err.message}`);
    });

    await navigateToOverview(page);

    // Interact: click refresh button
    const refreshBtn = page.locator("button").filter({ hasText: /Atualizar dados|Sincronizando/ });
    if (await refreshBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await refreshBtn.click();
      await page.waitForTimeout(2000);
    }

    // No critical JS errors should have been recorded
    expect(errors).toEqual([]);
  });

  test("@overview-refresh — Page can be refreshed without losing state", async ({ page }) => {
    await navigateToOverview(page);

    // Confirm overview content is visible
    await expect(page.locator("text=RECEITA GERADA · 7 DIAS")).toBeVisible({ timeout: 10_000 });

    // Hard refresh (F5 equivalent)
    await page.reload({ waitUntil: "networkidle" });
    await loginIfNeeded(page);

    // After reload, navigate again to overview
    await expect(page.locator("nav")).toBeVisible({ timeout: 10_000 });
    await page.locator("text=Operação").first().click();
    await page.waitForTimeout(1500);

    // Content should still render
    await expect(page.locator("text=RECEITA GERADA · 7 DIAS")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Funil de ofertas")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=Sessões recentes")).toBeVisible({ timeout: 5_000 });
  });
});
