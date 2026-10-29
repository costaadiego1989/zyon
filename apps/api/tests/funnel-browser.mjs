import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFunnelDatabase } from "./funnel-database-fixture.ts";
import { GetFunnelUseCase } from "../src/modules/checkout/application/use-cases/get-funnel.use-case.ts";
import { GetFunnelSessionsUseCase } from "../src/modules/checkout/application/use-cases/get-funnel-sessions.use-case.ts";
import { GetStorefrontFunnelUseCase } from "../src/modules/storefront/application/use-cases/get-storefront-funnel.use-case.ts";
import { GetStorefrontLiveSessionsUseCase } from "../src/modules/storefront/application/use-cases/get-storefront-live-sessions.use-case.ts";
import { PrismaStorefrontTelemetryRepository } from "../src/modules/storefront/infrastructure/repositories/prisma-storefront-telemetry.repository.ts";
const requireDashboard = createRequire(new URL("../../dashboard/package.json", import.meta.url));
const { chromium, expect } = requireDashboard("@playwright/test");
const { createServer } = await import(pathToFileURL(requireDashboard.resolve("vite")).href);
const fixture = await createFunnelDatabase();
const { db, merchantId, otherMerchant } = fixture;
const checkout = new GetFunnelUseCase(db);
const store = new GetStorefrontFunnelUseCase(db);
const liveCheckout = new GetFunnelSessionsUseCase(db);
const liveStore = new GetStorefrontLiveSessionsUseCase(new PrismaStorefrontTelemetryRepository(db));
const output = fileURLToPath(new URL("../../dashboard/test-results/funnel-audit/", import.meta.url));
await fs.mkdir(output, { recursive: true });
const controls = { delay: 0, failFunnel: false, failSessions: false, requests: [] };
const vite = await createServer({
  root: fileURLToPath(new URL("../../dashboard/", import.meta.url)),
  server: { host: "127.0.0.1", port: 5186, strictPort: true },
  plugins: [{ name: "funnel-audit-local-api", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, "http://127.0.0.1:5186");
      if (!url.pathname.startsWith("/audit-api/")) return next();
      const match = url.pathname.match(/^\/audit-api\/v1\/(checkout|storefront)\/funnel\/([^/]+)(\/sessions)?$/);
      res.setHeader("Content-Type", "application/json");
      if (!match) { res.statusCode = 404; return res.end("{}"); }
      const [, source, merchant, sessions] = match;
      const delay = source === "storefront" ? controls.delay : 0;
      const fail = sessions ? controls.failSessions : controls.failFunnel;
      controls.requests.push(url.pathname + url.search);
      try {
        const data = sessions
          ? await (source === "storefront" ? liveStore : liveCheckout).execute(merchant)
          : await (source === "storefront" ? store : checkout).execute(merchant, url.searchParams.get("period") ?? "7d", {
              breakdown: url.searchParams.get("breakdown") === "none" ? undefined : url.searchParams.get("breakdown") ?? undefined,
              compare: url.searchParams.get("compare") === "true",
              range: url.searchParams.has("from") ? { from: url.searchParams.get("from"), to: url.searchParams.get("to") } : undefined,
            });
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (fail) { res.statusCode = 503; return res.end(JSON.stringify({ message: "private_database_details" })); }
        res.end(JSON.stringify(data));
      } catch (error) { res.statusCode = error.getStatus?.() ?? 500; res.end(JSON.stringify({ message: error.message })); }
    });
  } }],
});
await vite.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const checks = [];
async function check(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
const url = "http://127.0.0.1:5186/e2e/fixtures/funnel.html?merchant=" + merchantId;
try {
  await page.goto(url);
  await check("store journey uses persisted signup data and leaves login visible", async () => {
    await expect(page.locator(".fnl-chart-conversion")).toHaveText("50.0% conversão");
    await expect(page.locator(".fnl-bar-label", { hasText: "Login realizado" })).toBeVisible();
    const opacity = await page.locator(".fnl-bar", { hasText: "Login realizado" }).evaluate(el => Number(getComputedStyle(el).opacity));
    assert.ok(opacity >= 0.35);
  });
  await check("checkout shows paid conversion, exclusive card segmentation and correct CSV percentages", async () => {
    await page.getByRole("tab", { name: "Jornada do Checkout", exact: true }).click();
    await expect(page.locator(".fnl-chart-conversion")).toHaveText("50.0% conversão");
    await page.getByLabel("Segmentação").selectOption("payment_method");
    await expect(page.locator(".fnl-breakdown-item", { hasText: "Cartão" })).toContainText("100.0%");
    await expect(page.locator(".fnl-breakdown-item", { hasText: "Não informado" })).toBeVisible();
    await expect(page.locator(".fnl-bar-drop")).toHaveCount(1);
    await expect(page.locator(".fnl-bar-drop")).toHaveText("↓ 50% saiu");
    const download = page.waitForEvent("download");
    await page.getByTitle("Exportar CSV").click();
    const csv = await download;
    await csv.saveAs(output + "/checkout.csv");
    const content = await fs.readFile(output + "/checkout.csv", "utf8");
    assert.match(content, /"Frete selecionado","2","100.0","50.0"/);
    assert.ok(!content.includes("5000.0"));
    assert.ok(!(await page.locator("body").innerText()).includes("Intent Memory detecta"));
    await page.screenshot({ path: output + "/checkout-desktop.png", fullPage: true });
  });
  await check("period comparison and date filter use the same API contract", async () => {
    await page.getByLabel("Comparar período anterior").check();
    await expect(page.getByText("+50.0 p.p. vs. período anterior")).toBeVisible();
    await page.getByLabel("Data inicial").fill(fixture.range.from);
    await expect(page.getByText("Informe a data inicial e a data final.")).toBeVisible();
    await expect(page.getByTitle("Exportar CSV")).toBeDisabled();
    await page.getByLabel("Data final").fill(fixture.range.to);
    await expect(page.locator(".fnl-chart-conversion")).toHaveText("50.0% conversão");
    assert.ok(controls.requests.some(r => r.includes("from=" + fixture.range.from + "&to=" + fixture.range.to)));
  });
  await check("late responses cannot restore the previous source or tenant", async () => {
    controls.delay = 900;
    await page.getByRole("tab", { name: "Jornada da Loja", exact: true }).click();
    await expect.poll(() => controls.requests.filter(r => r.includes("/storefront/")).length).toBeGreaterThan(2);
    await page.getByRole("tab", { name: "Jornada do Checkout", exact: true }).click();
    await expect(page.locator(".fnl-bar-label", { hasText: "Pagamento concluído" })).toBeVisible();
    await page.waitForTimeout(1100);
    await expect(page.locator(".fnl-bar-label", { hasText: "Pagamento concluído" })).toBeVisible();
    await expect(page.locator("tbody")).not.toContainText("conv_");
    await page.evaluate(id => window.setAuditMerchant(id), otherMerchant);
    await expect(page.locator(".fnl-chart-conversion")).toHaveText("100.0% conversão");
    await page.evaluate(id => window.setAuditMerchant(id), merchantId);
    await expect(page.locator(".fnl-chart-conversion")).toHaveText("50.0% conversão");
    controls.delay = 0;
  });
  await check("API failures hide stale numbers, sanitize errors and allow retry", async () => {
    controls.failFunnel = true;
    controls.failSessions = true;
    await page.getByRole("button", { name: "30 dias", exact: true }).click();
    await expect(page.getByText("Não foi possível carregar o funil. Tente novamente.")).toBeVisible();
    await expect(page.locator(".fnl-chart-card")).toHaveCount(0);
    await expect(page.getByTitle("Exportar CSV")).toBeDisabled();
    assert.ok(!(await page.locator("body").innerText()).includes("private_database_details"));
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(page.getByText("Não foi possível atualizar as sessões recentes.")).toBeVisible();
    controls.failFunnel = false;
    controls.failSessions = false;
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(page.locator(".fnl-chart-conversion")).toHaveText("50.0% conversão");
  });
  await check("mobile dashboard has no page overflow and controls remain usable", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTitle("Exportar CSV")).toBeEnabled();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: output + "/checkout-mobile.png", fullPage: true });
    await page.getByLabel("Segmentação").selectOption("device");
    await expect(page.locator(".fnl-breakdown-item", { hasText: "Mobile" })).toContainText("100.0%");
    await page.locator(".fnl-chart-card").scrollIntoViewIfNeeded();
    const checkboxSize = await page.getByLabel("Comparar período anterior").boundingBox();
    assert.ok(checkboxSize.width <= 20 && checkboxSize.height <= 20);
    assert.ok(await page.locator(".fnl-bar").evaluateAll(bars => bars.every(bar => {
      const label = bar.querySelector(".fnl-bar-label").getBoundingClientRect();
      const count = bar.querySelector(".fnl-bar-count").getBoundingClientRect();
      return label.right + 4 <= count.left && label.bottom <= bar.getBoundingClientRect().bottom;
    })));
    await page.screenshot({ path: output + "/checkout-mobile-chart.png", fullPage: true });
    await page.locator("tbody tr").last().scrollIntoViewIfNeeded();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  });
  assert.deepEqual(errors, []);
  await fs.writeFile(output + "/result.json", JSON.stringify({ checks, runtimeErrors: errors, database: "disposable-local", transport: "local HTTP adapter with real Prisma use cases; authentication verified separately" }, null, 2));
} catch (error) {
  await page.screenshot({ path: output + "/failure.png", fullPage: true });
  console.error("Browser runtime errors:", errors);
  throw error;
} finally { await browser.close(); await vite.close(); await db.$disconnect(); }
