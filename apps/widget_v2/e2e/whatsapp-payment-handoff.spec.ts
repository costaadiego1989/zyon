import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`WhatsApp card handoff retains the order and opens the configured secure payment at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const calls: string[] = [];
    const address = { zip: "01310100", street: "Avenida Paulista", number: "100", complement: "", city: "São Paulo", state: "SP" };
    const experience = {
      brand: { name: "Loja QA" }, agent: { name: "Zyon" },
      items: [{ sku: "SERUM", name: "Sérum", unit_price: 189.9, quantity: 1 }, { sku: "BRUMA", name: "Bruma", unit_price: 99.9, quantity: 1 }],
      totals: { subtotal: 289.8, shipping: 0, discount: 0, service_fee: 0.99, total: 289.8, total_to_pay: 290.79 },
      shipping: { carrier: "Correios", method: "PAC", customerPrice: 0, deliveryDays: 6 },
      buyer: { name: "Cliente QA", email: "qa@example.invalid", cpf: "52998224725", phone: "11987654321", address },
      paymentMethods: { pix: true, card: true, boleto: false },
    };
    await page.route("**/embed/**", async route => {
      const path = new URL(route.request().url()).pathname;
      calls.push(path);
      if (path === "/embed/start") return route.fulfill({ json: { session_id: "whatsapp-checkout", conversation_id: "conversation", experience } });
      if (path === "/embed/payment/intents") {
        const body = route.request().postDataJSON();
        expect(body.session_id).toBe("whatsapp-checkout"); expect(body.method).toBe("card");
        expect(body.idempotency_key).toBe("pay_whatsapp-checkout_card_0");
        // Browser/presentation proof only. No external provider or charge.
        return route.fulfill({ json: { id: "qa-card", method: "card", status: "requires_action", amountCents: 29079,
          buyerFacing: { invoiceUrl: "https://www.asaas.com/i/qa-only" }, experience } });
      }
      if (path.includes("/status")) return route.fulfill({ json: { status: "requires_action" } });
      return route.fulfill({ json: {} });
    });
    await page.route("**/checkout-settings/widget-config**", route => route.fulfill({ json: { enabledTriggers: [], advancedRules: [] } }));
    await page.goto("/?embedToken=fixture&merchantId=qa-merchant&apiBaseUrl=http://127.0.0.1:5174&channel=chat&paymentMethod=card");
    await expect(page.getByRole("link", { name: "Continuar para o pagamento seguro" })).toHaveAttribute("href", "https://www.asaas.com/i/qa-only");
    expect(calls.filter(path => path === "/embed/payment/intents")).toHaveLength(1);
    expect(calls.some(path => /shipping\/select|embed\/chat$/.test(path))).toBe(false);
    await expect(page.getByText(/290,79/).first()).toBeVisible();
  });
}
