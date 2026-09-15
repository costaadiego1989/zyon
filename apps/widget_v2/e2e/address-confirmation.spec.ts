import { expect, test } from "@playwright/test";

for (const structuredConfirmation of [false, true]) {
  test(`confirmed CEP advances to address details and payment (structured=${structuredConfirmation})`, async ({ page }) => {
    const messages: string[] = [];
    let quoteRequests = 0;
    const address = { zip: "01310100", street: "Avenida Paulista", city: "São Paulo", state: "SP" };
    const experience = {
      brand: { name: "Zyon Store", mode: "dark" }, agent: { name: "Zyon IA" },
      items: [{ sku: "SERUM-01", name: "Sérum Capilar", unit_price: 129.9, quantity: 1 }],
      totals: { subtotal: 129.9, discount: 0, total: 129.9 },
      buyer: { name: "Maria Silva", email: "buyer@example.com", cpf: "52998224725", phone: "11987654321", address },
      paymentMethods: { pix: true, boleto: false, card: true },
    };
    await page.route("**/embed/start", (route) => route.fulfill({ json: { session_id: "chk_address", experience } }));
    await page.route("**/checkout-settings/widget-config**", (route) => route.fulfill({ json: { enabledTriggers: [], advancedRules: [] } }));
    await page.route("**/embed/track", (route) => route.fulfill({ json: {} }));
    await page.route("**/shipping/quote**", (route) => { quoteRequests += 1; return route.fulfill({ json: [] }); });
    await page.route("**/embed/chat", async (route) => {
      const text = route.request().postDataJSON().user_message as string;
      messages.push(text);
      const response = text === "Vamos prosseguir" ? {
        message: "Localizei o endereço pelo CEP: Avenida Paulista · São Paulo/SP. Está correto? (Sim/Não)",
        stage: "shipping", missing_fields: ["confirmar endereço"],
        blocks: structuredConfirmation ? [{ type: "address_confirmation", data: { formatted: "Avenida Paulista · São Paulo/SP", address } }] : [],
        experience: { ...experience, copy: { quick_replies: ["Sim", "Não"] } },
      } : text === "Sim" ? {
        message: "Já achei o endereço pelo CEP. Qual o número e complemento (apto/bloco, se houver)?",
        stage: "shipping", missing_fields: ["número"], experience,
      } : text === "100" ? {
        message: "Tem complemento, como apartamento ou bloco?",
        stage: "shipping", missing_fields: ["complemento (ou responda que não tem)"],
        experience: { ...experience, buyer: { ...experience.buyer, address: { ...address, number: "100" } } },
      } : text === "sem complemento" ? {
        message: "Calculei as opções de frete. Selecione uma para seguirmos.",
        stage: "shipping", missing_fields: ["frete"],
        experience: { ...experience, copy: { quick_replies: ["Quero PAC", "Quero Sedex"] } },
      } : { message: "Frete confirmado. Vamos às opções de pagamento.", stage: "payment", missing_fields: ["forma de pagamento"] };
      await route.fulfill({ json: response });
    });
    await page.goto("/?embed=1&embedToken=tok_test&merchantId=mrc_test&cartRef=cart_test&apiBaseUrl=http://127.0.0.1:5174");
    await page.getByRole("button", { name: /chat/i }).click();
    await page.getByRole("button", { name: "Vamos prosseguir", exact: true }).click();
    await page.getByRole("button", { name: "Sim", exact: true }).last().click();
    await expect(page.getByRole("textbox", { name: "Número do endereço", exact: true })).toBeVisible();
    await expect(page.locator('[data-aacp-inline-field="cep"]')).toHaveCount(0);
    expect(messages).toEqual(["Vamos prosseguir", "Sim"]);
    expect(quoteRequests).toBe(0);

    await page.getByRole("textbox", { name: "Número do endereço", exact: true }).fill("100");
    await page.getByRole("button", { name: "Enviar Número do endereço", exact: true }).click();
    await page.getByRole("textbox", { name: "Complemento", exact: true }).fill("sem complemento");
    await page.getByRole("button", { name: "Enviar Complemento", exact: true }).click();
    await page.getByRole("button", { name: "Quero PAC", exact: true }).click();
    await expect(page.getByText("Tem cupom de desconto?", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Não possuo cupom", exact: true }).click();
    await expect(page.getByText("Pix", { exact: true })).toBeVisible();
    expect(messages).toEqual(["Vamos prosseguir", "Sim", "100", "sem complemento", "Quero PAC"]);
    await expect(page.locator('[data-aacp-inline-field="cep"]')).toHaveCount(0);
  });
}
