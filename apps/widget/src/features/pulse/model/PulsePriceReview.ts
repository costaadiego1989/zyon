export type PulsePriceReview = {
  confirmation_fingerprint: string;
  currency: 'BRL';
  order_total_cents: number;
  service_fee_cents: number;
  total_to_pay_cents: number;
  cart: { currency: 'BRL'; total: number; currentDiscount?: number;
    items: Array<{ sku: string; name: string; price: number; quantity: number }> };
  shipping?: { carrier?: string; carrierKey?: string; method?: string; customerPrice: number };
};

export function pulsePriceReview(value: unknown): PulsePriceReview | undefined {
  const v = value as PulsePriceReview | undefined;
  const money = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!v || !/^[a-f0-9]{64}$/.test(v.confirmation_fingerprint) || v.currency !== 'BRL' || v.cart?.currency !== 'BRL'
    || ![v.order_total_cents, v.service_fee_cents, v.total_to_pay_cents].every(n => Number.isSafeInteger(n) && n >= 0)
    || v.total_to_pay_cents <= 0 || v.total_to_pay_cents !== v.order_total_cents + v.service_fee_cents
    || !money(v.cart.total) || !money(v.cart.currentDiscount ?? 0)
    || !Array.isArray(v.cart.items) || v.cart.items.length === 0 || v.cart.items.length > 200
    || v.cart.items.some(item => !item || typeof item.sku !== 'string' || !item.sku || typeof item.name !== 'string'
      || !money(item.price) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)
    || (v.shipping && !money(v.shipping.customerPrice))
    || Math.round((v.cart.total - (v.cart.currentDiscount ?? 0) + (v.shipping?.customerPrice ?? 0)) * 100) !== v.order_total_cents) return undefined;
  return v;
}

export class PulsePriceReviewRequired extends Error {
  constructor(readonly review?: PulsePriceReview) {
    super('Confira o novo total do pedido antes de pagar.');
    this.name = 'PulsePriceReviewRequired';
  }
}
