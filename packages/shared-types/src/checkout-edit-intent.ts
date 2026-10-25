export type CheckoutEditSection = "payment" | "shipping" | "address" | "coupon";

/** A request to review a choice is never authorization to create a payment. */
export function checkoutEditIntent(message: string): CheckoutEditSection | undefined {
  const text = message.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  const change = /\b(alterar|altere|trocar|troque|mudar|mude|corrigir|corrija|outro|outra|rever|editar)\b/.test(text);
  if (/\b(cupom|coupon)\b/.test(text)) return "coupon";
  if (/\b(enviar|entregar|receber|usar)\b.*\b(trabalho|escritorio|casa|outro local|outro endereco)\b/.test(text)) return "address";
  if (change && /\b(endereco|cep|rua|numero|complemento|entrega em)\b/.test(text)) return "address";
  if (change && /\b(frete|entrega|transportadora|sedex|pac)\b/.test(text)) return "shipping";
  if (change && /\b(pagamento|pagar|pix|cartao|credito|debito|boleto)\b/.test(text)) return "payment";
  if (/\b(quero|prefiro|pagar|pago)\b.*\b(pix|cartao|credito|debito|boleto)\b/.test(text)) return "payment";
  if (/^(pix|cartao(?: de (?:credito|debito))?|credito|debito|boleto)[.!]?$/.test(text)) return "payment";
  if (/\b(frete|entrega)\b.*\b(mais barato|mais rapido|economico|expresso)\b/.test(text)) return "shipping";
  return undefined;
}
