import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { setupCrossSellMocks, navigateToCheckout, selectChatChannel } from "./fixtures/cross-sell-mocks.js";

const evidence = "C:/tmp/zyon-checkout-assistance-20261008-evidence";
mkdirSync(evidence, { recursive: true });
async function open(page: Page) {
  await setupCrossSellMocks(page);
  await page.route("**/checkout-settings/widget-config**", route => route.fulfill({ json: {
    mode: "silent_until_trigger", idleSeconds: 180, enabledTriggers: ["idle_30_seconds"],
    cooldownSeconds: 120, maxInterventionsPerSession: 3, handoffEnabled: true,
  } }));
  await page.route("**/support/faq/public**", route => route.fulfill({ json: { faqItems: [] } }));
  await navigateToCheckout(page); await selectChatChannel(page);
  await expect(page.getByRole("textbox", { name: "Mensagem", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const { useCheckoutStore } = await import("/src/store/checkout-store.ts" as string); return useCheckoutStore.getState().isTyping;
  })).toBe(false);
}
async function question(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await input.fill(text); await input.press("Enter");
}
async function pix(page: Page, expired = false) {
  await page.evaluate(async expired => {
    const { useCheckoutStore } = await import("/src/store/checkout-store.ts" as string);
    const intent = { intent_id: "pix-existing", method: "pix", status: "pending", pix_code: "000201-Pix-original-test",
      expires_at_unix: Math.floor(Date.now() / 1000) + (expired ? -60 : 600), amount_cents: 8990 };
    useCheckoutStore.setState({ paymentIntent: intent, leadRegistered: true,
      merchantPaymentConfig: { ...useCheckoutStore.getState().merchantPaymentConfig,
        paymentMethods: { pix: true, boleto: false, card: true, providers: { pix: "stripe", card: "stripe" } } },
      cart: { ...useCheckoutStore.getState().cart, shipping: { key: "delivery", label: "Entrega", cost: 0 }, status: "ready_to_pay" },
      messages: [...useCheckoutStore.getState().messages, { id: "pix-fixture", role: "agent", text: "Seu pagamento Pix está disponível.",
        timestamp: Date.now(), blocks: [{ type: "pix_payment", data: intent }] }] });
  }, expired);
}

