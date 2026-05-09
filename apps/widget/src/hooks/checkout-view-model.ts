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
  { key: "completed", label: "Concluido", shortLabel: "Concluido" }
] as const;

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

export function themeStyle(theme: MerchantTheme, isForcedMode = false): React.CSSProperties {
  const styles: React.CSSProperties = {
    "--aacp-accent": theme.accentColor,
    "--aacp-font": theme.fontFamily
  } as any;

  if (!isForcedMode) {
    if (theme.textColor) (styles as any)["--aacp-fg"] = theme.textColor;
    if (theme.backgroundColor) (styles as any)["--aacp-bg"] = theme.backgroundColor;
  }

  return styles;
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
  // Simple heuristic for now
  return replies;
}
