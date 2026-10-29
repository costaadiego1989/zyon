import type { Prisma } from "@prisma/client";

/** Recovery journals preserve amounts that the original settlement can no longer
 * represent as debt. Unknown money and a positive dispute fee after principal
 * extinction remain exposure until a separate terminal obligation is certified. */
export async function hasMarketplaceRecoveryExposure(tx: Prisma.TransactionClient, beneficiaryMerchantId: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<Array<{ exposed: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM marketplace_residual_operations o
      JOIN marketplace_residual_plans r ON r.id = o.residual_plan_id
      WHERE o.beneficiary_merchant_id = ${beneficiaryMerchantId}
        AND o.status IN ('unknown', 'pending', 'confirmed') AND r.status = 'held'
        AND NOT EXISTS (SELECT 1 FROM marketplace_transfer_recoveries c
          WHERE c.residual_operation_id=o.id AND c.funding_plan_id=r.funding_plan_id
            AND c.host_merchant_id=r.host_merchant_id AND c.beneficiary_merchant_id=o.beneficiary_merchant_id
            AND c.provider=o.provider AND c.account_fingerprint=o.account_fingerprint
            AND c.provider_transfer_id=o.provider_transfer_id AND c.amount_cents=o.amount_cents
            AND r.held_reason='marketplace_residual_dispute_requires_reconciliation'
            AND EXISTS(SELECT 1 FROM marketplace_funding_plans cf JOIN marketplace_order_ledgers cl
              ON cl.host_merchant_id=cf.host_merchant_id AND cl.order_id=cf.provider_payment_id
              WHERE cf.payment_intent_id=c.funding_plan_id AND cf.status='held' AND cl.chargeback_at IS NOT NULL))
    ) OR EXISTS (
      SELECT 1 FROM marketplace_payouts p
      JOIN marketplace_funding_plans f ON f.payment_intent_id = p.funding_plan_id
      JOIN marketplace_order_ledgers l ON l.host_merchant_id = f.host_merchant_id AND l.order_id = f.provider_payment_id
      WHERE p.beneficiary_merchant_id = ${beneficiaryMerchantId}
        AND p.status IN ('unknown', 'pending', 'confirmed') AND l.chargeback_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM marketplace_transfer_recoveries c
          WHERE c.payout_id=p.id AND c.funding_plan_id=f.payment_intent_id AND c.host_merchant_id=f.host_merchant_id
            AND c.beneficiary_merchant_id=p.beneficiary_merchant_id AND c.provider=p.provider
            AND c.account_fingerprint=p.account_fingerprint AND c.provider_transfer_id=p.provider_transfer_id
            AND c.amount_cents=p.amount_cents AND f.status='held')
        AND EXISTS (
          SELECT 1 FROM marketplace_transfer_reversals v
          JOIN marketplace_refund_plans r ON r.id = v.refund_plan_id
          WHERE r.funding_plan_id = f.payment_intent_id
        )
    ) OR EXISTS (
      SELECT 1 FROM marketplace_seller_debts d
      LEFT JOIN marketplace_debt_principal_extinctions c ON c.debt_id=d.id
      WHERE d.seller_merchant_id=${beneficiaryMerchantId} AND d.status='extinguished'
        AND (c.id IS NOT NULL AND c.evidence->'version'='1'::jsonb
          AND c.evidence->'disputeFeeCents'='0'::jsonb
          AND marketplace_debt_principal_extinction_valid(d.id) IS TRUE) IS NOT TRUE
        AND marketplace_seller_dispute_obligation_valid(d.id) IS NOT TRUE
    ) OR EXISTS (
      SELECT 1 FROM marketplace_host_debts d
      LEFT JOIN marketplace_payouts p ON p.id=d.payout_id
      WHERE d.host_merchant_id=${beneficiaryMerchantId} AND d.status='extinguished'
        AND marketplace_order_dispute_closure_valid(p.funding_plan_id) IS NOT TRUE
        AND marketplace_host_dispute_obligation_valid(d.payout_id) IS NOT TRUE
        AND NOT EXISTS (
          SELECT 1 FROM marketplace_host_principal_extinctions c
          WHERE c.payout_id=d.payout_id AND c.host_merchant_id=d.host_merchant_id
            AND c.funding_plan_id=p.funding_plan_id
            AND marketplace_host_principal_extinction_valid(d.payout_id) IS TRUE
            AND c.evidence->'hostDisputeFeeCents'='0'::jsonb
        )
    ) AS exposed`;
  return row?.exposed === true;
}
