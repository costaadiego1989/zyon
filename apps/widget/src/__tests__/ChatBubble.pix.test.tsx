import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { ChatBubble } from "../components/checkout/ChatThread.js";

const PIX_CODE =
  "00020126580014br.gov.bcb.pix0136a1b2c3d4e5f67890abcdef123456789052040000530398";

function agentTurn(text: string) {
  return { role: "agent" as const, text, occurredAt: new Date().toISOString() };
}

function buyerTurn(text: string) {
  return { role: "buyer" as const, text, occurredAt: new Date().toISOString() };
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true
  });
});

describe("ChatBubble — PIX rendering", () => {
  it("shows PixCopyButton when agent turn contains PIX code", () => {
    const { getByText } = render(
      <ChatBubble
        turn={agentTurn(`Copia e cola PIX: ${PIX_CODE}.`)}
        agentName="Aurora"
        bubbleKey="k0"
        streamingKey={null}
      />
    );
    expect(getByText("Copiar código PIX")).not.toBeNull();
  });

  it("renders QR code SVG alongside PIX button", () => {
    const { container } = render(
      <ChatBubble
        turn={agentTurn(`Copia e cola PIX: ${PIX_CODE}.`)}
        agentName="Aurora"
        bubbleKey="k0"
        streamingKey={null}
      />
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("does NOT show PixCopyButton when agent turn has no PIX code", () => {
    const { queryByText } = render(
      <ChatBubble
        turn={agentTurn("Olá! Como posso ajudar?")}
        agentName="Aurora"
        bubbleKey="k0"
        streamingKey={null}
      />
    );
    expect(queryByText("Copiar código PIX")).toBeNull();
  });

  it("does NOT show PixCopyButton on buyer turn even with PIX-like text", () => {
    const { queryByText } = render(
      <ChatBubble
        turn={buyerTurn(`PIX: ${PIX_CODE}`)}
        agentName="Aurora"
        bubbleKey="k0"
        streamingKey={null}
      />
    );
    expect(queryByText("Copiar código PIX")).toBeNull();
  });

  it("copy button writes PIX code to clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true
    });

    // Space after PIX code prevents trailing-dot from being captured by regex
    const { getByText } = render(
      <ChatBubble
        turn={agentTurn(`Copia e cola PIX: ${PIX_CODE} `)}
        agentName="Aurora"
        bubbleKey="k0"
        streamingKey={null}
      />
    );

    fireEvent.click(getByText("Copiar código PIX"));
    expect(writeText).toHaveBeenCalledWith(PIX_CODE);
  });

  it("shows 'Copiado!' feedback after copy button click", async () => {
    const { getByText } = render(
      <ChatBubble
        turn={agentTurn(`Copia e cola PIX: ${PIX_CODE} `)}
        agentName="Aurora"
        bubbleKey="k0"
        streamingKey={null}
      />
    );

    fireEvent.click(getByText("Copiar código PIX"));
    await waitFor(() => {
      expect(getByText("Copiado!")).not.toBeNull();
    });
  });
});
