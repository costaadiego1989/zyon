import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSupportChat } from "../hooks/use-support-chat.js";

const FALLBACK = "Entendo sua dúvida. Nossa equipe responde em até 24h — envie um e-mail para o suporte da loja.";

const DEFAULT_OPTS = {
  apiBaseUrl: "https://api.example.com",
  merchantId: "mrc_001",
  sessionId: "sess_abc",
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
}

describe("useSupportChat", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Estado inicial ────────────────────────────────────────────────────────

  it("C01 — estado inicial: messages vazio, loading false, error null", () => {
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));
    expect(result.current.messages).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("C03 — send: adiciona mensagem do usuário imediatamente (otimista)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Ok" }));
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    act(() => { void result.current.send("Olá"); });

    expect(result.current.messages[0]).toEqual({ role: "user", text: "Olá" });
  });

  it("C04/C05 — send: loading true durante chamada, false após resposta", async () => {
    let resolveFetch!: (v: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolveFetch = r; }));

    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    act(() => { void result.current.send("Teste"); });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ reply: "Resposta" }), {
          headers: { "content-type": "application/json" },
        })
      );
    });
    expect(result.current.loading).toBe(false);
  });

  it("C06 — send: resposta do agente adicionada após sucesso", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Prazo é 5 dias" }));
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("Qual o prazo?"); });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toEqual({ role: "agent", text: "Prazo é 5 dias" });
  });

  it("C07 — send: POST para {apiBaseUrl}/support/chat", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Ok" }));
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("Teste"); });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/support/chat",
      expect.any(Object)
    );
  });

  it("C08 — send: trailing slash removido da URL base", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Ok" }));
    const { result } = renderHook(() =>
      useSupportChat({ ...DEFAULT_OPTS, apiBaseUrl: "https://api.example.com/" })
    );

    await act(async () => { await result.current.send("Teste"); });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/support/chat");
  });

  it("C09 — send: payload contém message, merchant_id e session_id corretos", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Ok" }));
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("Qual o prazo?"); });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      message: "Qual o prazo?",
      merchant_id: "mrc_001",
      session_id: "sess_abc",
    });
  });

  it("C10 — send: message trimada antes de enviar e exibir", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Ok" }));
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("  Olá  "); });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.message).toBe("Olá");
    expect(result.current.messages[0]!.text).toBe("Olá");
  });

  it("C11 — send: Content-Type é application/json", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Ok" }));
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("Teste"); });

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("C12 — send: credentials é 'include'", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Ok" }));
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("Teste"); });

    expect(fetchMock.mock.calls[0]![1]!.credentials).toBe("include");
  });

  it("C13 — send: session_id omitido quando sessionId é undefined", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Ok" }));
    const { result } = renderHook(() =>
      useSupportChat({ ...DEFAULT_OPTS, sessionId: undefined })
    );

    await act(async () => { await result.current.send("Teste"); });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.session_id).toBeUndefined();
  });

  // ── Fallbacks e erros ─────────────────────────────────────────────────────

  it("C14 — send: reply ausente na resposta usa FALLBACK", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("Teste"); });

    expect(result.current.messages[1]!.text).toBe(FALLBACK);
  });

  it("C15/C16/C17 — send: fetch lança → FALLBACK + error state + loading false", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network_error"));
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("Teste"); });

    expect(result.current.messages[1]!.text).toBe(FALLBACK);
    expect(result.current.error).toBe("Falha ao contatar o suporte.");
    expect(result.current.loading).toBe(false);
  });

  it("C18 — send: error limpo no envio seguinte bem-sucedido", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(jsonResponse({ reply: "Ok" }));

    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("Msg 1"); });
    expect(result.current.error).not.toBeNull();

    await act(async () => { await result.current.send("Msg 2"); });
    expect(result.current.error).toBeNull();
  });

  it("C19 — send: API retorna 4xx/5xx sem throw → reply undefined → FALLBACK", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    );
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("Teste"); });

    // fetch não rejeita em 5xx; reply ausente → FALLBACK
    expect(result.current.messages[1]!.text).toBe(FALLBACK);
  });

  // ── Guards ────────────────────────────────────────────────────────────────

  it("C20 — send: texto vazio ignorado, sem chamada API", async () => {
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send(""); });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  it("C21 — send: só whitespace ignorado", async () => {
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("   "); });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("C22 — send: segundo envio bloqueado enquanto loading=true", async () => {
    let resolveFetch!: (v: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolveFetch = r; }));

    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    act(() => { void result.current.send("Msg A"); });
    expect(result.current.loading).toBe(true);

    await act(async () => { await result.current.send("Msg B"); });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ reply: "Ok" }), {
          headers: { "content-type": "application/json" },
        })
      );
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────────────

  it("C23/C24 — reset: limpa messages e error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("fail"));
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("Teste"); });
    expect(result.current.messages.length).toBeGreaterThan(0);
    expect(result.current.error).not.toBeNull();

    act(() => { result.current.reset(); });

    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("C02 — reset: estado pós-reset igual ao inicial", () => {
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    act(() => { result.current.reset(); });

    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("H04 — reply string vazia exibida (não usa FALLBACK, pois ?? só pega null/undefined)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "" }));
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send("Teste"); });

    expect(result.current.messages[1]!.text).toBe("");
  });

  it("H02 — mensagem muito longa enviada corretamente", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Ok" }));
    const longMsg = "a".repeat(5000);
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send(longMsg); });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.message).toBe(longMsg);
  });

  it("H03 — caracteres especiais e emoji enviados corretamente", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reply: "Ok" }));
    const msg = "Olá! 🛒 Preço: R$99,90 & prazo < 5 dias";
    const { result } = renderHook(() => useSupportChat(DEFAULT_OPTS));

    await act(async () => { await result.current.send(msg); });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.message).toBe(msg);
  });
});
