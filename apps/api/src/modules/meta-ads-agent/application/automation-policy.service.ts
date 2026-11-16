import { randomUUID } from 'node:crypto';
import type { MetaAdsAutomationPolicy, MetaAdsAutomationPolicyInput, MetaAdsAutomationReview, MetaAdsAutomationState } from '@zyon/shared-types';
import { MetaAdsError, type MetaAdsRepository, type CommerceContextPort, type MetaAdsStoreState, type Clock, type IdFactory } from '../domain/types.js';
import { requireEntitlement, requireIdentifier, stableDigest } from '../domain/offer.js';
import { automationReviewDigest, isAutomationPolicyCurrent, normalizeAutomationPolicy } from '../domain/automation-policy.js';
import type { ConnectionService } from './connection.service.js';
import type { CampaignService } from './campaign.service.js';

interface Dependencies {
  repo: MetaAdsRepository; commerce: Pick<CommerceContextPort, 'getPlan' | 'products'>;
  connection: Pick<ConnectionService, 'access'>; campaigns: Pick<CampaignService, 'owned'>;
  authorizeActor: (merchantId: string, actorId: string) => Promise<void>; enabled: () => boolean;
  clock?: Clock; id?: IdFactory;
}
interface AcceptInput extends MetaAdsAutomationPolicyInput { version: number; digest: string; idempotencyKey: string; }
interface RevokeInput { policyId: string; version: number; idempotencyKey: string; }
interface RequestReceipt { hash: string; policyId: string; }
interface PolicyReceipt { policy: MetaAdsAutomationPolicy; merchantId: string; }
interface Revocation { policyId: string; policyVersion: number; revokedBy: string; revokedAt: string; }
function fields(value: unknown, allowed: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) throw new MetaAdsError('automation_policy_invalid');
}
const control = (state: MetaAdsStoreState) => state.automation ?? { version: 0, activePolicyId: null, lastPolicyId: null };
export class AutomationPolicyService {
  private readonly clock: Clock;
  private readonly id: IdFactory;
  constructor(private readonly deps: Dependencies) { this.clock = deps.clock ?? (() => new Date()); this.id = deps.id ?? randomUUID; }
  private async actor(merchantId: string, actorId: string): Promise<void> { requireIdentifier(merchantId); requireIdentifier(actorId); await this.deps.authorizeActor(merchantId, actorId); }
  private async prepare(merchantId: string, input: unknown) {
    if (!this.deps.enabled()) throw new MetaAdsError('automatic_mode_unavailable', 503);
    const terms = normalizeAutomationPolicy(input, this.clock()); const plan = await this.deps.commerce.getPlan(merchantId);
    const state = await this.deps.repo.read(merchantId); requireEntitlement(plan, state, this.clock());
    const access = await this.deps.connection.access(merchantId, { destination: terms.scope.destination });
    if (!access.accountId) throw new MetaAdsError('meta_account_required', 409);
    const products = await this.deps.commerce.products(merchantId, { variantIds: terms.scope.variantIds, limit: 100 });
    if (products.length !== terms.scope.variantIds.length || terms.scope.variantIds.some(id => !products.some(p => p.variantId === id)) || products.some(p => !p.active || p.currency !== 'BRL' || p.stockQuantity !== null && p.stockQuantity <= 0)) throw new MetaAdsError('automation_products_unavailable', 409);
    for (const campaignId of terms.scope.campaignIds) {
      const campaign = await this.deps.campaigns.owned(merchantId, campaignId);
      if (campaign.draft.variantIds.some(id => !terms.scope.variantIds.includes(id)) || campaign.draft.destination !== terms.scope.destination || campaign.draft.priority !== terms.scope.priority || campaign.draft.country !== terms.scope.country) throw new MetaAdsError('automation_campaign_scope_invalid', 409);
      if (campaign.remoteAccountId && campaign.remoteAccountId !== access.accountId) throw new MetaAdsError('meta_asset_forbidden', 403);
    }
    return { terms, access, plan, state };
  }
  async review(merchantId: string, actorId: string, input: unknown): Promise<MetaAdsAutomationReview> {
    await this.actor(merchantId, actorId); const prepared = await this.prepare(merchantId, input);
    const binding = { merchantId, accountId: prepared.access.accountId!, connectionEpoch: prepared.access.connectionEpoch, version: control(prepared.state).version + 1 };
    return { accountId: binding.accountId, connectionEpoch: binding.connectionEpoch, version: binding.version, ...prepared.terms, digest: automationReviewDigest(binding, prepared.terms), warnings: ['automatic_budget_control_verification_required', 'media_spend_separate_from_subscription', 'revocation_does_not_pause_ads'] };
  }
  private async policy(state: MetaAdsStoreState): Promise<MetaAdsAutomationPolicy | null> {
    const pointer = control(state); const policyId = pointer.activePolicyId ?? pointer.lastPolicyId;
    if (!policyId) return null;
    const receipt = await this.deps.repo.getRecord<PolicyReceipt>(state.merchantId, `automatic-policy:${policyId}`);
    const policy = receipt?.payload.policy;
    if (!policy || receipt?.payload.merchantId !== state.merchantId || policy.id !== policyId || policy.revokedAt !== null) return null;
    try {
      const terms = normalizeAutomationPolicy({ scope: policy.scope, limits: policy.limits }, new Date(policy.acceptedAt));
      if (stableDigest(terms) !== stableDigest({ scope: policy.scope, limits: policy.limits }) || policy.digest !== automationReviewDigest({ merchantId: state.merchantId, accountId: policy.accountId, connectionEpoch: policy.connectionEpoch, version: policy.version }, terms)) return null;
    } catch { return null; }
    const revoked = await this.deps.repo.getRecord<Revocation>(state.merchantId, `automatic-policy-revoked:${policyId}`);
    if (revoked && (revoked.payload.policyId !== policyId || revoked.payload.policyVersion !== policy.version)) return null;
    return { ...structuredClone(policy), revokedAt: revoked?.payload.revokedAt ?? null };
  }
  async view(merchantId: string): Promise<MetaAdsAutomationState> {
    const state = await this.deps.repo.read(merchantId), policy = await this.policy(state);
    let entitled = false; try { requireEntitlement(await this.deps.commerce.getPlan(merchantId), state, this.clock()); entitled = true; } catch { /* History survives entitlement expiry. */ }
    const connection = state.connection;
    const validConnection = ['connected', 'limited'].includes(connection.status) && Boolean(connection.encryptedAccessToken) && (!connection.expiresAt || Date.parse(connection.expiresAt) > this.clock().getTime());
    const automatic = this.deps.enabled() && entitled && validConnection && control(state).activePolicyId === policy?.id && control(state).version === policy?.version && isAutomationPolicyCurrent(policy, connection.account?.id ?? '', connection.epoch, this.clock());
    return { mode: automatic ? 'automatic' : 'manual', policy, committedCents: 0, availableCents: automatic ? policy!.limits.storeCeilingCents : null };
  }
  async accept(merchantId: string, actorId: string, input: AcceptInput): Promise<MetaAdsAutomationState> {
    await this.actor(merchantId, actorId); fields(input, ['scope', 'limits', 'version', 'digest', 'idempotencyKey']); requireIdentifier(input.idempotencyKey);
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw new MetaAdsError('automation_policy_invalid');
    const requestKey = `automatic-policy-accept:${input.idempotencyKey}`; const hash = stableDigest({ scope: input.scope, limits: input.limits, version: input.version, digest: input.digest });
    const previous = await this.deps.repo.getRecord<RequestReceipt>(merchantId, requestKey);
    if (previous) { if (previous.payload.hash !== hash) throw new MetaAdsError('automation_policy_request_conflict', 409); return this.view(merchantId); }
    const prepared = await this.prepare(merchantId, { scope: input.scope, limits: input.limits });
    const binding = { merchantId, accountId: prepared.access.accountId!, connectionEpoch: prepared.access.connectionEpoch, version: input.version };
    if (typeof input.digest !== 'string' || input.digest !== automationReviewDigest(binding, prepared.terms)) throw new MetaAdsError('automation_policy_review_changed', 409);
    const policy: MetaAdsAutomationPolicy = { id: requireIdentifier(this.id()), version: input.version, accountId: binding.accountId, connectionEpoch: binding.connectionEpoch, ...prepared.terms, digest: input.digest, acceptedBy: actorId, acceptedAt: this.clock().toISOString(), revokedAt: null };
    await this.deps.repo.mutate(merchantId, [requestKey], (state, records) => {
      const prior = records.get(requestKey)?.payload as RequestReceipt | undefined;
      if (prior) { if (prior.hash !== hash) throw new MetaAdsError('automation_policy_request_conflict', 409); return { result: null }; }
      if (!this.deps.enabled()) throw new MetaAdsError('automatic_mode_unavailable', 503);
      requireEntitlement(prepared.plan, state, this.clock());
      normalizeAutomationPolicy(prepared.terms, this.clock());
      if (state.connection.epoch !== binding.connectionEpoch || state.connection.account?.id !== binding.accountId) throw new MetaAdsError('automation_policy_review_changed', 409);
      if (control(state).version + 1 !== input.version) throw new MetaAdsError('automation_policy_version_changed', 409);
      const acceptedPolicy = { ...policy, acceptedAt: this.clock().toISOString() };
      state.automation = { ...control(state), version: policy.version, activePolicyId: policy.id, lastPolicyId: policy.id };
      return { result: null, records: [{ key: `automatic-policy:${policy.id}`, kind: 'audit', payload: { merchantId, policy: acceptedPolicy }, createdAt: acceptedPolicy.acceptedAt }, { key: requestKey, kind: 'audit', payload: { hash, policyId: policy.id }, createdAt: acceptedPolicy.acceptedAt }] };
    });
    return this.view(merchantId);
  }
  async revoke(merchantId: string, actorId: string, input: RevokeInput): Promise<MetaAdsAutomationState> {
    await this.actor(merchantId, actorId); fields(input, ['policyId', 'version', 'idempotencyKey']); requireIdentifier(input.policyId); requireIdentifier(input.idempotencyKey);
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw new MetaAdsError('automation_policy_invalid');
    const requestKey = `automatic-policy-revoke:${input.idempotencyKey}`, policyKey = `automatic-policy:${input.policyId}`, revokedKey = `automatic-policy-revoked:${input.policyId}`;
    const hash = stableDigest({ policyId: input.policyId, version: input.version });
    await this.deps.repo.mutate(merchantId, [requestKey, policyKey, revokedKey], (state, records) => {
      const prior = records.get(requestKey)?.payload as RequestReceipt | undefined;
      if (prior) { if (prior.hash !== hash) throw new MetaAdsError('automation_policy_request_conflict', 409); return { result: null }; }
      const policy = (records.get(policyKey)?.payload as PolicyReceipt | undefined)?.policy;
      if (!policy || policy.version !== input.version) throw new MetaAdsError('automation_policy_version_changed', 409);
      const at = this.clock().toISOString();
      if (records.has(revokedKey)) return { result: null, records: [{ key: requestKey, kind: 'audit', payload: { hash, policyId: input.policyId }, createdAt: at }] };
      if (control(state).activePolicyId !== input.policyId || control(state).version !== input.version) throw new MetaAdsError('automation_policy_version_changed', 409);
      state.automation = { ...control(state), version: control(state).version + 1, activePolicyId: null, lastPolicyId: input.policyId };
      return { result: null, records: [{ key: revokedKey, kind: 'audit', payload: { policyId: input.policyId, policyVersion: policy.version, revokedBy: actorId, revokedAt: at }, createdAt: at }, { key: requestKey, kind: 'audit', payload: { hash, policyId: input.policyId }, createdAt: at }] };
    });
    return this.view(merchantId);
  }
}
