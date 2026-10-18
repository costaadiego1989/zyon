import "reflect-metadata";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { PrismaAuthRepository } from "../src/modules/auth/infrastructure/prisma-auth.repository.js";
import { JwtService } from "../src/modules/auth/domain/services/jwt.service.js";

// Sandbox only. Fixtures exercise the published reader, not a paid provider request.
if (process.env.AI_TRANSPARENCY_ENV !== "sandbox") throw Error("sandbox_only_until_customer_approval");
const evidence = process.env.AI_TRANSPARENCY_EVIDENCE;
if (!evidence) throw Error("evidence_directory_required");
mkdirSync(evidence, { recursive: true });
const cli = path.join(process.env.APPDATA!, "npm/node_modules/@railway/cli/bin/railway.exe");
const config = spawnSync(cli, ["variables", "--json", "--project", "b8421237-6557-4677-a08c-c93453b08568", "--environment", "a347216c-86e3-4a75-8d73-5ae6e122408c", "--service", "api"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
if (config.status !== 0) throw Error("sandbox_configuration_unavailable");
const vars = JSON.parse(config.stdout), url = new URL(vars.DATABASE_URL), proxy = process.env.AI_TRANSPARENCY_DB_PROXY;
if (!proxy || !/^[a-z0-9.-]+\.proxy\.rlwy\.net:\d+$/.test(proxy)) throw Error("verified_sandbox_database_proxy_required");
url.host = proxy;
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const api = "https://api-sandbox-8146.up.railway.app", dashboard = "https://app-sandbox.zyon-payments.com.br";
const tag = "transparency_review_" + randomUUID().replaceAll("-", ""), ids: string[] = [], checks: string[] = [];
const report: Record<string, unknown> = { environment: "sandbox", fixtureData: true, providerCallExecuted: false, startedAt: new Date().toISOString(), checks };
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let reviewPage: import("playwright").Page | undefined;
const browserErrors: string[] = [], failedApiRequests: Array<{ path: string; status: number }> = [];
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const day = (offset: number) => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const at = new Date(today + "T12:00:00-03:00");
try {
  const auth = new PrismaAuthRepository(db), jwt = new JwtService(vars.JWT_SECRET, 3600, auth);
  const merchants: Array<{ id: string; userId: string; email: string; token: string }> = [];
  for (const name of ["first", "other"]) {
    const id = tag + "_" + name; ids.push(id);
    const { user } = await auth.createMerchantWithOwner({ merchantId: id, merchantName: "Revisão transparência " + name, email: id + "@example.invalid", passwordHash: "temporary-fixture-no-password-login" });
    await db.merchant.update({ where: { id }, data: { plan: "STORE_ONLY", storeSettings: { registration_pending: false, owner_name: "Revisão de transparência" } } });
    await db.merchantBillingSubscription.upsert({ where: { merchantId: id }, create: { merchantId: id, planKey: "growth", status: "active" }, update: { planKey: "growth", status: "active" } });
    const steps = { account: { status: "completed" }, checkout_config: { status: "completed" }, whatsapp: { status: "completed" }, ai_engine: { status: "completed" } };
    await db.merchantOnboardingState.upsert({ where: { merchantId: id }, create: { merchantId: id, steps }, update: { steps } });
    merchants.push({ id, userId: user.id, email: user.email, token: await jwt.issue({ userId: user.id, merchantId: id, email: user.email, role: "owner" }) });
  }
  const [own, other] = merchants as [typeof merchants[number], typeof merchants[number]];
  const voice = tag + "_voice", missing = tag + "_missing";
  await db.aiVoiceUsageSession.createMany({ data: [
    { id: voice, merchantId: own.id, billingAccountId: own.id, credentialScope: "fixture", model: "fixture", source: "voice_checkout", conversationId: "fixture", state: "closed", startedAt: at },
    { id: missing, merchantId: own.id, billingAccountId: own.id, credentialScope: "fixture", model: "fixture", source: "voice_narration", conversationId: "fixture", state: "unobservable", startedAt: at },
  ] });
  const event = (merchantId: string, extra: Record<string, unknown> = {}) => db.aiUsageEvent.create({ data: {
    idempotencyKey: randomUUID(), merchantId, source: "transparency_review", provider: "openai", model: "fixture", channel: "text", component: "llm",
    executionStatus: "succeeded", usageKnown: true, measurementOrigin: "server_http", promptTokens: 12345, completionTokens: 6789, totalTokens: 19134,
    costMicros: 99999999n, currency: "USD", startedAt: at, completedAt: at, latencyMs: 0, ...extra,
  } });
  await event(own.id);
  await event(own.id, { channel: "voice", component: "realtime_response", voiceSessionId: voice, measurementOrigin: "server_sideband", promptTokens: 130, completionTokens: 60, totalTokens: 190, inputDetails: { text_tokens: 100, audio_tokens: 30 }, outputDetails: { text_tokens: 40, audio_tokens: 20 } });
  await event(own.id, { usageKnown: false, executionStatus: "unknown", promptTokens: null, completionTokens: null, totalTokens: null });
  await event(own.id, { usageKnown: false, executionStatus: "rejected", promptTokens: null, completionTokens: null, totalTokens: null });
  await event(own.id, { usageKnown: false, executionStatus: "unknown", promptTokens: null, completionTokens: null, totalTokens: null, startedAt: new Date(day(-2) + "T12:00:00-03:00") });
  await event(own.id, { promptTokens: 0, completionTokens: 0, totalTokens: 0, startedAt: new Date(day(-3) + "T12:00:00-03:00") });
  await event(own.id, { measurementOrigin: "legacy", component: "voice_admission" });
  await event(other.id, { promptTokens: 1000000, completionTokens: 10, totalTokens: 1000010 });
  const route = `/v1/dashboard/finance/ai-usage?from=${today}&to=${today}`;
  const get = (suffix = "", token = own.token) => fetch(api + route + suffix, { headers: { Authorization: "Bearer " + token } });
  const response = await get(); assert.equal(response.status, 200); const data = await response.json();
  assert.equal(data.summary.input_tokens, "12475"); assert.equal(data.summary.output_tokens, "6849"); assert.equal(data.summary.voice_sessions, "2");
  assert.equal(data.summary.requests, "4"); assert.equal(data.summary.pending_requests, "1"); assert.equal(data.coverage.incomplete_voice_sessions, "1");
  assert.doesNotMatch(JSON.stringify(data), /costMicros|99999999|USD|credentialScope|providerEventId|conversationId/);
  assert.equal((await get("&merchantId=" + other.id)).status, 403);
  assert.equal((await fetch(api + route)).status, 401);
  const foreign = await (await get("", other.token)).json(); assert.equal(foreign.summary.input_tokens, "1000000");
  checks.push("Published API matches persisted text/audio fixtures; rejects tenant tampering and anonymous access; excludes platform cost fields");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addCookies([{ name: vars.AUTH_COOKIE_NAME || "aacp_access_token", value: own.token, url: api, httpOnly: true, secure: true, sameSite: "None" }]);
  const page = await context.newPage(), errors: string[] = [], failedReads: string[] = [];
  reviewPage = page;
  page.on("pageerror", e => browserErrors.push(e.message));
  page.on("response", r => { if (r.url().startsWith(api + "/v1/") && r.status() >= 400) failedApiRequests.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => { if (r.url().includes("/dashboard/finance/ai-usage") && r.status() >= 400) failedReads.push(String(r.status())); });
  await page.goto(dashboard + "/#finance");
  await page.getByRole("heading", { name: "Financeiro", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("tab", { name: "Relatórios", exact: true }).click();
  const section = page.locator(".ai-usage");
  await section.locator("dd").first().waitFor();
  const todayRead = page.waitForResponse(r => { const u = new URL(r.url()); return u.pathname.endsWith("/finance/ai-usage") && u.searchParams.get("from") === today && u.searchParams.get("to") === today; });
  await page.getByRole("button", { name: "Hoje", exact: true }).click();
  assert.equal((await todayRead).status(), 200);
  await page.waitForFunction(() => document.querySelector(".ai-usage")?.getAttribute("aria-busy") === "false");
  assert.deepEqual(await section.locator("dd").allTextContents(), ["2", "12.475", "6.849"]);
  assert.equal(await section.locator("details").getAttribute("open"), null);
  assert.match(await section.innerText(), /Medição parcial/);
  await page.screenshot({ path: path.join(evidence, "sandbox-desktop.png"), fullPage: true });
  await section.locator("summary").click();
  assert.match(await section.innerText(), /12\.445/); assert.match(await section.innerText(), /6\.829/);
  assert.match(await section.innerText(), /não corresponde ao contador de franquia/);
  assert.doesNotMatch(await section.innerText(), /99999999|USD|R\$/);
  await page.screenshot({ path: path.join(evidence, "sandbox-details.png"), fullPage: true });
  const downloading = page.waitForEvent("download"); await section.getByRole("button", { name: "Baixar consumo", exact: true }).click();
  await (await downloading).saveAs(path.join(evidence, "sandbox-consumo.csv"));
  checks.push("Published dashboard shows correct provider totals, collapsed details and downloads the actual scoped CSV");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  async function alignMobileReport() {
    await section.evaluate(element => {
      let parent = element.parentElement;
      while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
      if (parent) parent.scrollTop += element.getBoundingClientRect().top - 128;
    });
  }
  await alignMobileReport();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile_page_overflows");
  await page.screenshot({ path: path.join(evidence, "sandbox-mobile-details.png"), fullPage: true });
  await section.locator("summary").click();
  await alignMobileReport();
  await page.screenshot({ path: path.join(evidence, "sandbox-mobile.png"), fullPage: true });
  checks.push("Desktop and mobile layouts render without horizontal page overflow or JavaScript errors");
  async function selectDate(value: string) {
    // Clear bounds through the existing custom date controls; no network interception.
    const read = page.waitForResponse(r => { const u = new URL(r.url()); return u.pathname.endsWith("/finance/ai-usage") && u.searchParams.get("from") === value && u.searchParams.get("to") === value; });
    await page.getByLabel("Data inicial", { exact: true }).fill(value);
    await page.getByLabel("Data final", { exact: true }).fill(value);
    assert.equal((await read).status(), 200);
    await page.waitForFunction(expected => document.querySelector<HTMLInputElement>('[aria-label="Data final"]')?.value === expected && document.querySelector(".ai-usage")?.getAttribute("aria-busy") === "false", value);
    await page.waitForTimeout(250);
  }
  await selectDate(day(-1)); assert.deepEqual(await section.locator("dd").allTextContents(), ["0", "0", "0"]);
  assert.match(await section.innerText(), /Nenhum consumo registrado/);
  await page.screenshot({ path: path.join(evidence, "sandbox-empty.png"), fullPage: true });
  await selectDate(day(-2)); assert.deepEqual(await section.locator("dd").allTextContents(), ["0", "—", "—"]);
  await page.screenshot({ path: path.join(evidence, "sandbox-unmeasured.png"), fullPage: true });
  await selectDate(day(-3)); assert.deepEqual(await section.locator("dd").allTextContents(), ["0", "0", "0"]);
  assert.doesNotMatch(await section.innerText(), /Nenhum consumo registrado|Medição parcial/);
  checks.push("Actual date filters distinguish empty history, missing metadata and measured zero tokens");
  assert.deepEqual(errors, []); assert.deepEqual(failedReads, []);
  await db.merchantTeamMember.updateMany({ where: { merchantId: own.id, userId: own.userId }, data: { role: "STAFF" } });
  const staff = await jwt.issue({ userId: own.userId, merchantId: own.id, email: own.email, role: "staff" });
  assert.equal((await get("", staff)).status, 403);
  const exportResponse = await fetch(api + `/v1/dashboard/finance/ai-usage/export.csv?from=${today}&to=${today}`, { headers: { Authorization: "Bearer " + staff } });
  assert.equal(exportResponse.status, 403); checks.push("Published API blocks both report and CSV for staff");
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error instanceof Error ? error.message : "validation_failed";
  report.browserErrors = browserErrors; report.failedApiRequests = failedApiRequests;
  if (reviewPage) {
    report.pageText = (await reviewPage.locator("body").innerText().catch(() => "unavailable")).slice(0, 4000);
    await reviewPage.screenshot({ path: path.join(evidence, "sandbox-failure.png"), fullPage: true }).catch(() => undefined);
  }
  throw error;
} finally {
  await browser?.close();
  if (ids.length) {
    await db.aiUsageEvent.deleteMany({ where: { merchantId: { in: ids } } });
    await db.aiVoiceUsageSession.deleteMany({ where: { merchantId: { in: ids } } });
    await db.merchant.deleteMany({ where: { id: { in: ids } } });
  }
  report.temporaryDataRemoved = (await db.merchant.count({ where: { id: { in: ids } } })) === 0;
  report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(evidence, "sandbox-live-validation.json"), JSON.stringify(report, null, 2));
  await db.$disconnect(); console.log(JSON.stringify(report));
}
