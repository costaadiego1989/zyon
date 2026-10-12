import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { Cart, CheckoutSession } from "@zyon/shared-types";
import { marketplacePaymentCartFingerprint, paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import type { PaymentIntentSnapshot } from "../../../payment/domain/payment-intent.entity.js";
import type { MarketplaceCaptureEvidence } from "../../domain/ports/marketplace-capture-provider.port.js";
import { buildMarketplaceFundingBudget, type FrozenMarketplaceFunding } from "../../domain/services/marketplace-funding-budget.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";
import { marketplacePaymentOptions } from "./marketplace-payment-options.js";
import { bindMarketplacePaymentStock } from "./marketplace-payment-stock.js";
import { assertMarketplaceShippingSelection } from "./marketplace-shipping-selection.js";

export type { FrozenMarketplaceFunding } from "../../domain/services/marketplace-funding-budget.js";
export type FundingBudget = ReturnType<typeof buildMarketplaceFundingBudget>;
const json = (value: unknown) => value as Prisma.InputJsonValue;
// PostgreSQL jsonb reorders object keys. Hash canonical values, not insertion order.
export function fundingHash(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, canonical(v[key])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export async function lockMarketplaceOrder(tx: Prisma.TransactionClient, host: string, order: string) {
  const key = JSON.stringify(["marketplace-order", host, order]);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}

/** Runs in the same transaction as the very first payment-intent insert. */
export async function freezeMarketplaceFunding(tx: Prisma.TransactionClient, snapshot: PaymentIntentSnapshot) {
  const input = snapshot.creation?.input, instructions = input?.marketplaceFunding;
  if (!instructions) return;
  if (snapshot.creation?.state !== "ready" || snapshot.providerPaymentId || snapshot.status !== "pending" ||
      instructions.hostMerchantId !== snapshot.merchantId || input.provider !== instructions.provider ||
      input.providerAccountFingerprint !== instructions.accountFingerprint || instructions.amountCents !== snapshot.amountCents ||
      snapshot.currency !== "BRL" || input.stripeConnectAccountId || input.merchantPayoutDestination || input.settlementMode) {
    throw new ConflictException("marketplace_funding_creation_mismatch");
  }
  new SettlementStateMachineService().validateConfig(instructions.hostTerms);
  // Before capture, the fee is unknown. Zero is validation only, never persisted as evidence.
  buildMarketplaceFundingBudget(instructions, { ...instructions, providerPaymentId: "validation", sourceId: "validation",
    providerFeeCents: 0, netAmountCents: instructions.amountCents });
  // Session writers also acquire this row lock when saving. Read only after it,
  // so a concurrent edit cannot leave admission using an obsolete snapshot.
  await tx.$queryRaw`SELECT session_id FROM checkout_sessions WHERE merchant_id = ${snapshot.merchantId}
    AND session_id = ${snapshot.sessionId} FOR UPDATE`;
  const checkout = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: {
    merchantId: snapshot.merchantId, sessionId: snapshot.sessionId,
  } } });
  if (!checkout) throw new ConflictException("marketplace_funding_checkout_missing");
  const cart = checkout.cart as unknown as Cart;
  const quote = { cart, shipping: checkout.shipping as unknown as CheckoutSession["shipping"],
    customer: checkout.customer as unknown as CheckoutSession["customer"] };
  if ((snapshot.amountBreakdown?.cartFingerprint && snapshot.amountBreakdown.cartFingerprint !== paymentCartFingerprint(quote)) ||
    (instructions.checkoutFingerprint && instructions.checkoutFingerprint !== marketplacePaymentCartFingerprint(quote))) {
    throw new ConflictException("marketplace_funding_checkout_changed");
  }
  const cartRef = (cart as Cart & { cart_ref?: string }).cart_ref ?? snapshot.sessionId;
  const key = JSON.stringify(["storefront-cart", snapshot.merchantId, cartRef]);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
  if (await tx.marketplaceFundingPlan.findFirst({ where: { hostMerchantId: snapshot.merchantId, checkoutSessionId: cartRef } })) {
    throw new ConflictException("marketplace_checkout_payment_already_bound");
  }
  const records = await tx.crossStoreLineItem.findMany({ where: { hostMerchantId: snapshot.merchantId, checkoutSessionId: cartRef } });
  if (cart.currentDiscount || cart.commercialNudge || cart.commerceCartRef || instructions.lines.length !== cart.items.length || !records.length) {
    throw new ConflictException("marketplace_funding_cart_mismatch");
  }
  const expected = cart.items.map(item => ({ lineItemId: item.marketplace?.lineItemId ?? `host:${item.sku}`,
    sellerMerchantId: item.marketplace?.sourceMerchantId ?? snapshot.merchantId,
    grossAmountCents: Math.round(item.price * 100) * item.quantity, commissionCents: item.marketplace?.commissionCents ?? 0 }));
  if (new Set(expected.map(row => row.lineItemId)).size !== expected.length || expected.some(row => {
    const line = instructions.lines.find(l => l.lineItemId === row.lineItemId);
    return !line || Object.entries(row).some(([key, value]) => (line as any)[key] !== value);
  }) || records.length !== expected.filter(row => row.sellerMerchantId !== snapshot.merchantId).length || records.some(record => {
    const line = expected.find(row => row.lineItemId === record.id);
    const item = cart.items.find(row => row.marketplace?.lineItemId === record.id);
    return !line || record.orderId || record.sellerMerchantId !== line.sellerMerchantId ||
      !item || item.variantId !== record.sourceVariantId || item.quantity !== record.quantity ||
      record.quantity * record.unitPriceCents !== line.grossAmountCents || record.commissionCents !== line.commissionCents || !record.termsJson;
  })) throw new ConflictException("marketplace_funding_cart_mismatch");
  const shipping = checkout.shipping as { customerPrice?: number; marketplace?: unknown } | null;
  const physical = await tx.productVariant.findFirst({ where: {
    OR: cart.items.map(item => ({ id: item.variantId ?? "", product: {
      merchantId: item.marketplace?.sourceMerchantId ?? snapshot.merchantId, type: { notIn: ["digital", "service"] },
    } })),
  }, select: { id: true } });
  if (instructions.shipping.reduce((sum, row) => sum + row.amountCents, 0) !== Math.round((shipping?.customerPrice ?? 0) * 100)) {
    throw new ConflictException("marketplace_funding_shipping_mismatch");
  }
  if (physical || instructions.shippingQuotes !== undefined || shipping?.marketplace !== undefined) {
    const selected = await assertMarketplaceShippingSelection(tx, { merchantId: snapshot.merchantId, sessionId: snapshot.sessionId, ...quote });
    if (fundingHash(selected.quotes) !== fundingHash(instructions.shippingQuotes) ||
        fundingHash(selected.allocations) !== fundingHash(instructions.shipping)) {
      throw new ConflictException("marketplace_funding_shipping_mismatch");
    }
  } else if (instructions.shipping.length || (shipping?.customerPrice ?? 0) !== 0) {
    // A nonzero browser scalar never establishes who is owed the freight.
    throw new ConflictException("marketplace_funding_shipping_quote_required");
  }
  const option = (await marketplacePaymentOptions(tx, snapshot.merchantId, records.map(row => row.sellerMerchantId)))
    .find(row => row.provider === instructions.provider && row.environment === instructions.environment);
  if (!option || option.destinations.some(row => !instructions.destinations.some(dest =>
    row.merchantId === dest.merchantId && row.destination === dest.destination))) throw new ConflictException("marketplace_funding_destination_mismatch");
  await tx.marketplaceFundingPlan.create({ data: { paymentIntentId: snapshot.id, hostMerchantId: snapshot.merchantId,
    checkoutSessionId: cartRef, provider: instructions.provider, environment: instructions.environment,
    accountFingerprint: instructions.accountFingerprint, amountCents: instructions.amountCents,
    instructions: json(instructions), instructionsHash: fundingHash(instructions) } });
  await bindMarketplacePaymentStock(tx, snapshot.id, records, instructions, cart);
}

