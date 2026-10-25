import type { CheckoutSession, CustomerHints } from "@zyon/shared-types";
import { extractAddressDetailLine, extractCep, extractEmail, extractPhone, extractStandaloneName, isBrazilianMobilePhone } from "./customer-extraction.service.js";

import { correctionQuestions as questions, correctionFieldFromPrompt, type CorrectionField } from "./customer-correction-prompts.js";
export type CustomerCorrection = { field: CorrectionField; question: string; patch?: Partial<CustomerHints>; cancelled?: boolean };

/** Explicit corrections take precedence over OTP and ordinary field extraction.
 * The persisted agent question keeps the repair active across voice/chat/reload.
 * No identity proof or arbitrary customer property is accepted from the model.
 */
export function customerCorrection(session: CheckoutSession, text: string, lastAgentTurn?: string): CustomerCorrection | null {
  const normalized = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const pending = correctionFieldFromPrompt(lastAgentTurn);
  if (pending && /^cancelar(?: corre[cç][aã]o)?[.!]?$/i.test(text.trim())) return { field: pending, question: questions[pending], cancelled: true };
  const correctionIntent = /\b(corrigir|corrija|corrige|correcao|alterar|altere|trocar|troque|mudar|mude|outro|outra|errad[oa]|incorret[oa])\b/.test(normalized);
  let field: CorrectionField | undefined;
  if (correctionIntent) {
    if (/\be-?mail\b/.test(normalized)) field = "email";
    else if (/\b(celular|telefone|ddd)\b/.test(normalized) || /outro numero/.test(normalized)) field = "phone";
    else if (/\bcomplemento\b/.test(normalized)) field = "complement";
    else if (/\b(cep|endereco|rua|bairro|cidade)\b/.test(normalized)) field = "zip";
    else if (/\bnumero\b/.test(normalized)) field = "number";
    else if (/\bcpf\b/.test(normalized)) field = "cpf";
    else if (/\bnome\b/.test(normalized)) field = "fullName";
  }
  // Supplying a different e-mail while awaiting its code is also a correction.
  const email = extractEmail(text)?.toLowerCase();
  if (!field && email && session.customer?.otp_code && email !== session.customer.email?.toLowerCase()) field = "email";
  field ??= pending;
  if (!field) return null;
  const result: CustomerCorrection = { field, question: questions[field] };
  // Never interpret a question about replacing a field as the new value.
  const valueText = text.replace(/^.*?(?:^|\s)(?:para|é|e)\s+/i, "").trim();
  if (/\b(errad[oa]|incorret[oa])\b/.test(normalized) && !/\b(para|correto [eé])\s/i.test(text)) return result;
  switch (field) {
    case "email": {
      const corrected = extractEmail(valueText)?.toLowerCase();
      if (corrected) result.patch = { email: corrected };
      break;
    }
    case "phone": {
      const phone = extractPhone(text);
      if (phone && isBrazilianMobilePhone(phone)) result.patch = { phone, phone_verified: false, phone_otp_code: "" };
      break;
    }
    case "cpf": {
      const cpf = text.replace(/\D/g, "");
      if (/^\d{11}$/.test(cpf)) result.patch = { cpf };
      break;
    }
    case "fullName": {
      const name = !/[?]/.test(text) && (!correctionIntent || valueText !== text) ? extractStandaloneName(valueText) : undefined;
      if (name) result.patch = { fullName: name };
      break;
    }
    case "zip": {
      const zip = extractCep(text);
      if (zip) result.patch = { address: { zip }, address_verified: false };
      break;
    }
    case "number": {
      const detail = extractAddressDetailLine(valueText);
      if (detail?.number) result.patch = { address: { ...session.customer?.address, number: detail.number } };
      break;
    }
    case "complement": {
      if (!/[?]/.test(text) && (!correctionIntent || valueText !== text)) {
        const complement = /^(sem complemento|nenhum|nao tem|não tem)$/i.test(valueText) ? "" : valueText.slice(0, 160);
        if (complement !== text || !correctionIntent) result.patch = { address: { ...session.customer?.address, complement } };
      }
      break;
    }
  }
  return result;
}
