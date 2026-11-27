const TRIGGER_VARIANTS: Record<string, string[]> = {
  exit_intent_detected: [
    "Antes de ir, quer comparar as opções ou conferir as ofertas disponíveis?",
    "Posso ajudar a encontrar uma opção que combine com o que você precisa e quer gastar.",
    "Faltou alguma informação para decidir? Posso explicar os detalhes e conferir as condições da loja.",
  ],
  idle_30_seconds: [
    "Posso ajudar a escolher? Me diga o que você procura e a faixa de preço.",
    "Tá em dúvida entre alguns? Posso comparar os produtos e conferir quais condições estão disponíveis.",
    "Quer ajuda para encontrar uma opção que faça sentido para você? Podemos olhar os produtos e as ofertas disponíveis.",
  ],
  shipping_objection_detected: [
    "O frete pesou na decisão? Posso conferir as opções disponíveis para o seu CEP.",
    "Quer comparar as opções de entrega e verificar se alguma condição se aplica ao seu pedido?",
  ],
  coupon_field_clicked: [
    "Procurando um cupom? Posso conferir as condições disponíveis para o seu carrinho.",
    "Quer verificar se há alguma oferta aplicável antes de decidir?",
  ],
  payment_failed: [
    "O pagamento não passou, mas resolvemos rápido. Quer tentar por outro método?",
    "Sem problema com o pagamento — posso te oferecer outra forma pra fechar agora mesmo.",
  ],
};

export function getTriggerMessage(trigger: string): string | undefined {
  const variants = TRIGGER_VARIANTS[trigger];
  if (!variants || variants.length === 0) return undefined;
  return variants[Math.floor(Math.random() * variants.length)];
}

export const TRIGGER_MESSAGES: Record<string, string> = {
  exit_intent_detected: TRIGGER_VARIANTS.exit_intent_detected[0],
  idle_30_seconds: TRIGGER_VARIANTS.idle_30_seconds[0],
  shipping_objection_detected: TRIGGER_VARIANTS.shipping_objection_detected[0],
  coupon_field_clicked: TRIGGER_VARIANTS.coupon_field_clicked[0],
  payment_failed: TRIGGER_VARIANTS.payment_failed[0],
};
