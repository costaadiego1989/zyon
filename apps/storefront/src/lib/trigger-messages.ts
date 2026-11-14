const TRIGGER_VARIANTS: Record<string, string[]> = {
  exit_intent_detected: [
    "Ei, antes de ir — separei uma condição especial pra você fechar hoje. Quer ver?",
    "Espera! Consigo um desconto pra deixar seu pedido ainda melhor agora. Posso mostrar?",
    "Vi que você ia sair. Deixa eu garantir o melhor preço antes de você fechar? 😉",
  ],
  idle_30_seconds: [
    "Posso te ajudar a escolher? Acho o produto ideal e ainda garanto o melhor preço pra você.",
    "Tá em dúvida entre alguns? Me diz o que procura que eu encontro e já aplico um desconto.",
    "Enquanto você olha, posso adiantar: tenho ofertas boas pro que você está buscando. Quer ver?",
  ],
  shipping_objection_detected: [
    "O frete te preocupou? Deixa eu ver a melhor opção de entrega pra você agora.",
    "Posso buscar um frete mais em conta — ou até condição especial. Quer que eu verifique?",
  ],
  coupon_field_clicked: [
    "Procurando cupom? Já tenho um desconto especial pronto pra você. Quer aplicar?",
    "Deixa que eu cuido do desconto — aplico a melhor condição no seu pedido agora.",
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
