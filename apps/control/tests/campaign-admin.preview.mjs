import { chromium } from "playwright";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

// Local UI fixtures only. Does not create or change any real coupon.
const require = createRequire(import.meta.url);
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const root = path.resolve(".");
const output = path.resolve("../../.audit/billing-promotions-production-20261015/evidence"); await mkdir(output, { recursive: true });
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0 } }); await server.listen();
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true });
const plans = [{ id: "starter179", name: "Starter", monthlyPriceCents: 17900 }, { id: "growth", name: "Growth", monthlyPriceCents: 44900 }, { id: "scale", name: "Scale", monthlyPriceCents: 74900 }];
const operator = { operator_id: "preview-admin", email: "admin@exemplo.test", role: "platform_admin" };
const saved = [], records = [], checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  await context.addInitScript(operator => sessionStorage.setItem("zyon.platform-control.session.v1", JSON.stringify({ token: "local-ui-fixture", operator })), operator);
  await context.route("**/v1/**", route => {
    const request = route.request(), url = new URL(request.url());
    const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/platform/auth/me")) return reply(operator);
    if (url.pathname.endsWith("/platform/billing/promotions")) {
      if (request.method() === "POST") {
        const body = request.postDataJSON(); saved.push(body);
        const row = { ...body, enabled: true, provisioned: true, timesRedeemed: 0, status: "active", stripeActive: true, livemode: false, createdAt: new Date().toISOString() }; records.unshift(row); return reply(row, 201);
      }
      return reply({ items: records, plans, policy: { maxMonths: 36, minChargeCents: 50 }, pagination: { page: 1, pageSize: 10, total: records.length, totalPages: 1 } });
    }
    return reply({ message: "outside_local_preview" }, 503);
  });
  const page = await context.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin); await page.getByRole("button", { name: "Cupons de assinatura", exact: true }).click();
  for (const scope of ["all", "specific"]) {
    await page.getByRole("button", { name: "Criar cupom", exact: true }).click();
    await page.getByLabel(/^Código do cupom/).fill(scope === "all" ? "BLACKFRIDAY" : "BLACKFRIDAY-GROWTH-SCALE");
    await page.getByLabel("Nome da campanha (opcional)", { exact: true }).fill("Black Friday");
    await page.getByLabel("Valor do desconto (%)", { exact: true }).fill("50");
    await page.getByLabel("Data de início", { exact: true }).fill("2026-10-15T00:00");
    await page.getByLabel("Data final", { exact: true }).fill("2026-12-01T00:00");
    assert.equal(await page.getByRole("checkbox", { name: /^Divulgar e aplicar automaticamente/ }).isChecked(), false);
    await page.getByRole("checkbox", { name: /^Divulgar e aplicar automaticamente/ }).check();
    if (scope === "specific") { await page.getByRole("radio", { name: "Planos específicos", exact: true }).check(); await page.getByRole("checkbox", { name: /^Starter/ }).uncheck(); }
    else assert.equal(await page.getByRole("radio", { name: /^Todos os planos pagos/ }).isChecked(), true);
    await page.getByText("Opções da assinatura e limites", { exact: false }).click();
    await page.getByLabel("Duração do desconto").selectOption("repeating"); await page.getByLabel("Quantidade de meses").fill("3");
    await page.screenshot({ path: path.join(output, `campanha-admin-${scope}-desktop.png`), fullPage: true });
    await page.locator(".promotion-campaign-settings").screenshot({ path: path.join(output, `campanha-admin-${scope}-opcoes.png`) });
    if (scope === "specific") {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator(".promotion-campaign-settings").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, "campanha-admin-specific-mobile.png"), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.setViewportSize({ width: 1440, height: 1100 });
    }
    await page.getByRole("button", { name: "Criar cupom", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "criado" }).waitFor();
    const body = saved.at(-1); assert.equal(body.autoApply, true); assert.equal(body.discountValue, 5000); assert.equal(body.durationMonths, 3);
    assert.deepEqual(body.plans, scope === "all" ? ["starter179", "growth", "scale"] : ["growth", "scale"]);
    checks.push({ scope, savedPlans: body.plans, autoApply: true, defaultPrivate: true, fixtureOnly: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "campaign-admin-preview.json"), JSON.stringify({ proof: "local_ui_fixture_no_real_writes", checks }, null, 2)); console.log(JSON.stringify(checks));
} finally { await browser.close(); await server.close(); }
