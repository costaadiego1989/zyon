function brazilianNationalDigits(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\+?[\d().\s-]*$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits.slice(2);
  if (!trimmed.startsWith("+") && (digits.length === 10 || digits.length === 11)) return digits;
  return null;
}

/** Keep incomplete drafts and historical foreign recipients exactly as entered. */
export function formatSupportPhone(value: string): string {
  const national = brazilianNationalDigits(value);
  if (!national) return value;
  const split = national.length === 11 ? 7 : 6;
  return `(${national.slice(0, 2)}) ${national.slice(2, split)}-${national.slice(split)}`;
}

/** Only the UI boundary adds Brazil's country code; the private API stays E164. */
export function canonicalSupportPhone(value: string | null): string | null {
  if (value === null) return null;
  const national = brazilianNationalDigits(value);
  return national ? `+55${national}` : value;
}
