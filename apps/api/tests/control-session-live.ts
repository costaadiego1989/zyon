import "reflect-metadata";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { PlatformJwtService } from "../src/modules/platform-control/domain/services/platform-jwt.service.js";
import { PrismaPlatformOperatorRepository } from "../src/modules/platform-control/infrastructure/prisma-platform-operator.repository.js";

const environment = process.env.CONTROL_SESSION_ENV;
assert(environment === "sandbox" || environment === "production", "explicit_environment_required");
const sandbox = environment === "sandbox";
const control = process.env.CONTROL_SESSION_URL ?? (sandbox ? "https://control-sandbox.zyon-payments.com.br" : "https://control.zyon-payments.com.br");
assert(new URL(control).hostname === (sandbox ? "control-sandbox.zyon-payments.com.br" : "control.zyon-payments.com.br"), "canonical_control_required");
const api = sandbox ? "https://api-sandbox-8146.up.railway.app" : "https://api.zyon-payments.com.br";
const runtime = spawnSync(path.join(process.env.APPDATA!, "npm/node_modules/@railway/cli/bin/railway.exe"), ["variables", "--json", "--project", "b8421237-6557-4677-a08c-c93453b08568", "--environment", sandbox ? "a347216c-86e3-4a75-8d73-5ae6e122408c" : "604c900d-afcd-4e98-b5b5-d3a1a428997c", "--service", "api"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
assert.equal(runtime.status, 0, "runtime_configuration_unavailable");
const vars = JSON.parse(runtime.stdout), url = new URL(vars.DATABASE_URL);
assert(/^[a-z0-9.-]+\.proxy\.rlwy\.net:\d+$/.test(process.env.CONTROL_SESSION_DB_PROXY ?? ""), "verified_proxy_required");
url.host = process.env.CONTROL_SESSION_DB_PROXY!;
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const evidence = process.env.CONTROL_SESSION_EVIDENCE!;
assert(evidence, "evidence_required");
mkdirSync(evidence, { recursive: true });
const checks: string[] = [], report: Record<string, unknown> = { environment, control, checks, startedAt: new Date().toISOString() };
let operatorId: string | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const key = "zyon.platform-control.session.v1";
try {
  const operator = await db.platformOperator.create({ data: { email: "control_session_" + randomUUID() + "@example.invalid", role: "platform_admin" } });
  operatorId = operator.id;
  const repository = new PrismaPlatformOperatorRepository(db);
  const jwt = new PlatformJwtService(repository, vars.PLATFORM_CONTROL_JWT_SECRET, 1);
  const initialToken = await jwt.issue({ operatorId: operator.id, email: operator.email, role: operator.role }, 0);
  const stored = { token: initialToken, operator: { operator_id: operator.id, email: operator.email, role: operator.role } };
  await new Promise(resolve => setTimeout(resolve, 1200));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let rotations = 0;
  page.on("response", response => { if (response.url() === api + "/v1/platform/auth/refresh" && response.ok()) rotations++; });
  // Seed our own real API session once. Reloads must read the rotated token.
  await page.goto(control);
  await page.evaluate(({ key, stored }) => sessionStorage.setItem(key, JSON.stringify(stored)), { key, stored });
  await page.reload();
  await page.getByRole("heading", { name: "Panorama da plataforma", exact: true }).waitFor();
  const first = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!).token as string, key);
  assert.notEqual(first, initialToken);
  assert.equal(rotations, 1);
  assert.equal((await fetch(api + "/v1/platform/auth/me", { headers: { Authorization: "Bearer " + initialToken } })).status, 401);
  checks.push("expired access token is renewed by the actual published API; replaced token is rejected");

  await page.reload();
  await page.getByRole("heading", { name: "Panorama da plataforma", exact: true }).waitFor();
  assert.equal(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!).token, key), first);
  checks.push("reload preserves the replacement token and authenticated operator");

  // Advance only this browser's scheduling clock; API/session validation remains real.
  await page.clock.install();
  await page.clock.fastForward(16 * 60 * 1000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(({ key, first }) => JSON.parse(sessionStorage.getItem(key)!).token !== first, { key, first });
  assert.equal(rotations, 2);
  checks.push("visible timer/focus renews session after simulated tab suspension with one rotation");
  await page.clock.setSystemTime(new Date());

  // Network fault injection is limited to transport failures, never fake success/auth data.
  await page.route(api + "/v1/platform/auth/me", route => route.abort("internetdisconnected"));
  await page.reload();
  await page.getByRole("heading", { name: "Panorama da plataforma", exact: true }).waitFor();
  assert(await page.evaluate(key => Boolean(sessionStorage.getItem(key)), key));
  await page.unroute(api + "/v1/platform/auth/me");
  checks.push("temporary connectivity failure during bootstrap does not delete session");
  await page.reload();
  await page.getByRole("heading", { name: "Panorama da plataforma", exact: true }).waitFor();
  await page.getByRole("button", { name: "Uso de IA", exact: true }).click();
  await page.getByRole("heading", { name: "Consumo e custos por empresa", exact: true }).waitFor();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  assert((await download).suggestedFilename().endsWith(".csv"));
  checks.push("AI cost page and authenticated CSV work after renewal");
  await page.getByRole("button", { name: "Atendimento técnico", exact: true }).click();
  await page.getByRole("heading", { name: "Atendimento técnico", level: 1, exact: true }).waitFor();
  await page.getByText("Conectado em tempo real", { exact: true }).waitFor();
  checks.push("technical support websocket connects with renewed token");
  await page.screenshot({ path: path.join(evidence, environment + "-session-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(evidence, environment + "-session-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const beforeLogout = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!).token as string, key);
  await page.getByRole("button", { name: /Sair/ }).click();
  await page.getByRole("heading", { name: "Entrar no Control", exact: true }).waitFor();
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null);
  assert.equal((await fetch(api + "/v1/platform/auth/me", { headers: { Authorization: "Bearer " + beforeLogout } })).status, 401);
  checks.push("explicit logout removes local session and revokes its family on the real API");
  assert.deepEqual(errors, []);
  report.successfulRotations = rotations;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : "session_validation_failed";
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: path.join(evidence, environment + "-failure.png"), fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser?.close();
  if (operatorId) {
    await db.platformAuditEvent.deleteMany({ where: { actorOperatorId: operatorId } });
    await db.platformOperator.delete({ where: { id: operatorId } });
    assert.equal(await db.platformAuthSession.count({ where: { operatorId } }), 0);
  }
  report.temporaryDataRemoved = true;
  report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(evidence, environment + "-live-validation.json"), JSON.stringify(report, null, 2));
  await db.$disconnect();
  console.log(JSON.stringify(report));
}
