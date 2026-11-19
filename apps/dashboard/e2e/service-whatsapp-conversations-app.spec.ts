import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "http://127.0.0.1:5187";
const captures = resolve(process.cwd(), "../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts");
interface Seed { fixtureId: string; email: string; password: string; ticketId: string; merchantId: string; role: "STAFF" | "OWNER" | "ADMIN"; mode: "products" | "services" }
const matches = (response: { url(): string; request(): { method(): string } }, path: string, method = "GET") =>
  new URL(response.url()).pathname === path && response.request().method() === method;
test.beforeEach(async ({ context }) => {
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
});
async function signIn(page: Page, request: APIRequestContext, scenario: string, selected = true) {
  const created = await request.post("/__service/conversation-app/" + scenario); expect(created.status()).toBe(200); const seed: Seed = await created.json();
  const calls: Array<{ path: string; method: string }> = [];
  page.on("request", value => { const path = new URL(value.url()).pathname; if (path.startsWith("/v1/")) calls.push({ path, method: value.method() }); });
  await page.goto("/?mode=signin#whatsapp-seller?tab=conversations" + (selected ? "&ticketId=" + encodeURIComponent(seed.ticketId) : ""));
  await page.getByLabel("E-mail", { exact: true }).fill(seed.email); await page.getByLabel("Senha", { exact: true }).fill(seed.password);
  const loggedIn = page.waitForResponse(response => matches(response, "/v1/auth/login", "POST"));
  await page.getByRole("button", { name: "Entrar", exact: true }).last().click(); expect((await loggedIn).status()).toBe(201);
  await expect(page.getByRole("tab", { name: "Conversas", exact: true })).toHaveAttribute("aria-selected", "true");
  return { seed, calls };
}
async function snapshot(request: APIRequestContext, seed: Seed) {
  const response = await request.get(`/__service/conversations/${seed.fixtureId}/snapshot`); expect(response.status()).toBe(200); return response.json();
}
async function capture(page: Page, name: string, dialog = false) {
  if (dialog) { await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1"); await expect(page.getByRole("dialog")).toBeInViewport({ ratio: 1 }); }
  else await expect(page.getByRole("tab", { name: "Conversas", exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await mkdir(captures, { recursive: true }); await page.screenshot({ path: resolve(captures, name), fullPage: false });
}

test("T62 Staff uses the real main route, canonical operation, direct URL, refresh, back and logout", async ({ page, request }) => {
  const { seed, calls } = await signIn(page, request, "staff"); const before = await snapshot(request, seed);
  await expect(page.getByRole("dialog")).toBeVisible(); expect(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("ticketId")).toBe(seed.ticketId);
  expect((await page.request.get("/v1/merchants/me")).status()).toBe(403); expect((await page.request.get("/v1/auth/me")).status()).toBe(403);
  const context = await page.request.get("/v1/support/whatsapp/conversations/context"); expect(context.status()).toBe(200);
  const actor = await context.json(); expect(Object.keys(actor).sort()).toEqual(["merchant_id", "role", "user_id"]); expect(actor.role).toBe("STAFF"); expect(actor.merchant_id).toBe(seed.merchantId);
  expect(calls.some(value => /store-settings|billing|whatsapp-channel|whatsapp-usage/.test(value.path))).toBe(false);
  // Observe the already-required reload response; do not issue another quota read.
  const listed = page.waitForResponse(response => matches(response, "/v1/support/whatsapp/conversations"));
  await page.reload(); await expect(page.getByRole("dialog")).toBeVisible();
  const queueResponse = await listed; expect(queueResponse.status()).toBe(200);
  const queue = await queueResponse.json(), rowIndex = queue.data.findIndex((row: { id: string }) => row.id === seed.ticketId);
  expect(rowIndex).toBeGreaterThanOrEqual(0);
  // Create list -> selected history with the actual queue gesture, rather than
  // traversing into the browser's initial about:blank or pre-login document.
  await page.getByRole("button", { name: "Fechar", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("list", { name: "Fila de conversas", exact: true }).getByRole("button", { name: "Abrir conversa", exact: true }).nth(rowIndex).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("ticketId")).toBe(seed.ticketId);
  await page.getByRole("button", { name: "Assumir atendimento", exact: true }).click();
  await expect(page.getByText("Atendimento humano com você", { exact: true })).toBeVisible();
  const navigationDraft = "Rascunho de navegacao ainda nao enviado";
  const draftInput = page.getByRole("textbox", { name: "Sua resposta", exact: true }); await draftInput.fill(navigationDraft);
  await page.goBack(); await expect(page.getByRole("button", { name: "Continuar editando", exact: true })).toBeVisible();
  await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("ticketId")).toBe(seed.ticketId);
  await page.getByRole("button", { name: "Continuar editando", exact: true }).click(); await expect(draftInput).toHaveValue(navigationDraft);
  await page.goBack(); await expect(page.getByRole("button", { name: "Descartar e fechar", exact: true })).toBeVisible();
  await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("ticketId")).toBe(seed.ticketId);
  await page.getByRole("button", { name: "Descartar e fechar", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).has("ticketId")).toBe(false);
  await page.goForward(); await expect(page.getByRole("dialog")).toBeVisible();
  expect(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("ticketId")).toBe(seed.ticketId);
  await expect(draftInput).toHaveValue("");
  await expect(page.getByText("Atendimento humano com voc\u00ea", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Atendimento conectado" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Encerrar e retomar IA", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("textbox", { name: "Sua resposta", exact: true })).toBeInViewport({ ratio: 1 });
  await capture(page, "whatsapp-conversations-drawer.running.png", true);
  expect(calls.filter(value => value.method === "POST" && value.path.endsWith("/messages"))).toHaveLength(0);
  const input = page.getByRole("textbox", { name: "Sua resposta", exact: true }); await input.fill("Atendimento pelo módulo WhatsApp");
  await page.getByRole("button", { name: "Enviar resposta", exact: true }).click();
  await expect.poll(async () => (await snapshot(request, seed)).messages.find((row: { content: string }) => row.content === "Atendimento pelo módulo WhatsApp")?.deliveryStatus).toBe("unknown");
  await expect(input).toHaveValue("Atendimento pelo módulo WhatsApp");
  const sent = await snapshot(request, seed); expect(sent.operatorSendAttempts).toBe(1);
  await page.getByRole("button", { name: "Encerrar e retomar IA", exact: true }).click(); await page.getByRole("button", { name: "Encerrar sem enviar", exact: true }).click();
  await expect(page.getByText("Atendimento humano encerrado · IA ativa", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fechar", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).has("ticketId")).toBe(false);
  await expect(page.getByRole("list", { name: "Fila de conversas", exact: true })).toBeVisible();
  await expect.poll(async () => ({
    refreshEnabled: await page.getByRole("button", { name: "Atualizar conversas", exact: true }).isEnabled(),
    loadingCount: await page.getByRole("status").filter({ hasText: "Carregando conversas" }).count(),
  })).toEqual({ refreshEnabled: true, loadingCount: 0 });
  await expect(page.getByRole("heading", { name: "Conversas", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("list", { name: "Fila de conversas", exact: true }).getByRole("button", { name: "Abrir conversa", exact: true }).first()).toBeInViewport({ ratio: 1 });
  await capture(page, "whatsapp-conversations-tab.running.png");
  await page.goBack(); await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Atendimento humano encerrado · IA ativa", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Abrir conversa", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const selected = new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("ticketId"); expect(selected).toBeTruthy();
  expect(calls.some(value => value.method === "GET" && value.path === "/v1/support/whatsapp/conversations/" + selected)).toBe(true);
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.evaluate(() => { window.location.hash = "whatsapp-seller?tab=usage"; });
  await expect(page.getByRole("alert")).toContainText("Esta opção não está disponível"); await expect(page.getByRole("tab", { name: "Consumo e cobrança", exact: true })).toHaveCount(0);
  const final = await snapshot(request, seed); expect(final.binding.mode).toBe("ai"); expect(final.checkoutCart).toEqual(before.checkoutCart); expect(final.providerCalls).toBe(0);
  await page.getByRole("button", { name: "Sair", exact: true }).click(); await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  await expect(page.getByRole("log")).toHaveCount(0);
});

test("T62 service Owner keeps private tabs and clears only its actual accepted intent", async ({ page, request }) => {
  const { seed } = await signIn(page, request, "services-owner"); await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Assumir atendimento", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Sua resposta", exact: true }); await input.fill("Resposta aceita no aplicativo");
  await page.getByRole("button", { name: "Enviar resposta", exact: true }).click(); await expect(input).toHaveValue("");
  const actual = await snapshot(request, seed), message = actual.messages.find((row: { content: string }) => row.content === "Resposta aceita no aplicativo");
  expect(message.deliveryStatus).toBe("accepted"); expect(actual.operatorSendAttempts).toBe(1); expect(actual.providerCalls).toBe(0);
  await expect(page.getByRole("log")).toContainText("Aceita pelo canal"); await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("tab", { name: "Conexão", exact: true }).click(); await expect(page.getByRole("tab", { name: "Conexão", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Modelos de mensagem", exact: true }).click(); await expect(page.getByRole("tab", { name: "Modelos de mensagem", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Consumo e cobrança", exact: true }).click(); await expect(page.getByRole("tab", { name: "Consumo e cobrança", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Conversas", exact: true }).click(); await expect(page.getByRole("list", { name: "Fila de conversas", exact: true })).toBeVisible();
});

test("T62 products Owner retains authorized closure on an inactive channel in the real app", async ({ page, request }) => {
  const { seed } = await signIn(page, request, "products-owner"); await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar resposta", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Encerrar e retomar IA", exact: true }).click(); await expect(page.getByText("Atendimento humano encerrado · IA ativa", { exact: true })).toBeVisible();
  expect((await snapshot(request, seed)).binding.mode).toBe("ai");
  await page.getByRole("button", { name: "Fechar", exact: true }).click(); await expect(page.getByRole("tab", { name: "Conversas", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("T62 Admin foreign ticket stays private and a real session expiry clears the app", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const { seed } = await signIn(page, request, "admin");
  await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Não foi possível carregar");
  await expect(page.getByRole("log")).toHaveCount(0); await expect(page.getByRole("button", { name: "Assumir atendimento", exact: true })).toHaveCount(0);
  const forbidden = await page.request.get("/v1/support/whatsapp/conversations/" + encodeURIComponent(seed.ticketId)); expect(forbidden.status()).toBe(404);
  await capture(page, "whatsapp-conversations-tab-error.running.png", true);
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await expect(page.getByRole("list", { name: "Fila de conversas", exact: true })).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => ({
    refreshEnabled: await page.getByRole("button", { name: "Atualizar conversas", exact: true }).isEnabled(),
    loadingCount: await page.getByRole("status").filter({ hasText: "Carregando conversas" }).count(),
  })).toEqual({ refreshEnabled: true, loadingCount: 0 });
  await capture(page, "whatsapp-conversations-tab-mobile.running.png");
  const loggedOut = await page.request.post("/v1/auth/logout"); expect(loggedOut.ok()).toBe(true);
  await page.getByRole("button", { name: "Atualizar conversas", exact: true }).click();
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible(); await expect(page.getByRole("log")).toHaveCount(0); await expect(page.getByRole("tab", { name: "Conversas", exact: true })).toHaveCount(0);
});
