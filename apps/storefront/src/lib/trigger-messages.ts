/**
 * Proactive nudge messages per trigger type.
 * Used when the agent initiates contact based on buyer signals.
 */
export const TRIGGER_MESSAGES: Record<string, string> = {
  exit_intent_detected: "Ei, vi que você está saindo. Posso te ajudar com algo?",
  idle_30_seconds: "Está com alguma dúvida? Fala comigo que eu ajudo!",
};
