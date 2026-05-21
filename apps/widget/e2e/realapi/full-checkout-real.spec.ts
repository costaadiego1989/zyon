/**
 * @realapi full checkout real - REQ-CHK-001 through REQ-CHK-005
 *
 * Verifies the checkout surface against the real local NestJS API.
 */
import { test, expect, type Page } from "@playwright/test";

const API = "http://localhost:3000";
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

function checkoutUrl(
  merchantId: string,
  embedToken: string,
  productId: string,
  opts: { customer?: Record<string, unknown> } = {}
): string {
  const url = new URL(BASE);
  url.searchParams.set("merchantId", merchantId);
  url.searchParams.set("embedToken", embedToken);
  url.searchParams.set("apiBaseUrl", API);
  url.searchParams.set("productId", productId);
  if (opts.customer) {
    url.searchParams.set("customerJson", JSON.stringify(opts.customer));
  }
  return url.toString();
}

async function waitForChatIdle(page: Page): Promise<void> {
  await page.waitForTimeout(150);
  await expect(page.locator(".aacp-typing")).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
  await expect(page.locator(".chat-caret")).toHaveCount(0, { timeout: 15_000 });
}

async function sendChat(page: Page, text: string): Promise<void> {
  await waitForChatIdle(page);
  const form = page.locator(".aacp-composer-form").first();
  const input = form.getByLabel("Mensagem para o assistente");
  const sendButton = form.getByRole("button", { name: "Enviar mensagem" });

  await expect(input).toBeVisible({ timeout: 10_000 });
  await expect(input).toBeEnabled({ timeout: 10_000 });
  await input.fill(text);
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });
  const response = page.waitForResponse((res) =>
    res.url().startsWith(`${API}/embed/chat`) && res.request().method() === "POST"
  );
  await sendButton.click();
  await response;
  await waitForChatIdle(page);
}

test.describe("full checkout real @realapi", () => {
  test.describe.configure({ mode: "serial" });

  let merchantId: string;
  let embedToken: string;
  let productId: string;

  test.beforeEach(async ({ request }) => {
    const seed = await request.post(`${API}/__test__/seed`);
    if (!seed.ok()) {
      test.skip(true, "Seed endpoint not available (E2E_SEED_ENABLED not set)");
      return;
    }
    ({ merchantId, embedToken, productId } = await seed.json());
  });

  test("shipping selector hidden and price zero before address [REQ-CHK-001]", async ({ page }) => {
    const startRequestPromise = page.waitForRequest((request) =>
      request.url() === `${API}/embed/start` && request.method() === "POST"
    );

    await page.goto(checkoutUrl(merchantId, embedToken, productId));
    const startRequest = await startRequestPromise;
    const startBody = JSON.parse(startRequest.postData() ?? "{}") as Record<string, unknown>;
    expect(startRequest.headers()["x-aacp-embed-token"]).toBe(embedToken);
    expect(startBody.shipping).toBeUndefined();

    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });
    await expect(page.locator(".aacp-shipping-selector")).not.toBeVisible();

    const cartBtn = page.locator(".aacp-cart-btn, [aria-label='Carrinho']").first();
    if (await cartBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await cartBtn.click();
      const cart = page.locator("#aacp-cart-panel");
      await expect(cart).toContainText("Aguardando");
      await expect(cart).not.toContainText("R$ 19,90");
    }
  });

  test("coupon input not visible before quick reply tap [REQ-CHK-004]", async ({ page }) => {
    await page.goto(checkoutUrl(merchantId, embedToken, productId));
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });

    await page.waitForTimeout(2_000);
    await expect(page.locator(".aacp-coupon-box")).not.toBeVisible();
    await expect(page.locator("input[placeholder*='cupom' i]")).not.toBeVisible();
  });

  test("full checkout flow renders without crash", async ({ page }) => {
    await page.goto(checkoutUrl(merchantId, embedToken, productId));
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });

    await expect(page.locator(".aacp-thread")).toBeVisible();

    const bubble = page.locator(".aacp-bubble, [data-testid='chat-bubble'], .aacp-message").first();
    await expect(bubble).toBeVisible({ timeout: 10_000 });

    await expect(page.locator(".error-overlay, [data-testid='error']")).not.toBeVisible();
    await expect(page.locator(".aacp-coupon-box")).not.toBeVisible();
    await expect(page.locator(".aacp-shipping-selector")).not.toBeVisible();
  });

  test("real chat quotes shipping and cart updates only after selection", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      (globalThis as any).process = { env: { AACP_DISABLE_STREAMING: "1" } };
    });

    const customer = {
      fullName: "Cliente E2E",
      email: `shipping_${Date.now()}@test.aacp`,
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
        state: "SP"
      }
    };

    await page.goto(checkoutUrl(merchantId, embedToken, productId, { customer }));
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });
    await waitForChatIdle(page);

    await sendChat(page, "1000");
    await sendChat(page, "Nao tem");

    const selector = page.locator(".aacp-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 10_000 });
    await expect(selector.locator("button").first()).toContainText(/R\$/);

    await page.locator(".aacp-cart-btn").click();
    const cart = page.locator("#aacp-cart-panel");
    await expect(cart).toContainText("Aguardando");

    const selected = selector.locator("button").first();
    const selectedText = await selected.textContent();
    const selectedMethod = selectedText?.replace(/\s+/g, " ").trim() ?? "";
    const selectionResponse = page.waitForResponse((res) =>
      res.url() === `${API}/embed/chat` && res.request().method() === "POST"
    );
    await selected.click();
    await selectionResponse;
    await waitForChatIdle(page);

    await expect(selector).toBeHidden({ timeout: 10_000 });
    await expect(cart).not.toContainText("Aguardando");
    const cartText = await cart.textContent();
    expect(cartText ?? "").toMatch(/Frete[\s\S]*R\$/);
    expect(selectedMethod).toMatch(/R\$/);

    await page.locator(".aacp-cart-btn").click();
    const paymentResponse = page.waitForResponse((res) =>
      res.url() === `${API}/embed/payment/intents` && res.request().method() === "POST"
    );
    await page.locator(".aacp-chip", { hasText: /^PIX$/i }).click();
    const paid = await paymentResponse;
    expect(paid.ok()).toBe(true, `Payment failed: ${await paid.text()}`);
    const paymentBody = await paid.json();
    expect(paymentBody.status).toBe("approved");

    const confirmation = page.locator(".aacp-order-confirmation");
    await expect(confirmation).toBeVisible({ timeout: 10_000 });
    await expect(confirmation).toContainText(/Pedido confirmado|sucesso/i);
    await expect(page.locator(".aacp-composer-wrap")).toHaveCount(0);
  });

  test("support panel answers through real support API", async ({ page }) => {
    await page.goto(checkoutUrl(merchantId, embedToken, productId));
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });

    await page.getByRole("button", { name: "Abrir suporte" }).click();
    const panel = page.locator("aside.aacp-ai-panel");
    await expect(panel).toHaveClass(/open/, { timeout: 5_000 });

    const response = page.waitForResponse((res) =>
      res.url() === `${API}/support/chat` && res.request().method() === "POST"
    );
    await panel.getByLabel("Mensagem para o suporte").fill("Qual o prazo de entrega?");
    await panel.getByRole("button", { name: "Enviar mensagem ao suporte" }).click();
    const answered = await response;
    expect(answered.ok()).toBe(true, `Support failed: ${await answered.text()}`);

    await expect(panel.locator(".aacp-bubble-agent").last()).toContainText(
      /frete|prazo|rastreamento|entrega/i,
      { timeout: 10_000 }
    );
  });
});

