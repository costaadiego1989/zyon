import type { MetaAdsBudget } from '@zyon/shared-types';
import { MetaAdsError, type MetaAdsStoreState } from './types.js';

/** A manual write can commit funds without an automatic reservation. */
export function hasUnreservedFinancialExecution(state: MetaAdsStoreState, campaignId: string): boolean {
  return Object.values(state.executions).some(execution => {
    if (execution.campaignId === campaignId || !['reserved', 'sending', 'publishing', 'execution_unknown'].includes(execution.status) || Object.hasOwn(state.exposure?.pending ?? {}, execution.id)) return false;
    const proposal = state.proposals[execution.proposalId];
    return !proposal || ['prepare', 'publish', 'launch', 'budget'].includes(proposal.kind);
  });
}

/** Internal server evidence from a confirmed provider read. Never a client/model DTO. */
export interface MetaBudgetEvidence {
  campaignId: string; accountId: string; connectionEpoch: number; remoteCampaignId: string;
  currency: 'BRL'; cadence: 'daily' | 'lifetime'; amountCents: number; checkedAt: string;
}
export interface ExposureReservation {
  operationId: string; campaignId: string; policyId: string; policyVersion: number; policyDigest: string;
  action: 'prepare' | 'publish' | 'budget'; targetBudget: MetaAdsBudget; beforeCents: number;
  status: 'reserved' | 'sending' | 'unknown' | 'confirmed' | 'cancelled'; createdAt: string; updatedAt: string;
}
export interface MetaAdsExposureState {
  allocations: Record<string, MetaBudgetEvidence>;
  pending: Record<string, ExposureReservation>;
}
export function totalMetaExposure(state: MetaAdsExposureState | undefined): number {
  if (!state) return 0;
  const amounts = new Map<string, number>();
  const set = (campaign: string, amount: number) => {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new MetaAdsError('authorization_limit_exceeded', 409);
    amounts.set(campaign, Math.max(amounts.get(campaign) ?? 0, amount));
  };
  for (const allocation of Object.values(state.allocations)) set(allocation.campaignId, allocation.amountCents);
  for (const pending of Object.values(state.pending)) { set(pending.campaignId, pending.beforeCents); set(pending.campaignId, pending.targetBudget.amountCents); }
  const total = [...amounts.values()].reduce((sum, amount) => sum + BigInt(amount), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new MetaAdsError('authorization_limit_exceeded', 409);
  return Number(total);
}
