import { Inject, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CheckoutSession, CashbackCheckoutQuote, CashbackConfigurationWrite, CashbackDraft, CashbackPaymentBinding, CashbackProgramView, CashbackRules, CashbackWalletView } from "@zyon/shared-types";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { requiresPhysicalDelivery } from "../../checkout/domain/services/cart-fulfillment.js";
import { advance, allocate, cents, CashbackError, consume, earned, fingerprint, grantCredit, MAX_MONEY, release, reserve, restore, reverseGrant, shrinkReservation, validateRules, walletBalance, adjust, type CashbackOrderLine, type Wallet } from "../domain/cashback.js";
import { CASHBACK_REPOSITORY, type CashbackRepositoryPort, type CashbackTx, type EarningSnapshot, type QuoteRow } from "../domain/ports/cashback-repository.port.js";
import { cashbackCombinedLimit, validateCombination } from "../domain/cashback-combination.js";
import { CheckoutCommercialBenefitsService } from "./checkout-commercial-benefits.service.js";
import { cashbackMerchandiseBasis } from "../domain/cashback-merchandise.js";
import { buyerPhoneLookupHash } from "../../../shared/crypto/pii-cipher.service.js";
import { validateCashbackDraft } from "../domain/cashback-draft.js";

export interface CashbackRefundInput {
  merchantId: string; orderId: string; commandKey?: string;
  returnedItems?: Array<{ variantId: string; quantity: number }>; amountCents?: number;
  providerRefundId?: string;
}
export interface CashbackRefundPreview {
  cashbackRestoreCents: number; externalRefundCents: number; fullOrderReturn: boolean;
  cumulativeCashbackCents: number; cumulativeBaseCents: number; quantities: Record<string, number>;
}
const DAY = 86400000;
const zeroBinding = (): CashbackPaymentBinding => ({ cashbackCents: 0, reservationId: null, earningQuoteId: null });
function scope(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new CashbackError(`cashback_${name}_invalid`);
  return value;
}
function period(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find(x => x.type === "year")!.value}-${parts.find(x => x.type === "month")!.value}`;
}
function configurationRevision(program: CashbackProgramView): string {
  const { merchantId, status, version, updatedAt, draft, published } = program;
  return fingerprint({ merchantId, status, version, updatedAt, draft, published });
}
function validateConfigurationCommand(command: CashbackConfigurationWrite): void {
  if (!command || typeof command.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(command.expectedRevision)) throw new CashbackError("cashback_configuration_revision_required");
  scope(command.idempotencyKey, "idempotency_key");
}

@Injectable()
export class CashbackService {
  private readonly benefits: CheckoutCommercialBenefitsService;
  constructor(@Inject(CASHBACK_REPOSITORY) public readonly repository: CashbackRepositoryPort, @Optional() benefits?: CheckoutCommercialBenefitsService) {
    this.benefits = benefits ?? new CheckoutCommercialBenefitsService(repository);
  }

  /** Public navigation reads only the current program, without loading a wallet. */
  async isProgramEnabled(merchantId: string): Promise<boolean> {
    return this.repository.transaction(merchantId, async tx => {
      const program = await this.repository.program(tx, merchantId);
      return program.merchantId === merchantId && program.status === "active" && program.published != null;
    });
  }

  private async configurationView(tx: CashbackTx, merchantId: string, options: { includeGeneralCap?: boolean; includeConfigurationRevision?: boolean } = {}): Promise<CashbackProgramView> {
    const p = await this.repository.program(tx, merchantId);
    const view = options.includeGeneralCap || p.published?.combination || p.draft?.combination
      ? { ...p, generalDiscountCapBps: (await this.benefits.generalLimits(tx, merchantId)).generalDiscountCapBps } : p;
    return options.includeConfigurationRevision ? { ...view, configurationRevision: configurationRevision(p) } : view;
  }
  async getProgram(merchantId: string, options: { includeGeneralCap?: boolean; includeConfigurationRevision?: boolean } = {}) {
    return this.repository.transaction(merchantId, tx => this.configurationView(tx, merchantId, options));
  }
  async saveDraft(merchantId: string, input: CashbackDraft, actorId: string, command?: CashbackConfigurationWrite & { merge?: boolean }) {
    const draft = validateCashbackDraft(input);
    scope(actorId, "actor");
    if (command !== undefined) validateConfigurationCommand(command);
    if (command?.merge !== undefined && typeof command.merge !== "boolean") throw new CashbackError("cashback_draft_invalid");
    return this.repository.transaction(merchantId, async tx => {
      const save = async () => {
        const current = await this.repository.program(tx, merchantId);
        if (command && command.expectedRevision !== configurationRevision(current)) throw new CashbackError("cashback_configuration_changed", 409);
        const base = current.draft ?? current.published;
        const saved = command?.merge ? validateCashbackDraft({ ...base, ...draft,
          ...(draft.combination ? { combination: { ...base?.combination, ...draft.combination } } : {}) }) : draft;
        await tx.$executeRaw`INSERT INTO cashback_programs(merchant_id,draft) VALUES(${merchantId},${JSON.stringify(saved)}::jsonb)
          ON CONFLICT(merchant_id) DO UPDATE SET draft=EXCLUDED.draft,updated_at=now()`;
        return this.configurationView(tx, merchantId, { includeGeneralCap: !!command, includeConfigurationRevision: !!command });
      };
      return command ? this.repository.command(tx, merchantId, `configuration:draft:${fingerprint({ actorId, key: command.idempotencyKey })}`,
        { actorId, expectedRevision: command.expectedRevision, draft, merge: command.merge === true }, save) : save();
    });
  }
  async publishProgram(merchantId: string, actorId: string, options: { requireCombination?: boolean; command?: CashbackConfigurationWrite } = {}) {
    scope(actorId, "actor");
    if (options.command !== undefined) validateConfigurationCommand(options.command);
    return this.repository.transaction(merchantId, async tx => {
      const publish = async () => {
        const p = await this.repository.program(tx, merchantId);
        if (options.command && options.command.expectedRevision !== configurationRevision(p)) throw new CashbackError("cashback_configuration_changed", 409);
        const rules = validateRules(p.draft); const version = p.version + 1;
        if (options.requireCombination) validateCombination(rules.combination);
        await tx.$executeRaw`UPDATE cashback_programs SET published=${JSON.stringify(rules)}::jsonb,status='active',version=${version},updated_at=now() WHERE merchant_id=${merchantId}`;
        await tx.$executeRaw`INSERT INTO cashback_rule_versions(merchant_id,version,rules,actor_id) VALUES(${merchantId},${version},${JSON.stringify(rules)}::jsonb,${actorId})`;
        return this.configurationView(tx, merchantId, { includeGeneralCap: !!options.command, includeConfigurationRevision: !!options.command });
      };
      return options.command ? this.repository.command(tx, merchantId, `configuration:publish:${fingerprint({ actorId, key: options.command.idempotencyKey })}`,
        { actorId, expectedRevision: options.command.expectedRevision, requireCombination: options.requireCombination === true }, publish) : publish();
    });
  }
  async pauseProgram(merchantId: string, actorId: string, end = false) {
    scope(actorId, "actor");
    return this.repository.transaction(merchantId, async tx => {
      const status = end ? "ended" : "paused";
      await tx.$executeRaw`INSERT INTO cashback_programs(merchant_id,status) VALUES(${merchantId},${status})
        ON CONFLICT(merchant_id) DO UPDATE SET status=EXCLUDED.status,updated_at=now()`;
      return this.repository.program(tx, merchantId);
    });
  }

  /** This entry point accepts only the durable proof produced by authenticated phone OTP. */
  async linkVerifiedIdentity(input: { merchantId: string; previousBuyerId: string; canonicalBuyerId: string; verificationId: string }) {
    return this.repository.transaction(input.merchantId, tx => this.linkIdentity(tx, input));
  }
  private async linkIdentity(tx: CashbackTx, input: { merchantId: string; previousBuyerId: string; canonicalBuyerId: string; verificationId: string }) {
    const { merchantId, previousBuyerId, canonicalBuyerId, verificationId } = input;
    [previousBuyerId, canonicalBuyerId, verificationId].forEach(v => scope(v, "identity"));
    if (previousBuyerId === canonicalBuyerId) return { linked: true, buyerId: canonicalBuyerId };
    const aliases = await tx.$queryRaw<Array<{ canonical_buyer_id: string }>>`SELECT canonical_buyer_id FROM cashback_buyer_aliases WHERE merchant_id=${merchantId} AND alias_buyer_id=${previousBuyerId}`;
    if (aliases[0]) {
      if (aliases[0].canonical_buyer_id !== canonicalBuyerId) throw new CashbackError("cashback_identity_already_bound", 409);
      return { linked: true, buyerId: canonicalBuyerId };
    }
    const proof = await tx.$queryRaw<Array<{ phone: string }>>`SELECT vp.phone FROM buyer_verified_phones vp
      JOIN buyer_accounts b ON b.global_user_id=vp.buyer_id
      JOIN buyer_identities bi ON bi.merchant_id=${merchantId} AND bi.identity_key=('phone:' || vp.phone) AND bi.global_user_id=${previousBuyerId}
      WHERE vp.verification_id=${verificationId} AND vp.buyer_id=${canonicalBuyerId}`;
    if (!proof[0]) throw new CashbackError("cashback_verified_identity_proof_required", 403);
    // The native hub can materialize an anonymous phone identity as an account.
    // Independent credentials or a registered email still require review.
    const otherAccount = await tx.$queryRaw<Array<{ id: string; email: string; password_hash: string | null; phone_lookup_hash: string | null }>>`
      SELECT global_user_id AS id,email,to_jsonb(b)->>'password_hash' AS password_hash,
        to_jsonb(b)->>'phone_lookup_hash' AS phone_lookup_hash
      FROM buyer_accounts b WHERE global_user_id=${previousBuyerId} FOR UPDATE`;
    if (otherAccount[0]) {
      const account = otherAccount[0];
      const phoneOnly = account.email === `phone_${proof[0].phone}@buyer.aacp` && account.password_hash === null
        && account.phone_lookup_hash !== null && account.phone_lookup_hash === buyerPhoneLookupHash(proof[0].phone);
      if (!phoneOnly) throw new CashbackError("cashback_account_merge_requires_review", 409);
      const credentials = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM webauthn_credentials WHERE global_user_id=${previousBuyerId} LIMIT 1`;
      if (credentials.length) throw new CashbackError("cashback_account_merge_requires_review", 409);
    }
    const destinationAlias = await tx.$queryRaw<Array<{ id: string }>>`SELECT alias_buyer_id AS id FROM cashback_buyer_aliases WHERE merchant_id=${merchantId} AND alias_buyer_id=${canonicalBuyerId}`;
    if (destinationAlias.length) throw new CashbackError("cashback_identity_alias_chain_forbidden", 409);
    const empty = walletBalance({ merchantId, buyerId: canonicalBuyerId, grants: [], reservations: [], entries: [] });
    await tx.$executeRaw`INSERT INTO cashback_wallets(merchant_id,buyer_id,balance) VALUES(${merchantId},${canonicalBuyerId},${JSON.stringify(empty)}::jsonb) ON CONFLICT(merchant_id,buyer_id) DO NOTHING`;
    await tx.$executeRaw`UPDATE cashback_grants SET buyer_id=${canonicalBuyerId} WHERE merchant_id=${merchantId} AND buyer_id=${previousBuyerId}`;
    await tx.$executeRaw`UPDATE cashback_reservations SET buyer_id=${canonicalBuyerId} WHERE merchant_id=${merchantId} AND buyer_id=${previousBuyerId}`;
    await tx.$executeRaw`UPDATE cashback_earning_quotes SET buyer_id=${canonicalBuyerId} WHERE merchant_id=${merchantId} AND buyer_id=${previousBuyerId}`;
    await tx.$executeRaw`INSERT INTO cashback_buyer_aliases(merchant_id,alias_buyer_id,canonical_buyer_id,verification_id) VALUES(${merchantId},${previousBuyerId},${canonicalBuyerId},${verificationId})`;
    await tx.$executeRaw`UPDATE cashback_wallets SET balance=${JSON.stringify(empty)}::jsonb,updated_at=now() WHERE merchant_id=${merchantId} AND buyer_id=${previousBuyerId}`;
    await tx.$executeRaw`UPDATE buyer_identities SET global_user_id=${canonicalBuyerId} WHERE merchant_id=${merchantId} AND identity_key=${`phone:${proof[0].phone}`} AND global_user_id=${previousBuyerId}`;
    // A charge or private checkout authority keeps its original buyer. Wallet
    // alias resolution already maps that buyer to the verified canonical wallet.
    await tx.$executeRaw`UPDATE checkout_sessions cs SET global_user_id=${canonicalBuyerId}
      WHERE cs.merchant_id=${merchantId} AND cs.global_user_id=${previousBuyerId}
        AND NOT EXISTS(SELECT 1 FROM payment_intents p WHERE p.merchant_id=cs.merchant_id AND p.session_id=cs.session_id)
        AND NOT EXISTS(SELECT 1 FROM completed_orders o WHERE o.merchant_id=cs.merchant_id AND o.session_id=cs.session_id)
        AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(cs.cart) AS field(key) WHERE left(field.key,1)='_')`;
    const w = await this.loadWallet(tx, merchantId, canonicalBuyerId); await this.repository.saveWallet(tx, w);
    return { linked: true, buyerId: canonicalBuyerId };
  }
  private async canonicalBuyer(tx: CashbackTx, merchantId: string, buyerId: string): Promise<string> {
    // Lazy repair handles a crash after the phone proof committed but before channel linking.
    const incoming = await tx.$queryRaw<Array<{ previous_buyer_id: string; verification_id: string }>>`SELECT bi.global_user_id AS previous_buyer_id,vp.verification_id FROM buyer_verified_phones vp
      JOIN buyer_identities bi ON bi.merchant_id=${merchantId} AND bi.identity_key=('phone:' || vp.phone)
      WHERE vp.buyer_id=${buyerId} AND bi.global_user_id<>${buyerId}`;
    for (const row of incoming) await this.linkIdentity(tx, { merchantId, previousBuyerId: row.previous_buyer_id, canonicalBuyerId: buyerId, verificationId: row.verification_id });
    const alias = await tx.$queryRaw<Array<{ canonical_buyer_id: string }>>`SELECT canonical_buyer_id FROM cashback_buyer_aliases WHERE merchant_id=${merchantId} AND alias_buyer_id=${buyerId}`;
    if (alias[0]) return alias[0].canonical_buyer_id;
    const outgoing = await tx.$queryRaw<Array<{ buyer_id: string; verification_id: string }>>`SELECT vp.buyer_id,vp.verification_id FROM buyer_identities bi
      JOIN buyer_verified_phones vp ON bi.identity_key=('phone:' || vp.phone)
      WHERE bi.merchant_id=${merchantId} AND bi.global_user_id=${buyerId} AND vp.buyer_id<>${buyerId}`;
    if (new Set(outgoing.map(x => x.buyer_id)).size > 1) throw new CashbackError("cashback_identity_ambiguous", 409);
    if (outgoing[0]) {
      await this.linkIdentity(tx, { merchantId, previousBuyerId: buyerId, canonicalBuyerId: outgoing[0].buyer_id, verificationId: outgoing[0].verification_id });
      return outgoing[0].buyer_id;
    }
    return buyerId;
  }

  private async buyerForSession(tx: CashbackTx, session: CheckoutSession): Promise<string | null> {
    const id = session.globalUserId;
    if (!id) return null;
    const rows = await tx.$queryRaw<Array<{ global_user_id: string; cart: CheckoutSession["cart"]; shipping: CheckoutSession["shipping"] }>>`
      SELECT global_user_id,cart,shipping FROM checkout_sessions WHERE merchant_id=${session.merchantId} AND session_id=${session.sessionId}`;
    const persisted = rows[0];
    const canonical = await this.canonicalBuyer(tx, session.merchantId, id);
    const persistedCanonical = persisted ? await this.canonicalBuyer(tx, session.merchantId, persisted.global_user_id) : null;
    if (!persisted || persistedCanonical !== canonical || paymentCartFingerprint({ cart: persisted.cart, shipping: persisted.shipping }) !== paymentCartFingerprint(session)) {
      throw new CashbackError("cashback_session_changed", 409);
    }
    const verified = await tx.$queryRaw<Array<{ valid: boolean }>>`SELECT (
      EXISTS(SELECT 1 FROM buyer_accounts WHERE global_user_id=${canonical}) OR
      EXISTS(SELECT 1 FROM whatsapp_sessions ws JOIN buyer_identities bi ON bi.merchant_id=ws.merchant_id
        AND bi.identity_key=('phone:' || regexp_replace(ws.buyer_phone,'[^0-9]','','g'))
        WHERE ws.merchant_id=${session.merchantId} AND ws.checkout_session_id=${session.sessionId} AND bi.global_user_id=${canonical})
      ) AS valid`;
    return verified[0]?.valid ? canonical : null;
  }

  private amounts(session: CheckoutSession): { base: number; shipping: number; discount: number; gross: number; eligible: boolean; reason: string | null; lines: CashbackOrderLine[] } {
    const items = session.cart.items;
    const reason = session.cart.currency.toUpperCase() !== "BRL" ? "cashback_brl_only" : session.cart.commerceCartRef ? "cashback_external_cart_not_supported"
      : !items.length ? "cashback_empty_cart" : items.some(i => i.marketplace) ? "cashback_cross_merchant_not_supported" : null;
    const weights = items.map(i => {
      if (!Number.isSafeInteger(i.quantity) || i.quantity < 1 || !Number.isFinite(i.price) || i.price < 0) throw new CashbackError("cashback_cart_invalid");
      return cents(Math.round(i.price * 100) * i.quantity, "cart");
    });
    const subtotal = cents(weights.reduce((a, b) => a + b, 0), "cart");
    const discount = cents(Math.round((session.cart.currentDiscount ?? 0) * 100), "discount");
    if (discount > subtotal) throw new CashbackError("cashback_discount_invalid");
    const basis = cashbackMerchandiseBasis(session.cart);
    const shipping = requiresPhysicalDelivery(session.cart) ? cents(Math.round((session.shipping?.customerPrice ?? 0) * 100), "shipping") : 0;
    const discounts = allocate(discount, weights);
    const lines = items.map((item, i) => ({ key: item.sku, variantId: item.variantId ?? item.sku, quantity: item.quantity,
      grossCents: weights[i]!, discountCents: discounts[i]!, cashbackCents: 0 }));
    return { gross: basis.grossCents, discount: basis.promotionDiscountCents + discount, shipping,
      base: basis.netProductsCents, eligible: !reason, reason, lines };
  }
  private async loadWallet(tx: CashbackTx, merchantId: string, buyerId: string): Promise<Wallet> {
    const w = await this.repository.wallet(tx, merchantId, buyerId); advance(w, new Date()); return w;
  }
  private async quote(tx: CashbackTx, session: CheckoutSession): Promise<CashbackCheckoutQuote> {
    const p = await this.repository.program(tx, session.merchantId); const a = this.amounts(session);
    const buyerId = await this.buyerForSession(tx, session);
    const w = buyerId ? await this.loadWallet(tx, session.merchantId, buyerId) : null;
    let reservation = w?.reservations.find(r => r.sessionId === session.sessionId && ["reserved", "payment_pending"].includes(r.state));
    const rules = p.published;
    const context = rules?.combination ? await this.benefits.context(tx, session) : null;
    let reboundReservation = false;
    if (w && reservation?.state === "reserved") {
      if (context && rules) {
        const limit = cashbackCombinedLimit({ grossCents: a.gross, netProductsCents: a.base, availableCents: walletBalance(w).availableCents + reservation.amountCents, rules, context });
        const previousFingerprint = reservation.fingerprint;
        shrinkReservation(w, reservation.id, a.eligible ? limit.maximumCashbackCents : 0, paymentCartFingerprint(session), new Date());
        reboundReservation = reservation.fingerprint !== previousFingerprint;
        if (!["reserved", "payment_pending"].includes(reservation.state)) reservation = undefined;
      } else if (reservation.fingerprint !== paymentCartFingerprint(session)) {
        release(w, reservation.id, new Date()); reservation = undefined;
      }
    }
    const stale = reservation && reservation.fingerprint !== paymentCartFingerprint(session);
    const hasDiscount = a.discount > 0 || Boolean(session.cart.commercialNudge);
    const available = w ? walletBalance(w).availableCents : 0;
    const reservedCents = reservation?.amountCents ?? 0;
    const combined = rules && context ? cashbackCombinedLimit({ grossCents: a.gross, netProductsCents: a.base, availableCents: available + reservedCents, rules, context }) : null;
    const reason = a.reason ?? (!buyerId ? "cashback_verified_identity_required" : !rules ? "cashback_disabled"
      : combined?.reason ? combined.reason : !combined && !rules.allowWithDiscounts && hasDiscount ? "cashback_combination_not_allowed" : stale ? "cashback_cart_changed" : null);
    let maximum = !reason && rules && a.base >= rules.minimumRedeemOrderCents
      ? combined?.maximumCashbackCents ?? Math.min(available + reservedCents, Number(BigInt(a.base) * BigInt(rules.maximumRedeemBps) / 10000n), rules.maximumRedeemCents ?? MAX_MONEY) : 0;
    maximum = Math.max(0, maximum);
    let estimate = !reason && p.status === "active" && rules ? earned(a.base, reservedCents, rules) : 0;
    if (estimate && rules) estimate = await this.remainingBudget(tx, session.merchantId, buyerId!, rules, estimate, period(new Date()));
    if (w && (w.entries.length || reboundReservation)) await this.repository.saveWallet(tx, w);
    return { merchantId: session.merchantId, sessionId: session.sessionId, programActive: p.status === "active", eligible: !reason,
      reason, availableCents: available, maximumRedeemCents: maximum, reservedCents,
      estimatedEarnCents: estimate, ruleVersion: rules ? p.version : null, fingerprint: paymentCartFingerprint(session), terms: rules?.terms ?? null };
  }
  async quoteCheckout(session: CheckoutSession) { return this.repository.transaction(session.merchantId, tx => this.quote(tx, session)); }
  /** Presentation only. Payment authorization still uses preparePayment/bindPayment. */
  async checkoutCashbackCents(session: CheckoutSession): Promise<number> {
    return this.repository.transaction(session.merchantId, async tx => {
      const p = await this.repository.program(tx, session.merchantId); if (!p.published) return 0;
      if (p.published.combination) await this.quote(tx, session);
      const buyerId = await this.buyerForSession(tx, session); if (!buyerId) return 0;
      const w = await this.loadWallet(tx, session.merchantId, buyerId);
      const current = w.reservations.filter(r => r.sessionId === session.sessionId && r.state !== "released").at(-1);
      let amount = 0;
      if (current?.state === "reserved" && current.fingerprint !== paymentCartFingerprint(session)) release(w, current.id, new Date());
      else if (current && (current.state === "payment_pending" || current.fingerprint === paymentCartFingerprint(session))) amount = current.amountCents;
      if (w.entries.length) await this.repository.saveWallet(tx, w); return amount;
    });
  }
  async reserveCheckout(session: CheckoutSession, amountCents: number, commandKey: string) {
    scope(commandKey, "idempotency_key");
    return this.repository.transaction(session.merchantId, async tx => {
      const buyerId = await this.buyerForSession(tx, session); if (!buyerId) throw new CashbackError("cashback_verified_identity_required", 401);
      await this.repository.command(tx, session.merchantId, `reserve:${commandKey}`, { buyerId, sessionId: session.sessionId, amountCents, fingerprint: paymentCartFingerprint(session) }, async () => {
        const q = await this.quote(tx, session); if (!q.eligible) throw new CashbackError(q.reason ?? "cashback_not_eligible", 409);
        const w = await this.loadWallet(tx, session.merchantId, buyerId);
        // The replacement reservation may reuse the credit currently held by this checkout.
        const r = reserve(w, { sessionId: session.sessionId, fingerprint: q.fingerprint, amountCents, maximumCents: q.maximumRedeemCents }, new Date());
        await this.repository.saveWallet(tx, w); return { reservationId: r.id };
      });
      return this.quote(tx, session);
    });
  }
  async releaseReservation(session: CheckoutSession, commandKey = `remove:${session.sessionId}`) {
    scope(commandKey, "idempotency_key");
    return this.repository.transaction(session.merchantId, async tx => {
      const buyerId = await this.buyerForSession(tx, session); if (!buyerId) throw new CashbackError("cashback_verified_identity_required", 401);
      await this.repository.command(tx, session.merchantId, `remove:${commandKey}`, { buyerId, sessionId: session.sessionId }, async () => {
        const w = await this.loadWallet(tx, session.merchantId, buyerId);
        for (const r of w.reservations.filter(r => r.sessionId === session.sessionId && ["reserved", "payment_pending"].includes(r.state))) release(w, r.id, new Date());
        await this.repository.saveWallet(tx, w); return { removed: true };
      });
      return this.quote(tx, session);
    });
  }

  private async remainingBudget(tx: CashbackTx, merchantId: string, buyerId: string, rules: CashbackRules, requested: number, month: string): Promise<number> {
    const budget = await tx.$queryRaw<Array<{ committed_cents: bigint; issued_cents: bigint }>>`SELECT committed_cents,issued_cents FROM cashback_budget_periods WHERE merchant_id=${merchantId} AND period=${month}`;
    const usage = await tx.$queryRaw<Array<{ cents: bigint }>>`SELECT COALESCE(SUM((data->>'earnCents')::bigint),0)::bigint AS cents FROM cashback_earning_quotes WHERE merchant_id=${merchantId} AND buyer_id=${buyerId} AND data->>'period'=${month} AND state IN ('prepared','bound','confirmed')`;
    return Math.max(0, Math.min(requested,
      rules.monthlyBudgetCents === null ? MAX_MONEY : rules.monthlyBudgetCents - Number(budget[0]?.committed_cents ?? 0) - Number(budget[0]?.issued_cents ?? 0),
      rules.buyerMonthlyEarnLimitCents === null ? MAX_MONEY : rules.buyerMonthlyEarnLimitCents - Number(usage[0]?.cents ?? 0)));
  }
  async preparePayment(session: CheckoutSession, paymentKey: string): Promise<CashbackPaymentBinding> {
    scope(paymentKey, "payment_key");
    return this.repository.transaction(session.merchantId, async tx => {
      const buyerId = await this.buyerForSession(tx, session);
      const old = await this.repository.quote(tx, session.merchantId, session.sessionId, paymentKey);
      const hash = paymentCartFingerprint(session);
      if (old) {
        if (old.fingerprint !== hash || old.buyer_id !== buyerId) throw new CashbackError("cashback_payment_input_mismatch", 409);
        if (old.state === "failed") throw new CashbackError("cashback_payment_retry_requires_new_key", 409);
        return { cashbackCents: old.data.cashbackCents, reservationId: old.data.reservationId, earningQuoteId: old.id };
      }
      const p = await this.repository.program(tx, session.merchantId);
      if (!buyerId) return zeroBinding();
      const q = await this.quote(tx, session);
      const w = await this.loadWallet(tx, session.merchantId, buyerId);
      const r = w.reservations.find(r => r.sessionId === session.sessionId && ["reserved", "payment_pending"].includes(r.state));
      const active = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM cashback_earning_quotes WHERE merchant_id=${session.merchantId} AND session_id=${session.sessionId} AND state IN ('prepared','bound')`;
      if (active.length || r?.state === "payment_pending") throw new CashbackError("cashback_payment_in_progress", 409);
      const a = this.amounts(session);
      if (r && (!q.eligible || r.fingerprint !== hash || r.amountCents > q.maximumRedeemCents)) throw new CashbackError("cashback_reservation_changed", 409);
      const used = r?.amountCents ?? 0;
      const rules = p.published;
      const month = period(new Date());
      let earnCents = q.eligible && p.status === "active" && rules ? earned(a.base, used, rules) : 0;
      if (earnCents && rules) earnCents = await this.remainingBudget(tx, session.merchantId, buyerId, rules, earnCents, month);
      if (!used && !earnCents) { if (w.entries.length) await this.repository.saveWallet(tx, w); return zeroBinding(); }
      const cashbackAlloc = allocate(used, a.lines.map(l => l.grossCents - l.discountCents));
      const lines = a.lines.map((l, i) => ({ ...l, cashbackCents: cashbackAlloc[i]! }));
      const data: EarningSnapshot = { rules, ruleVersion: p.version, earnCents, baseCents: a.base - used, cashbackCents: used,
        reservationId: r?.id ?? null, period: month, orderTotalCents: a.base - used + a.shipping, lines,
        returnedQuantities: {}, refundedCashbackCents: 0, refundedExternalCents: 0, externalCapturedCents: null, platformFeeCents: 0,
        paymentSession: { merchantId: session.merchantId, sessionId: session.sessionId, globalUserId: buyerId, cart: session.cart, shipping: session.shipping },
        ...(rules?.combination ? { combinationContext: await this.benefits.context(tx, session) } : {}) };
      if (r) { r.state = "payment_pending"; r.paymentKey = paymentKey; }
      await this.repository.saveWallet(tx, w);
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO cashback_earning_quotes(id,merchant_id,buyer_id,session_id,payment_key,fingerprint,state,data) VALUES(${id},${session.merchantId},${buyerId},${session.sessionId},${paymentKey},${hash},'prepared',${JSON.stringify(data)}::jsonb)`;
      if (earnCents) await tx.$executeRaw`INSERT INTO cashback_budget_periods(merchant_id,period,committed_cents) VALUES(${session.merchantId},${month},${earnCents}) ON CONFLICT(merchant_id,period) DO UPDATE SET committed_cents=cashback_budget_periods.committed_cents+EXCLUDED.committed_cents`;
      return { cashbackCents: used, reservationId: r?.id ?? null, earningQuoteId: id };
    });
  }
  async bindPayment(merchantId: string, sessionId: string, paymentKey: string, intentId: string,
    expected?: { earningQuoteId?: string; reservationId?: string; cashbackCents?: number }) {
    return this.repository.transaction(merchantId, async tx => {
      const q = await this.repository.quote(tx, merchantId, sessionId, paymentKey);
      if (!q) {
        if (expected) throw new CashbackError("cashback_payment_binding_invalid", 409);
        return;
      }
      if (expected && (expected.earningQuoteId !== undefined && expected.earningQuoteId !== q.id
        || expected.reservationId !== undefined && expected.reservationId !== q.data.reservationId
        || expected.cashbackCents !== undefined && expected.cashbackCents !== q.data.cashbackCents)) {
        throw new CashbackError("cashback_payment_binding_invalid", 409);
      }
      if (q.state === "failed" || (q.payment_intent_id && q.payment_intent_id !== intentId)) throw new CashbackError("cashback_payment_binding_conflict", 409);
      const rows = await tx.$queryRaw<Array<{ session_id: string; idempotency_key: string; amount_cents: number; amount_breakdown: { cashbackCents?: number; cashbackEarningQuoteId?: string; cartFingerprint?: string; platformFeeCents: number } }>>`SELECT session_id,idempotency_key,amount_cents,amount_breakdown FROM payment_intents WHERE merchant_id=${merchantId} AND id=${intentId}`;
      const p = rows[0];
      if (!p || p.session_id !== sessionId || p.idempotency_key !== paymentKey || (p.amount_breakdown?.cashbackCents ?? 0) !== q.data.cashbackCents || p.amount_breakdown.cashbackEarningQuoteId !== q.id || p.amount_breakdown.cartFingerprint !== q.fingerprint || p.amount_cents !== q.data.orderTotalCents + p.amount_breakdown.platformFeeCents) throw new CashbackError("cashback_payment_binding_invalid", 409);
      if (q.state === "confirmed") return;
      q.state = "bound"; q.payment_intent_id = intentId; q.data.externalCapturedCents = p.amount_cents; q.data.platformFeeCents = p.amount_breakdown.platformFeeCents;
      const w = await this.repository.wallet(tx, merchantId, q.buyer_id);
      const r = w.reservations.find(r => r.id === q.data.reservationId); if (r) r.paymentIntentId = intentId;
      await this.repository.saveWallet(tx, w); await this.repository.updateQuote(tx, q);
    });
  }
  async confirmedPayment(input: { merchantId: string; paymentIntentId: string; session: CheckoutSession; orderId: string; orderTotalCents: number }) {
    return this.repository.transaction(input.merchantId, async tx => {
      const canonical = await this.canonicalBuyer(tx, input.merchantId, input.session.globalUserId);
      const rows = await tx.$queryRaw<QuoteRow[]>`SELECT * FROM cashback_earning_quotes WHERE merchant_id=${input.merchantId} AND payment_intent_id=${input.paymentIntentId}`;
      const q = rows[0]; if (!q) return { grantedCents: 0, usedCents: 0 };
      return this.repository.command(tx, input.merchantId, `confirm:${input.paymentIntentId}`, { orderId: input.orderId, total: input.orderTotalCents }, async () => {
        const payments = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM payment_intents WHERE merchant_id=${input.merchantId} AND id=${input.paymentIntentId}`;
        if (payments[0]?.status !== "approved" || q.buyer_id !== canonical || q.fingerprint !== paymentCartFingerprint(input.session) || q.data.orderTotalCents !== input.orderTotalCents || q.state !== "bound") throw new CashbackError("cashback_payment_not_confirmed", 409);
        const orders = await tx.$queryRaw<Array<{ fulfilled_at: Date | null; completed_at: Date; order_total: string }>>`SELECT fulfilled_at,completed_at,order_total FROM completed_orders WHERE merchant_id=${input.merchantId} AND session_id=${q.session_id} AND (id=${input.orderId} OR external_order_id=${input.orderId})`;
        const completedOrder = orders[0];
        if (!completedOrder || Math.round(Number(completedOrder.order_total) * 100) !== input.orderTotalCents || !Number.isFinite(completedOrder.completed_at?.getTime())) throw new CashbackError("cashback_completed_order_fact_required", 409);
        const w = await this.loadWallet(tx, input.merchantId, q.buyer_id); const now = new Date();
        if (q.data.reservationId) consume(w, q.data.reservationId, input.orderId, now);
        if (q.data.earnCents && q.data.rules) {
          let availableAt: string | null = q.data.rules.releaseTrigger === "payment_confirmed" ? new Date(completedOrder.completed_at.getTime() + q.data.rules.releaseDelayDays * DAY).toISOString() : null;
          if (!availableAt) {
            if (completedOrder.fulfilled_at) availableAt = new Date(completedOrder.fulfilled_at.getTime() + q.data.rules.releaseDelayDays * DAY).toISOString();
          }
          grantCredit(w, { orderId: input.orderId, amountCents: q.data.earnCents, eligibleBaseCents: q.data.baseCents, rules: q.data.rules, ruleVersion: q.data.ruleVersion, lines: q.data.lines, availableAt }, now);
          await tx.$executeRaw`UPDATE cashback_budget_periods SET committed_cents=committed_cents-${q.data.earnCents},issued_cents=issued_cents+${q.data.earnCents} WHERE merchant_id=${input.merchantId} AND period=${q.data.period}`;
        }
        (q.data as EarningSnapshot & { orderId: string }).orderId = input.orderId;
        q.state = "confirmed"; advance(w, now); await this.repository.saveWallet(tx, w); await this.repository.updateQuote(tx, q);
        return { grantedCents: q.data.earnCents, usedCents: q.data.cashbackCents };
      });
    });
  }
  private async failQuote(tx: CashbackTx, q: QuoteRow) {
    if (!["prepared", "bound"].includes(q.state)) return;
    const w = await this.repository.wallet(tx, q.merchant_id, q.buyer_id);
    if (q.data.reservationId) release(w, q.data.reservationId, new Date(), true);
    q.state = "failed";
    if (q.data.earnCents) await tx.$executeRaw`UPDATE cashback_budget_periods SET committed_cents=committed_cents-${q.data.earnCents} WHERE merchant_id=${q.merchant_id} AND period=${q.data.period}`;
    await this.repository.saveWallet(tx, w); await this.repository.updateQuote(tx, q);
  }
  async failedPayment(input: { merchantId: string; paymentIntentId: string }) {
    return this.repository.transaction(input.merchantId, async tx => {
      const rows = await tx.$queryRaw<QuoteRow[]>`SELECT q.* FROM cashback_earning_quotes q JOIN payment_intents p ON p.id=q.payment_intent_id AND p.merchant_id=q.merchant_id WHERE q.merchant_id=${input.merchantId} AND q.payment_intent_id=${input.paymentIntentId} AND p.status IN ('failed','cancelled','expired')`;
      if (rows[0]) await this.failQuote(tx, rows[0]);
    });
  }

  /** Compensates a provider-confirmed full refund/lost dispute; never invokes a PSP. */
  async confirmedExternalRefund(input: { merchantId: string; paymentIntentId: string }): Promise<{ restoredCents: number; reversedCents: number }> {
    const next = await this.repository.transaction(input.merchantId, async tx => {
      const rows = await tx.$queryRaw<Array<QuoteRow & { payment_status: string }>>`SELECT q.*,p.status AS payment_status FROM payment_intents p
        JOIN cashback_earning_quotes q ON q.merchant_id=p.merchant_id AND (q.payment_intent_id=p.id OR (q.payment_intent_id IS NULL AND q.session_id=p.session_id AND q.payment_key=p.idempotency_key))
        WHERE p.merchant_id=${input.merchantId} AND p.id=${input.paymentIntentId}`;
      const q = rows[0];
      if (!q || !["refunded", "chargeback_lost"].includes(q.payment_status) || q.state === "failed") return null;
      q.buyer_id = await this.canonicalBuyer(tx, input.merchantId, q.buyer_id);
      if (q.state !== "confirmed") {
        // The capture was reversed before cashback completion. No purchase gain
        // is due, and its held credit can be returned without recording a spend.
        await this.repository.command(tx, input.merchantId, `provider-terminal-before-confirm:${input.paymentIntentId}`, { paymentIntentId: input.paymentIntentId }, async () => {
          await this.failQuote(tx, q); return { releasedCents: q.data.cashbackCents };
        });
        return null;
      }
      return { orderId: (q.data as EarningSnapshot & { orderId: string }).orderId };
    });
    if (!next) return { restoredCents: 0, reversedCents: 0 };
    return this.processRefundOrder({ merchantId: input.merchantId, orderId: next.orderId, commandKey: `provider-full-refund:${input.paymentIntentId}` });
  }

  private async quoteForOrder(tx: CashbackTx, merchantId: string, orderId: string): Promise<QuoteRow | undefined> {
    const rows = await tx.$queryRaw<QuoteRow[]>`SELECT q.* FROM cashback_earning_quotes q WHERE q.merchant_id=${merchantId} AND q.state='confirmed' AND
      (q.data->>'orderId'=${orderId} OR EXISTS(SELECT 1 FROM completed_orders o WHERE o.merchant_id=q.merchant_id AND o.session_id=q.session_id AND (o.id=${orderId} OR o.external_order_id=${orderId}))) ORDER BY q.created_at DESC LIMIT 1`;
    return rows[0];
  }
  private refundPreview(q: QuoteRow, input: CashbackRefundInput): CashbackRefundPreview {
    const lines = q.data.lines; const quantities = { ...q.data.returnedQuantities };
    const groups = new Map<string, { quantity: number; gross: number; discount: number; cashback: number }>();
    for (const l of lines) {
      const g = groups.get(l.variantId) ?? { quantity: 0, gross: 0, discount: 0, cashback: 0 };
      g.quantity += l.quantity; g.gross += l.grossCents; g.discount += l.discountCents; g.cashback += l.cashbackCents; groups.set(l.variantId, g);
    }
    if (input.returnedItems?.length) {
      if (new Set(input.returnedItems.map(x => x.variantId)).size !== input.returnedItems.length) throw new CashbackError("cashback_refund_items_invalid");
      for (const item of input.returnedItems) {
        const g = groups.get(item.variantId); if (!g || !Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new CashbackError("cashback_refund_items_invalid");
        quantities[item.variantId] = (quantities[item.variantId] ?? 0) + item.quantity;
        if (quantities[item.variantId]! > g.quantity) throw new CashbackError("cashback_refund_quantity_exceeded", 409);
      }
    } else {
      if (input.amountCents !== undefined && input.amountCents !== q.data.orderTotalCents && input.amountCents !== q.data.externalCapturedCents) throw new CashbackError("cashback_refund_items_required");
      for (const [id, g] of groups) quantities[id] = g.quantity;
    }
    for (const [id, group] of groups) {
      const returned = quantities[id] ?? 0;
      if (returned === 0 || returned === group.quantity) continue;
      const matching = lines.filter(line => line.variantId === id); const first = matching[0]!;
      const ambiguous = matching.some(line => (["grossCents", "discountCents", "cashbackCents"] as const).some(key =>
        BigInt(line[key]) * BigInt(first.quantity) !== BigInt(first[key]) * BigInt(line.quantity)));
      if (ambiguous) throw new CashbackError("cashback_refund_items_ambiguous");
    }
    let totalCashback = 0; let totalBase = 0; let cumulativeExternalItems = 0; let orderedQty = 0; let returnedQty = 0;
    for (const [id, g] of groups) {
      const qty = quantities[id] ?? 0; orderedQty += g.quantity; returnedQty += qty;
      totalCashback += Number(BigInt(g.cashback) * BigInt(qty) / BigInt(g.quantity));
      totalBase += Number(BigInt(g.gross - g.discount - g.cashback) * BigInt(qty) / BigInt(g.quantity));
      cumulativeExternalItems += Number(BigInt(g.gross - g.discount - g.cashback) * BigInt(qty) / BigInt(g.quantity));
    }
    const productsExternal = lines.reduce((s, l) => s + l.grossCents - l.discountCents - l.cashbackCents, 0);
    const shipping = q.data.orderTotalCents - productsExternal;
    const cumulativeExternal = returnedQty === orderedQty ? (q.data.externalCapturedCents ?? q.data.orderTotalCents)
      : cumulativeExternalItems + (orderedQty ? Number(BigInt(shipping) * BigInt(returnedQty) / BigInt(orderedQty)) : 0);
    return { cashbackRestoreCents: totalCashback - q.data.refundedCashbackCents, externalRefundCents: cumulativeExternal - q.data.refundedExternalCents,
      fullOrderReturn: returnedQty === orderedQty, cumulativeCashbackCents: totalCashback, cumulativeBaseCents: totalBase, quantities };
  }
  async previewRefundOrder(input: CashbackRefundInput): Promise<CashbackRefundPreview | null> {
    return this.repository.transaction(input.merchantId, async tx => {
      const q = await this.quoteForOrder(tx, input.merchantId, input.orderId); return q ? this.refundPreview(q, input) : null;
    });
  }
  private refundFingerprint(input: CashbackRefundInput, orderId: string, expectedExternalCents: number): string {
    return fingerprint({ orderId, returnedItems: input.returnedItems?.map(x => ({ variantId: x.variantId, quantity: x.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId)) ?? null,
      amountCents: input.amountCents ?? null, expectedExternalCents });
  }
  async claimRefundOrder(input: CashbackRefundInput & { commandKey: string }, expectedExternalCents: number): Promise<{ claimed: boolean }> {
    scope(input.commandKey, "refund_key"); cents(expectedExternalCents);
    return this.repository.transaction(input.merchantId, async tx => {
      const q = await this.quoteForOrder(tx, input.merchantId, input.orderId); if (!q) return { claimed: true };
      const orderId = (q.data as EarningSnapshot & { orderId: string }).orderId;
      const hash = this.refundFingerprint(input, orderId, expectedExternalCents);
      const existing = await tx.$queryRaw<Array<{ fingerprint: string; state: string }>>`SELECT fingerprint,state FROM cashback_refund_operations WHERE merchant_id=${input.merchantId} AND command_key=${input.commandKey}`;
      if (existing[0]) {
        if (existing[0].fingerprint !== hash) throw new CashbackError("cashback_refund_idempotency_mismatch", 409);
        return { claimed: false };
      }
      const pending = await tx.$queryRaw<Array<{ command_key: string }>>`SELECT command_key FROM cashback_refund_operations WHERE merchant_id=${input.merchantId} AND order_id=${orderId} AND state='submitted' AND command_key<>${input.commandKey}`;
      if (pending.length) throw new CashbackError("cashback_refund_in_progress", 409);
      const preview = this.refundPreview(q, input);
      if (preview.externalRefundCents !== expectedExternalCents) throw new CashbackError("cashback_refund_quote_changed", 409);
      await tx.$executeRaw`INSERT INTO cashback_refund_operations(merchant_id,command_key,order_id,fingerprint,amount_cents,state) VALUES(${input.merchantId},${input.commandKey},${orderId},${hash},${expectedExternalCents},'submitted')`;
      return { claimed: true };
    });
  }
  async refundProviderFailed(input: { merchantId: string; orderId: string; commandKey: string }): Promise<void> {
    scope(input.commandKey, "refund_key");
    await this.repository.transaction(input.merchantId, async tx => {
      const q = await this.quoteForOrder(tx, input.merchantId, input.orderId); if (!q) return;
      const orderId = (q.data as EarningSnapshot & { orderId: string }).orderId;
      await tx.$executeRaw`UPDATE cashback_refund_operations SET state='failed',updated_at=now() WHERE merchant_id=${input.merchantId} AND order_id=${orderId} AND command_key=${input.commandKey} AND state='submitted'`;
    });
  }
  async processRefundOrder(input: CashbackRefundInput & { commandKey: string }) {
    scope(input.commandKey, "refund_key");
    return this.repository.transaction(input.merchantId, tx => this.repository.command(tx, input.merchantId, `refund:${input.commandKey}`, { orderId: input.orderId, returnedItems: input.returnedItems ?? null, amountCents: input.amountCents ?? null }, async () => {
      const q = await this.quoteForOrder(tx, input.merchantId, input.orderId); if (!q) return { restoredCents: 0, reversedCents: 0 };
      const preview = this.refundPreview(q, input); const w = await this.loadWallet(tx, input.merchantId, q.buyer_id);
      const orderId = (q.data as EarningSnapshot & { orderId: string }).orderId;
      const pending = await tx.$queryRaw<Array<{ command_key: string }>>`SELECT command_key FROM cashback_refund_operations WHERE merchant_id=${input.merchantId} AND order_id=${orderId} AND state='submitted' AND command_key<>${input.commandKey}`;
      if (pending.length) throw new CashbackError("cashback_refund_in_progress", 409);
      const own = await tx.$queryRaw<Array<{ amount_cents: bigint }>>`SELECT amount_cents FROM cashback_refund_operations WHERE merchant_id=${input.merchantId} AND command_key=${input.commandKey} AND order_id=${orderId}`;
      if (own[0] && Number(own[0].amount_cents) !== preview.externalRefundCents) throw new CashbackError("cashback_refund_quote_changed", 409);
      const now = new Date(); const restoredCents = restore(w, orderId, preview.cumulativeCashbackCents, now);
      const reversedCents = reverseGrant(w, orderId, preview.cumulativeBaseCents, now);
      q.data.returnedQuantities = preview.quantities; q.data.refundedCashbackCents = preview.cumulativeCashbackCents;
      q.data.refundedExternalCents += preview.externalRefundCents;
      await this.repository.saveWallet(tx, w); await this.repository.updateQuote(tx, q);
      const hash = this.refundFingerprint(input, orderId, preview.externalRefundCents);
      await tx.$executeRaw`INSERT INTO cashback_refund_operations(merchant_id,command_key,order_id,fingerprint,amount_cents,state,provider_refund_id) VALUES(${input.merchantId},${input.commandKey},${orderId},${hash},${preview.externalRefundCents},'completed',${input.providerRefundId ?? null})
        ON CONFLICT(merchant_id,command_key) DO UPDATE SET state='completed',provider_refund_id=COALESCE(EXCLUDED.provider_refund_id,cashback_refund_operations.provider_refund_id),updated_at=now()`;
      return { restoredCents, reversedCents };
    }));
  }
  async wallet(merchantId: string, buyerId: string): Promise<CashbackWalletView> {
    scope(buyerId, "buyer");
    return this.repository.transaction(merchantId, async tx => {
      buyerId = await this.canonicalBuyer(tx, merchantId, buyerId);
      const p = await this.repository.program(tx, merchantId); const w = await this.loadWallet(tx, merchantId, buyerId);
      if (w.entries.length) await this.repository.saveWallet(tx, w);
      return { merchantId, buyerId, currency: "BRL", balance: walletBalance(w), program: { status: p.status, version: p.version, published: p.published } };
    });
  }
  async adjustWallet(merchantId: string, buyerId: string, input: { amountCents: number; reason: string; idempotencyKey: string; expiryDays: number | null }, actorId: string) {
    if (!input || typeof input !== "object") throw new CashbackError("cashback_adjustment_invalid");
    scope(input.idempotencyKey, "idempotency_key"); scope(actorId, "actor"); scope(buyerId, "buyer");
    if (input.amountCents > 0 && input.expiryDays === undefined) throw new CashbackError("cashback_expiry_policy_required");
    await this.repository.transaction(merchantId, async tx => {
      buyerId = await this.canonicalBuyer(tx, merchantId, buyerId);
      return this.repository.command(tx, merchantId, `adjust:${input.idempotencyKey}`, { buyerId, ...input, actorId }, async () => {
      const w = await this.loadWallet(tx, merchantId, buyerId); adjust(w, input.amountCents, input.reason, actorId, input.expiryDays, new Date());
      await this.repository.saveWallet(tx, w); return { adjusted: true };
      });
    });
    return this.wallet(merchantId, buyerId);
  }
  async reconcile(merchantId?: string): Promise<{ processed: number; issues: Array<{ merchantId: string; code: string; reference: string }> }> {
    const result = { processed: 0, issues: [] as Array<{ merchantId: string; code: string; reference: string }> };
    const merchants = merchantId ? [{ merchant_id: merchantId }] : await this.repository.prisma.$queryRaw<Array<{ merchant_id: string }>>`
      SELECT merchant_id FROM cashback_wallets UNION SELECT merchant_id FROM cashback_earning_quotes ORDER BY merchant_id`;
    for (const m of merchants) {
      try {
        let quoteCursor = "";
        for (;;) {
          const quotes = await this.repository.prisma.$queryRaw<QuoteRow[]>`SELECT q.* FROM cashback_earning_quotes q WHERE q.merchant_id=${m.merchant_id} AND q.id>${quoteCursor}
            AND (q.state IN ('prepared','bound') OR (q.state='confirmed'
              AND EXISTS(SELECT 1 FROM payment_intents p WHERE p.merchant_id=q.merchant_id AND p.id=q.payment_intent_id AND p.status IN ('refunded','chargeback_lost'))
              AND NOT EXISTS(SELECT 1 FROM cashback_event_receipts r WHERE r.merchant_id=q.merchant_id AND r.command_key=('refund:provider-full-refund:' || q.payment_intent_id)))) ORDER BY q.id LIMIT 100`;
          if (!quotes.length) break;
          for (const q of quotes) {
            try {
              const ps = await this.repository.prisma.$queryRaw<Array<{ id: string; status: string }>>`SELECT id,status FROM payment_intents WHERE merchant_id=${m.merchant_id} AND session_id=${q.session_id} AND idempotency_key=${q.payment_key}`;
              const p = ps[0];
              if (p && ["refunded", "chargeback_lost"].includes(p.status)) {
                await this.confirmedExternalRefund({ merchantId: m.merchant_id, paymentIntentId: p.id }); result.processed++;
              } else if ((!p && q.created_at.getTime() < Date.now() - 15 * 60000) || (p && ["failed", "cancelled", "expired"].includes(p.status))) {
                await this.repository.transaction(m.merchant_id, async tx => {
                  const current = await this.repository.quote(tx, m.merchant_id, q.session_id, q.payment_key);
                  // Re-read the provider intent while holding the financial lock.
                  const currentPayments = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM payment_intents WHERE merchant_id=${m.merchant_id} AND session_id=${q.session_id} AND idempotency_key=${q.payment_key}`;
                  if (current && ((!currentPayments[0] && current.created_at.getTime() < Date.now() - 15 * 60000) || (currentPayments[0] && ["failed", "cancelled", "expired"].includes(currentPayments[0].status)))) await this.failQuote(tx, current);
                });
                result.processed++;
              } else if (p?.status === "approved") {
                const orders = await this.repository.prisma.$queryRaw<Array<{ external_order_id: string; order_total: string }>>`SELECT external_order_id,order_total FROM completed_orders WHERE merchant_id=${m.merchant_id} AND session_id=${q.session_id} AND status NOT IN ('cancelled','refunded') ORDER BY completed_at LIMIT 1`;
                const order = orders[0];
                if (order && q.data.paymentSession) {
                  await this.bindPayment(m.merchant_id, q.session_id, q.payment_key, p.id);
                  const snapshot = { ...q.data.paymentSession, globalUserId: q.buyer_id } as CheckoutSession;
                  await this.confirmedPayment({ merchantId: m.merchant_id, paymentIntentId: p.id, session: snapshot, orderId: order.external_order_id, orderTotalCents: Math.round(Number(order.order_total) * 100) });
                  result.processed++;
                } else result.issues.push({ merchantId: m.merchant_id, code: "cashback_approved_order_snapshot_missing", reference: q.id });
              } else if (q.created_at.getTime() < Date.now() - DAY) result.issues.push({ merchantId: m.merchant_id, code: "cashback_payment_requires_reconciliation", reference: q.id });
            } catch (error) { result.issues.push({ merchantId: m.merchant_id, code: error instanceof Error ? error.message : "cashback_quote_reconciliation_failed", reference: q.id }); }
          }
          quoteCursor = quotes[quotes.length - 1]!.id;
        }
        let buyerCursor = "";
        for (;;) {
          const buyers = await this.repository.prisma.$queryRaw<Array<{ buyer_id: string }>>`SELECT buyer_id FROM cashback_wallets w WHERE merchant_id=${m.merchant_id} AND buyer_id>${buyerCursor} AND NOT EXISTS(SELECT 1 FROM cashback_buyer_aliases a WHERE a.merchant_id=w.merchant_id AND a.alias_buyer_id=w.buyer_id) ORDER BY buyer_id LIMIT 100`;
          if (!buyers.length) break;
          for (const b of buyers) {
            try {
              await this.repository.transaction(m.merchant_id, async tx => {
                const canonical = await this.canonicalBuyer(tx, m.merchant_id, b.buyer_id);
                const w = await this.repository.wallet(tx, m.merchant_id, canonical);
                const projection = await tx.$queryRaw<Array<{ balance: unknown }>>`SELECT balance FROM cashback_wallets WHERE merchant_id=${m.merchant_id} AND buyer_id=${canonical}`;
                const balance = walletBalance(w);
                if (projection[0] && fingerprint(projection[0].balance) !== fingerprint(balance)) result.issues.push({ merchantId: m.merchant_id, code: "cashback_wallet_projection_divergence", reference: canonical });
                const facts = await tx.$queryRaw<Array<{ original: bigint; used: bigint; reserved: bigint; reversed: bigint }>>`SELECT
                  COALESCE(SUM(CASE WHEN e.type='grant' OR (e.type='adjustment' AND e.amount_cents>0) THEN e.amount_cents ELSE 0 END),0)::bigint AS original,
                  COALESCE(SUM(CASE WHEN e.type='redeem' THEN e.amount_cents WHEN e.type='restore' THEN -e.amount_cents ELSE 0 END),0)::bigint AS used,
                  COALESCE(SUM(CASE WHEN e.type='reserve' THEN e.amount_cents WHEN e.type IN ('unreserve','redeem') THEN -e.amount_cents ELSE 0 END),0)::bigint AS reserved,
                  COALESCE(SUM(CASE WHEN e.type='reverse' THEN e.amount_cents WHEN e.type='adjustment' AND e.amount_cents<0 THEN -e.amount_cents ELSE 0 END),0)::bigint AS reversed
                  FROM cashback_ledger_entries e LEFT JOIN cashback_buyer_aliases a ON a.merchant_id=e.merchant_id AND a.alias_buyer_id=e.buyer_id
                  WHERE e.merchant_id=${m.merchant_id} AND COALESCE(a.canonical_buyer_id,e.buyer_id)=${canonical}`;
                const fact = facts[0]!;
                if (Number(fact.original) !== balance.earnedCents || Number(fact.used) !== balance.usedCents || Number(fact.reserved) !== balance.reservedCents || Number(fact.reversed) !== balance.reversedCents) {
                  result.issues.push({ merchantId: m.merchant_id, code: "cashback_ledger_lot_divergence", reference: canonical }); return;
                }
                for (const g of w.grants.filter(g => g.pendingCents > 0 && !g.availableAt)) {
                  const orders = await tx.$queryRaw<Array<{ fulfilled_at: Date | null }>>`SELECT fulfilled_at FROM completed_orders WHERE merchant_id=${m.merchant_id} AND (id=${g.orderId} OR external_order_id=${g.orderId})`;
                  if (orders[0]?.fulfilled_at) g.availableAt = new Date(orders[0].fulfilled_at.getTime() + g.rules.releaseDelayDays * DAY).toISOString();
                }
                advance(w, new Date()); await this.repository.saveWallet(tx, w);
              }); result.processed++;
            } catch (error) { result.issues.push({ merchantId: m.merchant_id, code: error instanceof Error ? error.message : "cashback_wallet_reconciliation_failed", reference: b.buyer_id }); }
          }
          buyerCursor = buyers[buyers.length - 1]!.buyer_id;
        }
      } catch (error) { result.issues.push({ merchantId: m.merchant_id, code: error instanceof Error ? error.message : "cashback_reconciliation_failed", reference: m.merchant_id }); }
    }
    return result;
  }
}
