import { describe, expect, it } from "vitest";
import {
  buildVoiceTurnContext,
  describePendingVoiceTurn,
  latestTurnText,
  normalizeVoiceText,
  resolveVoiceState,
} from "../presentation/voice-turn-interpreter.js";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";

function buildVm(overrides: Partial<CheckoutAgentViewModel> = {}): CheckoutAgentViewModel {
  return {
    checkoutStage: "payment",
    turns: [],
    visibleTotals: { total: 299.9, currency: "BRL", subtotal: 299.9, shipping: 0, discount: 0 },
    lastChat: { missing_fields: [] },
    ...overrides,
  } as CheckoutAgentViewModel;
}

describe("voice-turn-interpreter", () => {
  it("normalizes accents for matching", () => {
    expect(normalizeVoiceText("Pagamento")).toBe("pagamento");
  });

  it("describes PIX payment as high risk", () => {
    const draft = describePendingVoiceTurn(
      { checkoutStage: "payment", orderTotalLabel: "R$ 299,90" },
      "quero pagar no pix",
    );

    expect(draft).toMatchObject({
      riskLevel: "high",
      field: "payment",
      interpretedAction: expect.stringContaining("PIX"),
    });
  });

  it("detects CPF in data collection", () => {
    const draft = describePendingVoiceTurn(
      { checkoutStage: "data_collection", missingField: "cpf", orderTotalLabel: "R$ 0,00" },
      "123.456.789-01",
    );

    expect(draft.field).toBe("cpf");
    expect(draft.riskLevel).toBe("high");
  });

  it("returns latest turn text by role", () => {
    const text = latestTurnText(
      [
        { role: "agent", text: "Olá" },
        { role: "buyer", text: "Oi" },
        { role: "agent", text: "Qual seu e-mail?" },
      ] as CheckoutAgentViewModel["turns"],
      "agent",
    );

    expect(text).toBe("Qual seu e-mail?");
  });

  it("resolves voice state priority", () => {
    expect(
      resolveVoiceState({ speaking: true, listening: true, hasPendingTurn: true, busy: true }),
    ).toBe("speaking");
    expect(
      resolveVoiceState({ speaking: false, listening: false, hasPendingTurn: true, busy: true }),
    ).toBe("confirming");
  });

  it("builds voice turn context from vm", () => {
    const context = buildVoiceTurnContext(
      buildVm({
        checkoutStage: "shipping",
        lastChat: { missing_fields: ["frete"] } as CheckoutAgentViewModel["lastChat"],
      }),
    );

    expect(context.missingField).toBe("frete");
    expect(context.orderTotalLabel).toContain("299");
  });
});
