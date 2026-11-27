const cases = [
  { file: '/cashback/domain/cashback-combination.ts', old: 'combinedCapCents - commercialCents', replacement: 'combinedCapCents' },
  { file: '/coupons/infrastructure/repositories/prisma-bound-coupon-redemption.ts', old: 'a.discountCents / 100', replacement: 'checkoutCouponCombinedDiscountCents(a) / 100' },
  { file: '/payment/application/resume-payment-creation.service.ts',
    old: '(before.amountBreakdown?.cashbackCents ?? 0) > 0 || before.amountBreakdown?.cashbackEarningQuoteId',
    replacement: 'false && ((before.amountBreakdown?.cashbackCents ?? 0) > 0 || before.amountBreakdown?.cashbackEarningQuoteId)' },
];
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  const index = Number(process.env.CASHBACK_FINANCIAL_VERIFIER_MUTATION);
  if (!Number.isInteger(index) || index < 0 || index >= cases.length) throw new Error('financial_mutation_index_invalid');
  const item = cases[index];
  if (!url.replaceAll('\\', '/').endsWith(item.file)) return result;
  const source = String(result.source);
  if (source.split(item.old).length !== 2) throw new Error('financial_mutation_snippet_not_unique');
  process.stderr.write(`[CASHBACK_FINANCIAL_VERIFIER_MUTATION:${index}]\n`);
  return { ...result, source: source.replace(item.old, item.replacement) };
}
