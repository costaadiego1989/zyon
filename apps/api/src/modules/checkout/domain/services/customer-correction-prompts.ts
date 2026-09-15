import type { CheckoutSession } from "@zyon/shared-types";

export const correctionQuestions = {
  email: "Qual é o e-mail correto para este pedido?",
  phone: "Qual é o celular correto com DDD para este pedido?",
  fullName: "Qual é o nome completo correto para este pedido?",
  cpf: "Qual é o CPF correto para este pedido?",
  zip: "Qual é o CEP correto para este pedido?",
  number: "Qual é o número correto do imóvel para este pedido?",
  complement: "Qual é o complemento correto para este pedido? Se não houver, diga sem complemento.",
} as const;
export type CorrectionField = keyof typeof correctionQuestions;
export const correctionLabels: Record<CorrectionField, string> = {
  email: "email", phone: "telefone", fullName: "nome", cpf: "CPF", zip: "CEP", number: "número", complement: "complemento",
};
export function pendingCustomerCorrection(session: CheckoutSession): CorrectionField | undefined {
  const last = session.chatHistory.at(-1);
  return last?.role === "agent" ? correctionFieldFromPrompt(last.text) : undefined;
}
export function correctionFieldFromPrompt(text?: string): CorrectionField | undefined {
  return (Object.keys(correctionQuestions) as CorrectionField[]).find(field => text?.endsWith(correctionQuestions[field]));
}
