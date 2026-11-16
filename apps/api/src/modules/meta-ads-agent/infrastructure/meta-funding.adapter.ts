import type { MetaAdsFundingSnapshot } from '@zyon/shared-types';
import { MetaAdsError, type MetaAccess } from '../domain/types.js';
import type { MetaFundingPort, MetaPaymentDestinationResolver, VerifiedMetaPaymentDestination } from '../domain/funding.port.js';
import { MetaMcpSession } from './meta-mcp.transport.js';

interface Dependencies { graphVersion: string; request?: typeof fetch; clock?: () => Date; paymentDestination?: MetaPaymentDestinationResolver; }
type Json = Record<string, unknown>;
const accountId = (value: unknown): string | null => typeof value === 'string' && /^\d+$/.test(value.replace(/^act_/, '')) ? value.replace(/^act_/, '') : null;
const currency = (value: unknown): string | null => typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
function minorUnits(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value)) return null;
  const amount = Number(value); return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}
/** URL boundaries do not attest navigation. A missing account-specific attestation stays null. */
export function validatedMetaPaymentUrl(destination: VerifiedMetaPaymentDestination | null, selected: string, now: Date): string | null {
  if (!destination || destination.accountId !== selected) return null;
  const verified = Date.parse(destination.verifiedAt);
  if (!Number.isFinite(verified) || verified > now.getTime() || now.getTime() - verified > 180 * 86400000) return null;
  try {
    const url = new URL(destination.url);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return null;
    let key: string;
    if (url.hostname === 'www.facebook.com' && url.pathname === '/ads/manager/account_settings/account_billing/') key = 'act';
    else if (url.hostname === 'business.facebook.com' && ['/billing_hub/payment_settings', '/billing_hub/payment_settings/', '/billing_hub/accounts/details', '/billing_hub/accounts/details/'].includes(url.pathname)) key = 'asset_id';
    else return null;
    if ([...url.searchParams.keys()].length !== 1 || url.searchParams.get(key) !== selected) return null;
    return url.href;
  } catch { return null; }
}
export class MetaFundingAdapter implements MetaFundingPort {
  private readonly request: typeof fetch;
  private readonly clock: () => Date;
  constructor(private readonly deps: Dependencies) { this.request = deps.request ?? fetch; this.clock = deps.clock ?? (() => new Date()); }
  private async account(access: MetaAccess): Promise<Json | null> {
    try {
      const session = new MetaMcpSession(access, this.request, 'set_up_and_fix_ad_account', false); await session.start();
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const response = await session.call('ads_get_ad_accounts', { limit: 50, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(response.ad_accounts)) return null;
        const account = (response.ad_accounts as Json[]).find(a => accountId(a.ad_account_id) === access.accountId);
        if (account) {
          if (account.is_ads_mcp_enabled !== true) throw new MetaAdsError('meta_asset_forbidden', 403);
          return account;
        }
        cursor = typeof response.next_cursor === 'string' ? response.next_cursor : undefined;
        if (!cursor) throw new MetaAdsError('meta_asset_forbidden', 403);
      }
      return null;
    } catch (error) {
      if (error instanceof MetaAdsError && error.code === 'meta_asset_forbidden') throw error;
      return null;
    }
  }
  private async field(access: MetaAccess, field: string): Promise<unknown> {
    if (!/^v\d+\.0$/.test(this.deps.graphVersion)) return undefined;
    try {
      const url = new URL(`https://graph.facebook.com/${this.deps.graphVersion}/act_${access.accountId}`); url.searchParams.set('fields', `id,${field}`);
      const response = await this.request(url, { method: 'GET', headers: { Authorization: `Bearer ${access.accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) return undefined;
      const body = await response.json() as Json;
      if (!body || body.error) return undefined;
      if (accountId(body.id) !== access.accountId) throw new MetaAdsError('meta_asset_forbidden', 403);
      return body[field];
    } catch (error) {
      if (error instanceof MetaAdsError && error.code === 'meta_asset_forbidden') throw error;
      return undefined;
    }
  }
  async read(input: MetaAccess): Promise<MetaAdsFundingSnapshot> {
    const selected = accountId(input.accountId);
    if (!selected || !input.accessToken || !input.merchantId) throw new MetaAdsError('meta_account_required', 409);
    const access = { ...input, accountId: selected };
    const account = await this.account(access);
    const fields = ['currency', 'is_prepay_account', 'balance', 'funding_source', 'account_status', 'disable_reason'];
    const settled = await Promise.allSettled(fields.map(field => this.field(access, field)));
    for (const item of settled) if (item.status === 'rejected' && item.reason instanceof MetaAdsError && item.reason.code === 'meta_asset_forbidden') throw item.reason;
    const graph = Object.fromEntries(fields.map((field, i) => [field, settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<unknown>).value : undefined]));
    const denomination = currency(graph.currency) ?? currency(account?.currency);
    let paymentMethod: MetaAdsFundingSnapshot['paymentMethod'] = account?.has_payment_method === true ? 'present' : account?.has_payment_method === false ? 'missing' : 'unknown';
    if (typeof graph.funding_source === 'string' && /^[1-9]\d*$/.test(graph.funding_source)) paymentMethod = 'present';
    else if (graph.funding_source === null || graph.funding_source === '' || graph.funding_source === '0' || graph.funding_source === 0) paymentMethod = 'missing';
    const status = graph.account_status ?? account?.account_status;
    const unsettled = [3, 8, '3', '8', 'UNSETTLED', 'PENDING_SETTLEMENT'].includes(status as string | number);
    const risk = graph.disable_reason === 3 || graph.disable_reason === '3';
    const blockCode = unsettled ? 'account_unsettled' : risk ? 'payment_risk' : paymentMethod === 'missing' ? 'payment_method_missing' : null;
    let destination: VerifiedMetaPaymentDestination | null = null;
    try { destination = await this.deps.paymentDestination?.(selected) ?? null; } catch { /* Unverified navigation never enables a payment button. */ }
    input.clientConversationId = access.clientConversationId;
    return { accountId: selected, accountName: typeof account?.ad_account_name === 'string' ? account.ad_account_name.slice(0, 160) : selected,
      currency: denomination, billingType: graph.is_prepay_account === true ? 'prepaid' : graph.is_prepay_account === false ? 'postpaid' : 'unknown',
      paymentMethod, confirmedBlock: blockCode !== null, blockCode,
      amountDueCents: denomination === 'BRL' ? minorUnits(graph.balance) : null,
      // No verified available-funds field exists in this integration. balance is bill due.
      prepaidAvailableCents: null, checkedAt: this.clock().toISOString(), source: 'meta_mcp+graph',
      paymentUrl: validatedMetaPaymentUrl(destination, selected, this.clock()) };
  }
}
