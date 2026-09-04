/**
 * PIX Payment E2E with Real Webhook Monitoring
 *
 * Full flow:
 * 1. Login with phone OTP (real phone: 21993001883)
 * 2. OTP code extracted from API response (dev_code) or API logs
 * 3. Navigate checkout → PIX payment
 * 4. Poll payment intent status until "approved" (manual approval in Asaas)
 * 5. Verify webhook delivery
 *
 * Prerequisites:
 * - API running at E2E_API_URL (default: http://127.0.0.1:3009)
 * - ngrok tunnel active → forwarding to API /webhooks/asaas
 * - ASAAS_WEBHOOK_TOKEN set in .env
 * - ASAAS_API_KEY_SANDBOX set in .env
 * - Webhook registered in Asaas dashboard with ngrok URL
 *
 * Run:
 *   cd apps/widget && pnpm e2e:realapi -- --grep "@live-pix"
 *
 * Timeout: 3 minutes (gives time for manual Asaas approval)
 */
import { test, expect } from "@playwright/test";
import {
  openChatCheckout,
  REALAPI_URL,
  waitForChatIdle,
  sendChat,
  dismissChannelGate,
  checkoutUrl,
} from "../fixtures/realapi-helpers.js";

const API = REALAPI_URL;
const PHONE = "21993001883";
const PHONE_FORMATTED = "(21) 99300-1883";

// 3 min timeout — manual approval needs time
test.setTimeout(180_000);

