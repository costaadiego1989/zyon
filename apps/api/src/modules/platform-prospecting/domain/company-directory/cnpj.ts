/** Receita Federal's modulo-11 algorithm, character value = ASCII minus 48. */
export function canonicalCnpj(input: string): string {
  if (typeof input !== "string") throw new Error("invalid_cnpj");
  const value = input.trim().toUpperCase();
  if (!/^(?:[A-Z0-9]{12}\d{2}|[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-\d{2})$/.test(value)) throw new Error("invalid_cnpj");
  const canonical = value.replace(/[./-]/g, "");
  if (/^(\d)\1{13}$/.test(canonical)) throw new Error("invalid_cnpj");
  const digit = (part: string) => {
    let sum = 0;
    for (let index = part.length - 1, weight = 2; index >= 0; index--, weight = weight === 9 ? 2 : weight + 1) sum += (part.charCodeAt(index) - 48) * weight;
    const remainder = sum % 11;
    return String(remainder < 2 ? 0 : 11 - remainder);
  };
  if (digit(canonical.slice(0, 12)) !== canonical[12] || digit(canonical.slice(0, 13)) !== canonical[13]) throw new Error("invalid_cnpj");
  return canonical;
}
