import { chromium } from "playwright";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(new URL("../../dashboard/package.json", import.meta.url));
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const root = path.resolve("../dashboard");
const output = path.resolve("../../.audit/billing-promotions-production-20261015/evidence"); await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { host: "127.0.0.1", port: 0 } }); await server.listen();
const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ headless: true }); const checks = [];
try {
  for (const [name, width, height] of [["desktop", 1440, 1100], ["mobile", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: "pt-BR", reducedMotion: "reduce" });
    for (const view of ["signup", "dashboard"]) {
      const page = await context.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${origin}/tests/coupon-preview.html${view === "dashboard" ? "?dashboard" : ""}`);
      await page.locator('[data-plan-key="growth"] .billing-promotion-terms').waitFor();
      const field = page.getByLabel("Cupom de assinatura", { exact: false });
      assert.equal(await field.isVisible(), false);
      assert.ok((await page.locator('[data-plan-key="growth"] .billing-plan-details__price').innerText()).includes("224,50"));
      if (view === "signup") {
        assert.equal(await page.locator("[data-plan-key]").count(), 4);
        assert.equal(await page.getByRole("radio", { name: "Selecionar Starter", exact: true }).isChecked(), true);
        assert.ok((await page.locator(".plan-selection__footer").innerText()).includes("89,50"));
        await page.getByRole("radio", { name: "Selecionar Growth", exact: true }).check();
        assert.ok((await page.locator(".plan-selection__footer").innerText()).includes("224,50"));
        await page.getByRole("radio", { name: "Selecionar Free", exact: true }).check();
        assert.equal(await field.count(), 0);
        await page.getByRole("radio", { name: "Selecionar Starter", exact: true }).check();
        assert.equal(await field.inputValue(), "");
        await page.getByRole("button", { name: /Confirmar Starter no Stripe/ }).click();
        assert.deepEqual(await page.evaluate(() => window.lastPreviewCheckout), { plan: "starter179", billingCycle: "monthly", promotionCode: "BLACKFRIDAY" });
        await page.reload(); await page.locator(".billing-promotion-applied").waitFor();
      }
      await page.locator(view === "signup" ? ".billing-promotion-applied" : '[data-plan-key="growth"]').scrollIntoViewIfNeeded();
      if (view === "signup") { await page.locator(".plan-selection__header").scrollIntoViewIfNeeded(); }
      await page.screenshot({ path: path.join(output, `blackfriday-app-${view}-${name}-automatico.png`) });
      if (view === "signup" && name === "desktop") {
        await page.locator("[data-plan-key='scale']").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, "blackfriday-app-signup-scale-desktop.png") });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []); checks.push({ view, viewport: name, noCodeEntryRequired: true, noOverflow: true, ...(view === "signup" ? { plansVisibleInComparison: 4, initialPlanSelected: true, automaticCodeSentWithCheckout: true, freeHidesPromotion: true } : {}), fixtureOnly: true }); await page.close();
    }
    await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(`${origin}/tests/coupon-preview.html?specific`);
  await page.locator('[data-plan-key="growth"] .billing-promotion-terms').waitFor();
  assert.equal(await page.locator('[data-plan-key="starter179"] .billing-promotion-terms').count(), 0);
  assert.ok((await page.locator('[data-plan-key="starter179"] .billing-plan-details__price').innerText()).includes("179,00"));
  await page.getByRole("radio", { name: "Selecionar Growth", exact: true }).check();
  await page.locator(".billing-promotion-applied").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "blackfriday-app-planos-especificos.png") });
  checks.push({ scope: "specific", starterFullPrice: true, growthDiscounted: true, fixtureOnly: true }); await page.close();
  await writeFile(path.join(output, "coupon-app-preview.json"), JSON.stringify({ proof: "local_visual_fixture_not_provider_validation", checks }, null, 2)); console.log(JSON.stringify(checks));
} finally { await browser.close(); await server.close(); }
