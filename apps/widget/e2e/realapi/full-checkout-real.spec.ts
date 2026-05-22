/**
 * @realapi full checkout real - REQ-CHK-001 through REQ-CHK-005
 *
 * Verifies the checkout surface against the real local NestJS API.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

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
  const answered = await response;
  expect(answered.ok()).toBe(true, `Chat failed: ${await answered.text()}`);
  await waitForChatIdle(page);
}

async function waitForTestWebhook(
  request: APIRequestContext,
  bucket: string,
  eventType: string
): Promise<{ headers: Record<string, unknown>; body: Record<string, any> }> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const received = await request.get(`${API}/__test__/webhook-receiver/${bucket}`);
    expect(received.ok()).toBe(true);
    const body = await received.json();
    const delivery = (body.deliveries as Array<{ headers: Record<string, unknown>; body: Record<string, any> }>).find(
      (candidate) => candidate.body?.event_type === eventType
    );
    if (delivery) return delivery;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for webhook ${eventType} in bucket ${bucket}`);
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

  test("email OTP typed in chat keeps API alive and advances checkout", async ({ page, request }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      (globalThis as any).process = { env: { AACP_DISABLE_STREAMING: "1" } };
    });

    const startResponse = page.waitForResponse((res) =>
      res.url() === `${API}/embed/start` && res.request().method() === "POST"
    );
    await page.goto(checkoutUrl(merchantId, embedToken, productId));
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });
    const started = await startResponse;
    expect(started.ok()).toBe(true, `Start failed: ${await started.text()}`);
    const startedBody = await started.json();
    const sessionId = startedBody.session_id as string;
    expect(sessionId).toBeTruthy();

    await sendChat(page, "Diego Costa");
    const buyerEmail = `diego_${Date.now()}@test.aacp`;
    await sendChat(page, buyerEmail);

    const afterEmail = await request.get(`${API}/checkout/${merchantId}/${sessionId}`);
    expect(afterEmail.ok()).toBe(true, `Checkout session lookup failed: ${await afterEmail.text()}`);
    const session = await afterEmail.json();
    const otpCode = session.customer?.otp_code as string | undefined;
    expect(otpCode).toMatch(/^\d{6}$/);

    await sendChat(page, otpCode!);

    await expect(page.getByText("Falha ao falar com a IA")).toHaveCount(0);
    await expect(page.locator(".aacp-composer-form").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".aacp-thread")).toContainText(/CPF|telefone|celular/i, { timeout: 10_000 });

    const afterOtpHealth = await request.post(`${API}/__test__/seed`);
    expect(afterOtpHealth.ok()).toBe(true, `API did not stay healthy after OTP: ${await afterOtpHealth.text()}`);
  });

  test("real chat quotes shipping, cross-sell, coupon gate, and cart updates only after selection", async ({ page, request }) => {
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

    const promotion = await request.post(`${API}/merchant/cross-sell/promotions`, {
      data: {
        merchant_id: merchantId,
        name: "Complemento E2E",
        trigger: { cart_total_above: 1 },
        recommended_skus: ["CART-COE-01"],
        discount_percent: 0,
        max_discount_percent: 0,
        starts_at: new Date(Date.now() - 60_000).toISOString()
      }
    });
    expect(promotion.ok()).toBe(true, `Cross-sell seed failed: ${await promotion.text()}`);

    await page.goto(checkoutUrl(merchantId, embedToken, productId, { customer }));
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });
    await waitForChatIdle(page);

    await sendChat(page, "1000");
    await sendChat(page, "Nao tem");

    const selector = page.locator(".aacp-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 10_000 });
    await expect(selector.locator("button").first()).toContainText(/R\$/);
    await expect(selector).toContainText("Correios");
    await expect(selector).toContainText("PAC");
    await expect(selector).toContainText("Sedex");
    await expect(selector).toContainText("Transportadora");

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

    const crossSellCard = page.locator(".aacp-cross-sell-card", { hasText: "Carteira Slim RFID" });
    await expect(crossSellCard).toBeVisible({ timeout: 10_000 });
    const crossSellResponse = page.waitForResponse((res) =>
      res.url() === `${API}/embed/cross-sell/accept` && res.request().method() === "POST"
    );
    await crossSellCard.getByRole("button", { name: /Adicionar/i }).click();
    const acceptedCrossSell = await crossSellResponse;
    expect(acceptedCrossSell.ok()).toBe(true, `Cross-sell accept failed: ${await acceptedCrossSell.text()}`);
    await expect(cart).toContainText("Carteira Slim RFID", { timeout: 10_000 });

    await expect(page.getByRole("button", { name: "Nao tenho cupom" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Nao tenho cupom" }).click();

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
  test("checkout emits tenant webhooks and buyer hub shows inbound tracking timeline", async ({ request, page }) => {
    const bucket = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const merchantId = `mrc_${bucket}`;
    const merchantEmail = `${bucket}@tenant.test`;

    const registered = await request.post(`${API}/auth/register`, {
      data: {
        merchant_id: merchantId,
        merchant_name: "Tenant E2E",
        email: merchantEmail,
        password: "TenantPass123!"
      }
    });
    expect(registered.ok()).toBe(true, `Merchant register failed: ${await registered.text()}`);
    const auth = await registered.json();
    const tenantAuth = { Authorization: `Bearer ${auth.access_token}` };

    const webhook = await request.post(`${API}/integrations/webhooks`, {
      headers: tenantAuth,
      data: {
        url: `${API}/__test__/webhook-receiver/${bucket}`,
        events: ["order.approved", "customer.upserted", "order.tracking.updated"],
        enabled: true,
        description: "Playwright receiver"
      }
    });
    expect(webhook.ok()).toBe(true, `Webhook register failed: ${await webhook.text()}`);

    const apiKeyResponse = await request.post(`${API}/integrations/api-keys`, {
      headers: tenantAuth,
      data: {
        name: "Playwright backend",
        scopes: ["embed:sessions:create", "orders:tracking:write"]
      }
    });
    expect(apiKeyResponse.ok()).toBe(true, `API key create failed: ${await apiKeyResponse.text()}`);
    const apiKeyBody = await apiKeyResponse.json();
    const apiKey = apiKeyBody.secret_key as string;
    expect(apiKey).toBeTruthy();

    const embedSession = await request.post(`${API}/embed-sessions`, {
      headers: tenantAuth,
      data: {
        ttl_seconds: 900,
        allowed_origin: BASE,
        scopes: ["checkout:start", "checkout:chat", "payment:intents:create"],
        cart_ref: `cart_${bucket}`
      }
    });
    expect(embedSession.ok()).toBe(true, `Embed session failed: ${await embedSession.text()}`);
    const embedBody = await embedSession.json();
    const embedToken = embedBody.embed_session_token as string;
    expect(embedToken).toBeTruthy();

    const customerEmail = `${bucket}@buyer.test`;
    const start = await request.post(`${API}/embed/start`, {
      headers: { "x-aacp-embed-token": embedToken },
      data: {
        customer: {
          fullName: "Buyer Tracking E2E",
          email: customerEmail,
          email_verified: true,
          cpf: "12345678901",
          phone: "11999999999",
          phone_verified: true,
          address_verified: true,
          address: {
            zip: "01310100",
            street: "Avenida Paulista",
            number: "1000",
            neighborhood: "Bela Vista",
            city: "Sao Paulo",
            state: "SP"
          }
        },
        cart: {
          currency: "BRL",
          source: "storefront",
          total: 219.9,
          items: [
            {
              sku: "sku_tracking_001",
              name: "Tracking Product",
              price: 219.9,
              quantity: 1
            }
          ]
        }
      }
    });
    expect(start.ok()).toBe(true, `Checkout start failed: ${await start.text()}`);
    const checkout = await start.json();
    const sessionId = checkout.session_id as string;
    expect(sessionId).toBeTruthy();

    const quote = await request.post(`${API}/embed/shipping/quote`, {
      data: {
        session_id: sessionId,
        merchant_id: merchantId,
        destination_zip: "01310100",
        cart_total: 219.9
      }
    });
    expect(quote.ok()).toBe(true, `Quote failed: ${await quote.text()}`);
    const quoteBody = await quote.json();
    expect(quoteBody.results.length).toBeGreaterThan(0);
    const carrierKey = quoteBody.results[0].carrier_key as string;

    const selected = await request.post(`${API}/embed/shipping/select`, {
      data: {
        session_id: sessionId,
        merchant_id: merchantId,
        carrier_key: carrierKey
      }
    });
    expect(selected.ok()).toBe(true, `Select shipping failed: ${await selected.text()}`);

    const payment = await request.post(`${API}/embed/payment/intents`, {
      headers: { "x-aacp-embed-token": embedToken },
      data: {
        session_id: sessionId,
        idempotency_key: `pay_${bucket}`,
        method: "pix"
      }
    });
    expect(payment.ok()).toBe(true, `Payment failed: ${await payment.text()}`);
    const paid = await payment.json();
    expect(paid.status).toBe("approved");
    const externalOrderId = paid.providerPaymentId as string;
    expect(externalOrderId).toBeTruthy();

    const approvedWebhook = await waitForTestWebhook(request, bucket, "order.approved");
    expect(approvedWebhook.headers["x-aacp-signature"]).toBeTruthy();
    expect(approvedWebhook.body.data.order.external_order_id).toBe(externalOrderId);
    expect(approvedWebhook.body.data.customer.email).toBe(customerEmail);
    expect(approvedWebhook.body.data.tracking.status).toBe("pending");

    const customerWebhook = await waitForTestWebhook(request, bucket, "customer.upserted");
    expect(customerWebhook.headers["x-aacp-signature"]).toBeTruthy();
    expect(customerWebhook.body.data.customer.email).toBe(customerEmail);
    expect(customerWebhook.body.data.session_id).toBe(sessionId);
    expect(customerWebhook.body.data.external_order_id).toBe(externalOrderId);

    const trackingCode = `BR${Date.now().toString().slice(-9)}AA`;
    const tracked = await request.put(`${API}/integrations/orders/${externalOrderId}/tracking`, {
      headers: { "x-aacp-api-key": apiKey },
      data: {
        tracking_code: trackingCode,
        carrier: "Correios",
        tracking_url: `https://rastreamento.example/${trackingCode}`,
        status: "in_transit",
        events: [
          {
            status: "label_generated",
            description: "Etiqueta criada",
            location: "Sao Paulo, SP",
            occurred_at: new Date(Date.now() - 60_000).toISOString()
          },
          {
            status: "in_transit",
            description: "Objeto em transferencia",
            location: "Sao Paulo, SP",
            occurred_at: new Date().toISOString()
          }
        ]
      }
    });
    expect(tracked.ok()).toBe(true, `Tracking update failed: ${await tracked.text()}`);
    const trackingBody = await tracked.json();
    expect(trackingBody.updated).toBe(true);
    expect(trackingBody.shipment.trackingCode).toBe(trackingCode);
    expect(trackingBody.events_recorded).toBe(2);

    const trackingWebhook = await waitForTestWebhook(request, bucket, "order.tracking.updated");
    expect(trackingWebhook.body.data.tracking.tracking_code).toBe(trackingCode);
    expect(trackingWebhook.body.data.tracking.status).toBe("in_transit");

    const timeline = await request.get(`${API}/integrations/tracking/${trackingCode}`, {
      headers: { "x-aacp-api-key": apiKey }
    });
    expect(timeline.ok()).toBe(true, `Tracking timeline failed: ${await timeline.text()}`);
    const timelineBody = await timeline.json();
    expect(timelineBody.shipment.trackingCode).toBe(trackingCode);
    expect(timelineBody.events).toHaveLength(2);

    const buyerLogin = await request.post(`${API}/buyer/login-from-session`, {
      data: {
        merchant_id: merchantId,
        session_id: sessionId
      }
    });
    expect(buyerLogin.ok()).toBe(true, `Buyer login from session failed: ${await buyerLogin.text()}`);
    const buyerAuth = await buyerLogin.json();
    const buyerToken = buyerAuth.access_token as string;

    const purchases = await request.get(`${API}/buyer/me/purchases?merchant_id=${merchantId}&limit=5`, {
      headers: { Authorization: `Bearer ${buyerToken}` }
    });
    expect(purchases.ok()).toBe(true, `Buyer purchases failed: ${await purchases.text()}`);
    const purchasePage = await purchases.json();
    const order = purchasePage.items.find((item: { order_id: string }) => item.order_id === externalOrderId);
    expect(order).toBeTruthy();
    expect(order.tracking_code).toBe(trackingCode);
    expect(order.tracking_status).toBe("in_transit");
    expect(order.carrier).toBe("Correios");
    expect(order.tracking_events).toHaveLength(2);

    const hubUrl = new URL(BASE);
    hubUrl.searchParams.set("merchantId", merchantId);
    hubUrl.searchParams.set("embedToken", embedToken);
    hubUrl.searchParams.set("apiBaseUrl", API);
    hubUrl.searchParams.set(
      "cartJson",
      JSON.stringify({
        currency: "BRL",
        source: "storefront",
        total: 219.9,
        items: [
          {
            sku: "sku_tracking_001",
            name: "Tracking Product",
            price: 219.9,
            quantity: 1
          }
        ]
      })
    );
    hubUrl.searchParams.set(
      "customerJson",
      JSON.stringify({
        fullName: "Buyer Tracking E2E",
        email: customerEmail,
        email_verified: true
      })
    );

    await page.addInitScript(
      ({ token, email, merchant, globalUserId }) => {
        window.localStorage.setItem(
          "aacp_global_auth_session",
          JSON.stringify({
            merchant_id: merchant,
            global_user_id: globalUserId,
            email,
            access_token: token,
            token_type: "Bearer",
            expires_in: 3600,
            provider: "password"
          })
        );
      },
      {
        token: buyerToken,
        email: customerEmail,
        merchant: merchantId,
        globalUserId: buyerAuth.global_user_id
      }
    );

    await page.goto(hubUrl.toString());
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });
    await page.getByRole("button", { name: "Minha conta" }).click();
    const userPanel = page.locator(".aacp-user-panel");
    await expect(userPanel).toBeVisible({ timeout: 10_000 });
    await userPanel.getByRole("button", { name: "Pedidos" }).click();
    await expect(userPanel).toContainText(trackingCode, { timeout: 15_000 });
    await userPanel.getByLabel("Buscar pedido ou rastreio").fill(trackingCode);
    await expect(userPanel).toContainText("Correios");
    await expect(userPanel).toContainText("Em transporte");
    await expect(userPanel).toContainText("Etiqueta criada");
    await expect(userPanel).toContainText("Objeto em transferencia");
  });

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
