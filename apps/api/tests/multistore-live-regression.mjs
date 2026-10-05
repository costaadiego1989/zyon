// Real PostgreSQL + production Nest composition, never a shared/live database.
// Run after `pnpm --filter @zyon/api build` with MULTISTORE_TEST_DATABASE_URL.
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.MULTISTORE_TEST_DATABASE_URL;
const target = new URL(databaseUrl ?? "http://missing");
assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
assert.equal(target.pathname, "/zyon_multistore_regression");
Object.assign(process.env, {
  DATABASE_URL: databaseUrl, NODE_ENV: "test", REDIS_ENABLED: "false",
  E2E_SEED_ENABLED: "false", BILLING_BYPASS: "false", OTEL_ENABLED: "false",
  LOG_LEVEL: "silent",
  JWT_SECRET: "local-multistore-regression-secret-not-for-deployment",
  OPENROUTER_API_KEY: "local-unused-test-key", OPENROUTER_BASE_URL: "http://127.0.0.1:1",
  AUTH_COOKIE_SECURE: "false", AUTH_COOKIE_SAME_SITE: "lax",
});
const { AppModule } = await import("../dist/app.module.js");
const { initMetrics, initDomainMetrics } = await import("../dist/shared/http/metrics.middleware.js");
initMetrics();
initDomainMetrics();
const { PasswordHasher } = await import("../dist/modules/auth/domain/services/password-hasher.service.js");
const { PrismaAuthRepository } = await import("../dist/modules/auth/infrastructure/prisma-auth.repository.js");
const { AUTH_REPOSITORY } = await import("../dist/modules/auth/domain/ports/auth-repository.port.js");
const { MERCHANT_STORE_REPOSITORY } = await import("../dist/modules/merchant/domain/ports/merchant-store.repository.port.js");
const { PRISMA_CLIENT } = await import("../dist/shared/persistence/persistence.module.js");

const db = new PrismaClient();
const run = randomUUID();
const email = `multistore-${run}@example.invalid`;
const password = "Local-multistore-regression-Only!42";
const rootId = `multistore-${run}`;
const authRepo = new PrismaAuthRepository(db);
const rootAccount = await authRepo.createMerchantWithOwner({ merchantId: rootId, merchantName: "Scale Regression Root", storeSlug: rootId,
  email, passwordHash: await new PasswordHasher().hash(password) });
await db.merchant.update({ where: { id: rootId }, data: { storeCategory: "electronics", storeSettings: {
  registration_pending: false, owner_name: "Scale Regression Owner", owner_phone: "11999998888",
} } });
await db.merchantBillingSubscription.update({ where: { merchantId: rootId }, data: { planKey: "scale", status: "active" } });
await db.merchantOnboardingState.create({ data: { merchantId: rootId, steps: Object.fromEntries(
  ["account", "checkout_config", "whatsapp", "ai_engine"].map(id => [id, { status: "completed" }])) } });
const outsider = await db.merchant.create({ data: { id: `outsider-${run}`, name: "Other account" } });

