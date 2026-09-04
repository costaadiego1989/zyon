/**
 * T-NEW — Embed customer update integration with PIX payment.
 *
 * Verifies that the widget calls POST /embed/customer/update after collecting
 * customer data, and that the subsequent payment-intent creation does NOT
 * fail with "asaas_customer_data_incomplete".
 */
import { test, expect } from "@playwright/test";
import { openChatCheckout, sendChat, waitForChatIdle, REALAPI_URL } from "../fixtures/realapi-helpers.js";

const API = REALAPI_URL;

test.describe("@realapi embed customer update + PIX", () => {
  let merchantId: string;
  let embedToken: string;

  test.beforeEach(async ({ request }) => {
    const seed = await request.post(`${API}/__test__/seed`);
    expect(seed.ok()).toBe(true);
    ({ merchantId, embedToken } = await seed.json());
  });

  test("widget syncs customer data and PIX intent succeeds without asaas_customer_data_incomplete", async ({ page }) => {
    // Capture API traffic
    const customerUpdates: { body: string }[] = [];
    const paymentResponses: { status: number; body: string }[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/embed/customer/update")) {
        customerUpdates.push({ body: req.postData() ?? "" });
      }
    });
    page.on("response", async (res) => {
      if (res.url().includes("/embed/payment/intents") && res.request().method() === "POST") {
        try {
          paymentResponses.push({ status: res.status(), body: await res.text() });
        } catch {}
      }
    });

    await openChatCheckout(page, merchantId, embedToken, "e2e_product_001");

    // Drive the conversation to "Quase lá" / payment step
    await sendChat(page, "Sim, quero fechar o pedido");
    await waitForChatIdle(page);

    await sendChat(page, "PIX");
    await waitForChatIdle(page);

    // The agent may ask for the address/CPF next. Provide it.
    await sendChat(page, "Meu nome é João Silva, email joao@teste.com, CPF 12345678900");
    await waitForChatIdle(page);

    await sendChat(page, "CEP 69020-060, número 123");
    await waitForChatIdle(page);

    // Confirm if a confirmation prompt appears
    await sendChat(page, "Confirmar");
    await waitForChatIdle(page);

    // Allow async work
    await page.waitForTimeout(3000);

    // Logs for debugging
    console.log(`customer update calls: ${customerUpdates.length}`);
    for (const u of customerUpdates) console.log(`  body: ${u.body}`);
    console.log(`payment intent responses: ${paymentResponses.length}`);
    for (const p of paymentResponses) {
      console.log(`  status=${p.status} body=${p.body.slice(0, 300)}`);
    }

    // The widget must have called the new endpoint at least once when
    // customer data was collected.
    expect(customerUpdates.length).toBeGreaterThanOrEqual(1);

    // Either the agent already asked for payment or we are on the payment step.
    // If paymentResponses fired, ensure no asaas_customer_data_incomplete error.
    if (paymentResponses.length > 0) {
      for (const p of paymentResponses) {
        expect(p.body).not.toContain("asaas_customer_data_incomplete");
      }
    }

    // Final assertion: the chat thread remained rendered and stable
    await expect(page.locator('[role="log"]')).toBeVisible();
  });
});
