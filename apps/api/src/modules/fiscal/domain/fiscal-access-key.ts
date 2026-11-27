/** NT Conjunta2025.001: only the first12 CNPJ characters (positions7..18) can be uppercase letters. */
export function isFiscalAccessKey(value: unknown): value is string { return typeof value === "string" && /^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/.test(value); }
