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

export function themeStyle(theme: MerchantTheme): React.CSSProperties {
  return {
    "--aacp-accent": theme.accentColor,
    "--aacp-font": theme.fontFamily
  } as React.CSSProperties;
}

export function buildVisibleCart(experience: CheckoutExperienceSnapshot): VisibleCartState {
  return {
    items: experience.items.map((item) => ({ ...item })),
    totals: { ...experience.totals }
  };
}

export function removeVisibleCartItem(current: VisibleCartState, sku: string): VisibleCartState {
  const removed = current.items.find((item) => item.sku === sku);
  if (!removed) return current;
  const items = current.items.filter((item) => item.sku !== sku);
  const subtotal = Math.max(0, current.totals.subtotal - removed.line_total);
  const total = Math.max(0, subtotal + current.totals.shipping - current.totals.discount);
  return {
    items,
    totals: {
      ...current.totals,
      subtotal,
      total
    }
  };
}

export function countVisibleItems(items: CheckoutExperienceSnapshot["items"]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

export function stageLabel(stage: CheckoutExperienceSnapshot["stage"]): string {
  switch (stage) {
    case "data_collection":
      return "Cadastro";
    case "shipping":
      return "Entrega";
    case "payment":
      return "Pagamento";
    case "completed":
      return "Concluido";
    default:
      return "Cadastro";
  }
}

export function stageNarrative(stage: CheckoutExperienceSnapshot["stage"], nextField?: string): string {
  switch (stage) {
    case "data_collection":
      if (nextField === "nome") return "Para começar, vou confirmar seus dados pessoais e manter o pedido sincronizado.";
      if (nextField === "email") return "Vou validar seu e-mail para enviar código, nota e confirmação do pedido.";
      if (nextField === "CPF") return "Dados fiscais entram somente quando a loja precisa emitir a nota com segurança.";
      if (nextField === "telefone") return "O telefone ajuda no rastreio e na comunicação de entrega.";
      return "Vamos fechar seu cadastro antes de negociar preço, frete ou cupom.";
    case "shipping":
      if (nextField === "CEP") return "Agora eu valido o CEP e busco as opções reais de entrega.";
      if (nextField === "confirmar CEP") return "Confirme o endereço para eu cotar frete sem erro.";
      if (nextField?.includes("numero")) return "Falta o número/complemento para concluir a cotação.";
      return "Endereço em validação. Em seguida mostro frete e prazo disponíveis.";
    case "payment":
      return "Escolha PIX ou cartão. O link seguro é gerado somente depois da confirmação.";
    case "completed":
      return "Pedido confirmado. Detalhes, rastreio e resumo ficam disponíveis no fechamento.";
    default:
      return "Checkout assistido por IA em andamento.";
  }
}

export function filterSuggestedQuickReplies(
  replies: { label: string; event?: CheckoutEventName }[],
  stage?: CheckoutExperienceSnapshot["stage"]
): { label: string; event?: CheckoutEventName }[] {
  if (stage === "payment") return replies;
  const couponLike = /\b(cup[oô]m|promo|c[oó]digo(\s+(promocional|de\s+desconto))?|desconto\s+extra|%?\s*off)\b/i;
  return replies.filter(({ label }) => !couponLike.test(label));
}

export function quickReplyId(reply: QuickReplyChoice): string {
  return [reply.label, reply.type ?? "copy", reply.offerId ?? "", reply.event ?? ""].join("|");
}

export function agentGivenAndRest(agentFullName: string): { given: string; rest: string } {
  const trimmed = agentFullName.trim();
  if (!trimmed) return { given: "Assistente", rest: "" };
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const given = tokens[0] ?? trimmed;
  const rest = tokens.slice(1).join(" ").trim();
  return { given, rest };
}

export function agentTypingLine(agentFullName: string): string {
  const trimmed = agentFullName.trim();
  if (!trimmed) return "Assistente está digitando";
  return `${trimmed} está digitando`;
}

export function bubbleKey(turn: { role: string; occurredAt: string }, index?: number): string {
  return `${turn.role}-${turn.occurredAt}-${index ?? "x"}`;
}
