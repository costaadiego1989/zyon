import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";

const target = process.env.WIDGET_TEST_URL || "http://127.0.0.1:5186";
const experience = { stage: "payment", items: [{ sku: "sku", name: "Produto teste", quantity: 1, unit_price: 100 }],
  shipping: { carrierKey: "freight", method: "Entrega", customerPrice: 0 },
  totals: { subtotal: 100, discount: 0, shipping: 0, service_fee: 0, total: 100, total_to_pay: 100 },
  paymentMethods: { pix: true, card: true, boleto: false },
  customer: { fullName: "Comprador Teste", email: "buyer@example.test", phone: "11999999999" },
  brand: { name: "Loja teste" } };
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const results = [];

// Synthetic SDK boundary from the fiscal suite. The actual React CardElement
// must create/mount it in the unchanged current payment component.
async function localStripe(page) {
  await page.addInitScript(() => {
    const captured = { mounts: [], creates: [], retrieves: [], confirms: [] };
    window.__fiscalStripeBoundary = captured;
    const stripe = () => {
      let input;
      const element = {
        on() {}, off() {}, update() {}, unmount() {}, destroy() {},
        mount(target) {
          input = document.createElement("input");
          input.setAttribute("aria-label", "Cartão de teste local");
          target.append(input);
          captured.mounts.push({ connected: target.isConnected, parentClass: target.parentElement?.className });
        },
      };
      return {
        _registerWrapper() {}, registerAppInfo() {},
        elements: () => ({
          create: type => { captured.creates.push(type); return element; },
          getElement: () => element, update() {}, on() {}, off() {},
        }),
        createToken() {}, createPaymentMethod() {},
        retrievePaymentIntent: async clientSecret => {
          captured.retrieves.push(clientSecret);
          return { paymentIntent: { status: "requires_payment_method" } };
        },
        confirmCardPayment: async (clientSecret, options) => {
          const filled = input?.value === "4242424242424242";
          captured.confirms.push({ clientSecret, cardElementMatched: options?.payment_method?.card === element, filled });
          return filled
            ? { paymentIntent: { id: "pi_fiscal_inline_synthetic", status: "succeeded" } }
            : { error: { type: "validation_error", message: "Preencha o cartão de teste local" } };
        },
      };
    };
    window.Stripe = stripe;
  });
}

