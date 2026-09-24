import { expect, test } from "@playwright/test";
import { navigateToCheckout, selectChatChannel, setupCrossSellMocks } from "./fixtures/cross-sell-mocks.js";

test("PIX quick reply creates one visual intent and hides disabled crypto", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: "PIX", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /crypto/i })).toHaveCount(0);
  await page.getByRole("button", { name: "PIX", exact: true }).click();
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
    await page.getByRole("button", { name: "PIX", exact: true }).click();
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
