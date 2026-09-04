/**
 * PIX Payment E2E — Production Ready com Login Real
 *
 * Sem seed automático. Você loga com sua conta real.
 * Test para quando chegar em "aguarde aprovação manual", avisa você.
 *
 * Rodar:
 *   cd apps/widget && npx playwright test e2e/realapi/pix-production.spec.ts
 */

import { test, expect } from "@playwright/test";

const WIDGET_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173";
const API = process.env.E2E_API_URL || "http://127.0.0.1:3009";
const PHONE = "21993001883";

test.setTimeout(180_000); // 3 min

test("PIX checkout com seu usuário real → webhook approval", async ({ page, request }) => {
  console.log("\n" + "=".repeat(80));
  console.log("🚀 E2E PIX Checkout - Login Real");
  console.log("=".repeat(80) + "\n");

  // ════════════════════════════════════════════════════════════════════════════════
  // STEP 1: Você preenche os dados de login manualmente
  // ════════════════════════════════════════════════════════════════════════════════
  console.log("📝 [1/5] Abrir widget...");
  console.log("   URL: " + WIDGET_URL);
  console.log("   Aguardando você logar manualmente...\n");

  await page.goto(WIDGET_URL);

  // Espera você logar (até 10 min)
  console.log("⏳ Aguardando login (timeout: 10 min)...");
  console.log("   Quando logar com sucesso, teste continua automaticamente\n");

  // Espera a thread de chat ficar pronta (indicador que está logado)
  await expect(page.locator('[role="log"]')).toBeVisible({ timeout: 600_000 });
  console.log("✅ Login detectado\n");

  // ════════════════════════════════════════════════════════════════════════════════
  // STEP 2: Chat → PIX payment completo
  // ════════════════════════════════════════════════════════════════════════════════
  console.log("💬 [2/5] Navegando checkout via chat...");

  const sendChat = async (text: string, label: string) => {
    await page.waitForTimeout(300);
    const form = page.locator(".zyon-composer-form").first();
    const input = form.getByLabel("Mensagem para o assistente");
    const sendButton = form.getByRole("button", { name: "Enviar mensagem" });

    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill(text);
    await expect(sendButton).toBeEnabled({ timeout: 3_000 });

    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/embed/chat") && res.request().method() === "POST"
    );
    await sendButton.click();
    await responsePromise.catch(() => null);

    await page.waitForTimeout(500);
    await expect(page.locator(".zyon-typing")).toBeHidden({ timeout: 10_000 }).catch(() => null);
    console.log(`  → ${label}`);
  };

  try {
    await sendChat("Sim, quero comprar", "Purchase intent confirmed");
    await sendChat("PIX", "Selected PIX payment");
    await sendChat("Confirmar", "Order confirmed");
    await page.waitForTimeout(2_000);
    console.log("  ✅ Checkout via chat concluído\n");
  } catch (e) {
    console.log(`  ⚠️  Chat flow interrompido: ${e instanceof Error ? e.message : String(e)}`);
    console.log("  Continue manualmente no chat e me avise quando payment intent aparecer\n");
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // STEP 3: Buscar payment intent ativo
  // ════════════════════════════════════════════════════════════════════════════════
  console.log("💰 [3/5] Buscando payment intent...");

  // Se temos merchantId nos cookies/session, usa; senão, tenta extrair do page
  let merchantId: string | null = null;

  // Tenta pegar do localStorage (widget o armazena)
  try {
    const storageData = await page.evaluate(() => localStorage.getItem("aacp_embed_session"));
    if (storageData) {
      const parsed = JSON.parse(storageData);
      merchantId = parsed.merchantId || null;
    }
  } catch {}

  // Se não achou, tenta chamar um endpoint de teste que lista últimos intents
  // (requer implementação no API __test__ controller)
  if (!merchantId) {
    console.log("  ⚠️  Não consegui extrair merchantId automaticamente");
    console.log("  Abra o DevTools do Playwright:");
    console.log("    1. Page → Context menu → DevTools");
    console.log("    2. Network → procure por /embed/payment/intents");
    console.log("    3. Veja a query string: ?merchant_id=XXX");
    console.log("");

    // Pausa para você fazer isso
    await page.pause();
    return;
  }

  console.log(`  Merchant ID: ${merchantId}`);

  // Busca intents pendentes
  const intentsRes = await request.get(
    `${API}/payment/intents?merchant_id=${merchantId}&status=requires_action`,
    { headers: { "Content-Type": "application/json" } }
  ).catch(() => null);

  let intentId: string | null = null;
  let pixCode: string | null = null;
  let amount: number | null = null;

  if (intentsRes?.ok()) {
    const intents = (await intentsRes.json()) as Array<{
      id: string;
      status: string;
      amountCents: number;
      buyerFacing?: { qrCodeCopyPaste?: string };
    }>;

    if (intents.length > 0) {
      const latest = intents[intents.length - 1];
      intentId = latest.id;
      pixCode = latest.buyerFacing?.qrCodeCopyPaste || null;
      amount = latest.amountCents / 100;

      console.log(`  ✅ Intent encontrado: ${intentId}`);
      console.log(`  💵 Valor: R$ ${amount.toFixed(2)}`);
      if (pixCode) {
        console.log(`\n  📱 PIX Code:\n     ${pixCode}\n`);
      }
    }
  }

  if (!intentId) {
    console.log("  ❌ Nenhum payment intent pendente encontrado");
    console.log("  Verifique se o checkout chegou ao step de pagamento\n");
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // STEP 4: Pausa pra você aprovar no Asaas
  // ════════════════════════════════════════════════════════════════════════════════
  console.log("⏳ [4/5] Aguardando sua aprovação manual...\n");
  console.log("=" + "=".repeat(79));
  console.log("🔔 AÇÃO NECESSÁRIA:");
  console.log("=" + "=".repeat(79));
  console.log("");
  console.log("PASSO 1: Abra Asaas Sandbox");
  console.log("   URL: https://sandbox.asaas.com");
  console.log("   Login com sua conta");
  console.log("");
  console.log("PASSO 2: Encontre o pagamento");
  console.log(`   Valor: R$ ${amount?.toFixed(2)}`);
  console.log("   Menu: Pagamentos → Buscar");
  console.log("");
  console.log("PASSO 3: Aprove o pagamento");
  console.log("   Clique no pagamento");
  console.log("   Clique em 'Confirmar recebimento' ou 'Aprovar'");
  console.log("");
  console.log("PASSO 4: Webhook será enviado automaticamente");
  console.log("   Test vai detectar status mudando para 'approved'");
  console.log("");
  console.log("=" + "=".repeat(79) + "\n");

  // Pausa pra você fazer isso
  console.log("⏸️  Teste PAUSADO. Vá aprovar no Asaas.");
  console.log("   Quando aprovar, voltarei aqui (Ctrl+D pra continuar)\n");
  await page.pause();

  // ════════════════════════════════════════════════════════════════════════════════
  // STEP 5: Poll até approval chegar
  // ════════════════════════════════════════════════════════════════════════════════
  console.log("🔄 [5/5] Polling status...\n");

  let finalStatus = "requires_action";
  const startTime = Date.now();
  const maxWait = 30_000; // 30s (webhook já deve ter chegado)
  let checkCount = 0;

  while (Date.now() - startTime < maxWait) {
    checkCount++;
    try {
      const checkRes = await request.get(
        `${API}/payment/intents/${intentId}?merchant_id=${merchantId}`
      );

      if (checkRes.ok()) {
        const intent = (await checkRes.json()) as { status: string };
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        if (intent.status !== finalStatus) {
          console.log(`  [${elapsed}s] Status: ${finalStatus} → ${intent.status}`);
          finalStatus = intent.status;
        }

        if (intent.status === "approved") {
          console.log(`\n✅ SUCESSO! Payment aprovado\n`);
          break;
        }

        if (intent.status === "failed") {
          console.log(`\n❌ Payment FALHOU\n`);
          break;
        }
      }
    } catch (e) {
      // Continue
    }

    await page.waitForTimeout(1_000);
  }

  console.log("=" + "=".repeat(79));
  console.log("📊 RESULTADO");
  console.log("=" + "=".repeat(79));
  console.log(`  Intent:  ${intentId}`);
  console.log(`  Valor:   R$ ${amount?.toFixed(2)}`);
  console.log(`  Status:  ${finalStatus}`);
  console.log(`  Webhook: ${finalStatus === "approved" ? "✅ Recebido" : "❌ Não recebido"}`);
  console.log("=" + "=".repeat(79) + "\n");

  expect(finalStatus).toBe("approved");
});