test.describe("full checkout real API @realapi", () => {
  test("buyer registration and hub profile in snake_case [REQ-CHK-005]", async ({ request }) => {
    const email = `e2e_full_${Date.now()}@test.aacp`;
    const reg = await request.post(`${API}/buyer/register`, {
      data: { email, password: "e2ePass123!", displayName: "Full Test Buyer" }
    });
    expect(reg.ok()).toBe(true, `Register failed: ${await reg.text()}`);
    const regBody = await reg.json();
    expect(regBody.accessToken).toBeTruthy();

    const token = regBody.accessToken as string;

    const me = await request.get(`${API}/buyer/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(me.ok()).toBe(true, `GET /buyer/me failed: ${await me.text()}`);
    const profile = await me.json();
    expect(profile.global_user_id).toBeTruthy();
    expect(profile.display_name).toBe("Full Test Buyer");
    expect(profile.email).toBe(email);
    expect(profile.passwordHash).toBeUndefined();

    const summary = await request.get(`${API}/buyer/me/summary`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(summary.ok()).toBe(true);
    const stats = await summary.json();
    expect(typeof stats.orders_count).toBe("number");
    expect(typeof stats.total_spent).toBe("number");
    expect(stats.currency).toBe("BRL");

    const purchases = await request.get(`${API}/buyer/me/purchases?limit=5`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(purchases.ok()).toBe(true);
    const page = await purchases.json();
    expect(Array.isArray(page.items)).toBe(true);
    expect("next_cursor" in page).toBe(true);
  });

  test("shipping quote endpoint returns selectable results [REQ-CHK-002,003]", async ({ request }) => {
    const seed = await request.post(`${API}/__test__/seed`);
    expect(seed.ok()).toBe(true);
    const { merchantId, embedToken } = await seed.json();
    const started = await request.post(`${API}/embed/start`, {
      data: {
        customer: {},
        cart: {
          currency: "BRL",
          source: "storefront",
          total: 150,
          items: [{ sku: "e2e_product_001", name: "Produto E2E", price: 150, quantity: 1 }]
        }
      },
      headers: { "x-aacp-embed-token": embedToken }
    });
    expect(started.ok()).toBe(true, `Start failed: ${await started.text()}`);
    const startedBody = await started.json();

    const quote = await request.post(`${API}/embed/shipping/quote`, {
      data: {
        session_id: startedBody.session_id,
        merchant_id: merchantId,
        destination_zip: "01310100",
        cart_total: 150.0
      },
      headers: { "Content-Type": "application/json" }
    });

    expect(quote.ok()).toBe(true, `Quote failed: ${await quote.text()}`);
    const body = await quote.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]).toHaveProperty("carrier_key");
    expect(body.results[0]).toHaveProperty("price");
  });
});
