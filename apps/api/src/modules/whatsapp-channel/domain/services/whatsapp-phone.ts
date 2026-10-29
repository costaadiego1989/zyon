/** Explicit international numbers retain their country code; unprefixed local numbers use Brazil. */
export function whatsappE164(raw: string): string | null {
  if (typeof raw !== "string" || !/^\+?[\d\s().-]+$/.test(raw.trim())) return null;
  const digits = raw.replace(/\D/g, "");
  const international = raw.trim().startsWith("+") ? digits
    : digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  return /^[1-9]\d{7,14}$/.test(international) ? `+${international}` : null;
}
