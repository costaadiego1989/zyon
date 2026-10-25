import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.REVENUE_UI_TEST_URL ?? "http://127.0.0.1:5188";
if (new URL(base).hostname !== "127.0.0.1") throw new Error("Controlled local dashboard only");
const out = process.env.REVENUE_UI_SCREENSHOT_DIR;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errors = [];
    let resumed = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      if (url.origin === base && !path.startsWith("/api/")) return route.continue();
      if (!["fetch", "xhr"].includes(req.resourceType())) return route.abort();
      if (req.method() !== "GET") throw new Error(`Unexpected mutation: ${path}`);
      let body = {};
      if (path.endsWith("/merchants/me")) body = { id: "fixture", name: "Loja de teste", user_id: "owner", role: "OWNER", plan: "BOTH" };
      else if (path.endsWith("/merchants/me/stores")) body = { data: [{ id: "fixture", name: "Loja de teste", slug: "fixture" }] };
      else if (path.endsWith("/onboarding")) body = { completed: true, steps: [] };
      else if (path.endsWith("/billing/subscription")) body = { plan: "scale", planKey: "scale", status: "active", effectivePlan: "scale", features: { revenueManager: true }, currentPeriodEnd: "2099-01-01T00:00:00Z" };
      else if (path.endsWith("/rules")) body = { autonomousEngineEnabled: true };
      else if (path.endsWith("/notifications")) body = { items: [] };
      else if (path.endsWith("/incentive-policy")) body = { merchantId: "fixture", version: 0, policyHash: "a".repeat(64), enabled: false, limitCents: 0, maxDiscountCents: 0, maxRedemptions: 0 };
      else if (path.endsWith("/analysis-status")) body = { mode: "weekly", enabled: true, generation_enabled: resumed,
        queue_available: true, next_eligible_at: "2026-10-03T06:00:00Z", last_successful_at: null, overdue: true,
        run: { id: "run-1", status: "deferred_budget", reason: "generation_disabled", result: null,
          createdAt: "2026-10-03T06:00:00Z", startedAt: "2026-10-03T06:00:00Z", completedAt: null, hypothesisId: null } };
      else if (["/observations", "/hypotheses", "/strategy-lessons"].some(suffix => path.endsWith(suffix))) body = [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/#revenue-manager`, { waitUntil: "networkidle" });
    const analysis = page.getByRole("region", { name: "Análise semanal" });
    try { await analysis.getByText("Geração de sugestões pausada", { exact: true }).waitFor({ timeout: 10000 }); }
    catch (error) { console.error(JSON.stringify({ body: await page.locator("body").innerText(), errors })); throw error; }
    assert.match(await analysis.innerText(), /pausada pela Zyon/);
    assert.doesNotMatch(await analysis.innerText(), /Prevista desde/);
    await page.getByText("Permitir sugestões para esta loja", { exact: true }).waitFor();
    assert.equal(await page.getByText("Geração de sugestões ativada", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Revisar estratégia" }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (out) await page.screenshot({ path: `${out}/weekly-paused-${width}.png`, fullPage: true });
    resumed = true;
    await page.reload({ waitUntil: "networkidle" });
    await analysis.getByText("Sua análise está na fila", { exact: true }).waitFor();
    await analysis.locator("summary").click();
    assert.match(await analysis.innerText(), /A geração foi retomada/);
    assert.doesNotMatch(await analysis.innerText(), /pausada pela Zyon/);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: platform pause, merchant permission, empty review, resumed state, no overflow or browser errors`);
    await page.close();
  }
} finally { await browser.close(); }
