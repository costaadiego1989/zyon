import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { io, type Socket } from "socket.io-client";
import { chromium } from "playwright";
import { PrismaAuthRepository } from "../src/modules/auth/infrastructure/prisma-auth.repository.js";
import { JwtService } from "../src/modules/auth/domain/services/jwt.service.js";
import { PlatformJwtService } from "../src/modules/platform-control/domain/services/platform-jwt.service.js";
import { PrismaPlatformOperatorRepository } from "../src/modules/platform-control/infrastructure/prisma-platform-operator.repository.js";

const environment = process.env.SUPPORT_RELEASE_ENV;
if (environment !== "sandbox" && environment !== "production") throw Error("explicit_release_environment_required");
const identities = { sandbox: "a347216c-86e3-4a75-8d73-5ae6e122408c", production: "604c900d-afcd-4e98-b5b5-d3a1a428997c" };
const cli = path.join(process.env.APPDATA!, "npm/node_modules/@railway/cli/bin/railway.exe");
const varsResult = spawnSync(cli, ["variables", "--json", "--project", "b8421237-6557-4677-a08c-c93453b08568", "--environment", identities[environment], "--service", "api"], { encoding: "utf8", timeout: 20_000, windowsHide: true });
if (varsResult.status !== 0) throw Error("runtime_variables_unavailable");
const vars = JSON.parse(varsResult.stdout);
const dbUrl = new URL(vars.DATABASE_URL);
const proxy = process.env.SUPPORT_RELEASE_DB_PROXY;
if (!proxy || !/^[a-z0-9.-]+\.proxy\.rlwy\.net:\d+$/.test(proxy)) throw Error("verified_database_proxy_required");
dbUrl.host = proxy;
dbUrl.searchParams.set("connect_timeout", "15");
const db = new PrismaClient({ datasources: { db: { url: dbUrl.toString() } } });
const api = environment === "sandbox" ? "https://api-sandbox-8146.up.railway.app" : "https://api.zyon-payments.com.br";
const dashboard = environment === "sandbox" ? "https://app-sandbox.zyon-payments.com.br" : "https://app.zyon-payments.com.br";
const control = environment === "sandbox" ? "https://control-sandbox.zyon-payments.com.br" : "https://control.zyon-payments.com.br";
const output = process.env.SUPPORT_RELEASE_EVIDENCE!;
if (!output) throw Error("evidence_directory_required");
mkdirSync(output, { recursive: true });
const tag = "support_release_" + environment + "_" + randomUUID().replaceAll("-", "");
const merchantIds: string[] = [], operatorIds: string[] = [], sockets: Socket[] = [];
const checks: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const report: Record<string, unknown> = { environment, startedAt: new Date().toISOString(), tag, checks };
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
async function request(route: string, token: string, method = "GET", body?: unknown, expected = 200) {
  const r = await fetch(api + "/v1" + route, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25_000) });
  const value = await r.json().catch(() => null);
  assert.equal(r.status, expected, `${method} ${route}: ${r.status} ${value?.code ?? value?.message ?? ""}`);
  return value;
}
async function connect(kind: string, token: string, origin: string) {
  const socket = io(api + "/platform-support", { transports: ["websocket"], auth: { kind, accessToken: token }, extraHeaders: { Origin: origin }, reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error("live_socket_auth_timeout")), 15_000); socket.once("authenticated", () => { clearTimeout(timer); resolve(); }); socket.once("connect_error", () => { clearTimeout(timer); reject(Error("live_socket_connect_failed")); }); socket.once("support_error", () => { clearTimeout(timer); reject(Error("live_socket_auth_failed")); }); });
  return socket;
}
async function main() {
  const migration = await db.$queryRaw<Array<{ finished_at: Date | null }>>`SELECT finished_at FROM _prisma_migrations WHERE migration_name = '20261018160000_platform_technical_support' AND rolled_back_at IS NULL`;
  assert(migration.some(m => m.finished_at)); checks.push("deployment migration applied");
  const auth = new PrismaAuthRepository(db);
  const jwt = new JwtService(vars.JWT_SECRET, 3600, auth);
  const pj = new PlatformJwtService(new PrismaPlatformOperatorRepository(db), vars.PLATFORM_CONTROL_JWT_SECRET, 3600);
  const merchants: Record<string, { id: string; token: string }> = {};
  for (const plan of ["growth", "scale", "starter179"]) {
    const id = tag + "_" + plan; merchantIds.push(id);
    const { user } = await auth.createMerchantWithOwner({ merchantId: id, merchantName: "Validação atendimento " + plan, email: id + "@example.invalid", passwordHash: "release-validation-no-password-login" });
    await db.merchant.update({ where: { id }, data: { storeSettings: { registration_pending: false, onboarding_completed: true } } });
    await db.merchantBillingSubscription.upsert({ where: { merchantId: id }, create: { merchantId: id, planKey: plan, status: "active" }, update: { planKey: plan, status: "active" } });
    const steps = { account: { status: "completed" }, checkout_config: { status: "completed" }, whatsapp: { status: "completed" }, ai_engine: { status: "completed" } };
    await db.merchantOnboardingState.upsert({ where: { merchantId: id }, create: { merchantId: id, steps }, update: { steps } });
    merchants[plan] = { id, token: await jwt.issue({ userId: user.id, merchantId: id, email: user.email, role: "owner" }) };
  }
  const operators: Record<string, { id: string; token: string; email: string; role: any }> = {};
  for (const role of ["platform_admin", "billing_ops", "support_ops"] as const) {
    const row = await db.platformOperator.create({ data: { email: tag + "_" + role + "@example.invalid", role } }); operatorIds.push(row.id);
    operators[role] = { id: row.id, email: row.email, role, token: await pj.issue({ operatorId: row.id, email: row.email, role }, 0) };
  }
  const m = merchants, admin = operators.platform_admin!;
  for (const [plan, canOpen, tier] of [["growth", true, "standard"], ["scale", true, "priority"], ["starter179", false, "standard"]] as const) {
    const caps = await request("/merchants/me/platform-support/capabilities", m[plan]!.token); assert.equal(caps.canOpen, canOpen); assert.equal(caps.tier, tier);
  }
  checks.push("Growth chat, Escala priority and Starter restriction");
  const merchantSocket = await connect("merchant", m.scale!.token, dashboard);
  const adminSocket = await connect("operator", admin.token, control);
  checks.push("public WebSocket authentication for merchant and operator");
  const create = (plan: string, key = randomUUID()) => request("/merchants/me/platform-support", m[plan]!.token, "POST", { subject: tag + " " + plan, category: "bug", content: "Validação controlada da abertura de atendimento técnico.", clientRequestId: key }, 201);
  const growth = await create("growth");
  const scaleKey = randomUUID(), scale = await create("scale", scaleKey);
  const repeated = await create("scale", scaleKey); assert.equal(repeated.ticket.id, scale.ticket.id);
  await create("starter179").then(() => { throw Error("starter_ticket_allowed"); }, e => assert.match(String(e), /403/));
  const queue = await request("/platform/support?search=" + tag, admin.token);
  assert.deepEqual(queue.items.map((x: any) => x.id), [scale.ticket.id, growth.ticket.id]);
  checks.push("Escala ahead of earlier Growth ticket; idempotent creation");
  await request("/merchants/me/platform-support/" + scale.ticket.id, m.growth!.token, "GET", undefined, 404);
  await request("/platform/support", operators.billing_ops!.token, "GET", undefined, 403);
  checks.push("tenant isolation and operator permissions");
  const received = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error("durable_outbox_notification_timeout")), 25_000); merchantSocket.on("support_changed", event => { if (event.ticketId === scale.ticket.id) { clearTimeout(timer); resolve(); } }); });
  const messageId = randomUUID();
  const ack: any = await new Promise(resolve => adminSocket.timeout(15_000).emit("send_message", { ticketId: scale.ticket.id, content: "Resposta técnica enviada pelo WebSocket publicado.", clientMessageId: messageId }, (error: unknown, value: unknown) => resolve(error ? { error: "ack_timeout" } : value)));
  assert.equal(ack.success, true, "persisted WebSocket acknowledgement");
  await received;
  const persisted = await db.platformSupportMessage.findMany({ where: { ticketId: scale.ticket.id, clientMessageId: messageId } }); assert.equal(persisted.length, 1);
  await request("/platform/support/" + scale.ticket.id + "/messages", admin.token, "POST", { content: persisted[0]!.content, clientMessageId: messageId }, 201);
  assert.equal(await db.platformSupportMessage.count({ where: { ticketId: scale.ticket.id, clientMessageId: messageId } }), 1);
  checks.push("WebSocket acknowledgement after persistence; Redis/outbox delivery; HTTP retry without duplicate");
  const internal = "Nota privada de validação " + tag;
  await request("/platform/support/" + scale.ticket.id + "/notes", admin.token, "POST", { content: internal, clientRequestId: randomUUID() }, 201);
  const publicConversation = await request("/merchants/me/platform-support/" + scale.ticket.id, m.scale!.token);
  assert(!JSON.stringify(publicConversation).includes(internal));
  checks.push("internal note absent from merchant conversation");
  merchantSocket.disconnect();
  await connect("merchant", m.scale!.token, dashboard);
  assert.equal((await request("/merchants/me/platform-support/" + scale.ticket.id, m.scale!.token)).messages.length, 2);
  checks.push("reconnection recovers persisted history");
  browser = await chromium.launch({ headless: true });
  const merchantContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const operatorContext = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await merchantContext.addCookies([{ name: vars.AUTH_COOKIE_NAME || "aacp_access_token", value: m.scale!.token, domain: new URL(api).hostname, path: "/", secure: true, httpOnly: true, sameSite: "None" }]);
  await operatorContext.addInitScript(({ token, id, email, role }) => sessionStorage.setItem("zyon.platform-control.session.v1", JSON.stringify({ token, operator: { operator_id: id, email, role } })), admin);
  const merchant = await merchantContext.newPage(), operator = await operatorContext.newPage();
  const browserErrors: string[] = []; for (const page of [merchant, operator]) page.on("pageerror", e => browserErrors.push(e.message));
  await Promise.all([merchant.goto(dashboard), operator.goto(control)]);
  await operator.getByRole("button", { name: "Atendimento técnico", exact: true }).click();
  await operator.getByRole("button", { name: new RegExp(tag + " scale") }).click();
  const fab = merchant.locator(".platform-feedback-fab");
  await fab.click({ timeout: 30_000 });
  await merchant.getByRole("button", { name: new RegExp(tag + " scale") }).click();
  await operatorContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  await operator.getByRole("button", { name: "Copiar protocolo", exact: true }).click();
  assert.equal(await operator.evaluate(() => navigator.clipboard.readText()), scale.ticket.id);
  const reply = "Resposta validada nas duas telas publicadas.";
  await operator.getByLabel("Resposta ao cliente", { exact: true }).fill(reply);
  await operator.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
  await merchant.locator(".ps-message-body").filter({ hasText: reply }).waitFor({ timeout: 20_000 });
  const mine = operator.getByLabel("Meus atendimentos", { exact: true }); await mine.check();
  assert.equal(await mine.isChecked(), true);
  await operator.getByRole("button", { name: new RegExp(tag + " scale") }).waitFor();
  assert(!await merchant.getByText(internal, { exact: true }).count());
  await operator.screenshot({ path: path.join(output, environment + "-admin.png"), fullPage: true });
  await merchant.screenshot({ path: path.join(output, environment + "-merchant.png"), fullPage: true });
  await merchant.setViewportSize({ width: 390, height: 844 });
  await pause(400);
  assert(await merchant.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "mobile viewport overflow");
  await merchant.screenshot({ path: path.join(output, environment + "-mobile.png"), fullPage: true });
  assert.equal(browserErrors.length, 0, "browser runtime errors");
  checks.push("real published dashboard and Control exchange messages, clipboard protocol, checkbox and mobile layout");
  const rows = await db.platformSupportMessage.count({ where: { ticketId: scale.ticket.id } }); assert.equal(rows, 3);
  report.persistedMessages = rows; report.browserErrors = browserErrors; report.passed = true;
}
try { await main(); }
catch (error) { report.passed = false; report.error = error instanceof Error ? error.message : "live_validation_failed"; console.error(report.error); process.exitCode = 1; }
finally {
  for (const socket of sockets) socket.disconnect();
  await browser?.close();
  try {
    await db.platformSupportTicket.deleteMany({ where: { merchantId: { in: merchantIds } } });
    await db.platformAuditEvent.deleteMany({ where: { actorOperatorId: { in: operatorIds } } });
    await db.outboxMessage.deleteMany({ where: { merchantId: { in: merchantIds } } });
    await db.merchant.deleteMany({ where: { id: { in: merchantIds } } });
    await db.platformOperator.deleteMany({ where: { id: { in: operatorIds } } });
    report.temporaryDataRemoved = true;
  } catch { report.temporaryDataRemoved = false; process.exitCode = 1; }
  await db.$disconnect(); report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(output, environment + "-live-validation.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
