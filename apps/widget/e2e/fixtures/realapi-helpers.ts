import { expect, type APIRequestContext, type Page } from "@playwright/test";

// Force IPv4: on this host `localhost` resolves to ::1 first, where neither the
// API (binds IPv4) nor the Docker pg port-proxy answer — handshakes hang/refuse.
export const REALAPI_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:3009";
export const REALAPI_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";

export function checkoutUrl(
  merchantId: string,
  embedToken: string,
  productId: string,
  opts: { customer?: Record<string, unknown> } = {},
): string {
  const url = new URL(REALAPI_BASE);
  url.searchParams.set("merchantId", merchantId);
  url.searchParams.set("embedToken", embedToken);
  url.searchParams.set("apiBaseUrl", REALAPI_URL);
  url.searchParams.set("productId", productId);
  if (opts.customer) {
    url.searchParams.set("customerJson", JSON.stringify(opts.customer));
  }
  return url.toString();
}

export async function seedCheckout(request: APIRequestContext) {
  const seed = await request.post(`${REALAPI_URL}/__test__/seed`);
  if (!seed.ok()) {
    return null;
  }
  return seed.json() as Promise<{ merchantId: string; embedToken: string; productId: string }>;
}

/**
 * The conversational checkout opens with a channel-gate modal ("Sou Zion")
 * that asks the buyer to pick voice or chat. Greeting turns and the composer
 * stay gated until a channel is chosen (see use-checkout-chat `channelReady`),
 * and the modal overlay intercepts pointer events. Real-API specs must dismiss
 * it exactly like a buyer would before driving the chat surface.
 */
export async function dismissChannelGate(
  page: Page,
  channel: "chat" | "voice" = "chat",
): Promise<void> {
  const gate = page.locator(".zyon-channel-gate");
  if (!(await gate.isVisible({ timeout: 15_000 }).catch(() => false))) return;
  const label = channel === "voice" ? /Comprar por voz/i : /Comprar por chat/i;
  const button = page.getByRole("button", { name: label });
  // Channel buttons stay disabled until the session is ready (channelReady).
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await button.click();
  await expect(gate).toBeHidden({ timeout: 10_000 });
}

/**
 * Navigate to the conversational checkout and dismiss the channel-gate so the
 * chat thread + composer are interactive. Returns once `.zyon-thread` is shown.
 */
export async function openChatCheckout(
  page: Page,
  merchantId: string,
  embedToken: string,
  productId: string,
  opts: { customer?: Record<string, unknown> } = {},
): Promise<void> {
  await page.goto(checkoutUrl(merchantId, embedToken, productId, opts));
  await dismissChannelGate(page, "chat");
  await page.waitForSelector('[role="log"]', { timeout: 20_000 });
}

export async function waitForChatIdle(page: Page): Promise<void> {
  await page.waitForTimeout(150);
  await expect(page.locator(".zyon-typing")).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
  await expect(page.locator(".chat-caret")).toHaveCount(0, { timeout: 15_000 });
}

export async function sendChat(page: Page, text: string): Promise<void> {
  await waitForChatIdle(page);
  const form = page.locator(".zyon-composer-form").first();
  const input = form.getByLabel("Mensagem para o assistente");
  const sendButton = form.getByRole("button", { name: "Enviar mensagem" });

  await expect(input).toBeVisible({ timeout: 10_000 });
  await expect(input).toBeEnabled({ timeout: 10_000 });
  await input.fill(text);
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });
  const response = page.waitForResponse(
    (res) => res.url().startsWith(`${REALAPI_URL}/embed/chat`) && res.request().method() === "POST",
  );
  await sendButton.click();
  const answered = await response;
  expect(answered.ok()).toBe(true, `Chat failed: ${await answered.text()}`);
  await waitForChatIdle(page);
}

export const E2E_VERIFIED_CUSTOMER = {
  fullName: "Cliente E2E Integração",
  email: `integration_${Date.now()}@test.aacp`,
  email_verified: true,
  cpf: "12345678901",
  phone: "11999999999",
  phone_verified: true,
  address_verified: true,
  address: {
    zip: "01310100",
    street: "Avenida Paulista",
    neighborhood: "Bela Vista",
    city: "Sao Paulo",
    state: "SP",
  },
};
