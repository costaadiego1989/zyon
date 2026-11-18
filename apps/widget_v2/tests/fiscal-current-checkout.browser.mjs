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
  console.log(JSON.stringify({ status: "pass", cases: results.length, results }));
} finally { await browser.close(); }
