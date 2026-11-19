import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "http://127.0.0.1:5187";
const captures = resolve(process.cwd(), "../../.specs/features/whatsapp-service-booking-business-rag/captures/artifacts");
test.beforeEach(async ({ context }) => {
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
});
async function renderedDialog(page: Page) {
  const panel = page.getByRole("dialog");
  await expect(panel).toHaveCSS("opacity", "1");
  await expect(panel).toBeInViewport({ ratio: 1 });
  const styles = await panel.evaluate(element => ({ background: getComputedStyle(element).backgroundColor,
    surface: getComputedStyle(element).getPropertyValue("--surface-2").trim(), font: getComputedStyle(element).getPropertyValue("--font-sans").trim() }));
  expect(styles.surface).not.toBe(""); expect(styles.font).not.toBe(""); expect(styles.background).not.toBe("rgba(0, 0, 0, 0)");
}

async function controlsAfterHistoryScroll(page: Page, action: string) {
  const history = page.getByRole("log", { name: "Histórico da conversa" });
  await history.locator(".support-msg").last().scrollIntoViewIfNeeded();
  await history.hover(); await page.mouse.wheel(0, 600);
  await expect.poll(() => page.locator(".ui-dialog__body").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator(".support-chat__status")).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: action, exact: true })).toBeInViewport({ ratio: 1 });
}

