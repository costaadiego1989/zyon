import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCheckoutPayment } from "../hooks/use-checkout-payment.js";
import type { WidgetConfig } from "../lib/widget-types.js";
import type { CheckoutSessionState } from "../hooks/use-checkout-session.js";
import type { CheckoutChatState } from "../hooks/use-checkout-chat.js";

function buildConfig(mode: "embed" | "legacy" = "embed"): WidgetConfig {
  if (mode === "embed") {
    return {
      mode: "embed",
      embedSessionToken: "tok.test",
      merchantId: "mrc_test",
      apiBaseUrl: "http://localhost:3001",
      uiPresentation: "conversational",
      cart: { currency: "BRL", total: 300, items: [] }
    };
  }
  return {
    mode: "legacy",
    merchantId: "mrc_test",
    apiBaseUrl: "http://localhost:3001",
    uiPresentation: "conversational",
    cart: { currency: "BRL", total: 300, items: [] }
  };
}

function buildSessionState(overrides: Partial<CheckoutSessionState> = {}): CheckoutSessionState {
  const experience = {
    stage: "payment" as const,
    brand: { merchant_id: "mrc_test", name: "Test", subtitle: "", logo_url: "", accent_color: "#000", support_label: "", theme: {} as any },
    rules: {},
    items: [],
    totals: { currency: "BRL" as const, subtotal: 300, shipping: 0, discount: 0, total: 300 },
    agent: { name: "Bot", greeting: "Ola", tone: "consultative" as const, language: "pt-BR" },
    copy: { headline: "", subheadline: "", trust_badges: [], quick_replies: [], focus_input: true }
  };
  return {
    session: {
      session_id: "sess_test",
      conversation_id: "conv_test",
      global_user_id: "gu_test",
      agent_enabled: true,
      initial_mode: "open",
      tracking_token: "trk_test",
      experience
    },
    apiOrigin: "http://localhost:3001",
    embedOpts: { embedToken: "tok.test" },
    activeExperience: experience,
    syncExperience: vi.fn(),
    networkError: null,
    startedEvent: null,
    track: vi.fn(),
    ...overrides
  } as unknown as CheckoutSessionState;
}

function buildChatState(): Pick<CheckoutChatState, "appendAgentTurn" | "lastChat"> {
  return {
    appendAgentTurn: vi.fn(),
    lastChat: null
  };
}

