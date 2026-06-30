import { expect, type Page } from "@playwright/test";
import { setupApiMocks, type FlowStep, type MockApiOptions } from "./api-mocks.js";

export const CHAT_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

// Drives a full data-collection → shipping handoff via completeChatRegistration's
// 7 explicit messages (name, email, cpf, phone, cep, confirm, number). The
// bootstrap is suppressed by starting from a verified-email experience, so the
// FIRST message (name) maps to ask_email — there is NO leading ask_name step to
// be eaten. msg7 (number) yields show_shipping_options; the PAC click consumes
// shipping_selected.
export const CHAT_REGISTRATION_SEQUENCE: FlowStep[] = [
  "ask_email",
  "ask_cpf",
  "ask_phone",
  "ask_cep",
  "confirm_address",
  "ask_number",
  "show_shipping_options",
  "shipping_selected",
];

export async function installChatTestInit(page: Page) {
  await page.addInitScript(() => {
    (globalThis as { process?: { env: Record<string, string> } }).process = {
      env: { AACP_DISABLE_STREAMING: "1" },
    };
  });
}

export async function ensureChatChannel(page: Page) {
  // On a fresh origin the widget shows the channel gate (chat vs voice) before
  // rendering the thread. Use the specific gate selector with a timeout so the
  // check waits for the gate to render instead of racing it; idempotent when the
  // gate is auto-skipped (e.g. recognized buyer) or already dismissed.
  const gate = page.locator(".zyon-channel-gate__panel[role='dialog']");
  if (await gate.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.getByRole("button", { name: /Comprar por chat/i }).click();
  }
}

export async function waitForGreeting(page: Page) {
  await ensureChatChannel(page);
  const thread = page.locator(".zyon-thread");
  await expect(thread).toBeVisible({ timeout: 10_000 });
  await expect(thread.locator(".zyon-bubble-agent").first()).toBeVisible({ timeout: 10_000 });
}

export async function waitForStreamingDone(page: Page) {
  await expect(page.locator(".chat-caret")).toHaveCount(0, { timeout: 15_000 });
}

export async function sendMessage(page: Page, text: string) {
  const input = page.locator("input[aria-label='Mensagem para o assistente']");
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(text);
  const sendButton = page.locator("button[aria-label='Enviar mensagem']").first();
  await expect(sendButton).toBeEnabled({ timeout: 5_000 });
  await sendButton.click();
}

export async function waitForAgentReply(page: Page) {
  const typing = page.locator(".zyon-typing");
  await page.waitForTimeout(300);
  if (await typing.isVisible()) {
    await expect(typing).toBeHidden({ timeout: 15_000 });
  }
  await waitForStreamingDone(page);
  const bubbles = page.locator(".zyon-bubble-agent");
  return bubbles.nth((await bubbles.count()) - 1);
}

export async function tapQuickReply(page: Page, label: RegExp | string) {
  const btn = page.locator(".zyon-chip, .zyon-quick-replies button").filter({ hasText: label }).first();
  await expect(btn).toBeVisible({ timeout: 5_000 });
  await btn.click();
  await waitForStreamingDone(page);
}

export async function continueWithoutCoupon(page: Page) {
  const noCoupon = page
    .getByRole("button", { name: /^N[aã]o$/i })
    .or(page.locator(".zyon-chip, .zyon-quick-replies button").filter({ hasText: /N(?:a|ã)o tenho cupom/i }))
    .first();
  await expect(noCoupon).toBeVisible({ timeout: 5_000 });
  await noCoupon.click();
  await waitForStreamingDone(page);
}

function resolveMockOptions(options: MockApiOptions | FlowStep[]): MockApiOptions {
  return Array.isArray(options) ? { chatSequence: options } : options;
}

export async function openChatCheckout(page: Page, options: MockApiOptions | FlowStep[] = []) {
  await setupApiMocks(page, resolveMockOptions(options));
  await page.goto(CHAT_BASE);
  await waitForGreeting(page);
  await waitForStreamingDone(page);
}

export async function openChatFromChannelGate(page: Page, options: MockApiOptions | FlowStep[] = []) {
  await setupApiMocks(page, resolveMockOptions(options));
  await page.goto(CHAT_BASE);
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /Comprar por chat/i }).click();
  await waitForGreeting(page);
  await waitForStreamingDone(page);
}

export async function completeChatRegistration(page: Page) {
  await sendMessage(page, "João Silva");
  await waitForAgentReply(page);
  await sendMessage(page, "joao@email.com");
  await waitForAgentReply(page);
  await sendMessage(page, "123.456.789-00");
  await waitForAgentReply(page);
  await sendMessage(page, "(11) 99999-0000");
  await waitForAgentReply(page);
  await sendMessage(page, "01310-100");
  await waitForAgentReply(page);
  await sendMessage(page, "Sim, está correto");
  await waitForAgentReply(page);
  await sendMessage(page, "123, Apto 4B");
  await waitForAgentReply(page);
}

export async function selectChatShipping(page: Page, method: RegExp = /PAC/) {
  const selector = page.locator(".zyon-shipping-selector");
  await expect(selector).toBeVisible({ timeout: 5_000 });
  await selector.locator("button", { hasText: method }).first().click();
  await waitForAgentReply(page);
  await continueWithoutCoupon(page);
}
