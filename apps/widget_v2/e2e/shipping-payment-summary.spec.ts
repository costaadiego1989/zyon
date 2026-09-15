import { expect, test, type Page } from "@playwright/test";

const experience = {
  brand: { name: "Athom Technologies", mode: "dark" },
  agent: { name: "Assistente da loja" },
  items: [{ sku: "SERUM-01", name: "Núcleo — Sérum de Barreira", variant_label: "30 ml", unit_price: 259.8, quantity: 1 }],
  totals: { subtotal: 259.8, discount: 0, service_fee: 0.99, total_to_pay: 260.79, total: 259.8 },
  paymentMethods: { pix: true, boleto: true, card: true },
};

async function openCheckout(page: Page) {
  await page.route("**/embed/start", (route) => route.fulfill({ json: { session_id: "chk_shipping_summary", experience } }));
  await page.route("**/checkout-settings/widget-config**", (route) => route.fulfill({ json: { enabledTriggers: [], advancedRules: [] } }));
  await page.route("**/embed/track", (route) => route.fulfill({ json: {} }));
  await page.goto("/?embed=1&embedToken=tok_shipping&merchantId=mrc_shipping&cartRef=cart_shipping&apiBaseUrl=http://127.0.0.1:5174");
  await page.getByRole("button", { name: /por chat/i }).click();
}

test("frete confirmado entra no resumo e no total do pedido", async ({ page }) => {
  let shippingSelections = 0;
  await openCheckout(page);
  await page.route("**/embed/chat", (route) => route.fulfill({ json: {
    message: "Escolha a melhor opção de entrega para seguir.",
    stage: "shipping",
    blocks: [{ type: "shipping_options", data: { options: [{
      key: "partner-standard",
      label: "Transportadora Parceira · Entrega padrão (5 dias)",
      cost: 2490,
      sub: "Chega em até 5 dias úteis",
    }] } }],
  } }));
  await page.route("**/embed/shipping/select", (route) => {
    shippingSelections += 1;
    return route.fulfill({ json: {
      selected_carrier_key: "partner-standard",
      shipping: {
        carrier: "Transportadora Parceira",
        method: "Entrega padrão (5 dias)",
        carrierKey: "partner-standard",
        customerPrice: 24.9,
      },
    } });
  });

  await page.getByRole("button", { name: "Vamos prosseguir", exact: true }).click();
  await page.getByRole("button", { name: /Transportadora Parceira.*Entrega padrão/i }).click();

  await expect.poll(() => shippingSelections).toBe(1);
  await expect(page.getByTestId("checkout-shipping-summary")).toContainText("Entrega");
  await expect(page.getByTestId("checkout-shipping-summary")).toContainText("24,90");
  await expect(page.getByTestId("checkout-shipping-summary")).toContainText("Entrega padrão");
  await expect(page.locator(".checkout-cart__total")).toContainText("285,69");
  await expect(page.getByText("Frete selecionado", { exact: true })).toBeVisible();
});

test("pagamento hospedado usa um único painel claro, sem cartão aninhado", async ({ page }) => {
  await openCheckout(page);
  await page.route("**/embed/chat", (route) => route.fulfill({ json: {
    message: "Abra o ambiente seguro para concluir o pagamento.",
    stage: "payment",
    blocks: [{ type: "hosted_card_payment", data: {
      intent_id: "pay_hosted_1",
      hosted_card: true,
      invoice_url: "https://payments.example.test/checkout/pay_hosted_1",
      amount_cents: 28569,
    } }],
  } }));

  await page.getByRole("button", { name: "Vamos prosseguir", exact: true }).click();

  const panel = page.locator(".checkout-payment-panel");
  await expect(panel).toHaveCount(1);
  await expect(panel).toContainText("Cartão de crédito");
  await expect(panel).toContainText("285,69");
  await expect(panel).toContainText("Aguardando a confirmação do provedor");
  await expect(page.getByRole("link", { name: /Continuar para o pagamento seguro/i })).toHaveAttribute("target", "_blank");
  await expect(panel.locator("xpath=..")).not.toHaveAttribute("data-neu", "surface");
});
