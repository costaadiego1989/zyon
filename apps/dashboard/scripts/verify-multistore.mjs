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
  assert.equal(await page.getByLabel("URL da loja", { exact: true }).count(), 0);
  const name = `Sandbox Validação ${Date.now()}`;
  await page.getByLabel("Nome da loja", { exact: true }).fill(name);
  const creation = page.waitForResponse(response => response.url().endsWith("/merchants/me/stores") && response.request().method() === "POST");
  let documents = 0;
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  await page.getByRole("button", { name: "Criar e configurar", exact: true }).click();
  const createdResponse = await creation;
  assert.equal(createdResponse.status(), 201);
  const created = await createdResponse.json();
  await page.waitForFunction(expected => document.querySelector(".merchant-store-switcher > button")?.textContent?.trim() === expected, name, { timeout: 30000 });
  assert.ok(documents > 0, "activation must reload the document, not only change hash");
  assert.equal(new URL(page.url()).hash, "#onboarding");
  await page.getByText("Identidade", { exact: true }).first().waitFor();
  assert.match(await page.locator('.onb-rail-step[aria-current="step"]').innerText(), /Etapa 01/);
  const current = await (await context.request.get(`${api}/v1/merchants/me`)).json();
  assert.equal((current.data ?? current).id, created.id);
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
  const accountProfile = page.waitForResponse(response => response.url().endsWith("/auth/me") && response.request().method() === "GET");
  await page.evaluate(() => { window.location.hash = "account-settings"; });
  assert.equal((await accountProfile).status(), 200, "account profile must remain available after switching stores");
  await page.getByLabel("Nome completo", { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByText("Dados pessoais indisponíveis", { exact: true }).count(), 0);
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ result: "PASS", dashboard, storeId: created.id, name, slug: created.slug,
    checks: ["name-only UI", "real creation", "full document reload", "new store header", "first onboarding step", "persist after reload", "switch root and back", "account profile after switch"] }));
} catch (error) {
  console.log(JSON.stringify({ pageErrors: failures, pageText: (await page.locator("body").innerText()).slice(0, 1500) }));
  throw error;
} finally {
  await browser.close();
}
