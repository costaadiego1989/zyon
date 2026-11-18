import { isHumanSupportRequest } from "./whatsapp-turn-context.js";

export type HumanEscalationIntent = "request" | "clarify" | "not_requested";

/** Routes a current utterance away from a form collector for interpretation.
 * It grants no handoff: the actual selected tool still admits its own intent. */
export function isHumanSupportDiscussion(raw: string): boolean {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 4000) return false;
  if (isHumanSupportRequest(raw)) return true;
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/^\s*(?:atendente|humano|humana)[.!?\s]*$/.test(text)) return true;
  return /\b(?:atendente|humano|humana|pessoa|equipe|alguem|medic[oa]|doutor[a]?|profissional|terapeuta)\b/.test(text)
    && /\b(?:falar|conversar|atender|atenda|ajudar|ajude|contato|chamar|chame|transferir|transfira|passar|passe)\b/.test(text);
}

/** Admission of an already selected ordinary tool. Only the current private
 * server turn is input; model reasons and public source prose have no role. */
export function humanEscalationIntent(raw: string): HumanEscalationIntent {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 4000) return "not_requested";
  if (isHumanSupportRequest(raw)) return "request";
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const target = /\b(?:atendente|humano|humana|pessoa(?: real)?|gente|equipe(?: da loja)?|alguem (?:da equipe|da loja|dai))\b/.test(text);
  const clinician = /\b(?:medic[oa]|doutor[a]?|profissional|terapeuta|psicolog[oa]|prescrever)\b/.test(text);
  if (!target) return clinician ? "clarify" : "not_requested";
  if (/\b(?:nao|nunca|jamais)(?:\s+(?:me|nos|mais|agora)){0,2}\s+(?:quero|queria|preciso|precisa|gostaria|solicito|chame|chamar|falar|transfira|transferir|passe|passar)\b/.test(text)
    || /\b(?:dispenso|evite)\b[^.!?;]*\b(?:atendente|humano|humana|equipe|pessoa)\b/.test(text)) return "not_requested";
  if (/["'“”‘’][^\n]*\b(?:atendente|humano|humana|falar com|pessoa real)\b[^\n]*["'“”‘’]/.test(text)
    || /\b(?:e se|se eu|suponha|supondo|hipoteticamente|imagine|a frase|o texto|um exemplo|como exemplo)\b/.test(text)
    || clinician) return "clarify";
  const request = /\b(?:quero|queria|preciso|gostaria|solicito|pode|poderia|consegue|conseguiria|tem como|chame|chamar|passe|passar|transfira|transferir)\b/.test(text);
  const contact = /\b(?:falar|conversar|atender|atenda|ajudar|ajude|passar|passe|chamar|chame|transferir|transfira|contato)\b/.test(text);
  return request && contact ? "request" : request ? "not_requested" : "clarify";
}
