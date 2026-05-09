import type {
  ChatAction,
  CheckoutEventName,
  CheckoutExperienceSnapshot,
  MerchantTheme
} from "@aacp/shared-types";

export type VisibleCartState = {
  items: CheckoutExperienceSnapshot["items"];
  totals: CheckoutExperienceSnapshot["totals"];
};

export interface QuickReplyChoice {
  label: string;
  event?: CheckoutEventName;
  type?: ChatAction["type"];
  offerId?: string;
}

export const STAGE_FLOW = [
  { key: "data_collection", label: "Cadastro", shortLabel: "Cadastro" },
  { key: "shipping", label: "Entrega", shortLabel: "Entrega" },
  { key: "payment", label: "Pagamento", shortLabel: "Pagamento" },
  { key: "completed", label: "Concluído", shortLabel: "Concluído" }
] as const;

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

export function themeStyle(theme: MerchantTheme, isForcedMode = false): React.CSSProperties {
  const accent = theme.accentColor || "#a855f7";

  const styles: Record<string, string> = {
    "--aacp-accent": accent,
    "--aacp-font": theme.fontFamily,
    "--aacp-grad-primary": `linear-gradient(135deg, ${accent} 0%, ${accent}cc 50%, ${accent}99 100%)`,
    "--aacp-grad-soft": `linear-gradient(135deg, ${accent}26, ${accent}1a)`,
    "--aacp-grad-bubble-buyer": `linear-gradient(135deg, ${accent}dd 0%, ${accent} 60%, ${accent}99 100%)`,
    "--aacp-grad-glow": `radial-gradient(60% 60% at 50% 0%, ${accent}59, transparent 70%)`,
    "--aacp-glow": `0 0 40px ${accent}59`,
  };

  if (!isForcedMode) {
    if (theme.textColor) styles["--aacp-fg"] = theme.textColor;
    if (theme.backgroundColor) styles["--aacp-bg"] = theme.backgroundColor;
  }

  return styles as unknown as React.CSSProperties;
}

export function buildVisibleCart(experience: CheckoutExperienceSnapshot): VisibleCartState {
  return {
    items: experience.items.map((item) => ({ ...item })),
    totals: { ...experience.totals }
  };
}

export function stageNarrative(stage: string, missingField?: string): string {
  if (stage === "completed") return "Pedido finalizado";
  if (stage === "payment") return "Aguardando pagamento";
  if (stage === "shipping") return "Calculando frete";
  if (missingField === "customer.fullName") return "Nome do cliente";
  if (missingField === "customer.email") return "E-mail de contato";
  if (missingField === "customer.phone") return "Telefone";
  if (missingField === "shipping.address.zipCode") return "CEP de entrega";
  return "Coleta de dados";
}

export function stageLabel(stage: string): string {
  const step = STAGE_FLOW.find((s) => s.key === stage);
  return step?.label ?? "Checkout";
}

export function countVisibleItems(items: Array<{ quantity: number }>): number {
  return items.reduce((acc, it) => acc + it.quantity, 0);
}

export function removeVisibleCartItem(current: VisibleCartState, sku: string): VisibleCartState {
  const nextItems = current.items.filter((it) => it.sku !== sku);
  const nextSubtotal = nextItems.reduce((acc, it) => acc + it.line_total, 0);
  return {
    items: nextItems,
    totals: {
      ...current.totals,
      subtotal: nextSubtotal,
      total: Math.max(0, nextSubtotal + current.totals.shipping - current.totals.discount)
    }
  };
}

export function bubbleKey(turn: { role: string; text: string; occurredAt: string }, index: number): string {
  return `${turn.role}-${index}-${turn.occurredAt}`;
}

export function agentGivenAndRest(fullName: string): { given: string; rest: string } {
  const parts = fullName.split(" ");
  return {
    given: parts[0] || "",
    rest: parts.slice(1).join(" ")
  };
}

export function agentTypingLine(agentName: string): string {
  const { given } = agentGivenAndRest(agentName);
  return `${given} está digitando...`;
}

export function quickReplyId(reply: QuickReplyChoice): string {
  return reply.label + (reply.event ?? "") + (reply.offerId ?? "");
}

export function filterSuggestedQuickReplies(
  replies: QuickReplyChoice[],
  stage: string
): QuickReplyChoice[] {
  if (stage === "data_collection") {
    return replies.filter(r => !/frete|pagamento|cartao|pix|cupom/i.test(r.label));
  }
  if (stage === "shipping") {
    return replies.filter(r => !/cadastro|identificar|cupom/i.test(r.label));
  }
  if (stage === "payment") {
    const filtered = replies.filter(r => /pagamento|finalizar|cartao|pix|cupom/i.test(r.label));
    // Add coupon option if not already present
    const hasCoupon = filtered.some(r => /cupom/i.test(r.label));
    if (!hasCoupon) {
      filtered.push({ label: "Não possuo cupom" });
    }
    return filtered;
  }
  return replies;
}
