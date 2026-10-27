/**
 * Currency utilities — pt-BR format (R$)
 * Centralized: import from here in all pages.
 */

/** Format cents to pt-BR string: 2590 → "25,90", 150000 → "1.500,00" */
export function centsToReais(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

/** Parse pt-BR formatted string to cents: "25,90" → 2590, "1.500,00" → 150000 */
export function reaisToCents(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;

  // If has comma → treat comma as decimal, dots as milhar (strip dots)
  if (trimmed.includes(",")) {
    const stripped = trimmed.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(stripped);
    return Number.isFinite(num) ? Math.round(num * 100) : 0;
  }

  // No comma → dot is decimal (e.g. "89.90")
  const num = parseFloat(trimmed.replace(/[^\d.]/g, ""));
  return Number.isFinite(num) ? Math.round(num * 100) : 0;
}

/** Format raw input to pt-BR currency string (for display, not live mask) */
export function formatCurrencyInput(raw: string): string {
  if (!raw.trim()) return "";
  const cents = reaisToCents(raw);
  if (cents <= 0) return raw;
  return centsToReais(cents);
}

/**
 * Live currency mask: strips non-digits, treats input as cents, formats pt-BR.
 * Use inside onChange handler for real-time formatting.
 * "2590" → "25,90", "150000" → "1.500,00"
 */
export function applyCurrencyMask(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const cents = parseInt(digits, 10);
  const reais = (cents / 100).toFixed(2);
  const [intPart, decPart] = reais.split(".");
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + decPart;
}
