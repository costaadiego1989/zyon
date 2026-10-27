export type TotalCostInput = {
  price: number;
  shipping_estimate: number | null;
  coupon_discount?: number;
};

export function calculateTotalCost(input: TotalCostInput): number {
  const base = input.price + (input.shipping_estimate ?? 0);
  const discount = input.coupon_discount ?? 0;
  return Math.max(0, base - discount);
}
