import Stripe from "stripe";
import type { MarketplaceContributionCheckoutProvider, MarketplaceContributionCheckoutRequest, MarketplaceContributionCheckoutObservation,
  MarketplaceContributionExcessRequest, MarketplaceContributionExcessObservation } from "../domain/ports/marketplace-contribution-checkout.port.js";
import { checkoutMetadata, validContributionCheckout, validContributionExcess, contributionExcessMetadata, validContributionExcessProof } from "../domain/services/marketplace-contribution-checkout.js";
import { marketplaceContributionHash, marketplaceContributionMetadata } from "../domain/services/marketplace-refund-contribution.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";

const identifier = (v: unknown): string | undefined => typeof v === "string" ? v : v && typeof v === "object" && "id" in v && typeof v.id === "string" ? v.id : undefined;
const unknownCheckout = (): MarketplaceContributionCheckoutObservation => ({ state: "unknown" });
const unknownExcess = (): MarketplaceContributionExcessObservation => ({ state: "unknown" });
export const excessMetadata = contributionExcessMetadata;
function hostedUrl(value: string | null) {
  if (!value) return undefined;
  try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "checkout.stripe.com" && !u.username && !u.password && !u.port ? u.toString() : undefined; }
  catch { return undefined; }
}
/** Creation is called only after the durable first-submission claim. Observation
 * never recreates a Session or refund, including after an unknown POST result. */
