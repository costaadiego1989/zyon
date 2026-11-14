import { expect, test } from "@playwright/test";
import { navigateToCheckout, selectChatChannel, setupCrossSellMocks } from "./fixtures/cross-sell-mocks.js";

test("visual Pix choice creates one intent and hides disabled crypto", async ({ page }) => {
  let paymentRequest: Record<string, unknown> | null = null;
  let paymentSelectionChatRequests = 0;
  page.on("request", (request) => {
    if (!request.url().endsWith("/embed/chat")) return;
    const body = request.postDataJSON() as { user_message?: string } | null;
    if (body?.user_message === "PIX") paymentSelectionChatRequests += 1;
  });

  await setupCrossSellMocks(page, {
    buyer: { fullName: "Cliente de Teste", email: "cliente.teste@example.com", phone: "11999999999", cpf: "52998224725" },
    shipping: { carrier: "Correios", method: "PAC", carrierKey: "pac", customerPrice: 12 },
    paymentMethods: { pix: true, boleto: false, card: true },
    cryptoPaymentsEnabled: false,
    chatStage: "payment",
    chatBlocks: [{ type: "payment_methods", data: { methods: [{ key: "pix", label: "Pix" }, { key: "credito", label: "Cartão de crédito" }] } }],
    chatQuickReplies: ["PIX", "Cartao de credito", "Pagar com crypto"],
  });
  await page.route("**/embed/payment/intents", async (route) => {
    paymentRequest = route.request().postDataJSON();
    await route.fulfill({
      json: { id: "pi_pix_e2e", status: "requires_action", method: "pix", amountCents: 9090, buyerFacing: { qrCodeCopyPaste: "pix-copia-e-cola" } },
    });
  });

  await navigateToCheckout(page);
  await selectChatChannel(page);
  await page.getByRole("button", { name: "Vamos prosseguir", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pix", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /crypto/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Pix", exact: true }).click();
  await expect.poll(() => paymentRequest).not.toBeNull();
  expect(paymentRequest).toMatchObject({ session_id: "chk_e2e_test_001", method: "pix" });
  expect(paymentSelectionChatRequests).toBe(0);
  await expect(page.getByText("Pix gerado! Pague e confirmo seu pedido automaticamente.")).toBeVisible();
});

for (const initialFailure of ["uncertain", "empty_payload"] as const) {
  test(`Pix ${initialFailure} retries the same intent without entering chat and displays QR and copy`, async ({ page }) => {
    const paymentRequests: Array<Record<string, unknown>> = [];
    let retryChatRequests = 0;
    page.on("request", request => {
      if (request.url().endsWith("/embed/chat") && request.postDataJSON()?.user_message === "Tentar novamente") retryChatRequests++;
    });
    await setupCrossSellMocks(page, {
      buyer: { fullName: "Cliente de Teste", email: "cliente.teste@example.com", phone: "11999999999", cpf: "52998224725" },
      shipping: { carrier: "Correios", method: "PAC", carrierKey: "pac", customerPrice: 12 },
      paymentMethods: { pix: true, boleto: false, card: true },
      cryptoPaymentsEnabled: false, chatStage: "payment", chatQuickReplies: ["PIX"],
      chatBlocks: [{ type: "payment_methods", data: { methods: [{ key: "pix", label: "Pix" }, { key: "credito", label: "Cartão de crédito" }] } }],
    });
    await page.route("**/embed/payment/intents", async route => {
      paymentRequests.push(route.request().postDataJSON());
      if (paymentRequests.length === 1) {
        await route.fulfill(initialFailure === "uncertain"
          ? { status: 502, json: { message: "payment_creation_uncertain" } }
          : { json: { id: "pi_retry", status: "pending", method: "pix", amountCents: 9804, buyerFacing: {} } });
        return;
      }
      await route.fulfill({ json: {
        id: "pi_retry", status: "requires_action", method: "pix", amountCents: 9804,
        buyerFacing: {
          qrCodeCopyPaste: "000201-pix-copia-e-cola-completo",
          encodedQrImage: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPxoAAAAASUVORK5CYII=",
          invoiceUrl: "https://www.mercadopago.com.br/payments/123/ticket",
        },
      } });
    });
    await navigateToCheckout(page);
    await selectChatChannel(page);
    await page.getByRole("button", { name: "Vamos prosseguir", exact: true }).click();
    await page.getByRole("button", { name: "Pix", exact: true }).click();
    await expect(page.getByRole("button", { name: "Tentar novamente", exact: true })).toBeVisible();
    await expect(page.getByText("Pix gerado! Pague e confirmo seu pedido automaticamente.")).toHaveCount(0);
    await expect(page.getByText("Aguardando a confirmação do Pix")).toHaveCount(0);
    await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await expect(page.getByRole("img", { name: "QR Code Pix" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copiar código", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir página do Pix" })).toHaveAttribute("href", "https://www.mercadopago.com.br/payments/123/ticket");
    expect(paymentRequests).toHaveLength(2);
    expect(paymentRequests[1].idempotency_key).toBe(paymentRequests[0].idempotency_key);
    expect(retryChatRequests).toBe(0);
    await page.getByRole("button", { name: "Copiar código", exact: true }).click();
    await expect(page.getByRole("button", { name: "Código copiado", exact: true })).toBeVisible();
  });
}

