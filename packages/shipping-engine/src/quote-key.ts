export interface QuoteKeyInput {
  merchantId: string;
  destinationZip: string;
  cartTotalCents: number;
  items?: ReadonlyArray<{ sku: string; quantity: number }>;
}

/**
 * Deterministic idempotency key for a shipping quote. Same merchant, destination,
 * cart value and item composition always produce the same key so a valid quote
 * can be reused instead of re-hitting the carrier.
 */
export function buildQuoteKey(input: QuoteKeyInput): string {
  const zip = normalizeZip(input.destinationZip);
  const total = Math.max(0, Math.round(input.cartTotalCents));
  const items = [...(input.items ?? [])]
    .map((item) => `${normalizeToken(item.sku)}:${Math.max(0, Math.round(item.quantity))}`)
    .sort()
    .join(",");
  return `${normalizeToken(input.merchantId)}|${zip}|${total}|${items}`;
}

export const DEFAULT_QUOTE_TTL_SECONDS = 1800;

export function computeQuoteExpiry(createdAt: Date, ttlSeconds = DEFAULT_QUOTE_TTL_SECONDS): Date {
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : DEFAULT_QUOTE_TTL_SECONDS;
  return new Date(createdAt.getTime() + ttl * 1000);
}

export function isQuoteExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

function normalizeZip(zip: string): string {
  return (zip ?? "").replace(/\D/g, "");
}

function normalizeToken(value: string): string {
  return (value ?? "").trim().toLowerCase();
}