try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
    const chats = [], payments = [], errors = []; let cpf = "";
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://fiscal-checkout.invalid/**", async route => {
      const request = route.request(); const pathname = new URL(request.url()).pathname;
      const data = request.method() === "OPTIONS" ? undefined : request.postDataJSON();
      const json = body => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
      if (request.method() === "OPTIONS") return json({});
      const current = { ...experience, customer: { ...experience.customer, ...(cpf ? { cpf } : {}) } };
      if (pathname.endsWith("/embed/start")) return json({ session_id: "fiscal-ui-session", experience: current,
        fiscal: { active: true, mode: "buyer", recipient: {}, fields: ["taxId"] } });
      if (pathname.endsWith("/embed/chat")) {
        chats.push(data.user_message);
        if (data.user_message === "Quero continuar") return json({ stage: "data_collection", message: "Informe seu CPF.", experience: { ...current, stage: "data_collection" } });
        if (data.user_message === "52998224725") cpf = data.user_message;
        return json({ stage: "payment", message: "Escolha como pagar.", experience: { ...current, customer: { ...current.customer, ...(cpf ? { cpf } : {}) } } });
      }
      if (pathname.endsWith("/embed/customer/fiscal/prepare")) {
        assert.deepEqual(data, { session_id: "fiscal-ui-session", mode: "buyer" });
        return json({ active: true, mode: "buyer", recipient: { taxId: cpf }, fields: cpf ? [] : ["taxId"] });
      }
      if (pathname.endsWith("/embed/payment/intents")) {
        payments.push(data);
        return json({ id: "fiscal-card", method: "card", status: "requires_action", amountCents: 10000,
          buyerFacing: { invoiceUrl: "https://payment.example.test/fiscal-card" } });
      }
      if (pathname.includes("/payment/")) return json({ status: "requires_action" });
      return json({ enabledTriggers: [], maxInterventionsPerSession: 0 });
    });
    await page.context().route("https://payment.example.test/fiscal-card", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<h1>Cartão de teste local</h1>" }));
    const query = new URLSearchParams({ embedToken: "scoped-fixture", merchantId: "store", apiBaseUrl: "https://fiscal-checkout.invalid", channel: "chat" });
    await page.goto(`${target}/?${query}`);
    await page.getByRole("button", { name: "Vamos prosseguir", exact: true }).click();
    const card = page.getByRole("button", { name: /^Cartão de crédito/ }).last();
    await expect(card).toBeVisible(); await card.click();
    await expect(page.getByRole("log")).toContainText("Informe seu CPF.");
    await expect(page.getByTestId("lead-capture")).toHaveCount(0);
    await expect(page.getByRole("form", { name: "Dados da nota fiscal" })).toHaveCount(0);
    assert.equal(payments.length, 0);
    const composer = page.getByRole("textbox", { name: "Mensagem", exact: true });
    await composer.fill("52998224725"); await composer.press("Enter");
    const secure = page.getByRole("link", { name: "Continuar para o pagamento seguro" });
    await expect(secure).toBeVisible();
    assert.equal(payments.length, 1); assert.equal(payments[0].method, "card");
    assert.equal(payments[0].session_id, "fiscal-ui-session");
    assert.equal(chats.filter(message => message === "Quero continuar").length, 1);
    await expect(page.getByTestId("lead-capture")).toHaveCount(0);
    const popupReady = page.waitForEvent("popup"); await secure.click(); const popup = await popupReady;
    await expect(popup.getByRole("heading", { name: "Cartão de teste local" })).toBeVisible(); await popup.close();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    results.push({ width, cardRequests: payments.length, canonicalCpf: cpf, aggregateForm: false, realProvider: false });
    await page.close();
  }

  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
    const chats = [], allChats = [], payments = [], confirmations = [], errors = [], unexpected = [], providerRequests = [];
    let cpf = "";
    page.on("pageerror", error => errors.push(error.message));
    // No real provider or font request leaves this new synthetic case.
    await page.route("https://**", route => {
      const url = new URL(route.request().url());
      if (/(?:^|\.)stripe\.com$/.test(url.hostname)) providerRequests.push(url.hostname);
      return route.abort();
    });
    await localStripe(page);
    await page.route("https://fiscal-checkout.invalid/**", async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      const data = request.method() === "OPTIONS" ? undefined : request.postDataJSON();
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
      if (request.method() === "OPTIONS") return json({});
      const current = { ...experience, customer: { ...experience.customer, ...(cpf ? { cpf } : {}) } };
      if (pathname === "/embed/start") return json({ session_id: "fiscal-inline-session", experience: current,
        fiscal: { active: true, mode: "buyer", recipient: {}, fields: ["taxId"] } });
      if (pathname === "/embed/chat") {
        allChats.push(data.user_message);
        if (data.user_message === "Vamos prosseguir") return json({ stage: "payment", message: "Escolha como pagar.", experience: current });
        chats.push(data.user_message);
        if (data.user_message === "Quero continuar") return json({ stage: "data_collection", message: "Informe seu CPF.", experience: { ...current, stage: "data_collection" } });
        assert.equal(data.user_message, "52998224725");
        cpf = data.user_message;
        return json({ stage: "payment", message: "Escolha como pagar.", experience: { ...current, customer: { ...current.customer, cpf } } });
      }
      if (pathname === "/embed/customer/fiscal/prepare") {
        assert.deepEqual(data, { session_id: "fiscal-inline-session", mode: "buyer" });
        return json({ active: true, mode: "buyer", recipient: { taxId: cpf }, fields: cpf ? [] : ["taxId"] });
      }
      if (pathname === "/embed/payment/intents") {
        payments.push({ body: data, canonicalCpf: cpf, amountCents: 10000 });
        return json({ id: "fiscal-inline-card", method: "card", status: "requires_action", amountCents: 10000,
          buyerFacing: { clientSecret: "pi_fiscal_inline_secret_synthetic", stripePublishableKey: "pk_test_local_synthetic" } });
      }
      if (pathname === "/embed/payment/intents/fiscal-inline-card/stripe/confirm") {
        confirmations.push({ pathname, body: data });
        return json({ status: "approved", intent_id: "fiscal-inline-card" });
      }
      if (pathname === "/embed/track") return json({});
      if (pathname === "/checkout-settings/widget-config") return json({ enabledTriggers: [], maxInterventionsPerSession: 0 });
      if (request.method() === "GET" && pathname === "/support/faq/public") return json({ faqItems: [] });
      if (request.method() === "POST" && pathname === "/embed/cashback/quote") return json({
        merchantId: "store", sessionId: "fiscal-inline-session", programActive: false, eligible: false,
        reason: "program_inactive", availableCents: 0, maximumRedeemCents: 0, reservedCents: 0, estimatedEarnCents: 0,
        ruleVersion: null, fingerprint: "synthetic_cashback_disabled", terms: null,
      });
      unexpected.push({ method: request.method(), pathname });
      return json({ error: "unexpected_synthetic_route" }, 501);
    });
    const query = new URLSearchParams({ embedToken: "scoped-inline-fixture", merchantId: "store", apiBaseUrl: "https://fiscal-checkout.invalid", channel: "chat" });
    await page.goto(`${target}/?${query}`);
    await page.getByRole("button", { name: "Vamos prosseguir", exact: true }).click();
    await page.getByRole("button", { name: /^Cartão de crédito/ }).last().click();
    await expect(page.getByRole("log")).toContainText("Informe seu CPF.");
    await expect(page.getByTestId("lead-capture")).toHaveCount(0);
    await expect(page.getByRole("form", { name: "Dados da nota fiscal" })).toHaveCount(0);
    assert.equal(payments.length, 0);
    const composer = page.getByRole("textbox", { name: "Mensagem", exact: true });
    await composer.fill("52998224725"); await composer.press("Enter");
    const panel = page.getByRole("region", { name: "Cartão de crédito", exact: true });
    const field = panel.getByRole("textbox", { name: "Cartão de teste local", exact: true });
    await expect(field).toBeVisible();
    await expect(panel.locator(".checkout-payment-panel__card-field")).toBeVisible();
    await expect(panel.locator(".checkout-payment-panel__total strong")).toHaveText(new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(100));
    assert.equal(payments.length, 1);
    assert.equal(payments[0].body.method, "card");
    assert.equal(payments[0].body.session_id, "fiscal-inline-session");
    assert.equal(payments[0].canonicalCpf, "52998224725");
    assert.equal(payments[0].amountCents, 10000);
    assert.equal(confirmations.length, 0);
    await expect(page.getByRole("link", { name: "Continuar para o pagamento seguro" })).toHaveCount(0);
    await field.fill("4242424242424242");
    await panel.getByRole("button", { name: /^Pagar R\$/ }).click();
    await expect(page.getByRole("heading", { name: /^Pagamento confirmado/ })).toBeVisible();
    assert.deepEqual(confirmations, [{ pathname: "/embed/payment/intents/fiscal-inline-card/stripe/confirm", body: { session_id: "fiscal-inline-session" } }]);
    assert.equal(payments.length, 1);
    assert.deepEqual(chats, ["Quero continuar", "52998224725"]);
    assert.deepEqual(allChats, ["Vamos prosseguir", "Quero continuar", "52998224725"]);
    const sdk = await page.evaluate(() => window.__fiscalStripeBoundary);
    assert.deepEqual(sdk.creates, ["card"]);
    assert.deepEqual(sdk.mounts, [{ connected: true, parentClass: "checkout-payment-panel__card-field" }]);
    assert.deepEqual(sdk.retrieves, ["pi_fiscal_inline_secret_synthetic"]);
    assert.deepEqual(sdk.confirms, [{ clientSecret: "pi_fiscal_inline_secret_synthetic", cardElementMatched: true, filled: true }]);
    await expect(page.getByTestId("lead-capture")).toHaveCount(0);
    await expect(page.getByRole("form", { name: "Dados da nota fiscal" })).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.deepEqual(providerRequests, []);
    results.push({ width, flow: "inline_stripe", cardRequests: payments.length, canonicalCpf: cpf, amountCents: 10000,
      confirmations: confirmations.length, cardElementMounted: sdk.mounts.length, aggregateForm: false, realProvider: false });
    await page.close();
  }
  console.log(JSON.stringify({ status: "pass", cases: results.length, results }));
} finally { await browser.close(); }
