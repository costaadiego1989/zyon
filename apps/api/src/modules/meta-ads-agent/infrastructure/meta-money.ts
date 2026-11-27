/** MCP CURRENCY values carry major units explicitly. Bare values have no proven unit. */
export function metaCurrencyCents(value: unknown, currency: string): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const amount = value as { value?: unknown; unit?: unknown };
  if (amount.unit !== currency || typeof amount.value !== 'number' && typeof amount.value !== 'string') return null;
  const text = String(amount.value);
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.'); const cents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}
