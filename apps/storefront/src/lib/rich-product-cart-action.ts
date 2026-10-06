import type { CommerceTurnResult } from "./viewmodels/useConversationViewModel/types";

export interface RichProductCartResult {
  requestId: string;
  variantId: string;
  serviceSlotId?: string;
  status: "succeeded" | "rejected" | "unknown";
  code?: string;
}

const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);

/** Hide trailing routing metadata in the conversation without changing the API payload. */
export function visibleCommerceMessage(text: string): string {
  return text.replace(/(?:\s+\[(?:(?:variantId|serviceSlotId|crossSellPromoId):[A-Za-z0-9_-]{1,191}|optionItemIds:[A-Za-z0-9_-]{1,191}(?:,[A-Za-z0-9_-]{1,191})*)\])+\s*$/, "");
}

/** Correlate the actual API turn, never a quantity change from another action. */
export async function submitRichProductCart(detail: unknown, send: (message: string) => Promise<CommerceTurnResult | null>,
  emit: (result: RichProductCartResult) => void, busy: boolean) {
  if (!detail || typeof detail !== "object") return;
  const input = detail as { variantId?: unknown; optionItemIds?: unknown; requestId?: unknown; selectedServiceSlotId?: unknown };
  if (!validId(input.variantId)) return;
  if (input.requestId !== undefined && !validId(input.requestId)) return;
  const base = { requestId: (input.requestId as string | undefined) ?? "", variantId: input.variantId,
    ...(typeof input.selectedServiceSlotId === "string" ? { serviceSlotId: input.selectedServiceSlotId } : {}) };
  if (input.selectedServiceSlotId !== undefined && !validId(input.selectedServiceSlotId)) {
    emit({ ...base, status: "rejected", code: "service_slot_unknown" }); return;
  }
  if (input.optionItemIds !== undefined && (!Array.isArray(input.optionItemIds)
    || input.optionItemIds.length > 250 || !input.optionItemIds.every(validId))) {
    emit({ ...base, status: "rejected", code: "cart_selection_binding_mismatch" }); return;
  }
  if (busy) { emit({ ...base, status: "rejected", code: "cart_busy" }); return; }
  const options = (input.optionItemIds as string[] | undefined) ?? [];
  const tag = options.length ? ` [optionItemIds:${options.join(",")}]` : "";
  const serviceTag = input.selectedServiceSlotId ? ` [serviceSlotId:${input.selectedServiceSlotId}]` : "";
  try {
    const turn = await send(`Adicionar produto ao carrinho [variantId:${input.variantId}]${tag}${serviceTag}`);
    const result = turn?.blocks.find(block => block.type === "cart_add_result" && block.data?.variantId === input.variantId
      && block.data?.serviceSlotId === input.selectedServiceSlotId)?.data;
    if (result && ["succeeded", "rejected", "unknown"].includes(result.status)) {
      emit({ ...base, status: result.status, ...(typeof result.code === "string" ? { code: result.code } : {}) });
    } else emit({ ...base, status: "unknown" });
  } catch { emit({ ...base, status: "unknown" }); }
}

export function cartAddFeedback(code?: string) {
  if (code === "service_slot_quantity_invalid") return "Este horário já está no carrinho. Escolha outro horário para adicionar mais um atendimento.";
  if (code?.startsWith("service_slot_") || code?.startsWith("service_schedule_")) return "Este horário não está disponível para sua escolha. Revise a data e o horário antes de tentar novamente.";
  if (code === "variant_out_of_stock" || code === "marketplace_insufficient_stock") return "A quantidade escolhida não está disponível em estoque. Escolha outra quantidade ou produto.";
  if (code === "stock_validation_unavailable") return "Não foi possível consultar o estoque agora. Tente novamente em alguns instantes.";
  if (code === "product_unavailable" || code === "digital_content_unavailable") return "Este produto está indisponível no momento. Escolha outro produto.";
  if (code === "cart_busy") return "Aguarde a ação em andamento antes de adicionar este produto.";
  if (code?.startsWith("food_option_") || code === "required_group_missing" || code === "single_group_multiple_selected") return "Revise as opções do produto e os limites de seleção antes de tentar novamente.";
  return "Não foi possível adicionar sua escolha. Revise as opções e tente novamente.";
}