/** Each seller line retains its return identity; freight goes to its first stable line. */
export function fundingTransferAllocations(instructions: FrozenMarketplaceFunding, budget: FundingBudget) {
  const rows = budget.lines.filter(line => line.sellerMerchantId !== instructions.hostMerchantId)
    .sort((a, b) => a.lineItemId < b.lineItemId ? -1 : 1).map(line => ({ lineItemId: line.lineItemId,
      merchantId: line.sellerMerchantId, amountCents: line.sellerNetCents, kind: "seller_settlement" }));
  for (const beneficiary of budget.beneficiaries) {
    if (beneficiary.merchantId === instructions.hostMerchantId) continue;
    const row = rows.find(row => row.merchantId === beneficiary.merchantId)!;
    row.amountCents += beneficiary.shippingCents;
  }
  const host = budget.beneficiaries.find(row => row.merchantId === instructions.hostMerchantId)!;
  return [...rows, ...(host.amountCents ? [{ lineItemId: null, merchantId: host.merchantId, amountCents: host.amountCents, kind: "host_receivable" }] : [])];
}

@Injectable()
export class PrismaMarketplaceFundingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async pendingForOrder(hostMerchantId: string, providerPaymentId: string) {
    return this.prisma.marketplaceFundingPlan.findFirst({ where: { hostMerchantId, status: "awaiting_capture",
      payment: { providerPaymentId, status: "approved" } }, include: { payment: true } });
  }

  async pending(limit = 100) {
    return this.prisma.marketplaceFundingPlan.findMany({ where: { status: "awaiting_capture", payment: { status: "approved", providerPaymentId: { not: null } } },
      include: { payment: true }, orderBy: [{ updatedAt: "asc" }, { paymentIntentId: "asc" }], take: Math.min(100, Math.max(1, limit)) });
  }

  async defer(paymentIntentId: string) {
    await this.prisma.marketplaceFundingPlan.updateMany({ where: { paymentIntentId, status: "awaiting_capture" }, data: { updatedAt: new Date() } });
  }

  async fund(paymentIntentId: string, capture: MarketplaceCaptureEvidence) {
    return this.prisma.$transaction(async tx => {
      const initial = await tx.marketplaceFundingPlan.findUniqueOrThrow({ where: { paymentIntentId } });
      await lockMarketplaceOrder(tx, initial.hostMerchantId, capture.providerPaymentId);
      await tx.$queryRaw`SELECT payment_intent_id FROM marketplace_funding_plans WHERE payment_intent_id = ${paymentIntentId} FOR UPDATE`;
      const plan = await tx.marketplaceFundingPlan.findUniqueOrThrow({ where: { paymentIntentId }, include: { payment: true } });
      const instructions = plan.instructions as unknown as FrozenMarketplaceFunding;
      const input = (plan.payment.creation as unknown as { input?: { marketplaceFunding?: FrozenMarketplaceFunding } })?.input;
      if (fundingHash(instructions) !== plan.instructionsHash || fundingHash(input?.marketplaceFunding) !== plan.instructionsHash ||
          plan.payment.providerPaymentId !== capture.providerPaymentId || plan.payment.amountCents !== plan.amountCents) {
        throw new ConflictException("marketplace_funding_identity_mismatch");
      }
      const budget = buildMarketplaceFundingBudget(instructions, capture);
      if (plan.status !== "awaiting_capture") {
        if (fundingHash(plan.budget) !== fundingHash(budget)) throw new ConflictException("marketplace_funding_evidence_changed");
        return plan;
      }
      const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: {
        hostMerchantId: plan.hostMerchantId, orderId: capture.providerPaymentId,
      } } });
      if (!ledger?.purchasedAt || ledger.chargebackAt || plan.payment.status !== "approved" ||
          plan.payment.approvedAmountCents !== plan.amountCents || ledger.checkoutSessionId !== plan.checkoutSessionId) {
        throw new ConflictException("marketplace_funding_payment_not_available");
      }
      const settlements = await tx.marketplaceSettlement.findMany({ where: { hostMerchantId: plan.hostMerchantId, orderId: capture.providerPaymentId } });
      const sellerLines = budget.lines.filter(line => line.sellerMerchantId !== plan.hostMerchantId);
      if (settlements.length !== sellerLines.length || settlements.some(row => {
        const line = sellerLines.find(line => line.lineItemId === row.lineItemId);
        return !line || row.sellerMerchantId !== line.sellerMerchantId || row.totalAmountCents !== line.grossAmountCents ||
          row.commissionCents !== line.commissionCents || !row.transferScheduledAt || !["awaiting_return_window", "transfer_scheduled"].includes(row.status);
      })) throw new ConflictException("marketplace_funding_settlement_mismatch");
      if (await tx.marketplacePayout.count({ where: { OR: [{ settlementId: { in: settlements.map(row => row.id) } },
        { provider: plan.provider, accountFingerprint: plan.accountFingerprint, providerPaymentId: capture.providerPaymentId }] } })) {
        throw new ConflictException("marketplace_funding_existing_payout");
      }
      const hostWindow = new SettlementStateMachineService().calculateWindows(instructions.hostTerms, ledger.purchasedAt).transferScheduledAt;
      const hostDue = new Date(Math.max(hostWindow.getTime(), ...settlements.map(row => row.transferScheduledAt!.getTime())));
      for (const line of sellerLines) {
        const settlement = settlements.find(row => row.lineItemId === line.lineItemId)!;
        await tx.marketplaceSettlement.update({ where: { id: settlement.id }, data: { sellerNetCents: line.sellerNetCents } });
      }
      for (const allocation of fundingTransferAllocations(instructions, budget)) {
        const settlement = settlements.find(row => row.lineItemId === allocation.lineItemId);
        await tx.marketplacePayout.create({ data: { fundingPlanId: paymentIntentId, settlementId: settlement?.id,
          beneficiaryMerchantId: allocation.merchantId, kind: allocation.kind, dueAt: settlement?.transferScheduledAt ?? hostDue,
          provider: plan.provider, accountFingerprint: plan.accountFingerprint, providerPaymentId: capture.providerPaymentId,
          destination: instructions.destinations.find(row => row.merchantId === allocation.merchantId)!.destination,
          amountCents: allocation.amountCents, currency: "BRL",
          reference: `mp_${fundingHash([paymentIntentId, allocation.lineItemId ?? "host"])}` } });
      }
      // All obligations, including the host, reserve the capture in one commit.
      return tx.marketplaceFundingPlan.update({ where: { paymentIntentId }, data: { status: "funded", providerPaymentId: capture.providerPaymentId,
        budget: json(budget), providerFeeCents: capture.providerFeeCents, netAmountCents: capture.netAmountCents,
        platformRetainedCents: budget.platformRetainedCents, payoutTotalCents: budget.payoutTotalCents, fundedAt: new Date() } });
    });
  }
}
