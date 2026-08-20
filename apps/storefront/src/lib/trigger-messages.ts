/**
 * Default proactive nudge messages per trigger type.
 * Used as FALLBACK when merchant hasn't configured custom messages in dashboard.
 * Custom messages from checkout-settings.triggerMessages override these.
 */
export const TRIGGER_MESSAGES: Record<string, string> = {
  exit_intent_detected: "Ei, vi que você está saindo. Posso te ajudar com algo?",
  idle_30_seconds: "Está com alguma dúvida? Fala comigo que eu ajudo!",
  shipping_objection_detected: "Posso te ajudar com o frete! Deixa eu ver as opções.",
  coupon_field_clicked: "Tenho um cupom especial pra você! Quer conferir?",
  payment_failed: "Parece que houve um problema com o pagamento. Vamos resolver?",
};
