import { test, expect, type Page } from "@playwright/test";
import { setupCrossSellMocks, navigateToCheckout, selectChatChannel } from "./fixtures/cross-sell-mocks.js";

async function setup(page: Page, rejectEdit = false) {
  const address = { zip: "01310100", street: "Paulista", number: "100", complement: "", city: "São Paulo", state: "SP" };
  const buyer = { fullName: "Fixture Buyer", email: "fixture@example.test", phone: "11987654321", cpf: "52998224725", address };
  const shipping = { carrier: "Correios", method: "PAC", carrierKey: "pac", customerPrice: 20 };
  const methods = [{ key: "pix", label: "Pix" }, { key: "credito", label: "Cartão de crédito" }];
  let experience: any = { brand: { name: "Athom QA", mode: "light" }, buyer, agent: { name: "Zyon" },
    items: [{ sku: "SERUM", name: "Sérum de Barreira 50 ml", unit_price: 200, quantity: 1 }],
    totals: { subtotal: 200, discount: 0, shipping: 20, service_fee: .99, total_to_pay: 220.99, total: 220 },
    shipping, paymentMethods: { pix: true, card: true, boleto: false }, stripeEnabled: true, stage: "payment" };
  const edits: string[] = [], payments: any[] = [], chats: string[] = [];
  await setupCrossSellMocks(page, { buyer, shipping, paymentMethods: { pix: true, card: true, boleto: false },
    chatStage: "payment", chatBlocks: [{ type: "payment_methods", data: { methods } }] });
  await page.route("**/embed/start", route => route.fulfill({ json: { session_id: "chk_e2e_test_001", experience } }));
  await page.route("**/embed/checkout/edit", async route => {
    const section = route.request().postDataJSON().section; edits.push(section);
    if (rejectEdit) return route.fulfill({ status: 409, json: { message: "checkout_payment_cancellation_unconfirmed" } });
    if (section === "shipping" || section === "address") experience = { ...experience, shipping: undefined,
      totals: { ...experience.totals, shipping: 0, total_to_pay: 200.99, total: 200 } };
    return route.fulfill({ json: { experience, revision: edits.length + 2 } });
  });
  await page.route("**/embed/chat", async route => {
    const text = route.request().postDataJSON().user_message; chats.push(text);
    if (/trabalho|endereço/i.test(text)) return route.fulfill({ json: { message: "Qual o CEP do endereço de entrega?", stage: "data_collection", missing_fields: ["CEP"], experience } });
    if (/frete/i.test(text)) return route.fulfill({ json: { message: "Escolha o frete para este pedido.", stage: "shipping", missing_fields: ["frete"],
      blocks: [{ type: "shipping_options", data: { options: [{ key: "jadlog", label: "Jadlog Econômico", cost: 12, sub: "5 dias" }] } }], experience } });
    if (/cupom/i.test(text)) return route.fulfill({ json: { message: "Informe o cupom de desconto.", stage: "payment",
      blocks: [{ type: "coupon_input", data: { methods } }], experience } });
    return route.fulfill({ json: { message: "Escolha a forma de pagamento para este pedido.", stage: "payment",
      blocks: [{ type: "payment_methods", data: { methods } }], experience } });
  });
  await page.route("**/embed/coupons/apply", route => {
    experience = { ...experience, totals: { ...experience.totals, discount: 20, total: 200, total_to_pay: 200.99 },
      applied_benefits: [{ kind: "discount", label: "Cupom EDITQA10", amount: 20 }] };
    return route.fulfill({ json: { discount_applied: 20, experience, coupon: { code: "EDITQA10", discount_type: "percent" } } });
  });
  await page.route("**/embed/payment/intents", route => {
    const request = route.request().postDataJSON(); payments.push(request);
    const card = request.method === "card";
    return route.fulfill({ json: { id: `payment-${payments.length}`, method: request.method, status: "requires_action", amountCents: Math.round(experience.totals.total_to_pay * 100),
      buyerFacing: card ? { invoiceUrl: "https://payments.example.test/fixture" } : { qrCodeCopyPaste: "fixture-pix-pending" }, experience } });
  });
  await page.route("**/embed/track", route => route.fulfill({ json: {} }));
  await navigateToCheckout(page); await selectChatChannel(page);
  await page.getByRole("button", { name: "Vamos prosseguir", exact: true }).click();
  await page.getByRole("button", { name: "Pix", exact: true }).click();
  await expect(page.getByText("Pix gerado! Pague e confirmo seu pedido automaticamente.")).toBeVisible();
  return { edits, payments, chats };
}

for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440]) {
  test(`pending Pix can change payment by text and visual action at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 });
    const f = await setup(page);
    await expect(page.getByRole("button", { name: "Alterar pagamento", exact: true })).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Mensagem", exact: true });
    await composer.fill("Quero trocar para cartão"); await composer.press("Enter");
    await expect(page.getByRole("button", { name: "Cartão de crédito", exact: true }).last()).toBeVisible();
    expect(f.edits).toEqual(["payment"]); expect(f.payments).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Copiar código", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Cartão de crédito", exact: true }).last().click();
    await expect.poll(() => f.payments.length).toBe(2);
    expect(f.payments[1].method).toBe("card");
    expect(f.payments[1].idempotency_key).not.toBe(f.payments[0].idempotency_key);
    const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    expect(overflowing).toBe(false);
  });
}

test("unconfirmed cancellation keeps the current Pix actionable and never sends a replacement chat or payment", async ({ page }) => {
  const f = await setup(page, true);
  await page.getByRole("button", { name: "Alterar pagamento", exact: true }).click();
  await expect(page.getByText(/Ainda não foi possível liberar a alteração/)).toBeVisible();
  expect(f.edits).toEqual(["payment"]); expect(f.payments).toHaveLength(1); expect(f.chats).toEqual(["Vamos prosseguir"]);
  await expect(page.getByText("Pix gerado! Pague e confirmo seu pedido automaticamente.")).toBeVisible();
});

test("shipping can be reviewed after Pix without creating another payment", async ({ page }) => {
  const f = await setup(page);
  await page.getByRole("button", { name: "Alterar frete", exact: true }).click();
  await expect(page.getByRole("button", { name: /Jadlog Econômico/ })).toBeVisible();
  expect(f.edits).toEqual(["shipping"]); expect(f.payments).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Copiar código", exact: true })).toHaveCount(0);
});

test("coupon updates the cart and next Pix amount from the authoritative response", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await setup(page);
  await page.getByRole("button", { name: "Usar cupom", exact: true }).click();
  const coupon = page.getByPlaceholder(/cupom/i);
  await expect(coupon).toBeVisible(); await coupon.fill("EDITQA10");
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await page.getByRole("button", { name: "Abrir carrinho", exact: true }).click();
  await expect(page.getByText("R$ 200,99", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/20,00/).first()).toBeVisible();
  expect(f.edits).toEqual(["coupon"]); expect(f.payments).toHaveLength(1);
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pix", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Pix", exact: true }).last().click();
  await expect.poll(() => f.payments.length).toBe(2);
  await expect(page.getByRole("region", { name: "Pix", exact: true }).getByText("R$ 200,99", { exact: true })).toBeVisible();
});

test("workplace correction reopens delivery without leaving stale Pix controls", async ({ page }) => {
  const f = await setup(page);
  const composer = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await composer.fill("Quero entregar no trabalho"); await composer.press("Enter");
  await expect(page.getByRole("textbox", { name: "CEP de entrega", exact: true })).toBeVisible();
  expect(f.edits).toEqual(["address"]); expect(f.payments).toHaveLength(1);
});
