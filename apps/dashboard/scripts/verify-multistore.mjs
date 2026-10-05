// Exercises real HTTP endpoints and the actual dashboard. No API mocks.
// Credentials must belong to the specified environment. Never copies local cookies.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const dashboard = process.env.MULTISTORE_DASHBOARD_URL ?? "http://localhost:5185";
const api = process.env.MULTISTORE_API_URL ?? "http://localhost:3019";
const email = process.env.MULTISTORE_TEST_EMAIL;
const password = process.env.MULTISTORE_TEST_PASSWORD;
assert.ok(email && password, "Environment-specific test credentials required");
assert.ok(["localhost", "127.0.0.1", "dashboard-sandbox-59d9.up.railway.app"].includes(new URL(dashboard).hostname), "Only local or the explicit sandbox dashboard");
assert.ok(["localhost", "127.0.0.1", "api-sandbox-8146.up.railway.app"].includes(new URL(api).hostname), "Only local or the explicit sandbox API");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const failures = [];
page.on("pageerror", error => failures.push(error.message));
page.on("response", response => {
  if (response.status() >= 400) console.log(JSON.stringify({ status: response.status(), path: new URL(response.url()).pathname }));
});
try {
  const login = await context.request.post(`${api}/v1/auth/login`, { data: { email, password } });
  assert.equal(login.status(), 201, "official environment login");
  const profile = await (await context.request.get(`${api}/v1/merchants/me`)).json();
  const root = profile.data ?? profile;
  await page.goto(dashboard, { waitUntil: "domcontentloaded" });
  const trigger = page.locator(".merchant-store-switcher > button");
  await trigger.waitFor({ timeout: 30000 });
  assert.equal((await trigger.textContent()).trim(), root.name);
  await trigger.click();
  await page.getByRole("button", { name: "Criar nova loja", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Criar nova loja" });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel("URL da loja", { exact: true }).count(), 0);
  const name = `Sandbox Validação ${Date.now()}`;
  await dialog.getByLabel("Nome da loja", { exact: true }).fill(name);
  await dialog.getByLabel("CNPJ", { exact: true }).fill("11.444.777/0001-61");
  await dialog.getByLabel("E-mail comercial", { exact: true }).fill("contato@sandbox-validation.example");
  await dialog.getByLabel("Celular", { exact: true }).fill("(11) 99999-9999");
  assert.match(await dialog.getByRole("button", { name: "Tipo da loja" }).innerText(), /Eletrônicos & Tecnologia/);
  const creation = page.waitForResponse(response => response.url().endsWith("/merchants/me/stores") && response.request().method() === "POST");
  let documents = 0;
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  await dialog.getByRole("button", { name: "Criar e abrir primeiros passos", exact: true }).click();
  const createdResponse = await creation;
  assert.equal(createdResponse.status(), 201);
  const created = await createdResponse.json();
  assert.deepEqual(JSON.parse(createdResponse.request().postData() ?? "{}"), {
    name, cnpj: "11.444.777/0001-61", email: "contato@sandbox-validation.example", phone: "(11) 99999-9999", storeCategory: "electronics",
  });
  await page.waitForFunction(expected => document.querySelector(".merchant-store-switcher > button")?.textContent?.trim() === expected, name, { timeout: 30000 });
  assert.ok(documents > 0, "activation must reload the document, not only change hash");
  assert.equal(new URL(page.url()).hash, "#onboarding");
  await page.getByText("Identidade", { exact: true }).first().waitFor();
  assert.match(await page.locator('.onb-rail-step[aria-current="step"]').innerText(), /Etapa 01/);
  const current = await (await context.request.get(`${api}/v1/merchants/me`)).json();
  assert.equal((current.data ?? current).id, created.id);
  assert.equal((current.data ?? current).storeCategory, "electronics");
  const settings = await (await context.request.get(`${api}/v1/merchants/me/store-settings`)).json();
  assert.deepEqual(settings.company, {
    razaoSocial: name, cnpj: "11444777000161", email: "contato@sandbox-validation.example", phone: "11999999999",
  });
  const state = await (await context.request.get(`${api}/v1/onboarding`)).json();
  assert.equal(state.merchant_id, created.id);
  assert.equal(state.steps.find(step => step.id === "checkout_config").status, "pending");
  await page.reload({ waitUntil: "domcontentloaded" });
  await trigger.waitFor();
  assert.equal((await trigger.textContent()).trim(), name);
  await trigger.click();
  await page.getByRole("dialog", { name: "Trocar loja" }).getByRole("button", { name: root.name }).click();
  await page.waitForFunction(expected => document.querySelector(".merchant-store-switcher > button")?.textContent?.trim() === expected, root.name);
  await trigger.click();
  await page.getByRole("dialog", { name: "Trocar loja" }).getByRole("button", { name }).click();
  await page.waitForFunction(expected => document.querySelector(".merchant-store-switcher > button")?.textContent?.trim() === expected, name);
  const dashboardReads = await Promise.all(Array.from({ length: 61 }, () => context.request.get(`${api}/v1/merchants/me`)));
  assert.ok(dashboardReads.every(response => response.status() === 200), "normal authenticated reads must not exhaust the post-switch tenant quota");
  const erpConnections = await context.request.get(`${api}/v1/dashboard/inventory/erp-connections`);
  assert.equal(erpConnections.status(), 200, "ERP screen must remain available after post-switch dashboard reads");
  const accountProfile = page.waitForResponse(response => response.url().endsWith("/auth/me") && response.request().method() === "GET");
  await page.evaluate(() => { window.location.hash = "account-settings"; });
  assert.equal((await accountProfile).status(), 200, "account profile must remain available after switching stores");
  await page.getByLabel("Nome completo", { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByText("Dados pessoais indisponíveis", { exact: true }).count(), 0);
  // Simulate the exact refusal observed from Bling, through the real signed
  // callback and dashboard. No provider credentials or token exchange.
  const beforeErp = await (await context.request.get(`${api}/v1/dashboard/inventory/erp-connections`)).json();
  const authorization = await context.request.get(`${api}/v1/inventory/erp/oauth/bling/authorize`);
  assert.equal(authorization.status(), 200);
  const providerUrl = new URL((await authorization.json()).url);
  const callback = new URL(`${api}/v1/inventory/erp/oauth/callback`);
  callback.search = new URLSearchParams({ state: providerUrl.searchParams.get("state"), error: "FORBIDDEN" }).toString();
  const rejection = await context.request.get(callback.toString(), { maxRedirects: 0 });
  assert.equal(rejection.status(), 302);
  const returnUrl = new URL(rejection.headers().location);
  assert.equal(returnUrl.origin, new URL(dashboard).origin);
  assert.equal(returnUrl.searchParams.get("error"), "erp_permission_denied");
  await page.goto(returnUrl.toString(), { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Conectores ERP" }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "Conectores ERP" }).getAttribute("aria-selected"), "true");
  await page.getByRole("alert").filter({ hasText: "Bling recusou a autorização" }).waitFor();
  assert.equal((await trigger.textContent()).trim(), name, "Bling refusal must keep the selected child store");
  assert.equal(new URL(page.url()).hash, "#inventory");
  assert.equal(new URL(page.url()).searchParams.has("error"), false);
  assert.deepEqual(await (await context.request.get(`${api}/v1/dashboard/inventory/erp-connections`)).json(), beforeErp);
  console.log(JSON.stringify({ result: "PASS", checks: ["Bling FORBIDDEN callback", "persistent permission guidance", "ERP tab restored", "child-store session preserved", "ERP connections unchanged"] }));
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ result: "PASS", dashboard, storeId: created.id, name, slug: created.slug,
    checks: ["commercial profile modal", "parent category prefill", "real creation", "stored commercial profile", "full document reload", "new store header", "first onboarding step", "persist after reload", "switch root and back", "account profile after switch"] }));
} catch (error) {
  console.log(JSON.stringify({ pageErrors: failures, pageText: (await page.locator("body").innerText()).slice(0, 1500) }));
  throw error;
} finally {
  await browser.close();
}
