import type { PaymentIntent } from "@/api/checkout-session";

export interface AssistanceSettings {
  pix: boolean;
  installments: boolean;
  unavailableProduct: boolean;
  humanHandoff: boolean;
}

export const DEFAULT_ASSISTANCE: AssistanceSettings = {
  pix: true, installments: true, unavailableProduct: true, humanHandoff: true,
};

export type HelpAction = "check_payment" | "show_pix" | "renew_pix" | "card_conditions" | "alternatives" | "review_cart" | "human";
export interface HelpChoice { action: HelpAction; label: string }

export function assistanceCommand(text: string): "pix" | "installments" | "human" | undefined {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(nao quero|nao preciso|dispenso)\b/.test(normalized)) return undefined;
  if (/\b(atendente|atendimento humano|falar com (uma? )?(pessoa|humano)|suporte humano)\b/.test(normalized)) return "human";
  if (/\b(parcelamento|parcelar|parcelas|quantas vezes|em quantas vezes)\b/.test(normalized)) return "installments";
  if (/\bpix\b/.test(normalized) && /\b(expir|venceu|vencido|pendente|paguei|confirm|codigo|copiar|qr)/.test(normalized)) return "pix";
  return undefined;
}

export function idleAssistanceMessage(input: { paymentIntent: PaymentIntent | null; shippingChosen: boolean; leadRegistered: boolean; hasAddress: boolean }): string {
  if (input.paymentIntent?.method === "pix") return "Precisa de ajuda com o Pix? Posso consultar a confirmação ou mostrar o código novamente.";
  if (input.paymentIntent) return "Ficou alguma dúvida sobre o pagamento? Posso ajudar a conferir esta etapa.";
  if (!input.hasAddress) return "Precisa de ajuda para preencher o endereço ou encontrar o CEP?";
  if (!input.shippingChosen) return "Ficou alguma dúvida sobre o frete ou o prazo de entrega?";
  if (!input.leadRegistered) return "Precisa de ajuda para completar seus dados e seguir para o pagamento?";
  return "Ficou alguma dúvida sobre a forma de pagamento ou as condições do cartão?";
}

export function isStockError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return ["cart_insufficient_stock", "variant_out_of_stock", "marketplace_insufficient_stock", "checkout_insufficient_stock",
    "cart_product_unavailable", "product_unavailable", "digital_content_unavailable", "insufficient_stock"].includes(code);
}
