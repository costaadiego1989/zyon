import type { MetaAdsAutomationPolicy, MetaAdsAutomationPolicyInput, MetaAdsAutomaticAction, MetaAdsPriority } from '@zyon/shared-types';
import { MetaAdsError } from './types.js';
import { requireIdentifier, stableDigest } from './offer.js';

const invalid = (): never => { throw new MetaAdsError('automation_policy_invalid'); };
function fields(value: unknown, expected: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
function ids(value: unknown, minimum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 100 || new Set(value).size !== value.length) return invalid();
  try { return value.map(id => requireIdentifier(id)).sort(); } catch { return invalid(); }
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim()) return invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return invalid();
  const [, y, m, d, h, min, sec] = match; const date = new Date(0); date.setUTCFullYear(Number(y), Number(m) - 1, Number(d));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d) || Number(h) > 23 || Number(min) > 59 || Number(sec) > 59 || !Number.isFinite(Date.parse(value))) return invalid();
  return new Date(value).toISOString();
}
const positive = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : invalid();
export function normalizeAutomationPolicy(value: unknown, now: Date): MetaAdsAutomationPolicyInput {
  const input = fields(value, ['scope', 'limits']);
  const scope = fields(input.scope, ['variantIds', 'campaignIds', 'allowNewCampaigns', 'destination', 'priority', 'country', 'actions']);
  const limits = fields(input.limits, ['currency', 'cadence', 'campaignCeilingCents', 'storeCeilingCents', 'startsAt', 'endsAt']);
  const variants = ids(scope.variantIds, 1), campaigns = ids(scope.campaignIds, 0);
  if (typeof scope.allowNewCampaigns !== 'boolean' || !scope.allowNewCampaigns && !campaigns.length ||
    !['store', 'whatsapp'].includes(scope.destination as string) || !['paid_sales', 'cost_per_purchase', 'roas', 'contribution'].includes(scope.priority as string) ||
    typeof scope.country !== 'string' || scope.country.length !== 2 || !/^[A-Z]{2}$/.test(scope.country)) return invalid();
  if (!Array.isArray(scope.actions) || !scope.actions.length || new Set(scope.actions).size !== scope.actions.length ||
    scope.actions.some(action => !['prepare', 'publish', 'pause', 'budget', 'creative'].includes(action))) return invalid();
  if (limits.currency !== 'BRL' || !['daily', 'lifetime'].includes(limits.cadence as string)) return invalid();
  const campaignCeilingCents = positive(limits.campaignCeilingCents), storeCeilingCents = positive(limits.storeCeilingCents);
  const startsAt = timestamp(limits.startsAt), endsAt = timestamp(limits.endsAt);
  if (campaignCeilingCents > storeCeilingCents || Date.parse(endsAt) <= Date.parse(startsAt) || !Number.isFinite(now.getTime()) || Date.parse(endsAt) <= now.getTime()) return invalid();
  return { scope: { variantIds: variants, campaignIds: campaigns, allowNewCampaigns: scope.allowNewCampaigns, destination: scope.destination as 'store' | 'whatsapp', priority: scope.priority as MetaAdsPriority, country: scope.country, actions: [...scope.actions].sort() as MetaAdsAutomaticAction[] },
    limits: { currency: 'BRL', cadence: limits.cadence as 'daily' | 'lifetime', campaignCeilingCents, storeCeilingCents, startsAt, endsAt } };
}
export interface AutomationReviewBinding { merchantId: string; accountId: string; connectionEpoch: number; version: number; }
export function automationReviewDigest(binding: AutomationReviewBinding, terms: MetaAdsAutomationPolicyInput): string {
  requireIdentifier(binding.merchantId);
  if (!/^\d+$/.test(binding.accountId) || !Number.isSafeInteger(binding.connectionEpoch) || binding.connectionEpoch < 0 || !Number.isSafeInteger(binding.version) || binding.version < 1) throw new MetaAdsError('automation_policy_binding_invalid', 503);
  return stableDigest({ ...binding, scope: terms.scope, limits: terms.limits });
}
export function isAutomationPolicyCurrent(policy: MetaAdsAutomationPolicy | null | undefined, accountId: string, epoch: number, now: Date): boolean {
  if (!policy || policy.revokedAt !== null || policy.accountId !== accountId || policy.connectionEpoch !== epoch ||
    !Number.isSafeInteger(policy.version) || policy.version < 1 || typeof policy.digest !== 'string' || policy.digest.length !== 64 || !/^[a-f0-9]{64}$/i.test(policy.digest) || !policy.acceptedBy) return false;
  const at = now.getTime(), start = Date.parse(policy.limits.startsAt), end = Date.parse(policy.limits.endsAt), accepted = Date.parse(policy.acceptedAt);
  return [at, start, end, accepted].every(Number.isFinite) && start <= at && at < end && accepted <= at;
}
