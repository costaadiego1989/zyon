/**
 * CEP Validation for Melhor Envio integration.
 * CEP = Código de Endereçamento Postal (Brazilian postal code)
 * Format: 8 digits (can be passed as XXXXX-XXX or XXXXXXXX)
 */

export interface CepValidationResult {
  valid: boolean;
  normalized?: string; // 8 digits only
  reason?: string; // error reason if invalid
}

/**
 * Validate and normalize a Brazilian CEP.
 * - Must be exactly 8 digits (ignoring punctuation)
 * - Cannot be all zeros
 */
export function validateCep(cep: unknown): CepValidationResult {
  if (typeof cep !== "string") {
    return { valid: false, reason: "cep_must_be_string" };
  }

  const trimmed = cep.trim();
  if (!trimmed) {
    return { valid: false, reason: "cep_empty" };
  }

  // Remove any non-digit characters
  const digits = trimmed.replace(/\D/g, "");

  // Must be exactly 8 digits
  if (digits.length !== 8) {
    return { valid: false, reason: `cep_invalid_length:${digits.length}` };
  }

  // Cannot be all zeros
  if (digits === "00000000") {
    return { valid: false, reason: "cep_all_zeros" };
  }

  return { valid: true, normalized: digits };
}

/**
 * Type-safe CEP validation for use in try-catch chains.
 * Throws on invalid input; returns normalized CEP (8 digits) on success.
 */
export function assertValidCep(cep: unknown): string {
  const result = validateCep(cep);
  if (!result.valid) {
    throw new Error(result.reason || "invalid_cep");
  }
  return result.normalized!;
}