export class StripeMarketplaceContributionCheckoutAdapter implements MarketplaceContributionCheckoutProvider {
  private readonly stripe?: Stripe;
  private readonly returnUrl?: URL;
  constructor(private readonly config: { stripeSecret?: string; returnUrl: string }, request: typeof fetch = globalThis.fetch) {
    try { const u = new URL(config.returnUrl); if (u.protocol === "https:" && !u.username && !u.password && !u.port && !u.search && !u.hash) this.returnUrl = u; } catch { /* Fail closed. */ }
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), maxNetworkRetries: 0, timeout: 15_000 });
  }
  private account(r: { environment: "test" | "live"; accountFingerprint: string }) {
    return !!this.stripe && marketplaceCaptureAccount("stripe", r.environment, this.config.stripeSecret).accountFingerprint === r.accountFingerprint;
  }
  private async customer(r: { customerId: string; merchantId: string; environment: "test" | "live" }) {
    const c = await this.stripe!.customers.retrieve(r.customerId);
    return c.object === "customer" && c.id === r.customerId && !("deleted" in c && c.deleted) && "livemode" in c &&
      c.livemode === (r.environment === "live") && c.metadata?.merchant_id === r.merchantId;
  }
  private session(r: MarketplaceContributionCheckoutRequest, s: Stripe.Checkout.Session): MarketplaceContributionCheckoutObservation {
    if (s.object !== "checkout.session" || !/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(s.id) || s.mode !== "payment" ||
      s.livemode !== (r.environment === "live") || identifier(s.customer) !== r.customerId || s.currency !== "brl" ||
      s.amount_total !== r.grossAmountCents || s.amount_subtotal !== r.grossAmountCents || s.client_reference_id !== r.reference ||
      marketplaceContributionHash(s.metadata) !== marketplaceContributionHash(checkoutMetadata(r)) ||
      s.payment_method_types.length !== 1 || s.payment_method_types[0] !== "card" || s.subscription || s.setup_intent ||
      s.total_details?.amount_discount !== 0 || s.total_details?.amount_shipping !== 0 || s.total_details?.amount_tax !== 0 ||
      s.expires_at !== r.expiresAt) return unknownCheckout();
    const common = { sessionId: s.id, requestHash: r.requestHash, observedAt: new Date().toISOString(), session: structuredClone(s) };
    if (s.status === "complete" && s.payment_status === "paid" && /^pi_[A-Za-z0-9_]+$/.test(identifier(s.payment_intent) ?? ""))
      return { ...common, state: "paid", paymentIntentId: identifier(s.payment_intent)! };
    if (s.status === "expired" && s.payment_status === "unpaid") return { ...common, state: "expired" };
    const url = hostedUrl(s.url);
    if (s.status === "open" && s.payment_status === "unpaid" && url) return { ...common, state: "open", checkoutUrl: url };
    return unknownCheckout();
  }
  async submit(r: MarketplaceContributionCheckoutRequest): Promise<MarketplaceContributionCheckoutObservation> {
    try {
      if (!validContributionCheckout(r) || !this.account(r) || !this.returnUrl ||
        r.expiresAt < Math.floor(Date.now()/1000) + 1801 || r.expiresAt > Math.floor(Date.now()/1000) + 86400 || !await this.customer(r)) return unknownCheckout();
      const original=await this.originalSnapshot(r); let cursor:string|undefined,complete=false,total=0; const seen=new Set<string>();
      for(let n=0;n<20;n++){
        const page=await this.stripe!.refunds.list({charge:r.originalChargeId,limit:100,...(cursor?{starting_after:cursor}:{})});
        if(page.object!=="list"||!Array.isArray(page.data)||typeof page.has_more!=="boolean"||page.has_more&&!page.data.length)return unknownCheckout();
        for(const row of page.data){if(seen.has(row.id))return unknownCheckout();seen.add(row.id);const refund=await this.stripe!.refunds.retrieve(row.id);
          if(refund.id!==row.id||refund.object!=="refund"||refund.amount!==row.amount||refund.status!=="succeeded"||refund.currency!=="brl"||
            identifier(refund.charge)!==r.originalChargeId||identifier(refund.payment_intent)!==r.originalPaymentIntentId||!Number.isSafeInteger(refund.amount)||refund.amount<1)return unknownCheckout();total+=refund.amount;}
        if(!page.has_more){complete=true;break;}cursor=page.data.at(-1)!.id;
      }
      if(!complete||total!==r.originalRefundedAmountCents||!await this.customer(r)||marketplaceContributionHash(original)!==marketplaceContributionHash(await this.originalSnapshot(r)))return unknownCheckout();
      const returnUrl = new URL(this.returnUrl); returnUrl.searchParams.set("contribution_id", r.contributionId); returnUrl.hash="marketplace-contributions";
      const session = await this.stripe!.checkout.sessions.create({ mode: "payment", customer: r.customerId,
        payment_method_types: ["card"], client_reference_id: r.reference, metadata: checkoutMetadata(r),
        payment_intent_data: { metadata: checkoutMetadata(r) }, expires_at: r.expiresAt,
        success_url: returnUrl.toString(), cancel_url: returnUrl.toString(), allow_promotion_codes: false,
        automatic_tax: { enabled: false }, invoice_creation: { enabled: false },
        line_items: [{ quantity: 1, price_data: { currency: "brl", unit_amount: r.grossAmountCents,
          product_data: { name: "Aporte autorizado para taxa de devolução do marketplace" } } }] }, { idempotencyKey: r.reference });
      // No financial credit is inferred from this POST response.
      return this.session(r, session);
    } catch { return unknownCheckout(); }
  }
  private async originalSnapshot(r:MarketplaceContributionCheckoutRequest){
    const pi=await this.stripe!.paymentIntents.retrieve(r.originalPaymentIntentId),ch=await this.stripe!.charges.retrieve(r.originalChargeId);
    if(pi.object!=="payment_intent"||pi.id!==r.originalPaymentIntentId||pi.status!=="succeeded"||pi.amount!==r.originalAmountCents||pi.amount_received!==r.originalAmountCents||
      pi.currency!=="brl"||pi.livemode!==(r.environment==="live")||identifier(pi.latest_charge)!==r.originalChargeId||
      ch.object!=="charge"||ch.id!==r.originalChargeId||identifier(ch.payment_intent)!==pi.id||ch.amount!==r.originalAmountCents||ch.amount_captured!==r.originalAmountCents||
      ch.amount_refunded!==r.originalRefundedAmountCents||ch.currency!=="brl"||ch.livemode!==(r.environment==="live")||!ch.paid||!ch.captured||ch.disputed)throw Error("original");
    return {pi:pi.id,ch:ch.id,amount:ch.amount,refunded:ch.amount_refunded,disputed:ch.disputed};
  }
  async observe(r: MarketplaceContributionCheckoutRequest, sessionId?: string): Promise<MarketplaceContributionCheckoutObservation> {
    try {
      if (!validContributionCheckout(r) || !this.account(r) || !await this.customer(r)) return unknownCheckout();
      let found = sessionId;
      if (!found) {
        const seen = new Set<string>(), candidates: string[] = []; let cursor: string | undefined, complete = false;
        for (let n = 0; n < 20; n++) {
          const page = await this.stripe!.checkout.sessions.list({ customer: r.customerId, created: {
            gte: Math.floor(Date.parse(r.authorisedAt)/1000)-60, lte: r.expiresAt }, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
          if (page.object !== "list" || !Array.isArray(page.data) || typeof page.has_more !== "boolean" || page.has_more && !page.data.length) return unknownCheckout();
          for (const row of page.data) {
            if (!row.id || seen.has(row.id)) return unknownCheckout(); seen.add(row.id);
            if (row.client_reference_id === r.reference || row.metadata?.requestHash === r.requestHash) candidates.push(row.id);
          }
          if (!page.has_more) { complete = true; break; } cursor = page.data.at(-1)!.id;
        }
        if (!complete || candidates.length !== 1) return unknownCheckout(); found = candidates[0]!;
      }
      if (!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(found)) return unknownCheckout();
      const session = await this.stripe!.checkout.sessions.retrieve(found);
      if (session.id !== found || !await this.customer(r)) return unknownCheckout();
      return this.session(r, session);
    } catch { return unknownCheckout(); }
  }
  private async originalRefunded(r: MarketplaceContributionExcessRequest) {
    const old = await this.stripe!.charges.retrieve(r.certificate.request.originalChargeId);
    return old.object === "charge" && old.id === r.certificate.request.originalChargeId &&
      identifier(old.payment_intent) === r.certificate.request.originalPaymentIntentId && old.livemode === (r.environment === "live") &&
      old.currency === "brl" && old.amount === r.originalAmountCents && old.amount_captured === r.originalAmountCents &&
      old.amount_refunded === r.originalAmountCents && old.paid && old.captured && !old.disputed;
  }
  private async incoming(r: MarketplaceContributionExcessRequest, allowedRefundCents: number) {
    const request = r.certificate.request, pi = await this.stripe!.paymentIntents.retrieve(request.providerPaymentIntentId);
    if (pi.object !== "payment_intent" || pi.id !== request.providerPaymentIntentId || pi.status !== "succeeded" ||
      identifier(pi.latest_charge) !== r.certificate.proof.charge.id || identifier(pi.customer) !== request.customerId ||
      pi.amount !== request.grossAmountCents || pi.amount_received !== request.grossAmountCents || pi.currency !== "brl" ||
      pi.livemode !== (r.environment === "live") || pi.transfer_data || pi.on_behalf_of || pi.application_fee_amount !== null ||
      pi.payment_method_types.length !== 1 || pi.payment_method_types[0] !== "card" || pi.automatic_payment_methods?.enabled ||
      marketplaceContributionHash(pi.metadata) !== marketplaceContributionHash(marketplaceContributionMetadata(request))) throw Error("incoming");
    const ch = await this.stripe!.charges.retrieve(r.certificate.proof.charge.id);
    if (ch.object !== "charge" || ch.id !== r.certificate.proof.charge.id || identifier(ch.payment_intent) !== pi.id ||
      identifier(ch.customer) !== request.customerId || ch.amount !== request.grossAmountCents || ch.amount_captured !== request.grossAmountCents ||
      ch.amount_refunded !== allowedRefundCents || ch.disputed || !ch.paid || !ch.captured || ch.status !== "succeeded" ||
      ch.currency !== "brl" || ch.livemode !== (r.environment === "live") || ch.payment_method_details?.type !== "card" ||
      ch.transfer || ch.transfer_data || ch.application_fee || ch.application_fee_amount !== null || ch.on_behalf_of ||
      identifier(ch.balance_transaction) !== r.certificate.proof.balance.id) throw Error("incoming");
    const bt = await this.stripe!.balanceTransactions.retrieve(r.certificate.proof.balance.id);
    const frozen = r.certificate.proof.balance;
    if (bt.object !== "balance_transaction" || bt.id !== frozen.id || bt.source !== ch.id || bt.type !== "charge" || bt.currency !== "brl" ||
      bt.status !== "available" || bt.amount !== frozen.amountCents || bt.fee !== frozen.feeCents || bt.net !== frozen.netCents || bt.exchange_rate !== null) throw Error("balance");
  }
  private async refunds(r: MarketplaceContributionExcessRequest): Promise<Stripe.Refund[] | undefined> {
    const rows: Stripe.Refund[] = [], seen = new Set<string>(); let cursor: string | undefined;
    for (let n = 0; n < 20; n++) {
      const page = await this.stripe!.refunds.list({ charge: r.certificate.proof.charge.id, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      if (page.object !== "list" || !Array.isArray(page.data) || typeof page.has_more !== "boolean" || page.has_more && !page.data.length) return undefined;
      for (const row of page.data) { if (!/^re_[A-Za-z0-9_]+$/.test(row.id) || seen.has(row.id)) return undefined; seen.add(row.id);
        const refund = await this.stripe!.refunds.retrieve(row.id); if (refund.id !== row.id || refund.amount !== row.amount) return undefined; rows.push(refund); }
      if (!page.has_more) return rows; cursor = page.data.at(-1)!.id;
    }
    return undefined;
  }
  async submitExcess(r: MarketplaceContributionExcessRequest): Promise<MarketplaceContributionExcessObservation> {
    try {
      if (!validContributionExcess(r) || !this.account(r) || !await this.customer(r.certificate.request) || !await this.originalRefunded(r)) return unknownExcess();
      await this.incoming(r, 0); const refunds = await this.refunds(r);
      if (!refunds || refunds.length) return unknownExcess();
      await this.incoming(r, 0); if (!await this.originalRefunded(r) || !await this.customer(r.certificate.request)) return unknownExcess();
      const refund = await this.stripe!.refunds.create({ charge: r.certificate.proof.charge.id, amount: r.amountCents,
        metadata: excessMetadata(r) }, { idempotencyKey: r.reference });
      // Successful POST is still independently observed by GET before discharge.
      return refund.id && /^re_[A-Za-z0-9_]+$/.test(refund.id) ? { state: "pending", providerRefundId: refund.id } : unknownExcess();
    } catch { return unknownExcess(); }
  }
  async observeExcess(r: MarketplaceContributionExcessRequest, providerRefundId?: string): Promise<MarketplaceContributionExcessObservation> {
    try {
      if (!validContributionExcess(r) || !this.account(r) || !await this.customer(r.certificate.request) || !await this.originalRefunded(r)) return unknownExcess();
      const rows = await this.refunds(r); if (!rows || rows.length !== 1) return unknownExcess();
      const refund = rows[0]!;
      if (providerRefundId && refund.id !== providerRefundId || refund.object !== "refund" || refund.amount !== r.amountCents ||
        refund.currency !== "brl" || identifier(refund.charge) !== r.certificate.proof.charge.id ||
        identifier(refund.payment_intent) !== r.certificate.request.providerPaymentIntentId ||
        marketplaceContributionHash(refund.metadata) !== marketplaceContributionHash(excessMetadata(r))) return unknownExcess();
      if (refund.status === "pending" || refund.status === "requires_action") return { state: "pending", providerRefundId: refund.id };
      if (refund.status !== "succeeded") return { state: "failed", providerRefundId: refund.id };
      await this.incoming(r, r.amountCents);
      const btId = identifier(refund.balance_transaction); if (!btId) return unknownExcess();
      const bt = await this.stripe!.balanceTransactions.retrieve(btId);
      if (bt.object !== "balance_transaction" || bt.id !== btId || bt.source !== refund.id || bt.type !== "refund" ||
        bt.currency !== "brl" || bt.amount !== -r.amountCents || bt.fee !== 0 || bt.net !== -r.amountCents || bt.exchange_rate !== null ||
        bt.status !== "available" || !Number.isSafeInteger(bt.available_on) || bt.available_on*1000 > Date.now()+60_000) return unknownExcess();
      await this.incoming(r, r.amountCents); if (!await this.originalRefunded(r) || !await this.customer(r.certificate.request)) return unknownExcess();
      const proof:MarketplaceContributionExcessObservation={ state: "confirmed", providerRefundId: refund.id, amountCents: refund.amount, proof: { requestHash: r.requestHash,
        accountFingerprint: r.accountFingerprint, observedAt: new Date().toISOString(), refund: structuredClone(refund), balance: structuredClone(bt) } };
      return validContributionExcessProof(r,proof) ? proof : unknownExcess();
    } catch { return unknownExcess(); }
  }
}
