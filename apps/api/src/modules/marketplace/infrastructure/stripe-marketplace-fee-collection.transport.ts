import Stripe from "stripe";
import type { MarketplaceContributionCustomerProof, MarketplaceContributionCustomerScope } from "../domain/ports/marketplace-refund-contribution-journal.port.js";
import type { MarketplaceDisputeClosureProof, MarketplaceDisputeClosureRequest } from "../domain/ports/marketplace-dispute-closure.port.js";
import type { MarketplaceRefundContributionProof } from "../domain/ports/marketplace-refund-contribution.port.js";
import { marketplaceContributionHash } from "../domain/services/marketplace-refund-contribution.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";
import { MarketplaceRefundContributionAdapter } from "./marketplace-refund-contribution.adapter.js";
import { StripeMarketplaceDisputeClosureAdapter } from "./stripe-marketplace-dispute-closure.adapter.js";

export interface NativeFeeRequest extends MarketplaceContributionCustomerScope {
  disputeRequest: MarketplaceDisputeClosureRequest; collectionId: string; requestHash: string;
  reference: string; grossAmountCents: number; authorisedAt: string; expiresAt: number;
}
export interface NativeFeeIncomingProof extends Omit<MarketplaceRefundContributionProof, "request" | "paymentIntent"> {
  paymentIntent: Omit<MarketplaceRefundContributionProof["paymentIntent"], "metadata"> & { metadata: Record<string, string> };
  sessionId: string; requestHash: string;
}
export interface NativeFeeObservation<C> {
  state: "open" | "paid" | "expired" | "unknown"; sessionId?: string; paymentIntentId?: string; checkoutUrl?: string;
  observedAt?: string; requestHash?: string; session?: unknown; credit?: C;
}
export interface NativeFeeStrategy<R, C> {
  valid(request: R): boolean; metadata(request: R): Record<string, string>;
  session(request: R, session: unknown): NativeFeeObservation<C>;
  credit(request: R, proof: NativeFeeIncomingProof): C | undefined;
  originalFee(request: R, proof: MarketplaceDisputeClosureProof | undefined): boolean;
  returnHash: string; returnParameter: string;
}

const identifier = (v: unknown): string | undefined => typeof v === "string" ? v : v && typeof v === "object" && "id" in v && typeof v.id === "string" ? v.id : undefined;
const sessionIdValid = (v: string): boolean => /^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(v);
const unknown = (): { state: "unknown" } => ({ state: "unknown" });
type IncomingSnapshot = Pick<NativeFeeIncomingProof, "paymentIntent" | "charge" | "balance">;

/** The repository owns the durable one-submission claim. Only submit can create
 * a hosted payment; observation and recovery never repeat an uncertain POST. */
export class StripeMarketplaceFeeCollectionTransport<R extends NativeFeeRequest, C> {
  private readonly stripe?: Stripe;
  private readonly returnUrl?: URL;
  private readonly customers: MarketplaceRefundContributionAdapter;
  private readonly disputes: StripeMarketplaceDisputeClosureAdapter;

