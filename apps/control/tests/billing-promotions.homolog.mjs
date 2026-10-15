import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const adminUrl = "https://zyon-control-84mfslcp8-diegos-projects-b6fd2a25.vercel.app";
const api = "https://api-sandbox-8146.up.railway.app";
const output = path.resolve("../../.audit/billing-promotions-homolog");
await mkdir(output, { recursive: true });
const credential = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "$c=Import-Clixml -LiteralPath (Join-Path $env:LOCALAPPDATA 'Zyon\\homolog\\admin.credential.xml');[pscustomobject]@{email=$c.UserName;password=$c.GetNetworkCredential().Password}|ConvertTo-Json -Compress"], { encoding: "utf8" });
if (credential.status !== 0) throw new Error("local_encrypted_credential_unavailable");
const login = JSON.parse(credential.stdout);
const vercelCli = path.join(process.env.APPDATA, "npm/node_modules/vercel/dist/index.js");
const oidcResult = spawnSync(process.execPath, [vercelCli, "project", "token", "zyon-control", "--scope", "diegos-projects-b6fd2a25"], { encoding: "utf8" });
const oidc = oidcResult.stdout.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
if (!oidc) throw new Error("preview_oidc_unavailable");
const requireApi = createRequire(new URL("../../api/package.json", import.meta.url));
const Stripe = requireApi("stripe"); const dotenv = requireApi("dotenv");
const localEnv = dotenv.parse(await readFile("C:/Users/Admin/Desktop/AACP/.env"));
assert.ok(localEnv.STRIPE_SECRET_KEY_TEST?.startsWith("sk_test_"));
const stripe = new Stripe(localEnv.STRIPE_SECRET_KEY_TEST, { timeout: 15000, maxNetworkRetries: 0 });
assert.equal((await stripe.accounts.retrieve()).id, "acct_1TVJ9KPvEQVo3vcN");
assert.equal((await fetch(`${api}/ready`)).status, 200);
assert.equal((await fetch(`${api}/v1/platform/billing/promotions`)).status, 401);
let corsReady = false;
for (let attempt = 0; attempt < 24; attempt++) {
  const preflight = await fetch(`${api}/v1/platform/auth/login`, { method: "OPTIONS", headers: { Origin: adminUrl, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type" } });
  if (preflight.headers.get("access-control-allow-origin") === adminUrl) { corsReady = true; break; }
  await new Promise(resolve => setTimeout(resolve, 10000));
}
assert.ok(corsReady, "sandbox_cors_not_ready");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
await context.route(`${adminUrl}/**`, route => route.continue({ headers: { ...route.request().headers(), "x-vercel-trusted-oidc-idp-token": oidc } }));
const page = await context.newPage(); page.setDefaultTimeout(45000);
const errors = []; page.on("pageerror", error => errors.push(error.message));
const checks = ["api-ready", "unauthenticated-guard-401"];
let token;
async function request(path, init = {}) {
  const response = await fetch(`${api}/v1/platform/billing/promotions${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers } });
  const body = await response.json(); assert.ok(response.ok, `sandbox_api_status_${response.status}`); return body;
}
async function filter(code) {
  await page.getByLabel("Buscar cupom").fill(code);
  await page.getByRole("button", { name: "Filtrar", exact: true }).click();
  await page.getByRole("button", { name: `Copiar código ${code}`, exact: true }).waitFor();
}
const row = code => page.locator(".promotion-row").filter({ hasText: code });
const dateValue = date => new Date(date.getTime() - 3 * 3600000).toISOString().slice(0, 16);
async function form(code, type, value, starterOnly = false) {
  await page.getByRole("button", { name: "Criar cupom", exact: true }).click();
  await page.getByLabel(/^Código do cupom/).fill(code);
  await page.getByLabel("Nome da campanha (opcional)", { exact: true }).fill(starterOnly ? "Teste de assinatura Starter por R$1" : "QA CRUD homologação");
  await page.getByLabel("Tipo de desconto").selectOption(type);
  await page.getByLabel(type === "fixed" ? "Valor do desconto (R$)" : "Valor do desconto (%)", { exact: true }).fill(value);
  await page.getByLabel("Data de início", { exact: true }).fill(dateValue(new Date(Date.now() - 60000)));
  await page.getByLabel("Data final", { exact: true }).fill(dateValue(new Date(Date.now() + 7 * 86400000)));
  if (starterOnly) {
    await page.getByText("Opções da assinatura e limites", { exact: false }).click();
    await page.getByRole("checkbox", { name: /Growth/ }).uncheck(); await page.getByRole("checkbox", { name: /Scale/ }).uncheck();
    await page.getByLabel("Limite total de usos", { exact: true }).fill("1");
  }
}
try {
  await page.goto(adminUrl);
  await page.getByLabel("E-mail", { exact: true }).fill(login.email);
  await page.getByLabel("Senha", { exact: true }).fill(login.password);
  const loginResponse = page.waitForResponse(response => response.url().endsWith("/platform/auth/login") && response.request().method() === "POST");
  await page.getByRole("button", { name: /Entrar/, exact: false }).click();
  const authenticated = await loginResponse; assert.equal(authenticated.status(), 201);
  token = (await authenticated.json()).access_token;
  await page.getByRole("button", { name: "Cupons de assinatura", exact: true }).click();
  await page.getByRole("button", { name: "Criar cupom", exact: true }).waitFor();
  await page.locator(".control-brand img").evaluate(image => image.decode());
  checks.push("real-browser-admin-login", "real-cors", "logo-decodes");

  const qaCode = `QA-CRUD-${Date.now().toString(36).toUpperCase()}`;
  await form(qaCode, "percent", "50");
  await page.getByRole("button", { name: "Criar cupom", exact: true }).click();
  await page.getByRole("status").filter({ hasText: `Cupom ${qaCode} criado.` }).waitFor();
  await filter(qaCode);
  let qa = (await request(`?search=${qaCode}&page=1&pageSize=10`)).items[0];
  assert.equal(qa.discountValue, 5000); assert.equal(qa.provisioned, true); assert.equal(qa.livemode, false);
  const originalPromotion = (await stripe.promotionCodes.list({ code: qaCode, limit: 10 })).data.find(code => code.active);
  assert.ok(originalPromotion); assert.equal(originalPromotion.livemode, false);
  checks.push("create-percent-through-ui", "stripe-test-object-created", "server-filter-persistence");

  await row(qaCode).getByRole("button", { name: "Desabilitar", exact: true }).click();
  await row(qaCode).getByRole("button", { name: "Habilitar", exact: true }).waitFor();
  assert.equal((await stripe.promotionCodes.retrieve(originalPromotion.id)).active, false);
  await row(qaCode).getByRole("button", { name: "Habilitar", exact: true }).click();
  await row(qaCode).getByRole("button", { name: "Desabilitar", exact: true }).waitFor();
  assert.equal((await stripe.promotionCodes.retrieve(originalPromotion.id)).active, true);
  await row(qaCode).getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Valor do desconto (%)", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "atualizado" }).waitFor();
  qa = (await request(`?search=${qaCode}&page=1&pageSize=10`)).items[0]; assert.equal(qa.discountValue, 4000);
  assert.equal((await stripe.promotionCodes.retrieve(originalPromotion.id)).active, false);
  const updatedPromotion = (await stripe.promotionCodes.list({ code: qaCode, limit: 10 })).data.find(code => code.active); assert.ok(updatedPromotion);
  await row(qaCode).getByRole("button", { name: "Excluir", exact: true }).click();
  await row(qaCode).getByRole("button", { name: "Confirmar exclusão", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "excluído" }).waitFor();
  assert.equal((await request(`?search=${qaCode}&page=1&pageSize=10`)).pagination.total, 0);
  assert.equal((await stripe.promotionCodes.retrieve(updatedPromotion.id)).active, false);
  checks.push("disable-stripe-real", "enable-stripe-real", "edit-version-provider-real", "delete-provider-real", "deleted-hidden-from-list");

  const code = "HOMOLOG1REAL";
  const existing = (await request(`?search=${code}&page=1&pageSize=10`)).items.find(item => item.code === code);
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  if (!existing) {
    await form(code, "fixed", "178", true);
    await page.screenshot({ path: path.join(output, "cupom-1real-formulario.png"), fullPage: true });
    await page.getByRole("button", { name: "Criar cupom", exact: true }).click();
    await page.getByRole("status").filter({ hasText: `Cupom ${code} criado.` }).waitFor();
  }
  await filter(code);
  const saved = (await request(`?search=${code}&page=1&pageSize=10`)).items.find(item => item.code === code);
  assert.equal(saved.discountValue, 17800); assert.equal(saved.discountType, "fixed"); assert.deepEqual(saved.plans, ["starter179"]);
  assert.equal(saved.duration, "once"); assert.equal(saved.maxRedemptions, 1); assert.equal(saved.enabled, true); assert.equal(saved.livemode, false); assert.equal(saved.timesRedeemed, 0);
  const providerCode = (await stripe.promotionCodes.list({ code, limit: 10 })).data.find(item => item.active); assert.ok(providerCode);
  const couponId = providerCode.promotion.coupon; const coupon = await stripe.coupons.retrieve(typeof couponId === "string" ? couponId : couponId.id, { expand: ["applies_to"] });
  assert.equal(coupon.amount_off, 17800); assert.equal(coupon.duration, "once"); assert.equal(coupon.currency, "brl"); assert.equal(coupon.applies_to.products.length, 1);
  const prices = await stripe.prices.list({ product: coupon.applies_to.products[0], active: true });
  assert.ok(prices.data.some(price => price.unit_amount === 17900 && price.recurring?.interval === "month"));
  await page.reload(); await page.getByRole("button", { name: "Cupons de assinatura", exact: true }).click(); await filter(code);
  await page.screenshot({ path: path.join(output, "cupom-1real-listagem-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector(".control-sidebar").getBoundingClientRect().right <= 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, "cupom-1real-listagem-mobile.png"), fullPage: true });
  checks.push("fixed-discount-through-ui", "restricted-starter-product", "one-redemption", "reload-real-persistence", "mobile-layout");
  assert.deepEqual(errors, []);
  const result = { environment: "sandbox", proof: "deployed_ui_real_api_real_stripe_test", checks, code, id: saved.id, stripePromotionCodeId: providerCode.id,
    stripeCouponId: coupon.id, firstInvoiceCents: 100, subsequentMonthlyCents: 17900, expiresAt: saved.expiresAt, livemode: false, consumed: false,
    qaCode, adminUrl, screenshots: output, paymentExecuted: false, actualEmailDeliveryValidated: false };
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  if (token) await fetch(`${api}/v1/platform/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  await browser.close();
}
