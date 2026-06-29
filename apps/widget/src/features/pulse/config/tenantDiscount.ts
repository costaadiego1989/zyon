import type { CheckoutProps, TenantDiscount } from '../model/types';

export const DEFAULT_TENANT_DISCOUNT: Required<TenantDiscount> = {
  initialPercent: 5,
  bonusPercent: 5,
  urgencyMinutes: 5,
  code: 'PULSE10',
};

export function resolveTenantDiscount(props: Pick<CheckoutProps, 'discount'>): Required<TenantDiscount> {
  const d = props.discount ?? {};
  return {
    initialPercent: d.initialPercent ?? DEFAULT_TENANT_DISCOUNT.initialPercent,
    bonusPercent: d.bonusPercent ?? DEFAULT_TENANT_DISCOUNT.bonusPercent,
    urgencyMinutes: d.urgencyMinutes ?? DEFAULT_TENANT_DISCOUNT.urgencyMinutes,
    code: d.code ?? DEFAULT_TENANT_DISCOUNT.code,
  };
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildCouponFromTenant(productPrice: number, discount: Required<TenantDiscount>) {
  const initialAmount = roundMoney(productPrice * (discount.initialPercent / 100));
  const bonusAmount = discount.bonusPercent > 0 ? roundMoney(productPrice * (discount.bonusPercent / 100)) : 0;
  return {
    code: discount.code,
    amount: -initialAmount,
    displayAmount: -initialAmount,
    label: `${discount.initialPercent}% de desconto`,
    appliedPercent: discount.initialPercent,
    pendingPercent: discount.bonusPercent,
    pendingAmount: bonusAmount > 0 ? -bonusAmount : 0,
    urgencyMinutes: discount.urgencyMinutes,
    totalPercent: discount.initialPercent + discount.bonusPercent,
  };
}
