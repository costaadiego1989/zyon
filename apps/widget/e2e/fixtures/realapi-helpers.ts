import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const REALAPI_URL = "http://localhost:3000";
export const REALAPI_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

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

export async function waitForChatIdle(page: Page): Promise<void> {
  await page.waitForTimeout(150);
  await expect(page.locator(".aacp-typing")).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
  await expect(page.locator(".chat-caret")).toHaveCount(0, { timeout: 15_000 });
}

export async function sendChat(page: Page, text: string): Promise<void> {
  await waitForChatIdle(page);
  const form = page.locator(".aacp-composer-form").first();
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
