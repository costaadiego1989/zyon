import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

interface Seed { fixtureId: string; email: string; password: string; mode: "products" | "services"; role: "OWNER" | "ADMIN" | "STAFF";
  phones: { accepted: string; unknown: string; unavailable: string } }
const path = "/v1/support/notification-settings";
const captures = resolve(process.cwd(), "../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts");
const origin = "http://127.0.0.1:5187";
test.beforeEach(async ({ context }) => {
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
});
async function signIn(page: Page, request: APIRequestContext, scenario: string) {
  const made = await request.post("/__service/support-notifications/seed/" + scenario); expect(made.status()).toBe(200); const seed: Seed = await made.json();
  const calls: Array<{ path: string; method: string }> = [];
  page.on("request", row => { const value = new URL(row.url()).pathname; if (value.startsWith("/v1/")) calls.push({ path: value, method: row.method() }); });
  await page.goto("/?mode=signin#support"); await page.getByLabel("E-mail", { exact: true }).fill(seed.email); await page.getByLabel("Senha", { exact: true }).fill(seed.password);
  const login = page.waitForResponse(row => new URL(row.url()).pathname === "/v1/auth/login" && row.request().method() === "POST");
  await page.getByRole("button", { name: "Entrar", exact: true }).last().click(); expect((await login).status()).toBe(201);
  if (seed.role !== "STAFF") await expect(page.getByRole("heading", { name: "Alertas de atendimento", exact: true })).toBeVisible();
  return { seed, calls };
}
async function snapshot(request: APIRequestContext, seed: Seed) {
  const result = await request.get(`/__service/support-notifications/${seed.fixtureId}/snapshot`); expect(result.status()).toBe(200); return result.json();
}
function nationalDisplay(phone: string) {
  const national = phone.replace(/^\+55/, ""), split = national.length - 4;
  return `(${national.slice(0, 2)}) ${national.slice(2, split)}-${national.slice(split)}`;
}
async function save(page: Page, phone: string) {
  await page.getByRole("textbox", { name: "WhatsApp da equipe", exact: true }).fill(phone.replace(/^\+55/, ""));
  const result = page.waitForResponse(row => new URL(row.url()).pathname === path && row.request().method() === "PUT");
  await page.getByRole("button", { name: "Salvar telefone", exact: true }).click(); const saved = await result; expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON()).toEqual({ fallbackPhone: phone });
  await expect(page.getByRole("textbox", { name: "WhatsApp da equipe", exact: true })).toHaveValue(nationalDisplay(phone));
  await expect(page.getByText("Telefone configurado", { exact: true })).toBeVisible();
}
async function capture(page: Page, name: string) {
  if (name.startsWith("settings-")) {
    await page.getByRole("region", { name: "Alertas de atendimento", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "Alertas de atendimento", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "WhatsApp da equipe", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Salvar telefone", exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await mkdir(captures, { recursive: true }); await page.screenshot({ path: resolve(captures, "t101-" + name + ".running.png"), fullPage: false });
}
async function newCase(request: APIRequestContext, seed: Seed, outcome: "accepted" | "unknown" | "unavailable") {
  const result = await request.post(`/__service/support-notifications/${seed.fixtureId}/case`, { data: { outcome } }); expect(result.status()).toBe(200); return result.json() as Promise<{ ticketId: string }>;
}

for (const mode of ["services", "products"] as const) test(`T101 ${mode} owner saves, reloads and clears privately while preserving dirty FAQ`, async ({ page, request }) => {
  if (mode === "products") await page.setViewportSize({ width: 390, height: 844 });
  const { seed, calls } = await signIn(page, request, "owner-" + mode), before = await snapshot(request, seed);
  await page.getByRole("tab", { name: "Perguntas frequentes", exact: true }).click();
  const question = page.getByRole("textbox", { name: "Pergunta do comprador", exact: true }); await question.fill("Pergunta ainda não salva T101");
  await save(page, seed.phones.accepted); await expect(question).toHaveValue("Pergunta ainda não salva T101");
  expect(calls.filter(row => row.method === "PUT" && row.path === "/v1/support/settings")).toHaveLength(0);
  const configured = await snapshot(request, seed); expect(configured.publicState).toEqual(before.publicState); expect(configured.staffSendAttempts).toBe(0);
  await capture(page, "settings-" + mode + "-configured");
  const clear = page.waitForResponse(row => new URL(row.url()).pathname === path && row.request().method() === "PUT");
  await page.getByRole("button", { name: "Remover telefone", exact: true }).click(); const cleared = await clear;
  expect(cleared.request().postDataJSON()).toEqual({ fallbackPhone: null }); expect(cleared.status()).toBe(200);
  await expect(question).toHaveValue("Pergunta ainda não salva T101"); await expect(page.getByText("Telefone não configurado", { exact: true })).toBeVisible();
  await capture(page, "settings-" + mode + "-cleared"); await page.reload();
  await expect(page.getByRole("textbox", { name: "WhatsApp da equipe", exact: true })).toHaveValue("");
  const after = await snapshot(request, seed); expect(after.publicState).toEqual(before.publicState); expect(after.setting.fallbackWhatsapp).toBeNull();
  expect(after.providerCalls).toBe(0); expect(after.staffSendAttempts).toBe(0);
});

test("T101 Admin configures the real private endpoint", async ({ page, request }) => {
  const { seed } = await signIn(page, request, "admin"); await save(page, seed.phones.accepted); await page.reload();
  await expect(page.getByRole("textbox", { name: "WhatsApp da equipe", exact: true })).toHaveValue(nationalDisplay(seed.phones.accepted));
  const after = await snapshot(request, seed); expect(after.setting.fallbackWhatsapp).toBe(seed.phones.accepted); expect(after.staffSendAttempts).toBe(0);
});

test("T101 Staff never fetches or displays the recipient", async ({ page, request }) => {
  const { calls } = await signIn(page, request, "staff");
  await expect(page.getByRole("textbox", { name: "WhatsApp da equipe", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Salvar telefone", exact: true })).toHaveCount(0);
  expect(calls.filter(row => row.path === path)).toHaveLength(0); expect((await page.request.get(path)).status()).toBe(403);
});

test("T101 actual canonical alerts refresh the real drawer without resending or clearing its draft", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const { seed, calls } = await signIn(page, request, "owner-services");
  await save(page, seed.phones.unknown); const made = await newCase(request, seed, "unknown");
  await page.goto("/#whatsapp-seller?tab=conversations&ticketId=" + encodeURIComponent(made.ticketId));
  await expect(page.getByText("Envio do alerta à equipe sem confirmação", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Assumir atendimento", exact: true }).click();
  const draft = page.getByRole("textbox", { name: "Sua resposta", exact: true }); await draft.fill("Rascunho não enviado T101");
  const before = await snapshot(request, seed), reads = calls.filter(row => row.path.endsWith("/" + made.ticketId) && row.method === "GET").length;
  const replay = await request.post(`/__service/support-notifications/${seed.fixtureId}/replay`); expect(replay.status()).toBe(200);
  await expect.poll(() => calls.filter(row => row.path.endsWith("/" + made.ticketId) && row.method === "GET").length).toBeGreaterThan(reads);
  await expect(draft).toHaveValue("Rascunho não enviado T101"); await expect(page.getByText("Envio do alerta à equipe sem confirmação", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /reenviar alerta/i })).toHaveCount(0); await capture(page, "staff-alert-mobile-unknown");
  const after = await snapshot(request, seed); expect(after.staffSendAttempts).toBe(1); expect(after.staffSendAttempts).toBe(before.staffSendAttempts);
  expect(after.alertEvents).toBe(1); expect(after.providerCalls).toBe(0); expect(after.authOverrides).toBe(false); expect(after.repositoryOverrides).toBe(false);
  expect(calls.filter(row => row.path === path && row.method === "GET")).toHaveLength(1);
});

test("T101 accepted is distinct from delivery and an unavailable alert remains truthful", async ({ page, request }) => {
  const { seed } = await signIn(page, request, "owner-services"); await save(page, seed.phones.accepted);
  const made = await newCase(request, seed, "accepted"); await page.goto("/#whatsapp-seller?tab=conversations&ticketId=" + encodeURIComponent(made.ticketId));
  await expect(page.getByText("Alerta à equipe aceito pelo canal", { exact: true })).toBeVisible();
  await expect(page.getByText("Alerta à equipe entregue", { exact: true })).toHaveCount(0); await capture(page, "staff-alert-desktop-accepted");
  await page.goto("/#support"); await save(page, seed.phones.unavailable); const unavailable = await newCase(request, seed, "unavailable");
  await page.goto("/#whatsapp-seller?tab=conversations&ticketId=" + encodeURIComponent(unavailable.ticketId));
  await expect(page.getByText("Alerta à equipe indisponível", { exact: true })).toBeVisible(); await capture(page, "staff-alert-desktop-unavailable");
  expect((await snapshot(request, seed)).providerCalls).toBe(0);
});

test("T101 validation and network errors retain the draft and give honest feedback", async ({ page, request }) => {
  const { seed } = await signIn(page, request, "owner-products"); const field = page.getByRole("textbox", { name: "WhatsApp da equipe", exact: true });
  await field.fill("123"); const invalid = page.waitForResponse(row => new URL(row.url()).pathname === path && row.request().method() === "PUT");
  await page.getByRole("button", { name: "Salvar telefone", exact: true }).click(); expect((await invalid).status()).toBe(400);
  await expect(field).toHaveValue("123"); await expect(page.getByRole("alert")).toContainText("Confira o DDD e o número"); await capture(page, "settings-validation-error");
  await page.route("**/v1/support/notification-settings", route => route.request().method() === "PUT" ? route.abort("failed") : route.continue());
  await field.fill(seed.phones.accepted); await page.getByRole("button", { name: "Salvar telefone", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível salvar"); await expect(field).toHaveValue(nationalDisplay(seed.phones.accepted));
  await expect(page.getByText("Telefone não configurado", { exact: true })).toBeVisible(); expect((await snapshot(request, seed)).staffSendAttempts).toBe(0);
});