  constructor(private readonly config: { stripeSecret?: string; returnUrl: string }, request: typeof fetch, private readonly strategy: NativeFeeStrategy<R, C>) {
    // This is the configured dashboard origin, never a URL supplied by a seller.
    try {
      const u = new URL(config.returnUrl);
      if (u.protocol === "https:" && u.pathname === "/" && !u.username && !u.password && !u.port && !u.search && !u.hash) this.returnUrl = u;
    } catch { /* Missing or malformed dashboard configuration fails closed. */ }
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), maxNetworkRetries: 0, timeout: 15_000 });
    this.customers = new MarketplaceRefundContributionAdapter(config, request);
    this.disputes = new StripeMarketplaceDisputeClosureAdapter(config, request);
  }

  customer(scope: MarketplaceContributionCustomerScope): Promise<MarketplaceContributionCustomerProof | undefined> {
    return this.customers.readCustomerBinding(scope);
  }

  private account(r: R): boolean {
    return !!this.stripe && marketplaceCaptureAccount("stripe", r.environment, this.config.stripeSecret).accountFingerprint === r.accountFingerprint;
  }

  private async originalFee(r: R): Promise<boolean> {
    return this.strategy.originalFee(r, await this.disputes.read(r.disputeRequest) ?? undefined);
  }

  async submit(r: R): Promise<NativeFeeObservation<C>> {
    try {
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isSafeInteger(r.grossAmountCents) || r.grossAmountCents < 50 || r.grossAmountCents > 2147483647 ||
          !this.strategy.valid(r) || !this.account(r) || !this.returnUrl ||
          r.expiresAt < now + 1801 || r.expiresAt > now + 86400 || Date.parse(r.authorisedAt) > Date.now() + 60_000 ||
          !await this.customer(r) || !await this.originalFee(r) || !await this.customer(r)) return unknown();
      const returnUrl = new URL(this.returnUrl);
      returnUrl.searchParams.set(this.strategy.returnParameter, r.collectionId);
      returnUrl.hash = this.strategy.returnHash;
      const metadata = this.strategy.metadata(r);
      const session = await this.stripe!.checkout.sessions.create({ mode: "payment", customer: r.customerId,
        payment_method_types: ["card"], client_reference_id: r.reference, metadata,
        payment_intent_data: { metadata }, expires_at: r.expiresAt,
        success_url: returnUrl.toString(), cancel_url: returnUrl.toString(), allow_promotion_codes: false,
        automatic_tax: { enabled: false }, invoice_creation: { enabled: false },
        line_items: [{ quantity: 1, price_data: { currency: "brl", unit_amount: r.grossAmountCents,
          product_data: { name: "Pagamento autorizado da taxa de disputa do marketplace" } } }] }, { idempotencyKey: r.reference });
      // Even a paid POST response cannot certify an incoming balance or credit.
      return this.strategy.session(r, session);
    } catch { return unknown(); }
  }

  private async findSession(r: R): Promise<string | undefined> {
    const seen = new Set<string>(), candidates: string[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 20; n++) {
      const page = await this.stripe!.checkout.sessions.list({ customer: r.customerId,
        created: { gte: Math.floor(Date.parse(r.authorisedAt) / 1000) - 60, lte: r.expiresAt }, limit: 100,
        ...(cursor ? { starting_after: cursor } : {}) });
      if (page.object !== "list" || !Array.isArray(page.data) || page.data.length > 100 ||
          typeof page.has_more !== "boolean" || page.has_more && !page.data.length) return;
      for (const row of page.data) {
        if (!sessionIdValid(row.id) || seen.has(row.id)) return;
        seen.add(row.id);
        if (row.client_reference_id === r.reference || row.metadata?.requestHash === r.requestHash) candidates.push(row.id);
      }
      if (!page.has_more) return candidates.length === 1 ? candidates[0] : undefined;
      cursor = page.data.at(-1)!.id;
    }
    return;
  }

  private async incoming(r: R, paymentIntentId: string): Promise<IncomingSnapshot> {
    const pi = await this.stripe!.paymentIntents.retrieve(paymentIntentId), metadata = this.strategy.metadata(r);
    if (pi.object !== "payment_intent" || pi.id !== paymentIntentId || pi.id === r.disputeRequest.providerPaymentId ||
        pi.status !== "succeeded" || pi.amount !== r.grossAmountCents || pi.amount_received !== r.grossAmountCents || pi.amount_capturable !== 0 ||
        identifier(pi.customer) !== r.customerId || pi.currency !== "brl" || pi.livemode !== (r.environment === "live") ||
        marketplaceContributionHash(pi.metadata) !== marketplaceContributionHash(metadata) ||
        pi.payment_method_types?.length !== 1 || pi.payment_method_types[0] !== "card" || pi.automatic_payment_methods?.enabled ||
        pi.application_fee_amount !== null || pi.on_behalf_of !== null || pi.transfer_data !== null || pi.setup_future_usage != null) throw Error("unproven_incoming_payment");
    const chargeId = identifier(pi.latest_charge);
    if (!/^ch_[A-Za-z0-9_]+$/.test(chargeId ?? "") || chargeId === r.disputeRequest.sourceId) throw Error("unproven_incoming_charge");
    const ch = await this.stripe!.charges.retrieve(chargeId!);
    if (ch.object !== "charge" || ch.id !== chargeId || identifier(ch.payment_intent) !== pi.id || identifier(ch.customer) !== r.customerId ||
        ch.amount !== r.grossAmountCents || ch.amount_captured !== r.grossAmountCents || ch.currency !== "brl" || ch.livemode !== (r.environment === "live") ||
        ch.status !== "succeeded" || ch.paid !== true || ch.captured !== true || ch.disputed !== false || ch.refunded !== false || ch.amount_refunded !== 0 ||
        ch.payment_method_details?.type !== "card" || ch.transfer != null || ch.transfer_data != null || ch.application_fee != null || ch.on_behalf_of != null ||
        ch.application_fee_amount !== null || ch.refunds?.object !== "list" || ch.refunds.has_more !== false || !Array.isArray(ch.refunds.data) || ch.refunds.data.length) throw Error("unproven_incoming_charge");
    const balanceId = identifier(ch.balance_transaction);
    if (!/^txn_[A-Za-z0-9_]+$/.test(balanceId ?? "") || balanceId === r.disputeRequest.captureBalanceTransactionId) throw Error("unproven_incoming_balance");
    const bt = await this.stripe!.balanceTransactions.retrieve(balanceId!);
    if (bt.object !== "balance_transaction" || bt.id !== balanceId || identifier(bt.source) !== ch.id || bt.type !== "charge" || bt.status !== "available" ||
        bt.currency !== "brl" || bt.exchange_rate !== null || !Number.isSafeInteger(bt.available_on) || bt.available_on <= 0 ||
        bt.available_on * 1000 > Date.now() + 60_000 || bt.amount !== r.grossAmountCents || !Number.isSafeInteger(bt.fee) || bt.fee < 0 ||
        !Number.isSafeInteger(bt.net) || bt.net <= 0 || bt.amount - bt.fee !== bt.net) throw Error("unproven_incoming_balance");
    return {
      paymentIntent: { id: pi.id, status: "succeeded", amountCents: pi.amount, receivedAmountCents: pi.amount_received,
        currency: "BRL", environment: r.environment, customerId: r.customerId, latestChargeId: ch.id,
        applicationFeeCents: null, onBehalfOf: null, transferDestination: null, metadata: structuredClone(pi.metadata) },
      charge: { id: ch.id, paymentIntentId: pi.id, customerId: r.customerId, amountCents: ch.amount, paymentMethodType: "card", currency: "BRL",
        environment: r.environment, status: "succeeded", paid: true, captured: true, disputed: false, refundedAmountCents: 0,
        refundsComplete: true, refundIds: [], balanceTransactionId: bt.id, transferId: null, applicationFeeCents: null },
      balance: { id: bt.id, sourceId: ch.id, type: "charge", status: "available", currency: "BRL", amountCents: bt.amount, feeCents: bt.fee, netCents: bt.net },
    };
  }

  private async refundsCompleteAndEmpty(chargeId: string, paymentIntentId: string): Promise<boolean> {
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let n = 0; n < 20; n++) {
      const page = await this.stripe!.refunds.list({ charge: chargeId, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      if (page.object !== "list" || !Array.isArray(page.data) || page.data.length > 100 ||
          typeof page.has_more !== "boolean" || page.has_more && !page.data.length) return false;
      for (const listed of page.data) {
        if (!/^re_[A-Za-z0-9_]+$/.test(listed.id) || seen.has(listed.id)) return false;
        seen.add(listed.id);
        const exact = await this.stripe!.refunds.retrieve(listed.id);
        if (exact.object !== "refund" || exact.id !== listed.id || exact.amount !== listed.amount ||
            identifier(exact.charge) !== chargeId || identifier(exact.payment_intent) !== paymentIntentId) return false;
      }
      if (!page.has_more) return seen.size === 0; // Every refund attempt fences credit, including failed attempts.
      cursor = page.data.at(-1)!.id;
    }
    return false;
  }

  async observe(r: R, sessionId?: string): Promise<NativeFeeObservation<C>> {
    try {
      if (!this.strategy.valid(r) || !this.account(r) || !await this.customer(r)) return unknown();
      const found = sessionId === undefined ? await this.findSession(r) : sessionId;
      if (!found || !sessionIdValid(found)) return unknown();
      const beforeSession = await this.stripe!.checkout.sessions.retrieve(found);
      if (beforeSession.id !== found) return unknown();
      const observation = this.strategy.session(r, beforeSession);
      if (observation.state === "unknown") return unknown();
      if (observation.state !== "paid") return await this.customer(r) ? observation : unknown();
      const paymentIntentId = observation.paymentIntentId!;
      const before = await this.incoming(r, paymentIntentId);
      if (!await this.refundsCompleteAndEmpty(before.charge.id, paymentIntentId)) return unknown();
      const after = await this.incoming(r, paymentIntentId);
      if (marketplaceContributionHash(before) !== marketplaceContributionHash(after) ||
          !await this.refundsCompleteAndEmpty(after.charge.id, paymentIntentId)) return unknown();
      const afterSession = await this.stripe!.checkout.sessions.retrieve(found), final = this.strategy.session(r, afterSession);
      if (afterSession.id !== found || final.state !== "paid" || final.paymentIntentId !== paymentIntentId ||
          marketplaceContributionHash(beforeSession) !== marketplaceContributionHash(afterSession) || !await this.customer(r)) return unknown();
      const proof: NativeFeeIncomingProof = { provider: "stripe", requestHash: r.requestHash, sessionId: found,
        accountFingerprint: marketplaceCaptureAccount("stripe", r.environment, this.config.stripeSecret).accountFingerprint,
        observedAt: new Date().toISOString(), ...after };
      const credit = this.strategy.credit(r, proof);
      return credit ? { ...final, credit } : unknown();
    } catch { return unknown(); }
  }
}
