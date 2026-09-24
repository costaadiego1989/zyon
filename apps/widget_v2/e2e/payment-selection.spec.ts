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