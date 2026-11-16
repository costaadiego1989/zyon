import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { createSupportFixture } from "./platform-support-fixture.js";

const fixture = await createSupportFixture();
const browser = await chromium.launch({ channel: "msedge", headless: true });
const output = new URL("../../../.audit/platform-support-plans-20261116/", import.meta.url);
await mkdir(output, { recursive: true });
const errors: string[] = [];
const sockets: Record<string, number> = {};
const failedRequests: string[] = [];
const pages: import("playwright").Page[] = [];
const request = async (key: string, path: string, method = "GET", body?: unknown) => {
  const response = await fetch(fixture.first.url + "/v1" + path, { method, headers: { Authorization: `Bearer ${fixture.merchants[key]!.token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${response.status} ${path}`);
  return response.json() as Promise<any>;
};
async function pageFor(key: string) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addCookies([{ name: "aacp_access_token", value: fixture.merchants[key]!.token, url: fixture.first.url, httpOnly: true, sameSite: "Lax" }]);
  await context.addInitScript(data => sessionStorage.setItem("support.fixture", JSON.stringify(data)), { api: fixture.first.url + "/v1", merchantId: fixture.merchants[key]!.id });
  const page = await context.newPage(); pages.push(page); sockets[key] = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("websocket", socket => { if (socket.url().startsWith(fixture.first.url.replace(/^http/, "ws") + "/socket.io")) sockets[key] = (sockets[key] ?? 0) + 1; });
  page.on("response", response => { if (!response.ok() && response.url().includes("/v1/merchants/me/platform-support")) failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  await page.goto("http://127.0.0.1:17441/e2e/fixtures/platform-support.html");
  await page.getByRole("button", { name: "Ajuda e feedback sobre a Zyon", exact: true }).click();
  await page.getByRole("heading", { name: "Meus chamados", exact: true }).waitFor();
  return page;
}
async function fill(page: import("playwright").Page, subject: string, live: boolean) {
  await page.getByRole("button", { name: live ? "Iniciar atendimento em tempo real" : "Abrir chamado", exact: true }).click();
  await page.getByLabel("Assunto", { exact: true }).fill(subject);
  await page.getByLabel("O que aconteceu?", { exact: true }).fill("Cadastrei um produto e preciso verificar a publicação no catálogo.");
  await page.locator("form.ps-new").getByRole("button", { name: live ? "Iniciar atendimento" : "Abrir chamado", exact: true }).click();
  await page.getByRole("heading", { name: subject, exact: true }).waitFor();
}
try {
  const basic = await pageFor("starter179");
  await basic.getByText("Suporte por chamados. A equipe responde no histórico de cada chamado.", { exact: true }).waitFor();
  assert.equal(await basic.getByRole("button", { name: "Iniciar atendimento em tempo real", exact: true }).count(), 0);
  await fill(basic, "Chamado do plano Básico", false);
  assert.equal(sockets.starter179, 0);
  assert.equal((await fixture.prisma.platformSupportTicket.findFirstOrThrow({ where: { merchantId: fixture.merchants.starter179!.id } })).mode, "ticket");
  await basic.screenshot({ path: fileURLToPath(new URL("basic-desktop.png", output)), fullPage: true });
  const growth = await pageFor("growth");
  await growth.getByText(/Tempo real: 5 de 5/).waitFor();
  await fill(growth, "Atendimento Growth em tempo real", true);
  await growth.getByText("Conectado em tempo real", { exact: true }).waitFor();
  await growth.getByLabel("Sua mensagem", { exact: true }).fill("Mais detalhes pelo atendimento em tempo real.");
  await growth.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
  await growth.locator(".ps-message-body").filter({ hasText: "Mais detalhes pelo atendimento em tempo real." }).waitFor();
  const live = await fixture.prisma.platformSupportTicket.findFirstOrThrow({ where: { merchantId: fixture.merchants.growth!.id } });
  assert.equal(live.mode, "realtime");
  assert.equal(await fixture.prisma.platformSupportMessage.count({ where: { ticketId: live.id } }), 2);
  for (let i = 0; i < 4; i++) await request("growth", "/merchants/me/platform-support", "POST", { subject: `Atendimento adicional ${i}`, category: "bug", content: "Validação da franquia mensal de atendimento.", mode: "realtime", clientRequestId: randomUUID() });
  await growth.getByRole("button", { name: "Atualizar", exact: true }).click();
  await growth.getByText(/Tempo real: 0 de 5/).waitFor();
  assert.equal(await growth.getByRole("button", { name: "Iniciar atendimento em tempo real", exact: true }).isDisabled(), true);
  await fill(growth, "Chamado após usar a franquia", false);
  assert.equal((await request("growth", "/merchants/me/platform-support/capabilities")).realtimeUsed, 5);
  await growth.screenshot({ path: fileURLToPath(new URL("growth-exhausted-desktop.png", output)), fullPage: true });
  await growth.setViewportSize({ width: 390, height: 844 });
  await growth.screenshot({ path: fileURLToPath(new URL("growth-mobile.png", output)), fullPage: true });
  assert.equal(await growth.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await growth.getByRole("button", { name: "Enviar mensagem", exact: true }).isVisible(), true);
  const sendBox = await growth.getByRole("button", { name: "Enviar mensagem", exact: true }).boundingBox();
  const footerBox = await growth.locator(".ui-dialog__footer").boundingBox();
  assert.ok(sendBox && footerBox && sendBox.y + sendBox.height <= footerBox.y, "mobile send button is clipped by the modal footer");
  const scale = await pageFor("scale");
  await scale.getByText("Chamados e atendimentos em tempo real ilimitados, com prioridade.", { exact: true }).waitFor();
  assert.equal(await scale.getByRole("button", { name: "Iniciar atendimento em tempo real", exact: true }).isEnabled(), true);
  await scale.screenshot({ path: fileURLToPath(new URL("scale-desktop.png", output)), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
  await writeFile(new URL("browser-evidence.json", output), JSON.stringify({ passed: true, environment: "isolated local PostgreSQL and Redis", basicTickets: true, basicSockets: sockets.starter179, growthLivePersisted: true, growthExhaustedKeepsTickets: true, scaleUnlimited: true, mobileOverflow: false, runtimeErrors: errors, failedRequests, productionVerified: false }, null, 2));
  console.log("Browser passed: Basic tickets without live socket, Growth live then quota exhaustion with tickets available, Escala unlimited, desktop/mobile.");
} catch (error) {
  for (let i = 0; i < pages.length; i++) await pages[i]!.screenshot({ path: fileURLToPath(new URL(`failure-${i}.png`, output)), fullPage: true });
  console.log(JSON.stringify({ errors, failedRequests, screens: await Promise.all(pages.map(page => page.locator("body").innerText())) }));
  throw error;
} finally { await browser.close(); await fixture.close(); }