describe("useCheckoutPayment", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "test-uuid-1234" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, status = 200) {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" }
      })
    );
  }

  it("createPaymentIntent('card') com clientSecret e id → seta stripeIntent, NÃO adiciona agent turn", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "pi_intent_1",
        amountCents: 30000,
        currency: "BRL",
        buyerFacing: { clientSecret: "pi_xxx_secret", stripePublishableKey: "pk_test_abc" }
      })
    );

    const session = buildSessionState();
    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), session, chat)
    );

    await act(async () => {
      await result.current.createPaymentIntent("card");
    });

    expect(result.current.stripeIntent).toEqual({
      intentId: "pi_intent_1",
      clientSecret: "pi_xxx_secret",
      publishableKey: "pk_test_abc",
      amountCents: 30000,
      currency: "BRL"
    });
    expect(chat.appendAgentTurn).not.toHaveBeenCalled();
  });

  it("P2 regression: createPaymentIntent('card') com clientSecret mas sem id → aborta com mensagem clara, stripeIntent permanece null", async () => {
    // API retornou clientSecret mas omitiu o intent id — comportamento inválido
    // que antes persistia intentId="" causando confirmação que nunca resolvia.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        amountCents: 30000,
        currency: "BRL",
        buyerFacing: { clientSecret: "pi_xxx_secret", stripePublishableKey: "pk_test_abc" }
        // id: ausente propositalmente
      })
    );

    const session = buildSessionState();
    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), session, chat)
    );

    await act(async () => {
      await result.current.createPaymentIntent("card");
    });

    // P2: stripeIntent deve permanecer null (não seta intentId vazio).
    expect(result.current.stripeIntent).toBeNull();
    // Deve emitir mensagem de erro clara ao invés de silenciosamente abrir o form.
    expect(chat.appendAgentTurn).toHaveBeenCalledOnce();
    const [msg] = (chat.appendAgentTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msg).toContain("referência do intent ausente");
  });

  it("P1 regression: createPaymentIntent dupla chamada rápida → só uma requisição é enviada (lock in-flight)", async () => {
    // Simula dois cliques simultâneos. Apenas o primeiro deve fazer a requisição;
    // o segundo deve ser ignorado pelo in-flight lock.
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "pi_intent_only",
        amountCents: 15000,
        currency: "BRL",
        buyerFacing: { qrCodeCopyPaste: "00020126" }
      })
    );

    const session = buildSessionState();
    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), session, chat)
    );

    await act(async () => {
      // Dispara dois calls concorrentes sem aguardar o primeiro
      const p1 = result.current.createPaymentIntent("pix");
      const p2 = result.current.createPaymentIntent("pix");
      await Promise.all([p1, p2]);
    });

    // Apenas uma requisição deve ter sido feita ao endpoint de intents.
    const intentCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/payment/intents")
    );
    expect(intentCalls).toHaveLength(1);
  });

  it("createPaymentIntent('pix') com qrCodeCopyPaste → adiciona agent turn com snippet PIX", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        amountCents: 15000,
        currency: "BRL",
        buyerFacing: { qrCodeCopyPaste: "00020126580014br.gov.bcb.pix" }
      })
    );

    const session = buildSessionState();
    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), session, chat)
    );

    await act(async () => {
      await result.current.createPaymentIntent("pix");
    });

    expect(result.current.stripeIntent).toBeNull();
    expect(chat.appendAgentTurn).toHaveBeenCalledOnce();
    const [msg] = (chat.appendAgentTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msg).toContain("150.00 BRL");
    expect(msg).toContain("00020126580014br.gov.bcb.pix");
  });

  it("createPaymentIntent('pix') approved by fake E2E syncs completed", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        amountCents: 15000,
        approvedAmountCents: 15000,
        currency: "BRL",
        status: "approved",
        buyerFacing: { qrCodeCopyPaste: "00020126580014br.gov.bcb.pix" }
      })
    );

    const session = buildSessionState();
    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), session, chat)
    );

    await act(async () => {
      await result.current.createPaymentIntent("pix");
    });

    expect(chat.appendAgentTurn).toHaveBeenCalledWith(
      expect.stringContaining("Pagamento confirmado"),
      { stream: true }
    );
    expect(session.syncExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "completed",
        copy: expect.objectContaining({ quick_replies: [], focus_input: false })
      })
    );
  });

  it("createPaymentIntent('pix') pendente → faz polling do status autoritativo e completa em approved", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          id: "pay_int_1",
          amountCents: 15000,
          currency: "BRL",
          buyerFacing: { qrCodeCopyPaste: "00020126580014br.gov.bcb.pix" }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "pending", amount_cents: 15000, currency: "BRL" })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "approved",
          amount_cents: 15000,
          approved_amount_cents: 15000,
          currency: "BRL",
          order_id: "ord_555",
          provider_payment_id: "pay_asaas_555",
          receipt_url: "https://pay.example/receipt/555"
        })
      );

    const session = buildSessionState();
    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), session, chat)
    );

    await act(async () => {
      await result.current.createPaymentIntent("pix");
    });
    expect(session.syncExperience).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(session.syncExperience).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(session.syncExperience).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "completed" })
    );

    // Confirmation surfaces the real order id + receipt from authoritative status.
    expect(chat.appendAgentTurn).toHaveBeenCalledWith(
      expect.stringContaining("Pedido ord_555"),
      { stream: true }
    );
    expect(chat.appendAgentTurn).toHaveBeenCalledWith(
      expect.stringContaining("https://pay.example/receipt/555"),
      { stream: true }
    );

    // GET status calls hit the authoritative status path.
    const statusCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/payment/intents/pay_int_1/status")
    );
    expect(statusCall).toBeTruthy();
    vi.useRealTimers();
  });

  it("createPaymentIntent('pix') com invoiceUrl → agent turn com link", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        amountCents: 9900,
        currency: "BRL",
        buyerFacing: { invoiceUrl: "https://pay.example.com/inv/123" }
      })
    );

    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), buildSessionState(), chat)
    );

    await act(async () => {
      await result.current.createPaymentIntent("pix");
    });

    const [msg] = (chat.appendAgentTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msg).toContain("https://pay.example.com/inv/123");
  });

  it("createPaymentIntent com erro de rede → agent turn com mensagem de erro", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network_error"));

    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), buildSessionState(), chat)
    );

    await act(async () => {
      await result.current.createPaymentIntent("card");
    });

    expect(result.current.stripeIntent).toBeNull();
    const [msg] = (chat.appendAgentTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msg).toContain("Nao foi possivel iniciar o pagamento por cartao");
    expect(msg).toContain("tente PIX");
  });

  it("createPaymentIntent sem sessão ativa → noop", async () => {
    const noSession = buildSessionState({ session: null as any });
    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), noSession, chat)
    );

    await act(async () => {
      await result.current.createPaymentIntent("card");
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(chat.appendAgentTurn).not.toHaveBeenCalled();
  });

  it("createPaymentIntent('card') com Stripe ausente orienta PIX/suporte", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        type: "https://docs.aacp.dev/problems/stripe_provider_not_configured",
        title: "Conflict",
        status: 409,
        code: "stripe_provider_not_configured",
        detail: "stripe_provider_not_configured",
        correlation_id: "corr_card"
      }, 409)
    );

    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), buildSessionState(), chat)
    );

    await act(async () => {
      await result.current.createPaymentIntent("card");
    });

    expect(result.current.stripeIntent).toBeNull();
    const [msg] = (chat.appendAgentTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msg).toContain("cartao ainda nao esta habilitado");
    expect(msg).toContain("Tente PIX");
  });

  it("createPaymentIntent('pix') com provedor ausente explica configuracao da loja", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        type: "https://docs.aacp.dev/problems/payment_provider_not_configured",
        title: "Conflict",
        status: 409,
        code: "payment_provider_not_configured",
        detail: "payment_provider_not_configured",
        correlation_id: "corr_pix"
      }, 409)
    );

    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), buildSessionState(), chat)
    );

    await act(async () => {
      await result.current.createPaymentIntent("pix");
    });

    const [msg] = (chat.appendAgentTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msg).toContain("loja ainda nao configurou");
    expect(msg).toContain("provedor de cobranca");
  });

  it("onStripePaymentConfirmed → fica PENDENTE aguardando webhook (sem confirmação otimista)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "pi_int_1",
        amountCents: 50000,
        currency: "BRL",
        buyerFacing: { clientSecret: "pi_c", stripePublishableKey: "pk_test" }
      })
    );

    const session = buildSessionState();
    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), session, chat)
    );

    await act(async () => {
      await result.current.createPaymentIntent("card");
    });

    expect(result.current.stripeIntent).not.toBeNull();

    // Provider confirm not authoritative → stays pending until webhook.
    fetchMock.mockRejectedValueOnce(new Error("network"));

    await act(async () => {
      await result.current.onStripePaymentConfirmed(50000, "BRL");
    });

    // Intent kept; client-side confirm must NOT clear it nor complete the order.
    expect(result.current.stripeIntent).not.toBeNull();
    const calls = (chat.appendAgentTurn as ReturnType<typeof vi.fn>).mock.calls;
    const lastMsg = calls[calls.length - 1][0];
    expect(lastMsg).toContain("500.00 BRL");
    expect(lastMsg).toContain("aguardando a confirmacao");
    expect(lastMsg).not.toContain("Pagamento confirmado");
    // Client-side Stripe confirm must NOT drive the order to completed.
    expect(session.syncExperience).not.toHaveBeenCalled();
  });

  it("onStripePaymentError → adiciona agent turn com mensagem de erro do Stripe", async () => {
    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), buildSessionState(), chat)
    );

    act(() => {
      result.current.onStripePaymentError("Your card was declined.");
    });

    const [msg] = (chat.appendAgentTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msg).toBe("Your card was declined.");
  });

  it("onStripePaymentError com mensagem vazia → fallback genérico", async () => {
    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), buildSessionState(), chat)
    );

    act(() => {
      result.current.onStripePaymentError("");
    });

    const [msg] = (chat.appendAgentTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msg).toContain("Pagamento recusado");
  });

  it("createPaymentIntent('card') sem clientSecret na resposta → trata como PIX/normal", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ amountCents: 10000, currency: "BRL", buyerFacing: {} })
    );

    const chat = buildChatState();
    const { result } = renderHook(() =>
      useCheckoutPayment(buildConfig(), buildSessionState(), chat)
    );

    await act(async () => {
      await result.current.createPaymentIntent("card");
    });

    expect(result.current.stripeIntent).toBeNull();
    expect(chat.appendAgentTurn).toHaveBeenCalled();
  });
});