const app = await NestFactory.create(AppModule, { logger: ["error"] });
app.setGlobalPrefix("v1");
app.enableCors({ origin: "http://localhost:5185", credentials: true });
await app.init();
// Negative control: restore the old DI client without changing any assertions.
if (process.env.MULTISTORE_LEGACY_WIRING === "1") {
  app.get(MERCHANT_STORE_REPOSITORY).prisma = app.get(PRISMA_CLIENT);
  app.get(AUTH_REPOSITORY).prisma = app.get(PRISMA_CLIENT);
}
await app.listen(3019, "127.0.0.1");
const base = "http://127.0.0.1:3019/v1";
const storeProfile = {
  cnpj: "11.444.777/0001-61",
  email: "contato@regressao.example",
  phone: "(11) 99999-9999",
  storeCategory: "electronics",
};
let cookie = "";
async function request(path, body, expected = 200, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), "Idempotency-Key": randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  assert.equal(response.status, expected, `${path}: ${value.code ?? value.message ?? "unexpected status"}`);
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return value;
}
try {
  await request("/auth/login", { email, password }, 201);
  assert.equal((await request("/merchants/me")).id, rootId);
  const created = await request("/merchants/me/stores", { name: "Regressão Nova Loja", ...storeProfile }, 201);
  assert.match(created.slug, /^regressao-nova-loja(?:-\d+)?$/);
  assert.notEqual(created.id, rootId);
  assert.equal(created.storeCategory, storeProfile.storeCategory);
  const managedStores = (await request("/merchants/me/stores")).data;
  assert.ok(managedStores.some(store => store.id === created.id), "new membership must survive a separate request");
  assert.deepEqual(managedStores.find(store => store.id === rootId), {
    id: rootId, name: "Scale Regression Root", slug: rootId, role: "owner", storeCategory: "electronics", isBillingAccount: true,
  });
  const activated = await request(`/merchants/me/stores/${created.id}/activate`, {}, 201);
  assert.equal(activated.merchant_id, created.id);
  assert.equal((await request("/merchants/me")).id, created.id, "new cookie must authenticate on a fresh request");
  const accountProfile = await request("/auth/me");
  assert.equal(accountProfile.user_id, rootAccount.user.id, "account profile belongs to the authenticated user, not a child-store owner record");
  assert.equal(accountProfile.merchant_id, created.id, "account profile retains the active store context");
  assert.equal(accountProfile.name, "Scale Regression Owner", "account profile inherits existing root account details");
  assert.equal(accountProfile.phone, "11999998888");
  const updatedAccountProfile = await request("/auth/me", {
    name: "Scale Regression Owner Updated", phone: "11999997777",
  }, 200, "PUT");
  assert.deepEqual(updatedAccountProfile, { name: "Scale Regression Owner Updated", phone: "11999997777" });
  const persistedAccountProfile = await request("/auth/me");
  assert.equal(persistedAccountProfile.name, "Scale Regression Owner Updated");
  assert.equal(persistedAccountProfile.phone, "11999997777");
  const [accountSettings, childSettings] = await Promise.all([
    db.merchant.findUnique({ where: { id: rootId }, select: { storeSettings: true } }),
    db.merchant.findUnique({ where: { id: created.id }, select: { storeSettings: true, storeCategory: true } }),
  ]);
  assert.equal(accountSettings.storeSettings.owner_name, "Scale Regression Owner Updated");
  assert.equal(accountSettings.storeSettings.owner_phone, "11999997777");
  assert.equal((childSettings.storeSettings ?? {}).owner_name, undefined, "updating the account must not populate child-store settings");
  assert.equal(childSettings.storeCategory, storeProfile.storeCategory);
  assert.deepEqual((childSettings.storeSettings ?? {}).company, {
    razaoSocial: "Regressão Nova Loja", cnpj: "11444777000161", email: "contato@regressao.example", phone: "11999999999",
  });
  assert.equal((await request("/merchants/me")).name, "Regressão Nova Loja");
  assert.equal((await request("/billing/subscription")).plan, "scale");
  assert.equal(await db.merchantBillingSubscription.count({ where: { merchantId: created.id } }), 0);
  await request("/auth/refresh", {}, 201);
  assert.equal((await request("/merchants/me")).id, created.id, "refresh must preserve the selected store");
  const onboarding = await request("/onboarding");
  assert.equal(onboarding.merchant_id, created.id);
  assert.equal(onboarding.steps.find(step => step.id === "checkout_config").status, "pending");
  const stores = (await request("/merchants/me/stores")).data;
  assert.equal(stores.length, 2);
  assert.ok(stores.some(store => store.id === rootId));
  await request(`/merchants/me/stores/${outsider.id}/activate`, {}, 403);
  assert.equal((await request("/merchants/me")).id, created.id);
  const activeUser = await db.merchantUser.findUnique({ where: { email } });
  // Even a membership in a different billing account must not authorize a switch.
  await db.merchantTeamMember.create({ data: { merchantId: outsider.id, userId: activeUser.id, role: "OWNER" } });
  await request(`/merchants/me/stores/${outsider.id}/activate`, {}, 403);
  assert.equal((await request("/merchants/me/stores")).data.length, 2);
  const child2 = await request("/merchants/me/stores", { name: "Filial da Nova Loja", ...storeProfile }, 201);
  assert.equal((await db.merchant.findUnique({ where: { id: child2.id } })).billingAccountMerchantId, rootId);
  await request(`/merchants/me/stores/${rootId}/activate`, {}, 201);
  assert.equal((await request("/merchants/me")).id, rootId);
  for (const delegate of ["merchantPaymentConnection", "merchantCommerceConnection", "product", "whatsAppChannelConfig", "merchantOnboardingState"]) {
    assert.equal(await db[delegate].count({ where: { merchantId: created.id } }), 0, `${delegate} must not be inherited`);
  }
  assert.equal((await db.merchantUser.findUnique({ where: { email } })).merchantId, rootId);
  console.log(JSON.stringify({ result: "PASS", checks: ["official login", "commercial profile creation", "parent category", "persistent membership", "activation cookie", "profile after reload", "fresh onboarding", "list from child", "deny other account", "create from child with Scale", "return to root", "integration isolation"], rootId, email }));
  if (process.argv.includes("--serve")) {
    console.log("LOCAL_BROWSER_FIXTURE_READY http://localhost:3019");
    await new Promise(() => {});
  }
} finally {
  await app.close();
  await db.$disconnect();
}
