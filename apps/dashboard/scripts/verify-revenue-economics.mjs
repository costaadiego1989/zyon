import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.REVENUE_UI_TEST_URL ?? "http://127.0.0.1:5186";
if (new URL(base).hostname !== "127.0.0.1") throw new Error("Use a local dashboard; API responses are simulated.");
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let enoughData = true;
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === base && !url.pathname.startsWith("/api/")) return route.continue();
      if (!["fetch", "xhr"].includes(request.resourceType())) return route.abort();
      const path = url.pathname;
      let body = {};
      if (path.endsWith("/merchants/me")) body = { id: "merchant-fixture", name: "Loja de teste", user_id: "owner", role: "OWNER", plan: "BOTH" };
      else if (path.endsWith("/onboarding")) body = { completed: true, steps: [] };
      else if (path.endsWith("/billing/subscription")) body = { plan: "scale", planKey: "scale", status: "active", effectivePlan: "scale", features: { revenueManager: true, revenueLift: true }, currentPeriodEnd: "2099-01-01T00:00:00Z" };
      else if (path.endsWith("/rules")) body = { autonomousEngineEnabled: true };
      else if (path.endsWith("/notifications")) body = { items: [] };
      else if (path.endsWith("/analytics/revenue-lift")) body = {
        periodDays: 30, holdout: { sessions: enoughData ? 30 : 2, orders: 10, revenueCents: 10000, avgRevenueCents: 333.33 },
        treatment: { sessions: 600, orders: 150, revenueCents: 220000, avgRevenueCents: 366.67 },
        lift: { grossLiftPercent: enoughData ? 10 : null, netLiftCents: null, roiPercent: null },
        estimatedRevenueDifferenceCents: enoughData ? 20000 : null, aiCostCents: null, recordedAiCostCents: 5000,
        contribution: { status: "unavailable", contributionCents: null, missingComponents: ["productCostCents"], invalidComponents: [] },
        dataQuality: { status: enoughData ? "ready" : "insufficient_data", minimumCohortSessions: 30,
          sources: { checkoutSessions: "measured", completedOrders: "measured", attributionTags: "partial" },
          missingMetrics: enoughData ? [] : ["holdout_session_sample"] }, featureBreakout: [],
      };
      else if (path.includes("/analytics/revenue-lift/trend")) body = { periodDays: 30, trend: [] };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/#revenue-lift`, { waitUntil: "domcontentloaded" });
    await page.getByText("Variação estimada de receita", { exact: true }).waitFor({ timeout: 20000 }).catch(async error => {
      console.error((await page.locator("body").innerText()).slice(0, 2200));
      console.error(errors);
      throw error;
    });
    await page.getByText("+10.0%", { exact: true }).waitFor();
    await page.getByText("R$ 200,00", { exact: true }).waitFor();
    for (const label of ["Contribuição", "Custo IA"]) {
      const card = page.locator(".stat-card").filter({ has: page.getByText(label, { exact: true }) });
      assert.match(await card.innerText(), /—/);
    }
    assert.equal(await page.getByText("Retorno", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (process.env.REVENUE_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.REVENUE_UI_SCREENSHOT_DIR}/economics-${width}.png`, fullPage: true });
    enoughData = false;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/Dados insuficientes para calcular impacto/).waitFor();
    assert.equal(await page.getByText("+10.0%", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: estimated revenue, unavailable costs/contribution, insufficient data and no overflow (mock API)`);
    await page.close();
  }
} finally { await browser.close(); }
