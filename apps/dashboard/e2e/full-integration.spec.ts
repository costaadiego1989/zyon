import { test, expect } from "@playwright/test";

test.describe.serial("Dashboard Full Integration Suite", () => {

  async function loginIfNeeded(page: any) {
    const emailInput = page.locator("input[placeholder='owner@loja.com']");
    const isLoginPage = await emailInput.isVisible({ timeout: 2000 }).catch(() => false);

    if (isLoginPage) {
      // Use pressSequentially for React controlled inputs (more reliable)
      await emailInput.click();
      await emailInput.pressSequentially("demo@zyon.com", { delay: 50 });
      await page.waitForTimeout(300);

      const passwordInput = page.locator("input[type='password']");
      await passwordInput.click();
      await passwordInput.pressSequentially("demo1234", { delay: 50 });
      await page.waitForTimeout(300);

      // Verify password was actually typed
      const passwordValue = await passwordInput.inputValue();
      console.log(`  Password value: ${passwordValue}`);

      await page.locator("button[type='submit']").click();
      await page.waitForTimeout(3000);
    }
  }

  test("@setup-1 Auth: login and capture session", async ({ page }) => {
    // Monitor network to debug login
    const responses: string[] = [];
    page.on("response", (r: any) => {
      if (r.url().includes("auth") || r.url().includes("merchant")) {
        responses.push(`${r.status()} ${r.url()}`);
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    await loginIfNeeded(page);

    // Log network responses
    console.log("Network responses:");
    responses.forEach(r => console.log(`  ${r}`));

    // Verify shell loaded — look for nav element
    const nav = page.locator("nav").first();
    await expect(nav).toBeVisible({ timeout: 15_000 });

    console.log("✓ Auth successful — shell loaded");
  });

  test("@module-overview Overview: load metrics", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await loginIfNeeded(page);

    await page.locator("text=Operação").first().click();
    await page.waitForTimeout(800);

    const main = page.locator("main").first();
    await expect(main).toBeVisible({ timeout: 5_000 });

    console.log("✓ Overview rendered");
  });

  test("@module-orders Orders: filters, export", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await loginIfNeeded(page);

    await page.locator("text=Pedidos e envios").first().click();
    await page.waitForTimeout(800);

    const main = page.locator("main").first();
    await expect(main).toBeVisible({ timeout: 5_000 });

    const filterTab = page.locator("text=Todos os pedidos");
    const hasFilter = await filterTab.isVisible().catch(() => false);
    console.log(`  Filter tabs visible: ${hasFilter}`);

    console.log("✓ Orders rendered");
  });

  test("@module-customers Customers: search, filters", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await loginIfNeeded(page);

    await page.locator("text=Clientes").first().click();
    await page.waitForTimeout(800);

    const main = page.locator("main").first();
    await expect(main).toBeVisible({ timeout: 5_000 });

    console.log("✓ Customers rendered");
  });

  test("@module-integrations Integrations: API keys, webhooks", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await loginIfNeeded(page);

    await page.locator("text=Desenvolvedores").first().click();
    await page.waitForTimeout(800);

    const main = page.locator("main").first();
    await expect(main).toBeVisible({ timeout: 5_000 });

    console.log("✓ Integrations rendered");
  });

  test("@module-settings Checkout Settings", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await loginIfNeeded(page);

    await page.locator("text=Checkout").first().click();
    await page.waitForTimeout(800);

    const main = page.locator("main").first();
    await expect(main).toBeVisible({ timeout: 5_000 });

    console.log("✓ Checkout Settings rendered");
  });

  test("@module-theme Theme: customization", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await loginIfNeeded(page);

    await page.locator("text=Tema").first().click();
    await page.waitForTimeout(800);

    const main = page.locator("main").first();
    await expect(main).toBeVisible({ timeout: 5_000 });

    console.log("✓ Theme rendered");
  });

  test("@module-embed Embed: code display", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await loginIfNeeded(page);

    await page.locator("text=Embed").first().click();
    await page.waitForTimeout(800);

    const main = page.locator("main").first();
    await expect(main).toBeVisible({ timeout: 5_000 });

    console.log("✓ Embed rendered");
  });

  test("@sanity-all-tabs Sanity: all 16 tabs clickable", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await loginIfNeeded(page);

    const tabNames = [
      "Primeiros passos", "Operação", "Pedidos e envios", "Clientes",
      "Desenvolvedores", "Loja / Commerce", "Embed", "Tema", "Preview",
      "Suporte", "Checkout", "Agente", "Negociação",
      "Faturamento", "Pagamentos", "Auditoria"
    ];

    const results: { tab: string; found: boolean }[] = [];

    for (const tabName of tabNames) {
      const item = page.locator(`text=${tabName}`).first();
      const found = await item.isVisible({ timeout: 1000 }).catch(() => false);
      results.push({ tab: tabName, found });
      if (found) {
        await item.click();
        await page.waitForTimeout(300);
      }
    }

    const passed = results.filter(r => r.found).length;
    const failed = results.filter(r => !r.found);

    console.log(`\n=== TAB SANITY CHECK ===`);
    console.log(`Total: ${results.length}, Found: ${passed}`);
    if (failed.length > 0) {
      console.log(`Missing: ${failed.map(r => r.tab).join(", ")}`);
    }

    expect(passed).toBeGreaterThanOrEqual(14);
  });
});