for (const theme of ["light", "dark"]) {
  test(`final Pix synchronizes granted benefits and totals in ${theme}`, async ({ page }, testInfo) => {
    await setupCrossSellMocks(page, {
      brand: { mode: theme },
      cartItems: [{ variantId: "kit", productName: "Kit com benefício", quantity: 1, price: 300, subtotal: 300 }],
      buyer: { fullName: "Cliente de Teste", email: "buyer@example.test", phone: "11999999999", cpf: "52998224725" },
      shipping: { carrier: "Correios", method: "PAC", carrierKey: "pac", customerPrice: 35 },
      paymentMethods: { pix: true, boleto: false, card: true },
      chatStage: "payment", chatQuickReplies: ["PIX"],
      chatBlocks: [{ type: "payment_methods", data: { methods: [{ key: "pix", label: "Pix" }, { key: "credito", label: "Cartão de crédito" }] } }],
    });
    let calls = 0;
    await page.route("**/embed/payment/intents", route => {
      calls++;
      return route.fulfill({ json: {
        id: "pi_benefits", status: "requires_action", method: "pix", amountCents: 27099,
        buyerFacing: { qrCodeCopyPaste: "pix-benefits-code", invoiceUrl: "https://www.mercadopago.com.br/payments/123/ticket" },
        experience: {
          items: [{ sku: "kit", name: "Kit com benefício", variant_label: "30 ml", unit_price: 300, original_unit_price: 320, quantity: 1 }],
          shipping: { carrier: "Correios", method: "PAC", carrierKey: "pac", customerPrice: 0 },
          totals: { subtotal: 300, discount: 30, shipping: 0, service_fee: .99, total_to_pay: 270.99, total: 270 },
          applied_benefits: [{ kind: "discount", label: "Desconto das etapas da compra", amount: 30 }, { kind: "shipping", label: "Frete grátis", amount: 35 }],
        },
      } });
    });
    await navigateToCheckout(page);
    await selectChatChannel(page);
    await page.getByRole("button", { name: "Vamos prosseguir", exact: true }).click();
    await page.getByRole("button", { name: "Pix", exact: true }).click();
    await expect(page.locator(".checkout-cart__total")).toContainText("270,99");
    await expect(page.getByRole("list", { name: "Benefícios aplicados" })).toContainText("Desconto das etapas da compra");
    await expect(page.getByTestId("checkout-shipping-summary")).toContainText("Grátis");
    await expect(page.locator(".checkout-cart__product-promotion")).toContainText("20,00");
    expect(calls).toBe(1);
    const action = page.getByRole("link", { name: "Abrir página do Pix" });
    await expect(action).toHaveClass(/checkout-payment-panel__action/);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await action.scrollIntoViewIfNeeded();
      const box = await action.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`pix-benefits-${theme}-${width}.png`) });
    }
  });
}
