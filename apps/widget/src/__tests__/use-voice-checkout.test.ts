import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maskVoiceTranscriptForDisplay, useVoiceCheckout } from "../hooks/use-voice-checkout.js";

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];

  lang = "";
  interimResults = false;
  maxAlternatives = 0;
  continuous = false;
  onstart: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((event: { results: Array<Array<{ transcript?: string }>> }) => void) | null = null;

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }

  start(): void {
    this.onstart?.();
  }

  stop(): void {
    this.onend?.();
  }

  abort(): void {
    this.onend?.();
  }

  emitTranscript(transcript: string): void {
    this.onresult?.({ results: [[{ transcript }]] });
    this.onend?.();
  }
}

function renderVoiceHook(
  overrides: Partial<Parameters<typeof useVoiceCheckout>[0]> = {},
) {
  const onConfirmTranscript = vi.fn();
  const hook = renderHook(() =>
    useVoiceCheckout({
      enabled: true,
      busy: false,
      composerLocked: false,
      awaitingAgentPlayback: false,
      latestAgentText: null,
      onConfirmTranscript,
      ...overrides,
    }),
  );

  return { ...hook, onConfirmTranscript };
}

describe("useVoiceCheckout", () => {
  beforeEach(() => {
    MockSpeechRecognition.instances = [];
    vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);
    vi.stubGlobal("speechSynthesis", {
      cancel: vi.fn(),
      speak: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps recognized speech pending until the buyer confirms", () => {
    const { result, onConfirmTranscript } = renderVoiceHook();

    act(() => {
      result.current.handleMicPress();
    });
    act(() => {
      MockSpeechRecognition.instances[0]!.emitTranscript("meu cpf 12345678901");
    });

    expect(onConfirmTranscript).not.toHaveBeenCalled();
    expect(result.current.pendingTurn?.rawTranscript).toBe("meu cpf 12345678901");
    expect(result.current.pendingTurn?.displayTranscript).toContain("123.***.***-01");
    expect(result.current.hint).toBe("Confira o que entendi antes de enviar.");
  });

  it("sends the raw transcript only after explicit confirmation", async () => {
    const { result, onConfirmTranscript } = renderVoiceHook();

    act(() => {
      result.current.handleMicPress();
    });
    act(() => {
      MockSpeechRecognition.instances[0]!.emitTranscript("quero pagar no pix");
    });

    await act(async () => {
      await result.current.confirmPendingTurn();
    });

    expect(onConfirmTranscript).toHaveBeenCalledTimes(1);
    expect(onConfirmTranscript).toHaveBeenCalledWith("quero pagar no pix");
    expect(result.current.pendingTurn).toBeNull();
  });

  it("uses the caller interpretation for the confirmation panel", () => {
    const { result } = renderVoiceHook({
      buildPendingTurn: () => ({
        interpretedAction: "Solicitar pagamento via PIX para R$ 299,90.",
        riskLevel: "high",
        field: "payment",
      }),
    });

    act(() => {
      result.current.handleMicPress();
    });
    act(() => {
      MockSpeechRecognition.instances[0]!.emitTranscript("pix");
    });

    expect(result.current.pendingTurn).toMatchObject({
      interpretedAction: "Solicitar pagamento via PIX para R$ 299,90.",
      riskLevel: "high",
      field: "payment",
      requiresTapConfirmation: true,
    });
  });

  it("can discard or retry a noisy transcript without sending it", () => {
    const { result, onConfirmTranscript } = renderVoiceHook();

    act(() => {
      result.current.handleMicPress();
    });
    act(() => {
      MockSpeechRecognition.instances[0]!.emitTranscript("ruido estranho");
    });
    act(() => {
      result.current.discardPendingTurn();
    });

    expect(result.current.pendingTurn).toBeNull();
    expect(onConfirmTranscript).not.toHaveBeenCalled();

    act(() => {
      result.current.handleMicPress();
    });
    act(() => {
      MockSpeechRecognition.instances[1]!.emitTranscript("ruido de novo");
    });
    act(() => {
      result.current.retryPendingTurn();
    });

    expect(result.current.pendingTurn).toBeNull();
    expect(MockSpeechRecognition.instances).toHaveLength(3);
    expect(onConfirmTranscript).not.toHaveBeenCalled();
  });

  it("masks email and long payment-like numbers in the visible transcript", () => {
    const masked = maskVoiceTranscriptForDisplay(
      "meu email comprador@example.com e cartao 4111 1111 1111 1111",
    );

    expect(masked).toContain("co***@example.com");
    expect(masked).toContain("[numero protegido]");
    expect(masked).not.toContain("4111 1111 1111 1111");
  });
});
