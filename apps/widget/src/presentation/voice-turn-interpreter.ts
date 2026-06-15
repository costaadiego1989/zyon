import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";
import type { PendingVoiceTurnDraft } from "../hooks/use-voice-checkout.js";
import { formatCurrency } from "../hooks/checkout-presentation.js";

export function normalizeVoiceText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export type VoiceTurnContext = {
  checkoutStage: string;
  missingField?: string;
  orderTotalLabel: string;
};

export function describePendingVoiceTurn(
  context: VoiceTurnContext,
  transcript: string,
): PendingVoiceTurnDraft {
  const normalized = normalizeVoiceText(transcript);
  const missingField = normalizeVoiceText(context.missingField ?? "");

  if (context.checkoutStage === "data_collection") {
    if (
      missingField.includes("cpf") ||
      /\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[.\s-]?\d{2}\b/.test(transcript)
    ) {
      return {
        interpretedAction:
          "Enviar este CPF para emissão fiscal. Você revisa o pedido antes de pagar.",
        riskLevel: "high",
        field: "cpf",
      };
    }

    if (
      missingField.includes("email") ||
      /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(transcript)
    ) {
      return {
        interpretedAction:
          "Usar este e-mail para recibo, acesso ao pedido e acompanhamento.",
        riskLevel: "medium",
        field: "email",
      };
    }

    return {
      interpretedAction: "Enviar esta informação de cadastro para continuar a compra.",
      riskLevel: "medium",
      field: "generic",
    };
  }

  if (context.checkoutStage === "shipping") {
    return {
      interpretedAction:
        "Enviar sua escolha ou dúvida de entrega. Frete e prazo continuam visíveis antes do pagamento.",
      riskLevel: "medium",
      field: "shipping",
    };
  }

  if (context.checkoutStage === "payment") {
    if (normalized.includes("pix")) {
      return {
        interpretedAction: `Solicitar pagamento via PIX para ${context.orderTotalLabel}.`,
        riskLevel: "high",
        field: "payment",
      };
    }

    if (
      normalized.includes("cartao") ||
      normalized.includes("credito") ||
      normalized.includes("debito")
    ) {
      return {
        interpretedAction: `Abrir pagamento por cartão para ${context.orderTotalLabel}.`,
        riskLevel: "high",
        field: "payment",
      };
    }

    if (normalized.includes("cupom")) {
      return {
        interpretedAction: "Enviar sua resposta sobre cupom antes de escolher o pagamento.",
        riskLevel: "medium",
        field: "coupon",
      };
    }

    return {
      interpretedAction:
        "Enviar esta instrução de pagamento ao agente. Nenhuma cobrança acontece sem confirmação final.",
      riskLevel: "high",
      field: "payment",
    };
  }

  return {
    interpretedAction: "Enviar esta resposta ao agente para continuar a jornada.",
    riskLevel: "low",
    field: "generic",
  };
}

export function latestTurnText(
  turns: CheckoutAgentViewModel["turns"],
  role: "agent" | "buyer",
): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role === role && turn.text.trim()) {
      return turn.text.trim();
    }
  }
  return null;
}

export function buildVoiceTurnContext(vm: CheckoutAgentViewModel): VoiceTurnContext {
  return {
    checkoutStage: vm.checkoutStage,
    missingField: vm.lastChat?.missing_fields?.[0],
    orderTotalLabel: formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency),
  };
}

export function resolveVoiceState(input: {
  speaking: boolean;
  listening: boolean;
  hasPendingTurn: boolean;
  busy: boolean;
}): "speaking" | "listening" | "confirming" | "thinking" | "idle" {
  if (input.speaking) return "speaking";
  if (input.listening) return "listening";
  if (input.hasPendingTurn) return "confirming";
  if (input.busy) return "thinking";
  return "idle";
}
