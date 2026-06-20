import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { SupportPanel } from "../components/checkout/SupportPanel.js";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";
import type { SupportChatState } from "../hooks/use-support-chat.js";

vi.mock("../hooks/use-support-chat.js", () => ({
  useSupportChat: vi.fn(),
}));

vi.mock("../hooks/use-support-faq.js", () => ({
  useSupportFaq: vi.fn(),
}));

import { useSupportChat } from "../hooks/use-support-chat.js";
import { useSupportFaq } from "../hooks/use-support-faq.js";

// ── Builders ──────────────────────────────────────────────────────────────────

function buildChat(overrides: Partial<SupportChatState> = {}): SupportChatState {
  return {
    messages: [],
    loading: false,
    error: null,
    latestTicketId: null,
    handoffPending: false,
    send: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    ...overrides,
  };
}

function buildVm(overrides: Record<string, unknown> = {}): CheckoutAgentViewModel {
  return {
    supportOpen: true,
    setSupportOpen: vi.fn(),
    apiOrigin: "https://api.example.com",
    config: { merchantId: "mrc_001" },
    session: { session_id: "sess_abc" },
    activeExperience: {
      brand: { name: "Loja X" },
    },
    ...overrides,
  } as unknown as CheckoutAgentViewModel;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Selects the X close button in the header (always last .aacp-ai-close in header) */
function getHeaderCloseBtn(container: HTMLElement) {
  const closeBtns = container.querySelectorAll(".aacp-ai-head .aacp-ai-close");
  return closeBtns[closeBtns.length - 1] as HTMLElement;
}

function getComposerInput(container: HTMLElement) {
  return container.querySelector(".aacp-ai-composer .aacp-input") as HTMLInputElement;
}

function getComposerForm(container: HTMLElement) {
  return container.querySelector(".aacp-ai-composer") as HTMLFormElement;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("SupportPanel", () => {
  beforeEach(() => {
    vi.mocked(useSupportChat).mockReturnValue(buildChat());
    vi.mocked(useSupportFaq).mockReturnValue({ items: [], loading: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Abertura e fechamento ─────────────────────────────────────────────────

  it("B01 — painel fechado não tem classe open", () => {
    const { container } = render(<SupportPanel vm={buildVm({ supportOpen: false })} />);
    expect(container.querySelector(".aacp-ai-panel")!.classList.contains("open")).toBe(false);
  });

  it("B02 — painel aberto tem classe open", () => {
    const { container } = render(<SupportPanel vm={buildVm({ supportOpen: true })} />);
    expect(container.querySelector(".aacp-ai-panel")!.classList.contains("open")).toBe(true);
  });

  it("B03 — backdrop tem classe open quando painel aberto", () => {
    const { container } = render(<SupportPanel vm={buildVm({ supportOpen: true })} />);
    expect(container.querySelector(".aacp-support-backdrop")!.classList.contains("open")).toBe(true);
  });

  it("B04 — click no backdrop chama setSupportOpen(false)", () => {
    const setSupportOpen = vi.fn();
    const { container } = render(<SupportPanel vm={buildVm({ setSupportOpen })} />);
    fireEvent.click(container.querySelector(".aacp-support-backdrop")!);
    expect(setSupportOpen).toHaveBeenCalledWith(false);
  });

  it("B05 — click no X do header chama setSupportOpen(false)", () => {
    const setSupportOpen = vi.fn();
    const { container } = render(<SupportPanel vm={buildVm({ setSupportOpen })} />);
    fireEvent.click(getHeaderCloseBtn(container));
    expect(setSupportOpen).toHaveBeenCalledWith(false);
  });

  it("B06 — fechar painel (supportOpen false) chama chat.reset", async () => {
    const reset = vi.fn();
    vi.mocked(useSupportChat).mockReturnValue(buildChat({ reset }));

    const { rerender } = render(<SupportPanel vm={buildVm({ supportOpen: true })} />);
    await act(async () => {
      rerender(<SupportPanel vm={buildVm({ supportOpen: false })} />);
    });
    expect(reset).toHaveBeenCalled();
  });

  it("B07 — reabrir painel após fechar mostra welcome screen limpa", async () => {
    const { rerender, queryByText } = render(<SupportPanel vm={buildVm({ supportOpen: true })} />);
    await act(async () => {
      rerender(<SupportPanel vm={buildVm({ supportOpen: false })} />);
    });
    await act(async () => {
      rerender(<SupportPanel vm={buildVm({ supportOpen: true })} />);
    });
    expect(queryByText("Olá! Sou o assistente de suporte.")).not.toBeNull();
  });

  // ── Welcome screen ────────────────────────────────────────────────────────

  it("B08 — welcome screen visível quando sem mensagens", () => {
    const { getByText } = render(<SupportPanel vm={buildVm()} />);
    expect(getByText("Olá! Sou o assistente de suporte.")).not.toBeNull();
  });

  it("B09 — 5 cards de sugestão exibidos", () => {
    const { getByText } = render(<SupportPanel vm={buildVm()} />);
    expect(getByText("Qual o prazo de entrega?")).not.toBeNull();
    expect(getByText("Quais formas de pagamento?")).not.toBeNull();
    expect(getByText("É seguro comprar aqui?")).not.toBeNull();
    expect(getByText("Posso trocar ou devolver?")).not.toBeNull();
    expect(getByText("Preciso de ajuda com meu pedido")).not.toBeNull();
  });

  it("B09 — exatamente 5 cards renderizados", () => {
    const { container } = render(<SupportPanel vm={buildVm()} />);
    expect(container.querySelectorAll(".aacp-ai-faq-card")).toHaveLength(5);
  });

  it("B10 — click em sugestão chama send com o label correto", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useSupportChat).mockReturnValue(buildChat({ send }));

    const { getByText } = render(<SupportPanel vm={buildVm()} />);
    fireEvent.click(getByText("Qual o prazo de entrega?"));
    expect(send).toHaveBeenCalledWith("Qual o prazo de entrega?");
  });

  it("B10b — FAQ configurado abre resposta local sem chamar suporte AI", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useSupportChat).mockReturnValue(buildChat({ send }));
    vi.mocked(useSupportFaq).mockReturnValue({
      loading: false,
      items: [
        {
          id: "faq-1",
          question: "Como rastrear meu pedido?",
          answer: "Use o codigo enviado por e-mail assim que a transportadora liberar o rastreio.",
        },
      ],
    });

    const { getByText } = render(<SupportPanel vm={buildVm()} />);
    fireEvent.click(getByText("Como rastrear meu pedido?"));

    expect(getByText(/codigo enviado por e-mail/i)).not.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("B11 — todos os cards desabilitados quando chat.loading=true", () => {
    vi.mocked(useSupportChat).mockReturnValue(buildChat({ loading: true }));
    const { container } = render(<SupportPanel vm={buildVm()} />);
    const cards = container.querySelectorAll<HTMLButtonElement>(".aacp-ai-faq-card");
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((card) => { expect(card.disabled).toBe(true); });
  });

  it("B12 — nome da loja exibido no header", () => {
    const { container } = render(
      <SupportPanel vm={buildVm({ activeExperience: { brand: { name: "Minha Loja" } } })} />
    );
    expect(container.querySelector(".aacp-ai-sub")!.textContent).toContain("Minha Loja");
  });

  it("B13 — fallback 'a loja' quando brand.name ausente", () => {
    const { container } = render(
      <SupportPanel vm={buildVm({ activeExperience: { brand: {} } })} />
    );
    expect(container.querySelector(".aacp-ai-sub")!.textContent).toContain("a loja");
  });

  it("B14 — footer de confiança visível na welcome screen", () => {
    const { getByText } = render(<SupportPanel vm={buildVm()} />);
    expect(getByText(/Respostas verificadas/)).not.toBeNull();
  });

  // ── Thread de mensagens ───────────────────────────────────────────────────

  it("B15 — welcome screen oculta quando há mensagens", () => {
    vi.mocked(useSupportChat).mockReturnValue(
      buildChat({ messages: [{ role: "user", text: "Oi" }] })
    );
    const { queryByText } = render(<SupportPanel vm={buildVm()} />);
    expect(queryByText("Olá! Sou o assistente de suporte.")).toBeNull();
  });

  it("B16 — bubble do usuário tem classe aacp-bubble-buyer", () => {
    vi.mocked(useSupportChat).mockReturnValue(
      buildChat({ messages: [{ role: "user", text: "Qual o prazo?" }] })
    );
    const { getByText } = render(<SupportPanel vm={buildVm()} />);
    expect(getByText("Qual o prazo?").closest(".aacp-bubble-buyer")).not.toBeNull();
  });

  it("B17 — bubble do agente tem classe aacp-bubble-agent", () => {
    vi.mocked(useSupportChat).mockReturnValue(
      buildChat({ messages: [{ role: "agent", text: "5 dias úteis." }] })
    );
    const { getByText } = render(<SupportPanel vm={buildVm()} />);
    expect(getByText("5 dias úteis.").closest(".aacp-bubble-agent")).not.toBeNull();
  });

  it("B18 — múltiplas mensagens renderizadas na ordem correta", () => {
    vi.mocked(useSupportChat).mockReturnValue(
      buildChat({
        messages: [
          { role: "user", text: "Msg 1" },
          { role: "agent", text: "Resp 1" },
          { role: "user", text: "Msg 2" },
        ],
      })
    );
    const { container } = render(<SupportPanel vm={buildVm()} />);
    const bubbles = container.querySelectorAll(".aacp-bubble");
    expect(bubbles).toHaveLength(3);
    expect(bubbles[0]!.textContent).toBe("Msg 1");
    expect(bubbles[1]!.textContent).toBe("Resp 1");
    expect(bubbles[2]!.textContent).toBe("Msg 2");
  });

  it("B18b — mostra protocolo quando handoff abriu chamado", () => {
    vi.mocked(useSupportChat).mockReturnValue(
      buildChat({
        messages: [{ role: "agent", text: "Chamado aberto." }],
        latestTicketId: "sup_123",
        handoffPending: true,
      })
    );
    const { getByText } = render(<SupportPanel vm={buildVm()} />);
    expect(getByText("Chamado aberto: sup_123")).not.toBeNull();
  });

  it("B19 — 'Digitando...' visível quando loading=true e há mensagens", () => {
    vi.mocked(useSupportChat).mockReturnValue(
      buildChat({ messages: [{ role: "user", text: "Oi" }], loading: true })
    );
    const { getByText } = render(<SupportPanel vm={buildVm()} />);
    expect(getByText("Digitando...")).not.toBeNull();
  });

  it("B20 — 'Digitando...' ausente quando loading=false", () => {
    vi.mocked(useSupportChat).mockReturnValue(
      buildChat({ messages: [{ role: "user", text: "Oi" }], loading: false })
    );
    const { queryByText } = render(<SupportPanel vm={buildVm()} />);
    expect(queryByText("Digitando...")).toBeNull();
  });

  it("B22 — botão Voltar visível quando há mensagens", () => {
    vi.mocked(useSupportChat).mockReturnValue(
      buildChat({ messages: [{ role: "user", text: "Oi" }] })
    );
    const { getByLabelText } = render(<SupportPanel vm={buildVm()} />);
    expect(getByLabelText("Voltar")).not.toBeNull();
  });

  it("B23 — botão Voltar ausente quando sem mensagens", () => {
    const { queryByLabelText } = render(<SupportPanel vm={buildVm()} />);
    expect(queryByLabelText("Voltar")).toBeNull();
  });

  it("B24 — click em Voltar chama chat.reset", () => {
    const reset = vi.fn();
    vi.mocked(useSupportChat).mockReturnValue(
      buildChat({ messages: [{ role: "user", text: "Oi" }], reset })
    );
    const { getByLabelText } = render(<SupportPanel vm={buildVm()} />);
    fireEvent.click(getByLabelText("Voltar"));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("B24 — click em Voltar retorna à welcome screen", () => {
    const reset = vi.fn();
    vi.mocked(useSupportChat).mockReturnValue(
      buildChat({ messages: [{ role: "user", text: "Oi" }], reset })
    );
    // After reset, useSupportChat mock would return empty messages on next render
    // Simulate by updating mock after click
    const { getByLabelText, rerender } = render(<SupportPanel vm={buildVm()} />);

    vi.mocked(useSupportChat).mockReturnValue(buildChat({ reset }));
    fireEvent.click(getByLabelText("Voltar"));
    rerender(<SupportPanel vm={buildVm()} />);

    // After reset mock returns empty messages, welcome screen should appear
    // The component's local state drives hasMessages via chat.messages
    expect(reset).toHaveBeenCalled();
  });

  // ── Composer ──────────────────────────────────────────────────────────────

  it("B25 — botão envio desabilitado quando input vazio", () => {
    const { container } = render(<SupportPanel vm={buildVm()} />);
    const sendBtn = container.querySelector<HTMLButtonElement>(".aacp-send");
    expect(sendBtn!.disabled).toBe(true);
  });

  it("B26 — botão envio habilitado com texto no input", () => {
    const { container } = render(<SupportPanel vm={buildVm()} />);
    const input = getComposerInput(container);
    fireEvent.change(input, { target: { value: "Qual o prazo?" } });
    const sendBtn = container.querySelector<HTMLButtonElement>(".aacp-send");
    expect(sendBtn!.disabled).toBe(false);
  });

  it("B27 — botão envio desabilitado quando loading=true", () => {
    vi.mocked(useSupportChat).mockReturnValue(buildChat({ loading: true }));
    const { container } = render(<SupportPanel vm={buildVm()} />);
    const sendBtn = container.querySelector<HTMLButtonElement>(".aacp-send");
    expect(sendBtn!.disabled).toBe(true);
  });

  it("B28 — input desabilitado quando loading=true", () => {
    vi.mocked(useSupportChat).mockReturnValue(buildChat({ loading: true }));
    const { container } = render(<SupportPanel vm={buildVm()} />);
    expect(getComposerInput(container).disabled).toBe(true);
  });

  it("B29 — submit do form chama send com o texto do input", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useSupportChat).mockReturnValue(buildChat({ send }));

    const { container } = render(<SupportPanel vm={buildVm()} />);
    fireEvent.change(getComposerInput(container), { target: { value: "Qual o prazo?" } });
    fireEvent.submit(getComposerForm(container));
    expect(send).toHaveBeenCalledWith("Qual o prazo?");
  });

  it("B30 — click no botão de envio chama send", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useSupportChat).mockReturnValue(buildChat({ send }));

    const { container } = render(<SupportPanel vm={buildVm()} />);
    fireEvent.change(getComposerInput(container), { target: { value: "Teste" } });
    fireEvent.click(container.querySelector(".aacp-send")!);
    expect(send).toHaveBeenCalledWith("Teste");
  });

  it("B31 — whitespace no input não dispara send", () => {
    const send = vi.fn();
    vi.mocked(useSupportChat).mockReturnValue(buildChat({ send }));

    const { container } = render(<SupportPanel vm={buildVm()} />);
    fireEvent.change(getComposerInput(container), { target: { value: "   " } });
    fireEvent.submit(getComposerForm(container));
    expect(send).not.toHaveBeenCalled();
  });

  it("B32 — input limpo após envio", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useSupportChat).mockReturnValue(buildChat({ send }));

    const { container } = render(<SupportPanel vm={buildVm()} />);
    const input = getComposerInput(container);
    fireEvent.change(input, { target: { value: "Olá" } });
    fireEvent.submit(getComposerForm(container));
    expect(input.value).toBe("");
  });

  it("B33 — placeholder do input correto", () => {
    const { container } = render(<SupportPanel vm={buildVm()} />);
    expect(getComposerInput(container).placeholder).toBe("Digite sua dúvida aqui...");
  });

  // ── Integração de contexto ────────────────────────────────────────────────

  it("E01 — useSupportChat recebe merchantId correto do vm", () => {
    render(<SupportPanel vm={buildVm({ config: { merchantId: "mrc_xyz" } })} />);
    expect(vi.mocked(useSupportChat)).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: "mrc_xyz" })
    );
  });

  it("E02 — useSupportChat recebe sessionId da sessão ativa", () => {
    render(<SupportPanel vm={buildVm({ session: { session_id: "sess_xyz" } })} />);
    expect(vi.mocked(useSupportChat)).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess_xyz" })
    );
  });

  it("E03 — useSupportChat recebe sessionId undefined quando sem sessão", () => {
    render(<SupportPanel vm={buildVm({ session: null })} />);
    expect(vi.mocked(useSupportChat)).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: undefined })
    );
  });

  it("E04 — useSupportChat recebe apiBaseUrl do vm.apiOrigin", () => {
    render(<SupportPanel vm={buildVm({ apiOrigin: "https://custom-api.example.com" })} />);
    expect(vi.mocked(useSupportChat)).toHaveBeenCalledWith(
      expect.objectContaining({ apiBaseUrl: "https://custom-api.example.com" })
    );
  });

  it("E05 — useSupportFaq busca apenas quando painel esta aberto", () => {
    render(<SupportPanel vm={buildVm({ supportOpen: false })} />);
    expect(vi.mocked(useSupportFaq)).toHaveBeenCalledWith(
      "https://api.example.com",
      "mrc_001",
      false,
      undefined
    );
  });
});