test("T61 staff canonical history, uncertain draft, keyboard and closure", async ({ page, request }) => {
  const response = await request.post("/__service/conversations/staff-active"); expect(response.status()).toBe(200);
  const seed = await response.json(), read = async () => {
    const response = await request.get(`/__service/conversations/${seed.fixtureId}/snapshot`); expect(response.status()).toBe(200); return response.json();
  };
  const before = await read();
  await page.goto("/__service/conversations?scenario=staff-active");
  const opener = page.getByRole("button", { name: "Abrir conversa", exact: true }); await expect(opener).toBeEnabled();
  // This uses the real HttpOnly login cookie; Staff gets no private profile.
  expect((await page.request.get("/v1/merchants/me")).status()).toBe(403);
  expect((await page.request.get("/v1/auth/me")).status()).toBe(403);
  const principalResponse = await page.request.get("/v1/support/whatsapp/conversations/context"); expect(principalResponse.status()).toBe(200);
  const principal = await principalResponse.json(); expect(Object.keys(principal).sort()).toEqual(["merchant_id", "role", "user_id"]); expect(principal.role).toBe("STAFF");
  await opener.click(); await expect(page.getByRole("dialog")).toBeVisible();
  await controlsAfterHistoryScroll(page, "Assumir atendimento");
  await page.getByRole("button", { name: "Assumir atendimento", exact: true }).click();
  await expect(page.getByText("Atendimento humano com você", { exact: true })).toBeVisible();
  await expect(page.getByText("Atendimento conectado", { exact: true })).toBeVisible();
  const history = page.getByRole("log", { name: "Histórico da conversa" });
  for (const label of ["Na fila", "Aceita pelo canal", "Entregue", "Lida", "Falhou", "Envio não confirmado"]) await expect(history.getByText(label, { exact: true })).toHaveCount(1);
  // These persisted historical delivery states are synthetic fixture projections.
  // The send/claim/close below use the actual served authenticated API.
  await mkdir(captures, { recursive: true });
  await controlsAfterHistoryScroll(page, "Encerrar e retomar IA");
  await renderedDialog(page);
  await page.screenshot({ path: resolve(captures, "whatsapp-conversations.running.png"), fullPage: true });
  const input = page.getByRole("textbox", { name: "Sua resposta", exact: true });
  await input.fill("Resposta sintética sem confirmação"); await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Continuar editando", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continuar editando", exact: true }).click(); await expect(input).toBeFocused();
  await expect(input).toHaveValue("Resposta sintética sem confirmação");
  // Keyboard traversal remains within the dialog and invokes its real send.
  await input.press("Tab"); await expect(page.getByRole("button", { name: "Enviar resposta", exact: true })).toBeFocused(); await page.keyboard.press("Enter");
  await expect(history.getByText("Resposta sintética sem confirmação", { exact: true })).toHaveCount(1);
  await expect.poll(async () => (await read()).messages.find((row: { content: string }) => row.content === "Resposta sintética sem confirmação")?.deliveryStatus).toBe("unknown");
  await expect(input).toHaveValue("Resposta sintética sem confirmação");
  const unknown = await read(), sent = unknown.messages.find((row: { content: string }) => row.content === "Resposta sintética sem confirmação");
  expect(sent.clientMessageId).toBeTruthy(); expect(unknown.operatorSendAttempts).toBe(1);
  const retried = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/conversations/${seed.ticketId}/messages`));
  await page.getByRole("button", { name: "Enviar resposta", exact: true }).click();
  const retryResponse = await retried; expect(retryResponse.status()).toBe(201); expect((await retryResponse.json()).id).toBe(sent.id);
  expect(retryResponse.request().postDataJSON().clientMessageId).toBe(sent.clientMessageId);
  const replay = await read();
  expect(replay.messages.filter((row: { content: string }) => row.content === "Resposta sintética sem confirmação")).toHaveLength(1);
  expect(replay.operatorSendAttempts).toBe(1); expect(replay.messages.find((row: { id: string }) => row.id === sent.id).clientMessageId).toBe(sent.clientMessageId);
  await expect(input).toHaveValue("Resposta sintética sem confirmação");
  await controlsAfterHistoryScroll(page, "Encerrar e retomar IA");
  await renderedDialog(page); await page.screenshot({ path: resolve(captures, "whatsapp-conversations-unknown.running.png"), fullPage: true });
  await page.getByRole("button", { name: "Encerrar e retomar IA", exact: true }).click();
  await expect(page.getByRole("button", { name: "Encerrar sem enviar", exact: true })).toBeVisible();
  expect((await read()).binding.mode).toBe("human");
  await page.getByRole("button", { name: "Encerrar sem enviar", exact: true }).click();
  await expect(page.getByText("Atendimento humano encerrado · IA ativa", { exact: true })).toBeVisible();
  const closed = await read(); expect(closed.binding.mode).toBe("ai"); expect(closed.ticketStatus).toBe("closed"); expect(closed.checkoutCart).toEqual(before.checkoutCart);
  expect(closed.providerCalls).toBe(0); expect(closed.authOverrides).toBe(false); expect(closed.repositoryOverrides).toBe(false);
  await page.getByRole("button", { name: "Fechar", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(opener).toBeFocused();
  const historySeedResponse = await request.post("/__service/conversations/staff-history"); expect(historySeedResponse.status()).toBe(200); const historySeed = await historySeedResponse.json();
  await page.goto("/__service/conversations?scenario=staff-history"); await page.getByRole("button", { name: "Abrir conversa", exact: true }).click();
  const more = page.waitForResponse(response => response.url().includes(`/conversations/${historySeed.ticketId}?`) && response.url().includes("cursor="));
  await page.getByRole("button", { name: "Carregar mais mensagens", exact: true }).click(); expect((await more).status()).toBe(200);
  const paginated = page.getByRole("log", { name: "Histórico da conversa" }); await expect(paginated).toContainText("Histórico adicional #104");
  await controlsAfterHistoryScroll(page, "Assumir atendimento");
  const lines = await paginated.locator(".support-msg p").allTextContents(); expect(lines[0]).toBe("Histórico adicional #0"); expect(lines.filter(line => line.startsWith("Histórico adicional #"))).toHaveLength(105);
});

test("T61 products owner inactive channel keeps authorized closure and mobile focus", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await request.post("/__service/conversations/products-inactive"); expect(response.status()).toBe(200); const seed = await response.json();
  await page.goto("/__service/conversations?scenario=products-inactive");
  await page.getByRole("button", { name: "Abrir conversa", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enviar resposta", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Encerrar e retomar IA", exact: true })).toBeEnabled();
  await expect(page.getByText(/O canal está indisponível para responder/)).toBeVisible();
  await controlsAfterHistoryScroll(page, "Encerrar e retomar IA");
  await mkdir(captures, { recursive: true }); await renderedDialog(page); await page.screenshot({ path: resolve(captures, "whatsapp-conversations-mobile.running.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const close = page.getByRole("button", { name: "Fechar", exact: true }); await close.focus(); await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("dialog")).toBeVisible(); expect(await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))).toBe(true);
  await page.getByRole("button", { name: "Encerrar e retomar IA", exact: true }).click();
  await expect(page.getByText("Atendimento humano encerrado · IA ativa", { exact: true })).toBeVisible();
  const snapshot = await request.get(`/__service/conversations/${seed.fixtureId}/snapshot`); expect(snapshot.status()).toBe(200);
  const actual = await snapshot.json(); expect(actual.binding.mode).toBe("ai"); expect(actual.operatorSendAttempts).toBe(0); expect(actual.providerCalls).toBe(0);
});

test("T61 services owner clears only the accepted canonical intent", async ({ page, request }) => {
  const response = await request.post("/__service/conversations/owner-accepted"); expect(response.status()).toBe(200); const seed = await response.json();
  await page.goto("/__service/conversations?scenario=owner-accepted"); await page.getByRole("button", { name: "Abrir conversa", exact: true }).click();
  await page.getByRole("button", { name: "Assumir atendimento", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Sua resposta", exact: true }); await input.fill("Resposta com aceite canônico"); await page.getByRole("button", { name: "Enviar resposta", exact: true }).click();
  await expect(input).toHaveValue("");
  const responseState = await request.get(`/__service/conversations/${seed.fixtureId}/snapshot`); expect(responseState.status()).toBe(200); const actual = await responseState.json();
  const message = actual.messages.find((row: { content: string }) => row.content === "Resposta com aceite canônico");
  expect(message.deliveryStatus).toBe("accepted"); expect(message.clientMessageId).toBeTruthy(); expect(actual.operatorSendAttempts).toBe(1);
  const row = page.getByRole("log").locator(".support-msg", { hasText: "Resposta com aceite canônico" });
  await expect(row).toContainText("Aceita pelo canal"); await expect(row).not.toContainText("Lida");
});
