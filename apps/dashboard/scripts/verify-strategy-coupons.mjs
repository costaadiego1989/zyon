import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.REVENUE_UI_TEST_URL ?? "http://127.0.0.1:5189";
if (new URL(base).hostname !== "127.0.0.1") throw new Error("Local controlled dashboard only");
const out = process.env.REVENUE_UI_SCREENSHOT_DIR;
if (out) await mkdir(out, { recursive: true });
const code = "ZYON0123456789ABCDEF0123";
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultNavigationTimeout(120000);
    const errors = [], mutations = [];
    let managedState = "active";
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      if (url.origin === base && !path.startsWith("/api/")) return route.continue();
      if (!["fetch", "xhr"].includes(req.resourceType())) return route.abort();
      let body = {};
      if (path.endsWith("/merchants/me")) body = { id: "merchant-fixture", name: "Loja", user_id: "owner", role: "OWNER", plan: "BOTH" };
      else if (path.endsWith("/merchants/me/stores")) body = { data: [{ id: "merchant-fixture", name: "Loja", slug: "fixture" }] };
      else if (path.endsWith("/onboarding")) body = { completed: true, steps: [] };
      else if (path.endsWith("/billing/subscription")) body = { plan: "scale", planKey: "scale", status: "active", effectivePlan: "scale", features: { revenueManager: true }, currentPeriodEnd: "2099-01-01T00:00:00Z" };
      else if (path.endsWith("/notifications")) body = { items: [] };
      else if (path.endsWith("/merchant/coupons")) body = [
        { id: "managed", code, discount_type: "fixed", discount_value: 10, strategy_incentive_execution_id: "execution-1",
          strategy_incentive_state: managedState, status: managedState === "active" ? "active" : ["ended", "closed"].includes(managedState) ? "expired" : "paused",
          max_usages: 30, usages_count: 2, starts_at: "2026-10-05T12:00:00Z", ends_at: "2099-10-12T12:00:00Z" },
        { id: "manual", code: "MANUAL10", discount_type: "percent", discount_value: 10, status: "active" },
      ];
      else if (path.includes("/merchant/coupons/") && req.method() !== "GET") mutations.push(path);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/#coupons`, { waitUntil: "domcontentloaded" });
    const managed = page.getByRole("article", { name: `Cupom ${code}`, exact: true });
    await managed.getByText(/Gerenciado pela estratégia de IA/).waitFor();
    assert.equal(await managed.getByRole("button", { name: /Pausar|Ativar|Arquivar/ }).count(), 0);
    assert.equal(await managed.getByRole("link", { name: "Ver estratégias da IA" }).getAttribute("href"), "#revenue-manager");
    await managed.getByText("Consulte os resultados da estratégia", { exact: true }).waitFor();
    await page.getByRole("article", { name: "Cupom MANUAL10", exact: true }).getByRole("button", { name: "Pausar cupom MANUAL10", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Overflow at ${width}px`);
    assert.deepEqual(mutations, []);
    assert.deepEqual(errors, []);
    if (out) await managed.screenshot({ path: `${out}/strategy-coupon-list-${width}.png` });
    for (const [state, label, filter] of [["capacity_reached", "Limite atingido", "Sem novas ofertas"], ["ended", "Encerrado", "Encerrados"]]) {
      managedState = state;
      await page.reload({ waitUntil: "domcontentloaded" });
      await managed.getByText(label, { exact: true }).waitFor();
      assert.equal(await managed.getByText("Ativo", { exact: true }).count(), 0);
      const filters = page.getByRole("group", { name: "Filtrar resultados", exact: true });
      await filters.getByRole("button", { name: "Ativos", exact: true }).click();
      await managed.waitFor({ state: "hidden" });
      await filters.getByRole("button", { name: filter, exact: true }).click();
      await managed.getByText(label, { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      if (out) await managed.screenshot({ path: `${out}/strategy-coupon-${state}-${width}.png` });
    }
    console.log(`PASS ${width}px: managed coupon visibility, restricted controls, strategy navigation, capacity/expiry states and filters, manual coupon controls (controlled API)`);
    await page.close();
  }
} finally { await browser.close(); }
