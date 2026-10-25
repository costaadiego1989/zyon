export function validateOriginZip(value: string | undefined): string | null {
  if (!value) return null;
  return /^\d{5}-\d{3}$/.test(value) ? null : "CEP deve estar no formato 00000-000";
}

export function validateTreasuryAddress(value: string | undefined): string | null {
  if (!value) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(value)
    ? null
    : "Endereço deve iniciar com 0x seguido de 40 caracteres hexadecimais";
}

export function validateNonNegative(value: number): string | null {
  return value < 0 ? "Valor não pode ser negativo" : null;
}

export function validateMarginConsistency(maxDiscount: number, minMargin: number): string | null {
  if (maxDiscount + minMargin > 100) {
    return "Desconto máximo excede a margem mínima configurada";
  }
  return null;
}