test.describe("@realapi @live-pix PIX checkout with real webhook", () => {
  let merchantId: string;
  let embedToken: string;

  test.beforeEach(async ({ request }) => {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔧 Seeding merchant...");
    const seed = await request.post(`${API}/__test__/seed`);
    expect(seed.ok()).toBe(true);
    const data = await seed.json();
    merchantId = data.merchantId;
    embedToken = data.embedToken;
    console.log(`✅ Merchant: ${merchantId}`);
    console.log(`✅ Embed Token: ${embedToken.slice(0, 12)}...`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  });

  test("login OTP → checkout → PIX → wait webhook approval", async ({ page, request }) => {
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Open checkout widget
    // ═══════════════════════════════════════════════════════════════════════
    console.log("📱 Step 1: Opening checkout widget...");
    await openChatCheckout(page, merchantId, embedToken, "e2e_product_001");
    console.log("✅ Checkout open, channel gate dismissed\n");

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Login with phone OTP
    // ═══════════════════════════════════════════════════════════════════════
    console.log("📱 Step 2: Login with phone OTP...");

    // Intercept the widget's /buyer/phone/send response to capture dev_code
    let otpCode: string | null = null;
    page.on("response", async (res) => {
      if (res.url().includes("/buyer/phone/send") && res.request().method() === "POST") {
        try {
          const data = await res.json() as { sent?: boolean; dev_code?: string };
          if (data.dev_code) {
            otpCode = data.dev_code;
            console.log(`  → [intercepted] dev_code: ${otpCode}`);
          }
        } catch {}
      }
    });

    // Click "Entrar" button to open auth modal
    const entrarBtn = page.getByRole("button", { name: /Entrar/i });
    await expect(entrarBtn).toBeVisible({ timeout: 10_000 });
    await entrarBtn.click();
    console.log("  → Auth modal opened");

    // Fill phone number
    const phoneInput = page.getByLabel("Numero do celular");
    await expect(phoneInput).toBeVisible({ timeout: 5_000 });
    await phoneInput.fill(PHONE_FORMATTED);
    console.log(`  → Phone filled: ${PHONE_FORMATTED}`);

    // Click "Enviar codigo por SMS" — this triggers the widget's fetch
    const sendBtn = page.locator(".zyon-auth-primary");
    await expect(sendBtn).toBeEnabled({ timeout: 5_000 });
    await sendBtn.click();
    console.log("  → OTP send requested (widget called /buyer/phone/send)");

    // Wait for code input to appear
    const codeInput = page.getByLabel("Codigo de verificacao");
    await expect(codeInput).toBeVisible({ timeout: 10_000 });
    console.log("  → Code input visible");

    // Wait a moment for response interception
    await page.waitForTimeout(1_000);

    // If dev_code was not in the intercepted response, fetch directly
    if (!otpCode) {
      console.log("  → dev_code not in widget response, calling API directly...");
      const otpRes = await request.post(`${API}/buyer/phone/send`, {
        data: { phone: PHONE }
      });
      if (otpRes.ok()) {
        const otpData = await otpRes.json() as { dev_code?: string };
        if (otpData.dev_code) {
          otpCode = otpData.dev_code;
          console.log(`  → OTP from direct API call: ${otpCode}`);
        }
      }
    }

    if (!otpCode) {
      console.log("\n  ❌ Cannot extract OTP code automatically.");
      console.log("  Possible causes:");
      console.log("  1. SMS provider IS configured (dev_code only returned when no SMS)");
      console.log("  2. NODE_ENV is 'production'");
      console.log("");
      console.log("  Check API terminal for log line:");
      console.log(`     [OTP-PHONE] code=XXXXXX phone=${PHONE}`);
      console.log("");
      console.log("  If you see the code there, hard-code it temporarily.");
      expect(otpCode).toBeTruthy();
      return;
    }

    // Fill OTP code
    await codeInput.fill(otpCode);
    await expect(sendBtn).toBeEnabled({ timeout: 3_000 });
    await sendBtn.click();
    console.log("  → OTP code submitted");

    // Wait for auth modal to close
    await expect(page.locator(".zyon-auth-dialog")).not.toBeVisible({ timeout: 10_000 });
    console.log("✅ Logged in successfully\n");

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Navigate checkout to PIX payment
    // ═══════════════════════════════════════════════════════════════════════
    console.log("🛒 Step 3: Navigating to PIX payment...");

    await sendChat(page, "Sim, quero fechar o pedido");
    await waitForChatIdle(page);
    console.log("  → Confirmed checkout intent");

    await sendChat(page, "PIX");
    await waitForChatIdle(page);
    console.log("  → Selected PIX payment method");

    // Agent may ask for CPF/address. Provide complete data
    await sendChat(page, "Diego, CPF 12345678900, email diego@teste.com");
    await waitForChatIdle(page);
    console.log("  → Provided customer data");

    await sendChat(page, "CEP 20040-020, Rua Buenos Aires 123, Centro, Rio de Janeiro");
    await waitForChatIdle(page);
    console.log("  → Provided address");

    // Confirm if prompted
    await sendChat(page, "Confirmar");
    await waitForChatIdle(page);
    console.log("  → Confirmed order");

    // Wait for payment intent creation
    await page.waitForTimeout(3_000);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Capture payment intent and monitor webhook
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n💰 Step 4: Looking for payment intent...");

    // Intercept payment responses from page traffic
    let intentId: string | null = null;
    let pixCode: string | null = null;

    // Try to get from API directly
    const intentsRes = await request.get(
      `${API}/payment/intents?merchant_id=${merchantId}&status=requires_action`
    );

    if (intentsRes.ok()) {
      const intents = await intentsRes.json() as Array<{
        id: string;
        status: string;
        amountCents: number;
        buyerFacing?: { qrCodeCopyPaste?: string; invoiceUrl?: string };
      }>;

      if (intents.length > 0) {
        const latest = intents[intents.length - 1];
        intentId = latest.id;
        pixCode = latest.buyerFacing?.qrCodeCopyPaste ?? null;
        console.log(`  ✅ Found intent: ${intentId}`);
        console.log(`  📋 Amount: R$ ${(latest.amountCents / 100).toFixed(2)}`);
        console.log(`  📋 Status: ${latest.status}`);
        if (pixCode) {
          console.log(`  📋 PIX Code: ${pixCode.slice(0, 60)}...`);
        }
        if (latest.buyerFacing?.invoiceUrl) {
          console.log(`  🔗 Invoice URL: ${latest.buyerFacing.invoiceUrl}`);
        }
      }
    }

    // Also check page for PIX QR display
    const pixDisplay = page.locator("[data-testid='pix-copy'], button:has-text('Copiar código PIX'), .pix-code-display");
    if (await pixDisplay.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      console.log("  ✅ PIX QR code visible in widget");
    }

    if (!intentId) {
      // Try alternate: check embed payment endpoint
      const embedIntentsRes = await request.get(
        `${API}/embed/payment/intents?merchant_id=${merchantId}`
      ).catch(() => null);

      if (embedIntentsRes?.ok()) {
        const data = await embedIntentsRes.json() as any[];
        if (data.length > 0) {
          intentId = data[data.length - 1].id;
          console.log(`  ✅ Found intent via embed: ${intentId}`);
        }
      }
    }

    if (!intentId) {
      console.log("\n  ⚠️  No payment intent found.");
      console.log("  The conversation may not have reached payment step.");
      console.log("  Check:");
      console.log("  - Is the conversation engine responding?");
      console.log("  - Did the agent reach payment stage?");
      console.log("  - Are commerce/cart items configured?\n");

      // Take screenshot for debugging
      await page.screenshot({ path: "e2e-pix-debug-screenshot.png", fullPage: true });
      console.log("  📷 Screenshot saved: e2e-pix-debug-screenshot.png");
    }

    expect(intentId).toBeTruthy();

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Wait for webhook delivery (manual approval in Asaas)
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔄 AGUARDANDO APROVAÇÃO MANUAL NO ASAAS");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log("👉 Acesse: https://sandbox.asaas.com");
    console.log("👉 Encontre o pagamento PIX pendente");
    console.log("👉 Clique em 'Confirmar recebimento'");
    console.log("");
    if (pixCode) {
      console.log(`📋 PIX Code (se precisar): ${pixCode.slice(0, 80)}...`);
      console.log("");
    }
    console.log("⏱️  Polling a cada 3s por até 120s...");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Poll for status change
    const startTime = Date.now();
    const maxWait = 120_000; // 2 minutes
    const interval = 3_000;
    let finalStatus = "unknown";
    let webhookReceived = false;

    while (Date.now() - startTime < maxWait) {
      try {
        const checkRes = await request.get(
          `${API}/payment/intents/${intentId}?merchant_id=${merchantId}`
        );

        if (checkRes.ok()) {
          const intent = await checkRes.json() as { status: string };
          const elapsed = Math.round((Date.now() - startTime) / 1000);

          if (intent.status !== finalStatus) {
            console.log(`  [${elapsed}s] Status: ${finalStatus} → ${intent.status}`);
            finalStatus = intent.status;
          }

          if (finalStatus === "approved") {
            webhookReceived = true;
            console.log(`\n  ✅ PAYMENT APPROVED! (after ${elapsed}s)`);
            console.log("  → Webhook was delivered and processed successfully");
            break;
          }

          if (finalStatus === "failed") {
            console.log(`\n  ❌ Payment FAILED (after ${elapsed}s)`);
            break;
          }
        }
      } catch (e) {
        // Network error, keep trying
      }

      await page.waitForTimeout(interval);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: Verify results
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 RESULTADO FINAL");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Payment Intent: ${intentId}`);
    console.log(`  Status Final: ${finalStatus}`);
    console.log(`  Webhook Recebido: ${webhookReceived ? "✅ SIM" : "❌ NÃO"}`);

    if (!webhookReceived) {
      console.log("\n  ⚠️  WEBHOOK NÃO CHEGOU. Verificar:");
      console.log("  1. ngrok está rodando? (URL não expirou?)");
      console.log("  2. Webhook URL no Asaas dashboard está correta?");
      console.log("  3. ASAAS_WEBHOOK_TOKEN no .env bate com o do dashboard?");
      console.log("  4. Pagamento foi aprovado no Asaas?");
      console.log("  5. Verificar logs do ngrok (requests recebidos)");
      console.log("  6. Verificar logs da API: grep 'asaas.webhook'");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    expect(finalStatus).toBe("approved");
    expect(webhookReceived).toBe(true);
  });
});
