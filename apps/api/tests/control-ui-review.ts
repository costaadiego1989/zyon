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

const environment = process.env.CONTROL_REVIEW_ENV;
assert(environment === "sandbox" || environment === "production", "explicit_environment_required");
const sandbox = environment === "sandbox";
const environmentId = sandbox ? "a347216c-86e3-4a75-8d73-5ae6e122408c" : "604c900d-afcd-4e98-b5b5-d3a1a428997c";
const runtime = spawnSync(path.join(process.env.APPDATA!, "npm/node_modules/@railway/cli/bin/railway.exe"), ["variables", "--json", "--project", "b8421237-6557-4677-a08c-c93453b08568", "--environment", environmentId, "--service", "api"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
assert.equal(runtime.status, 0, "runtime_configuration_unavailable");
const vars = JSON.parse(runtime.stdout), url = new URL(vars.DATABASE_URL);
assert(/^[a-z0-9.-]+\.proxy\.rlwy\.net:\d+$/.test(process.env.CONTROL_REVIEW_DB_PROXY ?? ""), "verified_proxy_required");
url.host = process.env.CONTROL_REVIEW_DB_PROXY!;
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const control = sandbox ? "https://control-sandbox.zyon-payments.com.br" : "https://control.zyon-payments.com.br";
const evidence = process.env.CONTROL_REVIEW_EVIDENCE!;
assert(evidence, "evidence_required");
mkdirSync(evidence, { recursive: true });
const report: any = { environment, startedAt: new Date().toISOString(), pages: [] };
let operatorId: string | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const operator = await db.platformOperator.create({ data: { email: "control_ui_review_" + randomUUID() + "@example.invalid", role: "platform_admin" } });
  operatorId = operator.id;
  const jwt = new PlatformJwtService(new PrismaPlatformOperatorRepository(db), vars.PLATFORM_CONTROL_JWT_SECRET, 3600);
  const token = await jwt.issue({ operatorId: operator.id, email: operator.email, role: operator.role }, 0);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(value => sessionStorage.setItem("zyon.platform-control.session.v1", JSON.stringify(value)), { token, operator: { operator_id: operator.id, email: operator.email, role: operator.role } });
  const page = await context.newPage();
  const errors: string[] = [], failures: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.url().includes("/v1/platform/") && response.status() >= 400) failures.push(response.status() + " " + new URL(response.url()).pathname); });
  await page.goto(control);
  await page.getByRole("heading", { name: "Panorama da plataforma", exact: true }).waitFor();
  const views = ["Visão geral", "Atendimento técnico", "Feedback", "Empresas", "Pedidos", "Cobrança", "Cupons de assinatura", "Uso de IA", "Infraestrutura", "Auditoria"];
  for (let index = 0; index < views.length; index++) {
    const view = views[index]!;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: view, exact: true }).click();
    await page.getByRole("heading", { name: view, level: 1, exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => {
      const main = document.querySelector("#control-content");
      return main && !main.querySelector('[aria-busy="true"], [class*="skeleton"], [class*="loading"]');
    });
    if (view === "Cobrança") {
      await page.locator("#billing-facts-heading").waitFor();
      await page.locator("#receivables-heading").waitFor();
    }
    const main = page.locator("#control-content");
    assert(await main.innerText(), "page_content_missing:" + view);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "desktop_overflow:" + view);
    const initiallyVisibleCharacters = (await main.innerText()).length;
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); scrollTo(0, 0); });
    await page.screenshot({ path: path.join(evidence, `${environment}-${index}-desktop.png`), fullPage: true });
    const disclosures = main.locator("details.control-details");
    for (const disclosure of await disclosures.all()) {
      await disclosure.locator("summary").first().click();
      assert(await disclosure.evaluate(node => (node as HTMLDetailsElement).open), "disclosure_not_open:" + view);
    }
    const expandedText = await main.innerText();
    assert(!/[\u00c3\u00c2][\u0080-\u00bf]|\ufffd/.test(expandedText), "corrupt_encoding:" + view);
    assert(!/[\p{L}]\?[\p{L}?]/u.test(expandedText), "lost_accents:" + view);
    if (view === "Cobrança") {
      assert(!expandedText.includes("Cobertura desde Ainda"));
      assert(expandedText.includes("histórico anterior à implantação"), "corrected_source_copy_not_deployed");
    }
    await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>("#control-content details.control-details").forEach(node => { node.open = false; }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(180);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile_overflow:" + view);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); scrollTo(0, 0); });
    await page.screenshot({ path: path.join(evidence, `${environment}-${index}-mobile.png`), fullPage: true });
    await page.getByRole("button", { name: "Abrir navegação", exact: true }).click();
    await page.getByRole("button", { name: view, exact: true }).click();
    report.pages.push({ view, desktop: true, mobile: true, disclosures: await disclosures.count(), initiallyVisibleCharacters, expandedCharacters: expandedText.length });
  }
  assert.deepEqual(errors, [], "browser_runtime_errors");
  assert.deepEqual(failures, [], "platform_request_failures");
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : "review_failed";
  const current = browser?.contexts()[0]?.pages()[0];
  if (current) {
    await current.screenshot({ path: path.join(evidence, environment + "-failure.png"), fullPage: true }).catch(() => undefined);
    report.overflow = await current.evaluate(() => [...document.querySelectorAll<HTMLElement>("#control-content *")].filter(node => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(node => ({ tag: node.tagName, className: node.className, width: node.getBoundingClientRect().width }))).catch(() => []);
  }
  throw error;
} finally {
  await browser?.close();
  if (operatorId) {
    await db.platformAuditEvent.deleteMany({ where: { actorOperatorId: operatorId } });
    await db.platformOperator.delete({ where: { id: operatorId } });
  }
  report.temporaryDataRemoved = true;
  report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(evidence, environment + "-live-validation.json"), JSON.stringify(report, null, 2));
  await db.$disconnect();
  console.log(JSON.stringify(report));
}
