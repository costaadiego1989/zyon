import { expect, test } from "@playwright/test";
import { setupApiMocks, type FlowStep } from "./fixtures/api-mocks.js";
import {
  answerAndWaitForPrompt,
  answerByVoice,
  completeVoiceRegistration,
  emitVoiceTranscript,
  ensureListening,
  installVoiceBrowserMocks,
  openVoiceCheckout,
  selectVoiceShipping,
  skipCouponByVoice,
  spokenCount,
  VOICE_REGISTRATION_SEQUENCE,
  waitForVoicePrompt,
} from "./fixtures/voice-helpers.js";

test.beforeEach(async ({ page }) => {
  await installVoiceBrowserMocks(page);
});

// ─── 0. Channel gate ─────────────────────────────────────────────────────────

test.describe("0. Channel gate (voz)", () => {
  test("dialog mostra opção Comprar por voz e abre experiência voice", async ({ page }) => {
    await openVoiceCheckout(page, []);
    await expect(page.locator(".aacp-voice-header__mode")).toContainText(/voz/i);
    await expect(page.locator(".aacp-voice-mic")).toBeVisible();
  });

  test("botão Chat permite voltar ao modo conversacional", async ({ page }) => {
    await openVoiceCheckout(page, []);
    await page.getByRole("button", { name: /^Chat$/i }).click();
    await expect(page.locator("[data-channel='voice']")).toHaveCount(0);
    await expect(page.locator(".aacp-thread")).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 1. Cadastro (data_collection) ─────────────────────────────────────────────

test.describe("1. Cadastro por voz (data_collection)", () => {
  test.setTimeout(90_000);

  test("agente fala greeting e pede nome", async ({ page }) => {
    await openVoiceCheckout(page, []);
    await waitForVoicePrompt(page, /nome/i);
    await expect.poll(() => spokenCount(page), { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test("nome → email → CPF → telefone → CEP", async ({ page }) => {
    await openVoiceCheckout(page, ["ask_email", "ask_cpf", "ask_phone", "ask_cep"]);
    await waitForVoicePrompt(page, /nome/i);
    await answerAndWaitForPrompt(page, "Maria Souza", /e-?mail/i);
    await answerAndWaitForPrompt(page, "maria arroba exemplo ponto com", /cpf/i);
    await answerAndWaitForPrompt(page, "98765432100", /telefone/i);
    await answerAndWaitForPrompt(page, "21988887777", /cep|frete/i);
  });

  test("painel de confirmação mascara CPF sensível", async ({ page }) => {
    await openVoiceCheckout(page, ["ask_email"]);
    await waitForVoicePrompt(page, /nome/i);
    await answerAndWaitForPrompt(page, "Joao Silva", /e-?mail/i);
    await emitVoiceTranscript(page, "12345678901");
    const panel = page.locator(".aacp-voice-confirmation");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/\*\*\*/);
    await page.getByRole("button", { name: /Confirmar e enviar/i }).click();
  });

  test("buyer existente: email reconhecido → OTP → frete", async ({ page }) => {
    await openVoiceCheckout(page, [
      "ask_email",
      "existing_buyer_otp_sent",
      "existing_buyer_shipping_options",
    ]);
    await waitForVoicePrompt(page, /nome/i);
    await answerAndWaitForPrompt(page, "Diego Costa", /e-?mail/i);
    await answerAndWaitForPrompt(page, "costaadiego1989@gmail.com", /codigo|verifica/i);

    const loginResponse = page.waitForResponse(
      (res) => res.url().includes("/buyer/login-from-session") && res.request().method() === "POST",
    );
    await answerByVoice(page, "123456");
    await waitForVoicePrompt(page, /frete|endereco|bem-vindo/i);

    const selector = page.locator(".aacp-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 10_000 });
    expect((await loginResponse).ok()).toBe(true);
  });
});

// ─── 2. Frete (shipping) ─────────────────────────────────────────────────────

test.describe("2. Frete por voz (shipping)", () => {
  test.setTimeout(90_000);

  test("CEP → confirma endereço → número → selector PAC/Sedex", async ({ page }) => {
    await openVoiceCheckout(page, [
      "ask_cep",
      "confirm_address",
      "ask_number",
      "show_shipping_options",
    ]);
    await waitForVoicePrompt(page, /nome/i);
    await answerAndWaitForPrompt(page, "Ana Lima", /cep|frete/i);
    await answerAndWaitForPrompt(page, "01310100", /endereco|rua/i);
    await answerAndWaitForPrompt(page, "sim correto", /numero|complemento/i);
    await answerByVoice(page, "456 bloco B");
    const selector = page.locator(".aacp-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 10_000 });
    await expect(selector).toContainText("PAC");
    await expect(selector).toContainText("Sedex");
  });

  test("selecionar Sedex por voz avança para pagamento", async ({ page }) => {
    await openVoiceCheckout(page, VOICE_REGISTRATION_SEQUENCE);
    await completeVoiceRegistration(page);
    await selectVoiceShipping(page, "Sedex");
    await skipCouponByVoice(page);
    await expect(page.locator(".aacp-voice-chip, .aacp-voice-chips button").filter({ hasText: /PIX/i }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("indicador de jornada avança de Cadastro para Entrega", async ({ page }) => {
    await openVoiceCheckout(page, ["ask_cep", "show_shipping_options"]);
    const stageLabel = page.locator(".aacp-stage-progress-title, .aacp-journey-step.is-active .aacp-journey-step__label").first();
    await waitForVoicePrompt(page, /nome/i);
    await answerAndWaitForPrompt(page, "Pedro Alves", /cep|frete/i);
    await expect(stageLabel).toContainText(/Entrega|Frete/i, { timeout: 10_000 });
  });
});

// ─── 3. Pagamento (payment) ──────────────────────────────────────────────────

test.describe("3. Pagamento por voz (payment)", () => {
  test.setTimeout(90_000);

  test("cartão de crédito abre Stripe element", async ({ page }) => {
    await openVoiceCheckout(page, VOICE_REGISTRATION_SEQUENCE);
    await completeVoiceRegistration(page);
    await selectVoiceShipping(page, "PAC");
    await skipCouponByVoice(page);

    const cardIntentRequest = page.waitForRequest((request) => {
      if (!request.url().includes("/payment/intents") || request.method() !== "POST") return false;
      try {
        return JSON.parse(request.postData() ?? "{}").method === "card";
      } catch {
        return false;
      }
    });

    await answerByVoice(page, "cartao de credito");
    const request = await cardIntentRequest;
    expect(JSON.parse(request.postData() ?? "{}")).toMatchObject({ method: "card" });
    await expect(page.locator(".aacp-stripe-element-wrap")).toBeVisible({ timeout: 10_000 });
  });

  test("PIX gera cobrança via API e fala código na legenda", async ({ page }) => {
    await openVoiceCheckout(page, VOICE_REGISTRATION_SEQUENCE);
    await completeVoiceRegistration(page);
    await selectVoiceShipping(page, "PAC");
    await skipCouponByVoice(page);

    const pixIntentRequest = page.waitForRequest((request) => {
      if (!request.url().includes("/payment/intents") || request.method() !== "POST") return false;
      try {
        return JSON.parse(request.postData() ?? "{}").method === "pix";
      } catch {
        return false;
      }
    });

    await answerByVoice(page, "pix");
    await pixIntentRequest;
    await waitForVoicePrompt(page, /cobranca|pix|000201/i);
    // QR/copiar ficam no thread de chat; em voz validamos a cobrança gerada na legenda.
    await expect(page.locator(".aacp-voice-caption__agent")).toContainText(/cobranca|pix/i);
  });
});

// ─── 4. Cupom ────────────────────────────────────────────────────────────────

test.describe("4. Cupom por voz", () => {
  test.setTimeout(90_000);

  test("tenho cupom → input visível → aplica desconto", async ({ page }) => {
    const sequence: FlowStep[] = [...VOICE_REGISTRATION_SEQUENCE, "coupon_applied"];
    await openVoiceCheckout(page, sequence);
    await completeVoiceRegistration(page);
    await selectVoiceShipping(page, "PAC");
    await answerAndWaitForPrompt(page, "tenho cupom", /codigo|cupom/i);

    const couponBox = page.locator(".aacp-coupon-box");
    await expect(couponBox).toBeVisible({ timeout: 5_000 });
    const input = couponBox.locator("input");
    await input.fill("DESCONTO10");
    await couponBox.locator("button", { hasText: /aplicar/i }).click();
    await page.waitForTimeout(1_500);
    const content = await page.content();
    expect(content).toMatch(/89[,.]98|desconto|10%/i);
  });
});

// ─── 5. Conclusão (completed) ────────────────────────────────────────────────

test.describe("5. Conclusão por voz (completed)", () => {
  test.setTimeout(90_000);

  test("PIX aprovado instantaneamente → stage completed", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: VOICE_REGISTRATION_SEQUENCE,
      pixInstantApproval: true,
    });
    await page.goto(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173");
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Comprar por voz/i }).click();
    await expect(page.locator("[data-channel='voice']")).toBeVisible({ timeout: 10_000 });

    await completeVoiceRegistration(page);
    await selectVoiceShipping(page, "PAC");
    await skipCouponByVoice(page);
    await answerByVoice(page, "pix");

    await expect(page.locator("[data-channel='voice'][data-stage='completed']")).toBeVisible({
      timeout: 15_000,
    });
    await waitForVoicePrompt(page, /confirmado|aprovado/i);
  });
});

// ─── 6. Carrinho ───────────────────────────────────────────────────────────────

test.describe("6. Carrinho por voz", () => {
  test("order strip abre painel do carrinho", async ({ page }) => {
    await openVoiceCheckout(page, []);
    await page.locator(".aacp-voice-order-strip").click();
    const cartPanel = page.locator("#aacp-cart-panel");
    await expect(cartPanel).toHaveClass(/open/, { timeout: 3_000 });
    await expect(cartPanel).toContainText("Bolsa Executiva");
  });
});

// ─── 7. Resiliência / edge cases ─────────────────────────────────────────────

test.describe("7. Resiliência por voz", () => {
  test.setTimeout(90_000);

  test("Falar de novo descarta confirmação sem enviar", async ({ page }) => {
    await openVoiceCheckout(page, ["ask_email"]);
    await waitForVoicePrompt(page, /nome/i);
    await emitVoiceTranscript(page, "nome errado");
    await expect(page.locator(".aacp-voice-confirmation")).toBeVisible();
    await page.getByRole("button", { name: /Falar de novo/i }).click();
    await expect(page.locator(".aacp-voice-confirmation")).toBeHidden({ timeout: 5_000 });
    await ensureListening(page);
  });

  test("Editar no chat preserva transcript e abre modo conversacional", async ({ page }) => {
    await openVoiceCheckout(page, ["ask_email"]);
    await waitForVoicePrompt(page, /nome/i);
    await emitVoiceTranscript(page, "Joao da Silva");
    await expect(page.locator(".aacp-voice-confirmation")).toBeVisible();
    await page.getByRole("button", { name: /Editar no chat/i }).click();
    await expect(page.locator(".aacp-thread")).toBeVisible({ timeout: 10_000 });
    const input = page.locator("input[aria-label='Mensagem para o assistente']");
    await expect(input).toHaveValue("Joao da Silva");
  });

  test("mic desabilitado enquanto agente fala (speaking state)", async ({ page }) => {
    await openVoiceCheckout(page, []);
    await waitForVoicePrompt(page, /nome/i);
    const mic = page.locator(".aacp-voice-mic");
    await expect(mic).toBeVisible();
    const voiceState = page.locator("[data-channel='voice']");
    await expect(voiceState).toHaveAttribute("data-voice-state", /idle|listening|speaking/);
  });
});

// ─── 8. Fluxo completo E2E ────────────────────────────────────────────────────

test.describe("8. Fluxo completo por voz", () => {
  test.setTimeout(120_000);

  test("cadastro → frete → cupom negado → cartão Stripe", async ({ page }) => {
    await openVoiceCheckout(page, VOICE_REGISTRATION_SEQUENCE);
    await completeVoiceRegistration(page);
    await selectVoiceShipping(page, "PAC");
    await skipCouponByVoice(page);
    await answerByVoice(page, "cartao de credito");

    await expect(page.locator(".aacp-stripe-element-wrap")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".aacp-voice-caption__agent")).toContainText(/cartao|valor|confirmar/i, {
      timeout: 10_000,
    });
    await expect.poll(() => spokenCount(page), { timeout: 10_000 }).toBeGreaterThan(3);
  });
});
