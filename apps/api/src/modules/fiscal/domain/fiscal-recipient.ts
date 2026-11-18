export const FISCAL_RECIPIENT_FIELDS = ["name", "taxId", "email", "phone", "address.street", "address.number",
  "address.complement", "address.neighborhood", "address.city", "address.state", "address.postalCode", "address.cityCode", "address.countryCode"] as const;
export type FiscalRecipientField = typeof FISCAL_RECIPIENT_FIELDS[number];
/** Common domestic NF-e recipient fields, independent of the merchant's tax rates. */
export const FISCAL_BASE_RECIPIENT_REQUIREMENTS: readonly FiscalRecipientField[] = ["name", "taxId", "address.street", "address.number",
  "address.neighborhood", "address.city", "address.state", "address.postalCode", "address.cityCode"];
export interface FiscalRecipient {
  name?: string; taxId?: string; email?: string; phone?: string;
  address?: { street?: string; number?: string; complement?: string; neighborhood?: string; city?: string;
    state?: string; postalCode?: string; cityCode?: string; countryCode?: string };
}
export type FiscalRecipientValidation = { valid: true; recipient: FiscalRecipient }
  | { valid: false; code: "fiscal_customer_data_required"; fields: FiscalRecipientField[] };

function digit(value: string, weights: readonly number[]): number {
  const remainder = [...value].reduce((sum, character, index) => sum + (character.charCodeAt(0) - 48) * weights[index]!, 0) % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** RFB ASCII-minus-48 CNPJ algorithm also preserves existing numeric CNPJs.
 * https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj */
export function normalizeFiscalTaxId(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length > 32 || /[^A-Za-z0-9.\-/\s]/.test(input)) return undefined;
  const value = input.replace(/[.\-/\s]/g, "").toUpperCase();
  if (/^\d{11}$/.test(value) && !/^(\d)\1{10}$/.test(value)) {
    const first = digit(value.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = digit(value.slice(0, 9) + first, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return value.slice(-2) === `${first}${second}` ? value : undefined;
  }
  if (/^[A-Z0-9]{12}\d{2}$/.test(value) && !/^(\d)\1{13}$/.test(value)) {
    const first = digit(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = digit(value.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return value.slice(-2) === `${first}${second}` ? value : undefined;
  }
  return undefined;
}

const states = new Set(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO", "EX"]);
const minTwo = new Set<FiscalRecipientField>(["name", "address.street", "address.neighborhood", "address.city"]);

function normalizeField(field: FiscalRecipientField, raw: unknown): string | undefined {
  if (field === "taxId") return normalizeFiscalTaxId(raw);
  // NF-e recipient/address textual limits: official MOC E04–E16 and Focus fields.
  // https://campos.focusnfe.com.br/nfe/NotaFiscalXML.html
  if (typeof raw !== "string" || raw.length > 256 || /[\u0000-\u001F\u007F]/.test(raw)) return undefined;
  const value = raw.trim();
  if (!value || value.length > 60 || minTwo.has(field) && value.length < 2) return undefined;
  if (field === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined;
  if (field === "phone") {
    const phone = value.replace(/[+().\s-]/g, "");
    return /^\+?[0-9().\s-]+$/.test(value) && /^\d{6,14}$/.test(phone) ? phone : undefined;
  }
  if (field === "address.state") return states.has(value.toUpperCase()) ? value.toUpperCase() : undefined;
  if (field === "address.postalCode") return /^\d{5}-?\d{3}$/.test(value) ? value.replace("-", "") : undefined;
  if (field === "address.cityCode") return /^\d{7}$/.test(value) ? value : undefined;
  if (field === "address.countryCode") return /^\d{2,4}$/.test(value) ? value : undefined;
  return value;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function validateFiscalRecipient(input: unknown, requiredFields: readonly FiscalRecipientField[]): FiscalRecipientValidation {
  if (!Array.isArray(requiredFields) || requiredFields.some(field => !FISCAL_RECIPIENT_FIELDS.includes(field))) {
    throw new Error("fiscal_recipient_profile_invalid");
  }
  const source = asObject(input);
  const address = asObject(source.address);
  const normalized = new Map<FiscalRecipientField, string>();
  const raw = (field: FiscalRecipientField) => field.startsWith("address.") ? address[field.slice(8)] : source[field];
  const errors = new Set<FiscalRecipientField>();
  for (const field of FISCAL_RECIPIENT_FIELDS) {
    const value = normalizeField(field, raw(field));
    if (value !== undefined) normalized.set(field, value);
  }
  for (const field of requiredFields) if (!normalized.has(field)) errors.add(field);
  for (const field of FISCAL_RECIPIENT_FIELDS) {
    const value = raw(field);
    const provided = value !== undefined && value !== null && !(typeof value === "string" && !value.trim());
    if (provided && !normalized.has(field)) errors.add(field);
  }
  if (errors.size) return { valid: false, code: "fiscal_customer_data_required", fields: [...errors] };
  const recipient: FiscalRecipient = {};
  for (const [field, value] of normalized) {
    if (field.startsWith("address.")) {
      recipient.address ??= {};
      recipient.address[field.slice(8) as keyof NonNullable<FiscalRecipient["address"]>] = value;
    } else recipient[field as "name" | "taxId" | "email" | "phone"] = value;
  }
  return { valid: true, recipient };
}