test("Pix help consults the existing operation and displays the same code", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 }); await open(page);
  let creations = 0;
  await page.route("**/embed/payment/intents", route => { creations++; return route.fulfill({ status: 500 }); });
  await page.route("**/embed/payment/intents/*/status**", route => route.fulfill({ json: { status: "pending" } }));
  await pix(page);
  await question(page, "Paguei o Pix, pode confirmar?");
  await expect(page.getByRole("button", { name: "Mostrar código Pix", exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/pix-help-desktop.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Mostrar código Pix", exact: true }).click();
  await expect(page.getByText("Este é o código da mesma operação Pix.", { exact: true })).toBeVisible();
  expect(creations).toBe(0);
});

test("expired Pix hides the old copy action and verifies termination before renewal", async ({ page }) => {
  await open(page); let creations = 0, checked = false;
  await page.route("**/embed/payment/intents/*/status**", route => {
    checked = true;
    return route.fulfill({ json: { status: route.request().url().includes("pix-renewed") ? "pending" : "cancelled" } });
  });
  await page.route("**/embed/payment/intents", route => {
    expect(checked).toBe(true); creations++;
    return route.fulfill({ json: { id: "pix-renewed", status: "pending", method: "pix", amountCents: 8990,
      buyerFacing: { qrCodeCopyPaste: "000201-Pix-renewed-test", quoteExpiresAt: new Date(Date.now() + 600000).toISOString() } } });
  });
  await pix(page, true);
  await expect(page.getByRole("button", { name: "Copiar código", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Ajuda com este Pix", exact: true }).click();
  await page.getByRole("button", { name: "Consultar e renovar Pix", exact: true }).click();
  await expect(page.getByText("Pix gerado! Pague e confirmo seu pedido automaticamente.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar código", exact: true })).toHaveCount(1);
  expect(creations).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Copiar código", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/pix-renewed-mobile.png`, fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test("unavailable stock offers a confirmed replacement using available catalog products", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page); let replacements = 0;
  await page.route("**/embed/cart", route => route.fulfill({ status: 409, json: { message: "cart_insufficient_stock", sku: "SKU-001", availableQuantity: 0 } }));
  await page.route("**/embed/catalog/search**", route => route.fulfill({ json: { products: [
    { sku: "OUT", name: "Camiseta esgotada", unit_price: 79.9, in_stock: false },
    { sku: "GREEN", name: "Camiseta verde", unit_price: 79.9, in_stock: true },
  ] } }));
  await page.route("**/embed/catalog/add", route => {
    const body = route.request().postDataJSON(); expect(body.replace_sku).toBe("SKU-001"); expect(body.quantity).toBe(1); replacements++;
    return route.fulfill({ json: { experience: { items: [{ sku: "GREEN", name: "Camiseta verde", quantity: 1, unit_price: 79.9 }],
      totals: { subtotal: 79.9, total: 79.9 }, stage: "shipping" } } });
  });
  await page.evaluate(async () => {
    const { useCheckoutStore } = await import("/src/store/checkout-store.ts" as string); await useCheckoutStore.getState().updateQty("SKU-001", 2);
  });
  await page.getByRole("button", { name: "Ver alternativas disponíveis", exact: true }).click();
  const replace = page.getByRole("button", { name: "Trocar por 1 unidade de Camiseta verde", exact: true });
  await expect(replace).toBeVisible(); await expect(page.getByText("Camiseta esgotada", { exact: true })).toHaveCount(0);
  expect(replacements).toBe(0);
  await replace.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/stock-alternative-mobile.png`, fullPage: true, animations: "disabled" });
  await replace.click();
  await expect(page.getByText("Produto trocado por uma unidade da alternativa escolhida. Revise o carrinho e confirme novamente a entrega antes de pagar.", { exact: true })).toBeVisible();
  expect(replacements).toBe(1); await expect(replace).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test("persistent difficulty requests a real support ticket only after the buyer chooses it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 }); await open(page); let tickets = 0;
  await page.route("**/support/chat/public", route => {
    tickets++; expect(route.request().postDataJSON().session_id).toBe("chk_e2e_test_001");
    return route.fulfill({ json: { reply: "Sua solicitação foi enviada à equipe da loja. Referência: TICKET-TESTE.", handoff: { ticketId: "ticket-test" } } });
  });
  await page.evaluate(async () => {
    const { useCheckoutStore } = await import("/src/store/checkout-store.ts" as string);
    useCheckoutStore.getState().recordCheckoutDifficulty(); useCheckoutStore.getState().recordCheckoutDifficulty();
  });
  const help = page.getByRole("button", { name: "Falar com atendente", exact: true });
  await expect(help).toBeVisible(); expect(tickets).toBe(0);
  await page.screenshot({ path: `${evidence}/human-offer-desktop.png`, fullPage: true, animations: "disabled" });
  await help.click(); await expect(page.getByText(/Referência: TICKET-TESTE/)).toBeVisible();
  expect(tickets).toBe(1);
  await page.screenshot({ path: `${evidence}/human-support-desktop.png`, fullPage: true, animations: "disabled" });
});

test("installment question explains actual available conditions without creating a payment", async ({ page }) => {
  await open(page); let creations = 0;
  await page.route("**/embed/payment/intents", route => { creations++; return route.fulfill({ status: 500 }); });
  await question(page, "Em quantas parcelas posso pagar?");
  await expect(page.getByText(/O cartão está disponível à vista/)).toBeVisible();
  await page.getByRole("button", { name: "Ver formas de pagamento", exact: true }).click();
  await expect(page.getByText("Estas são as formas disponíveis. Confirme o frete e seus dados antes de pagar.", { exact: true })).toBeVisible();
  expect(creations).toBe(0);
});

test("default inactivity message adapts to the checkout stage after three minutes", async ({ page }) => {
  await page.clock.install(); await open(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 30000));
  await page.locator("body").press("Shift");
  await page.clock.runFor(180000);
  await expect(page.locator(".discount-banner")).toContainText("Precisa de ajuda para preencher o endereço ou encontrar o CEP?");
});

test("support delivery failure does not claim that a ticket was created", async ({ page }) => {
  await open(page);
  await page.route("**/support/chat/public", route => route.fulfill({ status: 503, json: {} }));
  await question(page, "Quero falar com um atendente humano");
  await expect(page.getByText("Não consegui enviar sua mensagem à equipe da loja. Tente novamente em instantes.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Um atendente será designado em breve/)).toHaveCount(0);
});
