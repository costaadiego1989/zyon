import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSupportChat } from "../hooks/use-support-chat.js";

function makeFetch(reply?: string, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(reply !== undefined ? { reply } : {})
  });
}

describe("useSupportChat smartFallback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows freight-specific reply when API fails and message mentions frete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const { result } = renderHook(() =>
      useSupportChat({ apiBaseUrl: "http://localhost", merchantId: "mrc_1" })
    );
    await act(async () => {
      await result.current.send("Qual o prazo do frete?");
    });
    const agentMsg = result.current.messages.find((m) => m.role === "agent");
    expect(agentMsg?.text).toMatch(/frete|prazo|rastreamento/i);
    expect(agentMsg?.text).not.toMatch(/suporte humano/i);
  });

  it("shows return-specific reply when message mentions devolução", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const { result } = renderHook(() =>
      useSupportChat({ apiBaseUrl: "http://localhost", merchantId: "mrc_1" })
    );
    await act(async () => {
      await result.current.send("Como faço uma devolução?");
    });
    const agentMsg = result.current.messages.find((m) => m.role === "agent");
    expect(agentMsg?.text).toMatch(/troca|devolu|7 dias/i);
  });

  it("shows payment reply when message mentions cartão", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const { result } = renderHook(() =>
      useSupportChat({ apiBaseUrl: "http://localhost", merchantId: "mrc_1" })
    );
    await act(async () => {
      await result.current.send("Meu cartão foi recusado");
    });
    const agentMsg = result.current.messages.find((m) => m.role === "agent");
    expect(agentMsg?.text).toMatch(/pagamento|extrato|banco/i);
  });

  it("uses API reply when available", async () => {
    vi.stubGlobal("fetch", makeFetch("Resposta personalizada da API."));
    const { result } = renderHook(() =>
      useSupportChat({ apiBaseUrl: "http://localhost", merchantId: "mrc_1" })
    );
    await act(async () => {
      await result.current.send("Quero saber sobre entrega");
    });
    const agentMsg = result.current.messages.find((m) => m.role === "agent");
    expect(agentMsg?.text).toBe("Resposta personalizada da API.");
  });

  it("adds user message to messages array", async () => {
    vi.stubGlobal("fetch", makeFetch("ok"));
    const { result } = renderHook(() =>
      useSupportChat({ apiBaseUrl: "http://localhost", merchantId: "mrc_1" })
    );
    await act(async () => {
      await result.current.send("Pergunta do usuário");
    });
    const userMsg = result.current.messages.find((m) => m.role === "user");
    expect(userMsg?.text).toBe("Pergunta do usuário");
  });

  it("does not send empty messages", async () => {
    const fetchMock = makeFetch("ok");
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      useSupportChat({ apiBaseUrl: "http://localhost", merchantId: "mrc_1" })
    );
    await act(async () => {
      await result.current.send("   ");
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });
});
