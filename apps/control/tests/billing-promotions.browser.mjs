import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// Local visual/interaction fixtures only. No provider or deployed API is contacted.
const output = path.resolve(process.argv[2] ?? "../../.audit/billing-promotions-preview");
await mkdir(output, { recursive: true });
const operator = { operator_id: "preview-admin", email: "admin@exemplo.test", role: "platform_admin" };
const plans = [{ id: "starter179", name: "Starter", monthlyPriceCents: 17900 }, { id: "growth", name: "Growth", monthlyPriceCents: 44900 }, { id: "scale", name: "Scale", monthlyPriceCents: 74900 }];
let records = Array.from({ length: 23 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  code: index === 0 ? "BLACKFRIDAY" : index === 1 ? "BEMVINDO20" : `CAMPANHA${String(index + 1).padStart(2, "0")}`,
  name: index === 0 ? "Black Friday" : index === 1 ? "Boas-vindas" : `Campanha de assinatura ${index + 1}`,
  discountType: index % 2 ? "fixed" : "percent", discountValue: index % 2 ? 2000 : 5000,
  duration: index === 0 ? "repeating" : "once", durationMonths: index === 0 ? 3 : null,
  plans: index % 2 ? ["starter179"] : ["starter179", "growth", "scale"],
  startsAt: "2026-10-15T03:00:00.000Z", expiresAt: "2026-11-30T23:59:00.000Z",
  maxRedemptions: index === 0 ? 100 : null, firstTimeOnly: false,
  enabled: index !== 1, provisioned: true, status: index === 1 ? "paused" : "active",
  timesRedeemed: index === 0 ? 12 : 0, stripeActive: index !== 1, livemode: false, createdAt: "2026-10-15T03:00:00.000Z",
}));
const calls = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
await context.addInitScript(({ operator }) => {
  sessionStorage.setItem("zyon.platform-control.session.v1", JSON.stringify({ token: "local-ui-fixture", operator }));
}, { operator });
await context.route("**/v1/**", async route => {
  const request = route.request(); const url = new URL(request.url());
  const respond = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname.endsWith("/platform/auth/me")) return respond(operator);
  if (!url.pathname.includes("/platform/billing/promotions")) return respond({ message: "Fonte fora desta prévia local" }, 503);
  calls.push({ method: request.method(), url: url.pathname + url.search, body: request.postDataJSON() });
  const identifier = url.pathname.split("/promotions/")[1];
  if (request.method() === "GET") {
    let items = records.filter(row => !row.deleted);
    const search = url.searchParams.get("search")?.toUpperCase();
    if (search) items = items.filter(row => `${row.code} ${row.name}`.toUpperCase().includes(search));
    const status = url.searchParams.get("status");
    if (status === "enabled") items = items.filter(row => row.enabled);
    if (status === "disabled") items = items.filter(row => !row.enabled);
    const type = url.searchParams.get("discountType"); if (type) items = items.filter(row => row.discountType === type);
    const plan = url.searchParams.get("plan"); if (plan) items = items.filter(row => row.plans.includes(plan));
    const page = Number(url.searchParams.get("page") ?? 1); const pageSize = Number(url.searchParams.get("pageSize") ?? 10);
    return respond({ items: items.slice((page - 1) * pageSize, page * pageSize), plans,
      policy: { maxMonths: 36, minChargeCents: 50 }, pagination: { page, pageSize, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) } });
  }
  if (request.method() === "POST" && !identifier) {
    const body = request.postDataJSON();
    const row = { ...body, enabled: true, provisioned: true, timesRedeemed: 0, status: "active", stripeActive: true, livemode: false, createdAt: "2026-10-15T03:00:00Z" };
    records.unshift(row); return respond(row, 201);
  }
  const row = records.find(row => row.id === identifier);
  if (!row) return respond({ message: "not_found" }, 404);
  if (request.method() === "PUT") { Object.assign(row, request.postDataJSON()); return respond(row); }
  if (request.method() === "PATCH") { row.enabled = request.postDataJSON().enabled; row.status = row.enabled ? "active" : "paused"; return respond(row); }
  if (request.method() === "DELETE") { row.deleted = true; row.enabled = false; return respond({ deleted: true }); }
  return respond({ message: "unexpected_request" }, 500);
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
process.on("uncaughtException", async error => { console.error(error.message); await page.screenshot({ path: path.join(output, "debug-failure.png"), fullPage: true }).catch(() => {}); await browser.close(); process.exit(1); });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.goto("http://127.0.0.1:5176/");
await page.getByRole("button", { name: "Cupons de assinatura", exact: true }).click();
await page.getByText("23 cupons · Página 1 de 3").waitFor();
await page.locator(".control-brand img").evaluate(image => image.decode());
assert.equal(await page.locator(".control-brand img").getAttribute("src"), "/zyon-z.png");
// Mark screenshots as a fixture-driven preview without changing the shipped UI.
await page.evaluate(() => {
  const badge = document.createElement("div"); badge.textContent = "PRÉVIA LOCAL · DADOS DEMONSTRATIVOS";
  Object.assign(badge.style, { position: "fixed", bottom: "8px", right: "8px", padding: "5px 8px", background: "#e9eee8", color: "#465347", border: "1px solid #bac5b8", borderRadius: "4px", font: "10px system-ui", zIndex: "9999", pointerEvents: "none" });
  document.body.append(badge);
});
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "page must not overflow horizontally");
await noOverflow();
await page.screenshot({ path: path.join(output, "cupons-lista-desktop.png"), fullPage: true });
await page.getByRole("button", { name: "Próxima", exact: true }).click();
await page.getByText("23 cupons · Página 2 de 3").waitFor();
await page.getByLabel("Por página").selectOption("25");
await page.getByText("23 cupons · Página 1 de 1").waitFor();
await page.getByLabel("Buscar cupom").fill("BLACKFRIDAY");
await page.getByRole("button", { name: "Filtrar", exact: true }).click();
await page.getByText("1 cupons · Página 1 de 1").waitFor();
assert.equal(await page.locator(".promotion-row").count(), 1);
await page.getByRole("button", { name: "Limpar", exact: true }).click();
await page.getByText("23 cupons · Página 1 de 1").waitFor();
await page.getByRole("button", { name: "Criar cupom", exact: true }).click();
await page.getByLabel(/^Código do cupom/).fill("TESTE-MANUAL");
await page.getByLabel("Tipo de desconto").selectOption("fixed");
await page.getByLabel("Valor do desconto (R$)", { exact: true }).fill("178");
await page.getByLabel("Data de início", { exact: true }).fill("2026-10-15T12:00");
await page.getByLabel("Data final", { exact: true }).fill("2026-10-22T23:59");
assert.equal(await page.locator(".promotion-presets").count(), 0);
await noOverflow();
await page.screenshot({ path: path.join(output, "cupons-criar-desktop.png"), fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForFunction(() => document.querySelector(".control-sidebar").getBoundingClientRect().right <= 0);
await noOverflow();
await page.screenshot({ path: path.join(output, "cupons-criar-mobile.png"), fullPage: true });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.getByText("Opções da assinatura e limites", { exact: false }).click();
await page.getByRole("checkbox", { name: /Growth/ }).uncheck();
await page.getByRole("checkbox", { name: /Scale/ }).uncheck();
await page.getByLabel("Limite total de usos", { exact: true }).fill("1");
await page.getByRole("button", { name: "Criar cupom", exact: true }).click();
await page.getByRole("status").filter({ hasText: "Cupom TESTE-MANUAL criado." }).waitFor();
const created = calls.find(call => call.method === "POST" && call.body?.code === "TESTE-MANUAL").body;
assert.equal(created.discountValue, 17800); assert.equal(created.duration, "once");
assert.deepEqual(created.plans, ["starter179"]); assert.equal(created.maxRedemptions, 1);
assert.equal(created.startsAt, "2026-10-15T15:00:00.000Z");
const ownRow = () => page.locator(".promotion-row").filter({ hasText: "TESTE-MANUAL" });
await ownRow().getByRole("button", { name: "Editar", exact: true }).click();
await page.getByLabel("Valor do desconto (R$)", { exact: true }).fill("177");
await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
await page.getByRole("status").filter({ hasText: "atualizado" }).waitFor();
assert.ok(calls.some(call => call.method === "PUT" && call.body?.discountValue === 17700));
await ownRow().getByRole("button", { name: "Desabilitar", exact: true }).click();
await ownRow().getByRole("button", { name: "Habilitar", exact: true }).waitFor();
await ownRow().getByRole("button", { name: "Habilitar", exact: true }).click();
await ownRow().getByRole("button", { name: "Desabilitar", exact: true }).waitFor();
await page.getByLabel(/^Status/).selectOption("disabled");
await page.getByRole("button", { name: "Filtrar", exact: true }).click();
await page.getByText("1 cupons · Página 1 de 1").waitFor();
assert.ok((await page.locator(".promotion-list").innerText()).includes("BEMVINDO20"));
await page.getByRole("button", { name: "Limpar", exact: true }).click();
await ownRow().getByRole("button", { name: "Excluir", exact: true }).click();
await ownRow().getByRole("button", { name: "Confirmar exclusão", exact: true }).click();
await page.getByRole("status").filter({ hasText: "excluído" }).waitFor();
await page.getByText("23 cupons · Página 1 de 1").waitFor();
assert.equal(await ownRow().count(), 0);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForFunction(() => document.querySelector(".control-sidebar").getBoundingClientRect().right <= 0);
await noOverflow();
await page.screenshot({ path: path.join(output, "cupons-lista-mobile.png"), fullPage: true });
assert.deepEqual(errors, []);
await browser.close();
console.log(JSON.stringify({ passed: ["server-filter-query", "pagination", "page-size", "create-fixed-cents", "edit", "disable", "enable", "delete-confirmation", "brasilia-timezone", "desktop-mobile-overflow", "no-shortcuts", "no-page-errors"], screenshots: output, providerWrites: 0, proof: "local_interaction_fixtures_only" }));
