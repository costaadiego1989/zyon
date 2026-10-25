import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import { marketplacePaymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import { lockMarketplaceOrder } from "../../../marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.js";
import { GetMarketplaceShippingContractService } from "../../application/use-cases/get-marketplace-shipping-contract.service.js";
import { buildMarketplaceShipmentRequests, assertMarketplaceShipmentOriginRequests, marketplaceShipmentReference, marketplaceShipmentVolume, marketplaceShipmentRecipient, type MarketplaceShipmentAddress,
  assertMarketplaceShipmentPurchaseReceipt, assertMarketplaceShipmentGenerationReceipt, type MarketplaceShipmentRecord, type MarketplaceShipmentEvidence,
  type MarketplaceShipmentStage, type MarketplaceShipmentStageEvidence, assertMarketplaceShipmentCancellationReceipt,
  marketplaceShipmentCancellationDescription, type MarketplaceShipmentCancellationReason, type MarketplaceShipmentCancellationEvidence,
  MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES, type MarketplaceShipmentFinancialIssue, type MarketplaceShipmentTrackingEvidence } from "../../domain/marketplace-shipment-journal.js";
import { verifyMarketplaceShipmentRecord } from "../../domain/marketplace-shipment-proof.js";
import { marketplaceShippingContractHash as hash } from "../../domain/marketplace-shipping-contract.js";
import { inventorySaleFingerprint, validateInventorySale } from "../../../inventory/domain/events/inventory-sale.validation.js";
import type { SaleCompletedEvent } from "../../../inventory/domain/events/sale-completed.event.js";
import type { FrozenMarketplaceFunding } from "../../../marketplace/domain/services/marketplace-funding-budget.js";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const fail = (reason: string): never => { throw new ConflictException(`marketplace_shipment_${reason}`); };
type PrepareShipmentInput = { hostMerchantId: string; paymentIntentId: string; originMerchantId: string;
  from: MarketplaceShipmentAddress; invoiceKey: string };

/** Internal journal. Every read has host scope; the carrier account is the origin's. */
@Injectable()
export class PrismaMarketplaceShipmentRepository {
  constructor(private readonly prisma: PrismaClient, private readonly contracts: GetMarketplaceShippingContractService) {}

  async prepare(input: PrepareShipmentInput) {
    return (await this.prepareVolumes(input, false))[0];
  }

  async prepareOrigin(input: PrepareShipmentInput) {
    return this.prepareVolumes(input, true);
  }

  private async prepareVolumes(input: PrepareShipmentInput, multiple: boolean) {
    return this.prisma.$transaction(async tx => {
      await this.orderLock(tx, input.hostMerchantId, input.paymentIntentId);
      const existing = await tx.marketplaceShipmentJournal.findMany({ where: { hostMerchantId: input.hostMerchantId,
        fundingPlanId: input.paymentIntentId, originMerchantId: input.originMerchantId }, orderBy: { volumeIndex: "asc" } });
      if (existing.length) {
        const records = existing.map(row => this.verify(row));
        this.assertCompleteVolumeSet(records);
        if (!multiple && records.length !== 1) fail("prepare_origin_required");
        if (records.some(record => hash(record.request.body.from) !== hash(input.from) || record.request.body.options.invoice.key !== input.invoiceKey)) fail("request_changed");
        return records;
      }
      const source = await this.contracts.read(tx, { merchantId: input.hostMerchantId, paymentIntentId: input.paymentIntentId, originMerchantId: input.originMerchantId });
      if (!source.carrierQuote || !source.carrierQuoteHash) fail("carrier_quote_reconciliation_required");
      await this.assertShippable(tx, input.hostMerchantId, input.paymentIntentId);
      const checkout = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: input.hostMerchantId, sessionId: source.sessionId } } });
      if (!checkout || checkout.merchantId !== input.hostMerchantId || !source.checkoutFingerprint) fail("checkout_missing");
      const session = { cart: checkout!.cart, shipping: checkout!.shipping, customer: checkout!.customer } as unknown as CheckoutSession;
      if (marketplacePaymentCartFingerprint(session) !== source.checkoutFingerprint) fail("checkout_changed");
      const productNames: Record<string, string> = {};
      for (const p of source.shipment.products) {
        const items = session.cart.items.filter(item => (item.marketplace?.lineItemId ?? `host:${item.sku}`) === p.lineItemId &&
          item.variantId === p.variantId && item.quantity === p.quantity);
        if (items.length !== 1) fail("product_identity_changed");
        productNames[p.lineItemId] = items[0].name;
      }
      const requests = buildMarketplaceShipmentRequests({ ...input, ...source, contract: source.shipment,
        carrierQuote: source.carrierQuote!, carrierQuoteHash: source.carrierQuoteHash!, to: marketplaceShipmentRecipient(session.customer), productNames });
      if (!multiple && requests.length !== 1) fail("prepare_origin_required");
      const records: MarketplaceShipmentRecord[] = [];
      for (const request of requests) records.push(this.verify(await tx.marketplaceShipmentJournal.create({ data: { fundingPlanId: input.paymentIntentId,
        hostMerchantId: input.hostMerchantId, originMerchantId: input.originMerchantId, volumeIndex: marketplaceShipmentVolume(request).index,
        quoteId: source.quoteId, quoteKey: source.quoteKey, environment: request.environment, accountFingerprint: request.accountFingerprint,
        request: json(request), requestHash: hash(request), reference: request.reference } })));
      this.assertCompleteVolumeSet(records);
      return records;
    });
  }

  async claim(host: string, id: string, now = new Date(), reconcileOnly = false) {
    return this.prisma.$transaction(async tx => {
      const record = await this.lock(tx, host, id);
      if (!record || record.status === "blocked") return undefined;
      if (record.status !== "prepared") return { record, submit: false };
      if (reconcileOnly) return undefined;
      await this.assertShippable(tx, host, record.fundingPlanId, record.originMerchantId);
      const updated = await tx.marketplaceShipmentJournal.updateMany({ where: { id, hostMerchantId: host, version: record.version, status: "prepared" },
        data: { status: "cart_unknown", claimedAt: now, blockReason: null, version: { increment: 1 } } });
      return updated.count === 1 ? { record: this.verify(await tx.marketplaceShipmentJournal.findFirstOrThrow({ where: { id, hostMerchantId: host } })), submit: true } : undefined;
    });
  }

  async recoveryRecord(host: string, id: string) {
    if (!host?.trim() || !id?.trim()) fail("scope_required");
    return this.prisma.$transaction(async tx => {
      const record = await this.lock(tx, host, id);
      if (!record) throw new NotFoundException("marketplace_shipment_not_found");
      return record;
    });
  }

  async record(record: MarketplaceShipmentRecord, evidence: MarketplaceShipmentEvidence, recovery?: { operatorUserId: string }) {
    if (recovery && (!/^[A-Za-z0-9_-]{1,200}$/.test(recovery.operatorUserId) || evidence.status !== "cart_created")) fail("recovery_actor_invalid");
    return this.prisma.$transaction(async tx => {
      const current = await this.lock(tx, record.hostMerchantId, record.id);
      if (!current || current.version !== record.version || current.status !== "cart_unknown") return undefined;
      if (!Number.isFinite(evidence.observedAt.getTime()) || Math.abs(Date.now() - evidence.observedAt.getTime()) > 300000 ||
          (current.carrierOrderId && evidence.carrierOrderId && current.carrierOrderId !== evidence.carrierOrderId) ||
          (evidence.carrierOrderId && !/^[a-f0-9-]{36}$/i.test(evidence.carrierOrderId)) ||
          (evidence.status === "cart_created" && !evidence.carrierOrderId)) fail("evidence_invalid");
      const updated = await tx.marketplaceShipmentJournal.update({ where: { id: current.id }, data: {
        status: evidence.status === "cart_created" ? "cart_created" : "cart_unknown", version: { increment: 1 },
        carrierOrderId: evidence.carrierOrderId ?? current.carrierOrderId, reconciledAt: evidence.observedAt,
        blockReason: evidence.status === "cart_created" ? null : (evidence.carrierOrderId ?? current.carrierOrderId) ? "carrier_cart_unproven" : "carrier_order_id_recovery_required" } });
      if (evidence.status === "cart_created") await this.event(tx, current, "marketplace.shipment.cart_created", {
        carrier_order_id: evidence.carrierOrderId, origin_merchant_id: current.originMerchantId });
      if (recovery) await this.event(tx, current, "marketplace.shipment.carrier_order_recovered", {
        carrier_order_id: evidence.carrierOrderId, origin_merchant_id: current.originMerchantId, operator_user_id: recovery.operatorUserId });
      return this.verify(updated);
    });
  }

  async releaseUnsubmitted(record: MarketplaceShipmentRecord) {
    return this.prisma.$transaction(async tx => {
      const current = await this.lock(tx, record.hostMerchantId, record.id);
      if (!current || current.version !== record.version || current.status !== "cart_unknown" || current.carrierOrderId) return false;
      await tx.marketplaceShipmentJournal.update({ where: { id: current.id }, data: { status: "prepared", claimedAt: null,
        blockReason: "carrier_account_unavailable", version: { increment: 1 } } });
      return true;
    });
  }

  async claimStage(host: string, id: string, stage: MarketplaceShipmentStage, now = new Date()) {
    return this.prisma.$transaction(async tx => {
      const record = await this.lock(tx, host, id);
      if (!record || record.status === "blocked") return undefined;
      if (record.cancellationStatus) fail("cancellation_pending_or_completed");
      const expected = stage === "purchase" ? "cart_created" : "purchased";
      if (record.status !== expected) return { record, submit: false };
      if (!record.carrierOrderId || (stage === "generate" && (!record.purchaseReceipt || !record.purchasedAt))) fail("stage_not_ready");
      await this.assertShippable(tx, host, record.fundingPlanId, record.originMerchantId);
      if (["released", "posted", "delivered", "canceled", "expired", "undelivered", "suspended"].includes(record.trackingStatus ?? "") && stage === "purchase") fail("purchase_external_state_requires_reconciliation");
      if (["posted", "delivered", "canceled", "expired", "undelivered", "suspended"].includes(record.trackingStatus ?? "")) fail("generation_external_state_requires_reconciliation");
      const updated = await tx.marketplaceShipmentJournal.updateMany({ where: { id, hostMerchantId: host, version: record.version, status: expected },
        data: { status: stage === "purchase" ? "purchase_unknown" : "generate_unknown", blockReason: null, version: { increment: 1 },
          ...(stage === "purchase" ? { purchaseClaimedAt: now } : { generationClaimedAt: now }) } });
      return updated.count === 1 ? { record: this.verify(await tx.marketplaceShipmentJournal.findFirstOrThrow({ where: { id, hostMerchantId: host } })), submit: true } : undefined;
    });
  }

  async recordStage(record: MarketplaceShipmentRecord, stage: MarketplaceShipmentStage, evidence: MarketplaceShipmentStageEvidence) {
    return this.prisma.$transaction(async tx => {
      const current = await this.lock(tx, record.hostMerchantId, record.id), expected = stage === "purchase" ? "purchase_unknown" : "generate_unknown";
      if (!current || current.version !== record.version || current.status !== expected) return undefined;
      if (!current.carrierOrderId || evidence.carrierOrderId !== current.carrierOrderId ||
          !Number.isFinite(evidence.observedAt.getTime()) || Math.abs(Date.now() - evidence.observedAt.getTime()) > 300000 ||
          (stage === "purchase" && evidence.status === "generated") || (stage === "generate" && evidence.status === "purchased")) fail("stage_evidence_invalid");
      const receipt = evidence.purchaseReceipt ?? current.purchaseReceipt;
      if (evidence.purchaseReceipt) {
        assertMarketplaceShipmentPurchaseReceipt(evidence.purchaseReceipt, current.request, current.carrierOrderId!);
        if ((current.purchaseReceiptHash && current.purchaseReceiptHash !== hash(evidence.purchaseReceipt)) ||
            (current.carrierPurchaseId && current.carrierPurchaseId !== evidence.purchaseReceipt.carrierPurchaseId)) fail("purchase_receipt_changed");
      }
      if (evidence.status === "purchased" && !receipt) fail("purchase_receipt_required");
      const generation = evidence.generationReceipt;
      if (evidence.status === "generated") {
        if (!receipt || !current.purchasedAt || !generation ||
            (current.trackingCode && generation.trackingCode && current.trackingCode !== generation.trackingCode)) fail("generation_receipt_invalid");
        assertMarketplaceShipmentGenerationReceipt(generation!, current.request, receipt!, current.carrierOrderId!);
      } else if (generation) fail("stage_evidence_invalid");
      // Provider receipts are preserved even if a return/dispute held funding
      // after the claim. Eligibility controls the next mutation, never whether
      // an already submitted wallet debit is recorded.
      const updated = await tx.marketplaceShipmentJournal.update({ where: { id: current.id }, data: {
        status: evidence.status === "unknown" ? expected : evidence.status, version: { increment: 1 }, reconciledAt: evidence.observedAt,
        blockReason: evidence.status === "unknown" ? (stage === "purchase" && !receipt ? "carrier_purchase_receipt_recovery_required" : `carrier_${stage}_unproven`) : null,
        ...(evidence.purchaseReceipt ? { purchaseReceipt: json(evidence.purchaseReceipt), purchaseReceiptHash: hash(evidence.purchaseReceipt), carrierPurchaseId: evidence.purchaseReceipt.carrierPurchaseId } : {}),
        ...(evidence.status === "purchased" ? { purchasedAt: evidence.observedAt } : {}),
        ...(evidence.status === "generated" ? { generationReceipt: json(generation), generationReceiptHash: hash(generation), generatedAt: evidence.observedAt,
          trackingCode: generation!.trackingCode ?? current.trackingCode } : {}),
      } });
      if (evidence.status !== "unknown") await this.event(tx, current, `marketplace.shipment.${evidence.status}`, {
        carrier_order_id: current.carrierOrderId, origin_merchant_id: current.originMerchantId,
        ...(stage === "purchase" ? { carrier_purchase_id: receipt!.carrierPurchaseId, amount_cents: receipt!.amountCents } : { tracking_code: generation!.trackingCode }),
      });
      if (stage === "purchase" && evidence.status === "unknown" && !receipt) await this.financialException(tx, current,
        "carrier_purchase_receipt_recovery_required");
      return this.verify(updated);
    });
  }

  async releaseUnsubmittedStage(record: MarketplaceShipmentRecord, stage: MarketplaceShipmentStage) {
    return this.prisma.$transaction(async tx => {
      const current = await this.lock(tx, record.hostMerchantId, record.id), expected = stage === "purchase" ? "purchase_unknown" : "generate_unknown";
      if (!current || current.version !== record.version || current.status !== expected ||
          (stage === "purchase" ? !!current.purchaseReceipt || !!current.purchasedAt : !!current.generationReceipt || !!current.generatedAt)) return false;
      await tx.marketplaceShipmentJournal.update({ where: { id: current.id }, data: { status: stage === "purchase" ? "cart_created" : "purchased",
        blockReason: `carrier_${stage}_not_submitted`, version: { increment: 1 },
        ...(stage === "purchase" ? { purchaseClaimedAt: null } : { generationClaimedAt: null }) } });
      return true;
    });
  }

  async claimCancellation(host: string, id: string, reason: MarketplaceShipmentCancellationReason, now = new Date()) {
    if (!host?.trim() || !id?.trim()) fail("scope_required");
    marketplaceShipmentCancellationDescription(reason);
    return this.prisma.$transaction(async tx => {
      const record = await this.lock(tx, host, id);
      if (!record) throw new NotFoundException("marketplace_shipment_not_found");
      if (record.cancellationStatus) {
        if (record.cancellationReason !== reason) fail("cancellation_reason_changed");
        return { record, submit: false };
      }
      if (!["purchased", "generated"].includes(record.status) || !record.carrierOrderId || !record.purchaseReceipt || !record.purchasedAt ||
          (record.status === "generated" && (!record.generationReceipt || !record.generatedAt)) ||
          ["posted", "delivered", "expired", "undelivered", "suspended"].includes(record.trackingStatus ?? "")) fail("cancellation_not_ready");
      // Cancellation remedies a return or dispute. Funding holds and refund
      // plans cannot block it, but the original paid order binding must survive.
      const payment = await tx.paymentIntent.findFirst({ where: { id: record.fundingPlanId, merchantId: host } });
      const plan = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: record.fundingPlanId, hostMerchantId: host } });
      const ledger = payment?.providerPaymentId ? await tx.marketplaceOrderLedger.findUnique({ where: {
        hostMerchantId_orderId: { hostMerchantId: host, orderId: payment.providerPaymentId } } }) : null;
      if (!payment || !plan?.fundedAt || plan.providerPaymentId !== payment.providerPaymentId || plan.amountCents !== payment.amountCents ||
          !ledger?.purchasedAt || ledger.checkoutSessionId !== plan.checkoutSessionId) fail("cancellation_binding_invalid");
      const changed = await tx.marketplaceShipmentJournal.updateMany({ where: { id, hostMerchantId: host, version: record.version, cancellationStatus: null },
        data: { cancellationStatus: "unknown", cancellationReason: reason, cancellationClaimedAt: now, blockReason: null, version: { increment: 1 } } });
      return changed.count === 1 ? { record: this.verify(await tx.marketplaceShipmentJournal.findFirstOrThrow({ where: { id, hostMerchantId: host } })), submit: true } : undefined;
    });
  }

  async releaseUnsubmittedCancellation(record: MarketplaceShipmentRecord) {
    return this.prisma.$transaction(async tx => {
      const current = await this.lock(tx, record.hostMerchantId, record.id);
      if (!current || current.version !== record.version || current.cancellationStatus !== "unknown" || current.cancellationReceipt || current.canceledAt) return false;
      await tx.marketplaceShipmentJournal.update({ where: { id: current.id }, data: { cancellationStatus: null, cancellationReason: null,
        cancellationClaimedAt: null, blockReason: "carrier_cancellation_not_submitted", version: { increment: 1 } } });
      return true;
    });
  }

  async recordCancellation(record: MarketplaceShipmentRecord, evidence: MarketplaceShipmentCancellationEvidence) {
    return this.prisma.$transaction(async tx => {
      const current = await this.lock(tx, record.hostMerchantId, record.id);
      if (!current || current.version !== record.version || current.cancellationStatus !== "unknown") return undefined;
      if (evidence.carrierOrderId !== current.carrierOrderId || !["unknown", "canceled"].includes(evidence.status) ||
          !Number.isFinite(evidence.observedAt.getTime()) || Math.abs(Date.now() - evidence.observedAt.getTime()) > 300000) fail("cancellation_evidence_invalid");
      if (evidence.status === "canceled") {
        if (!evidence.receipt || !current.purchaseReceipt || !current.carrierOrderId) fail("cancellation_receipt_invalid");
        assertMarketplaceShipmentCancellationReceipt(evidence.receipt!, current.request, current.purchaseReceipt!, current.generationReceipt, current.carrierOrderId!);
      } else if (evidence.receipt) fail("cancellation_evidence_invalid");
      const updated = await tx.marketplaceShipmentJournal.update({ where: { id: current.id }, data: {
        cancellationStatus: evidence.status, reconciledAt: evidence.observedAt, version: { increment: 1 },
        blockReason: evidence.status === "canceled" ? "carrier_wallet_refund_unproven" : "carrier_cancellation_unproven",
        ...(evidence.status === "canceled" ? { cancellationReceipt: json(evidence.receipt), cancellationReceiptHash: hash(evidence.receipt),
          canceledAt: evidence.observedAt, trackingStatus: "canceled" } : {}),
      } });
      if (evidence.status === "canceled") await this.event(tx, current, "marketplace.shipment.canceled", {
        origin_merchant_id: current.originMerchantId, carrier_order_id: current.carrierOrderId,
        reason: current.cancellationReason, wallet_refund_status: "unproven" });
      if (evidence.status === "canceled") await this.financialException(tx, current, "carrier_wallet_refund_unproven");
      return this.verify(updated);
    });
  }

  async printable(host: string, id: string) {
    if (!host?.trim() || !id?.trim()) fail("scope_required");
    return this.prisma.$transaction(async tx => {
      const record = await this.lock(tx, host, id);
      if (!record) throw new NotFoundException("marketplace_shipment_not_found");
      await this.assertPrintable(tx, record);
      return record;
    });
  }

  async recordPrintLinkObtained(record: MarketplaceShipmentRecord) {
    return this.prisma.$transaction(async tx => {
      const current = await this.lock(tx, record.hostMerchantId, record.id);
      if (!current || current.originMerchantId !== record.originMerchantId || current.carrierOrderId !== record.carrierOrderId ||
          current.requestHash !== record.requestHash || current.purchaseReceiptHash !== record.purchaseReceiptHash ||
          current.generationReceiptHash !== record.generationReceiptHash) fail("print_identity_changed");
      // Recheck after the carrier response; a return/dispute must suppress the
      // link even when it arrived while the print query was in flight. Polling
      // that only advanced a journal version does not invalidate a safe link.
      await this.assertPrintable(tx, current!);
      const eventId = `mship_print_${hash([current!.id, current!.generationReceiptHash])}`;
      await tx.outboxMessage.upsert({ where: { eventId }, update: {}, create: {
        eventId, eventType: "marketplace.shipment.print_link_obtained", schemaVersion: 1, merchantId: current!.hostMerchantId,
        occurredAt: new Date(), correlationId: current!.fundingPlanId, causationId: current!.id, producer: "marketplace-shipping",
        payload: { shipment_id: current!.id, origin_merchant_id: current!.originMerchantId,
          carrier_order_id: current!.carrierOrderId, mode: "private" },
      } });
    });
  }

  private async assertPrintable(tx: Prisma.TransactionClient, record: MarketplaceShipmentRecord) {
    if (record.cancellationStatus || record.status !== "generated" || !record.carrierOrderId || !record.purchaseReceipt || !record.purchasedAt ||
        !record.generationReceipt || !record.generatedAt || ["canceled", "expired", "undelivered", "suspended"].includes(record.trackingStatus ?? "")) fail("print_not_ready");
    await this.assertShippable(tx, record.hostMerchantId, record.fundingPlanId, record.originMerchantId);
  }

  async recordTracking(record: MarketplaceShipmentRecord, evidence: { carrierOrderId: string; status: string; trackingCode: string | null; observedAt: Date }) {
    return this.prisma.$transaction(async tx => {
      const current = await this.lock(tx, record.hostMerchantId, record.id);
      if (!current || current.cancellationStatus || current.version !== record.version || !current.carrierOrderId || current.carrierOrderId !== evidence.carrierOrderId ||
          !["cart_created", "purchased", "generated"].includes(current.status)) return false;
      if (!Number.isFinite(evidence.observedAt.getTime()) || Math.abs(Date.now() - evidence.observedAt.getTime()) > 300000 ||
          !["pending", "released", "posted", "delivered", "canceled", "expired", "undelivered", "suspended"].includes(evidence.status) ||
          (evidence.trackingCode !== null && !/^[a-zA-Z0-9-]{6,64}$/.test(evidence.trackingCode))) fail("tracking_invalid");
      if (current.trackingCode && evidence.trackingCode && current.trackingCode !== evidence.trackingCode) fail("tracking_identity_changed");
      if (["delivered", "canceled", "expired"].includes(current.trackingStatus ?? "") && current.trackingStatus !== evidence.status) fail("tracking_terminal_changed");
      const changed = current.trackingStatus !== evidence.status || (evidence.trackingCode && current.trackingCode !== evidence.trackingCode);
      await tx.marketplaceShipmentJournal.update({ where: { id: current.id }, data: { trackingStatus: evidence.status,
        trackingCode: evidence.trackingCode ?? current.trackingCode, reconciledAt: evidence.observedAt, blockReason: null, version: { increment: 1 } } });
      if (changed) await this.event(tx, current, "marketplace.shipment.tracking_updated", {
        origin_merchant_id: current.originMerchantId, carrier_order_id: current.carrierOrderId, status: evidence.status,
        tracking_code: evidence.trackingCode ?? current.trackingCode });
      if (evidence.status === "delivered") await this.recordOriginDelivered(tx, current);
      return true;
    });
  }

  async recordTrackingException(record: MarketplaceShipmentRecord, evidence: MarketplaceShipmentTrackingEvidence) {
    if (!evidence.financialIssue || !MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES.includes(evidence.financialIssue) ||
        evidence.status !== "unproven" || !Number.isFinite(evidence.observedAt.getTime()) ||
        Math.abs(Date.now() - evidence.observedAt.getTime()) > 300000 ||
        (evidence.observedAmountCents !== undefined && (!Number.isSafeInteger(evidence.observedAmountCents) ||
          evidence.observedAmountCents < 0 || evidence.observedAmountCents > 2_147_483_647))) fail("financial_observation_invalid");
    return this.prisma.$transaction(async tx => {
      const current = await this.lock(tx, record.hostMerchantId, record.id);
      if (!current || current.version !== record.version || current.cancellationStatus || !current.purchaseReceipt ||
          !["purchased", "generated"].includes(current.status) || current.carrierOrderId !== evidence.carrierOrderId) return false;
      // Preserve the original price, receipts, physical history and all money.
      // A later authenticated clean observation can clear this recoverable issue.
      await tx.marketplaceShipmentJournal.update({ where: { id: current.id }, data: {
        blockReason: evidence.financialIssue, reconciledAt: evidence.observedAt, version: { increment: 1 } } });
      await this.financialException(tx, current, evidence.financialIssue!, evidence.observedAmountCents);
      return true;
    });
  }

  async listRecoverable(limit = 20) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("limit_invalid");
    return this.prisma.marketplaceShipmentJournal.findMany({ where: { OR: [{ cancellationStatus: "unknown" },
      { cancellationStatus: null, OR: [{ status: { in: ["cart_unknown", "purchase_unknown", "generate_unknown"] } },
        { status: { in: ["cart_created", "purchased", "generated"] }, OR: [{ trackingStatus: null }, { trackingStatus: { notIn: ["delivered", "canceled", "expired"] } },
          { blockReason: { in: [...MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES] } }] }] }] },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: limit, select: { hostMerchantId: true, id: true } });
  }

  async touchUnprovenTracking(record: MarketplaceShipmentRecord) {
    return this.prisma.$transaction(async tx => {
      let current: MarketplaceShipmentRecord | undefined;
      try { current = await this.lock(tx, record.hostMerchantId, record.id); }
      catch (error) { if (error instanceof NotFoundException) return false; throw error; }
      if (!current || current.version !== record.version || current.cancellationStatus ||
          !["cart_created", "purchased", "generated"].includes(current.status) ||
          ["delivered", "canceled", "expired"].includes(current.trackingStatus ?? "")) return false;
      const changed = await tx.marketplaceShipmentJournal.updateMany({ where: { id: current.id, hostMerchantId: current.hostMerchantId,
        version: current.version, cancellationStatus: null, status: current.status }, data: {
          version: { increment: 1 }, blockReason: MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES.includes(current.blockReason as MarketplaceShipmentFinancialIssue)
            ? current.blockReason : "carrier_tracking_unproven" } });
      return changed.count === 1;
    });
  }

  private async orderLock(tx: Prisma.TransactionClient, host: string, paymentIntentId: string) {
    const payment = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId: host }, select: { merchantId: true, providerPaymentId: true } });
    if (!payment || payment.merchantId !== host || !payment.providerPaymentId) throw new NotFoundException("marketplace_shipment_order_not_found");
    await lockMarketplaceOrder(tx, host, payment.providerPaymentId);
  }
  private async lock(tx: Prisma.TransactionClient, host: string, id: string) {
    const initial = await tx.marketplaceShipmentJournal.findFirst({ where: { id, hostMerchantId: host } });
    if (!initial) return undefined;
    await this.orderLock(tx, host, initial.fundingPlanId);
    const row = await tx.marketplaceShipmentJournal.findFirst({ where: { id, hostMerchantId: host } });
    return row ? this.verify(row) : undefined;
  }
  private verify(row: unknown): MarketplaceShipmentRecord { return verifyMarketplaceShipmentRecord(row); }

  private assertCompleteVolumeSet(records: MarketplaceShipmentRecord[]) {
    const first = records[0];
    if (!first || records.length !== marketplaceShipmentVolume(first.request).count || records.some((row, index) => {
      const volume = marketplaceShipmentVolume(row.request);
      return volume.index !== index || volume.count !== records.length || row.hostMerchantId !== first.hostMerchantId ||
        row.fundingPlanId !== first.fundingPlanId || row.originMerchantId !== first.originMerchantId || row.quoteId !== first.quoteId ||
        row.quoteKey !== first.quoteKey || row.request.carrierQuoteHash !== first.request.carrierQuoteHash ||
        row.accountFingerprint !== first.accountFingerprint || row.environment !== first.environment ||
        hash([row.request.body.from, row.request.body.to, row.request.body.options.invoice]) !==
          hash([first.request.body.from, first.request.body.to, first.request.body.options.invoice]);
    })) fail("volume_set_incomplete");
  }

  private async recordOriginDelivered(tx: Prisma.TransactionClient, current: MarketplaceShipmentRecord) {
    const rows = await tx.marketplaceShipmentJournal.findMany({ where: { hostMerchantId: current.hostMerchantId,
      fundingPlanId: current.fundingPlanId, originMerchantId: current.originMerchantId }, orderBy: { volumeIndex: "asc" } });
    if (rows.some(row => row.status !== "generated" || row.trackingStatus !== "delivered" || row.cancellationStatus || row.blockReason || !row.carrierOrderId ||
        !row.purchaseReceipt || !row.purchasedAt || !row.generationReceipt || !row.generatedAt)) return;
    const plan = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: current.fundingPlanId, hostMerchantId: current.hostMerchantId } });
    if (!plan || hash(plan.instructions) !== plan.instructionsHash) return;
    const bindings = (plan?.instructions as unknown as FrozenMarketplaceFunding)?.shippingQuotes?.filter(b => b.merchantId === current.originMerchantId);
    if (bindings?.length !== 1) return;
    const binding = bindings[0], quote = await tx.shippingQuote.findFirst({ where: { id: binding.quoteId, merchantId: current.hostMerchantId } });
    if (!quote || quote.quoteKey !== binding.quoteKey || quote.selectedCarrierKey !== binding.carrierKey || !Array.isArray(quote.results)) return;
    const options = (quote.results as Array<Record<string, unknown>>).filter(o => o.carrier_key === binding.carrierKey);
    if (options.length !== 1) return;
    let proven: MarketplaceShipmentRecord[];
    try {
      proven = assertMarketplaceShipmentOriginRequests(rows.map(row => this.verify(row)), { hostMerchantId: current.hostMerchantId,
        paymentIntentId: current.fundingPlanId, originMerchantId: current.originMerchantId, binding, option: options[0] });
    } catch { return; }
    // This confirms only this origin's complete physical delivery. It does not
    // finalize the buyer order, settle a dispute or release any money.
    const eventId = `mship_origin_delivered_${hash([current.hostMerchantId, current.fundingPlanId, current.originMerchantId])}`;
    await tx.outboxMessage.upsert({ where: { eventId }, update: {}, create: { eventId,
      eventType: "marketplace.shipment.origin_delivered", schemaVersion: 1, merchantId: current.hostMerchantId,
      occurredAt: new Date(), correlationId: current.fundingPlanId, causationId: current.originMerchantId, producer: "marketplace-shipping",
      payload: { funding_plan_id: current.fundingPlanId, origin_merchant_id: current.originMerchantId,
        volume_count: proven.length, shipment_ids: proven.map(row => row.id) } } });
  }
  private async assertShippable(tx: Prisma.TransactionClient, host: string, paymentIntentId: string, originMerchantId?: string) {
    const payment = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId: host } });
    const plan = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId, hostMerchantId: host } });
    if (!payment || payment.merchantId !== host || payment.status !== "approved" || payment.approvedAmountCents !== payment.amountCents ||
        !plan || plan.status !== "funded" || !plan.fundedAt || plan.providerPaymentId !== payment.providerPaymentId || plan.amountCents !== payment.amountCents) fail("order_not_shippable");
    const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId: host, orderId: payment!.providerPaymentId! } } });
    if (!ledger?.purchasedAt || ledger.chargebackAt || ledger.checkoutSessionId !== plan!.checkoutSessionId) fail("order_not_shippable");
    const orderIds = [payment!.providerPaymentId!, ...(payment!.commerceOrderId ? [payment!.commerceOrderId] : [])];
    const completed = await tx.completedOrder.findMany({ where: { merchantId: host, externalOrderId: { in: orderIds } }, select: { id: true } });
    // A rejected/cancelled request without financial history is closed. Any
    // refund journal still holds the shipment, including a legacy/unknown one.
    if (await tx.return.count({ where: { merchantId: host, orderId: { in: [...orderIds, ...completed.map(row => row.id)] },
          OR: [{ status: { notIn: ["REJECTED", "CANCELLED"] } }, { refund: { isNot: null } }] } }) ||
        await tx.marketplaceRefundPlan.count({ where: { hostMerchantId: host, fundingPlanId: paymentIntentId } })) fail("return_requires_reconciliation");
    if (originMerchantId) {
      const source = await this.contracts.read(tx, { merchantId: host, paymentIntentId, originMerchantId });
      const rows = await tx.$queryRaw<Array<{ payload: unknown; payload_hash: string }>>`SELECT payload, payload_hash FROM inventory_sale_receipts
        WHERE merchant_id = ${originMerchantId} AND order_id = ${payment!.providerPaymentId}`;
      if (rows.length !== 1) fail("inventory_receipt_required");
      const sale = validateInventorySale(rows[0].payload as SaleCompletedEvent), frozen = plan!.instructions as unknown as FrozenMarketplaceFunding;
      if (inventorySaleFingerprint(sale) !== rows[0].payload_hash || sale.merchantId !== originMerchantId || sale.orderId !== payment!.providerPaymentId ||
          sale.totalCents !== frozen.lines.filter(line => line.sellerMerchantId === originMerchantId).reduce((sum, line) => sum + line.grossAmountCents, 0) ||
          source.shipment.products.some(p => sale.items.filter(item => item.variantId === p.variantId && item.quantity === p.quantity).length !== 1)) fail("inventory_receipt_invalid");
    }
  }
  private async event(tx: Prisma.TransactionClient, record: MarketplaceShipmentRecord, eventType: string, payload: unknown) {
    await tx.outboxMessage.create({ data: { eventId: `mship_evt_${hash([record.id, record.version, eventType])}`, eventType,
      schemaVersion: 1, merchantId: record.hostMerchantId, occurredAt: new Date(), correlationId: record.fundingPlanId,
      causationId: record.id, producer: "marketplace-shipping", payload: json(payload) } });
  }
  private async financialException(tx: Prisma.TransactionClient, record: MarketplaceShipmentRecord,
    reason: MarketplaceShipmentFinancialIssue, observedAmountCents?: number) {
    const payload = { shipment_id: record.id, funding_plan_id: record.fundingPlanId, origin_merchant_id: record.originMerchantId,
      carrier_order_id: record.carrierOrderId, reason, original_amount_cents: record.request.amountCents,
      ...(observedAmountCents !== undefined ? { observed_amount_cents: observedAmountCents } : {}) };
    const eventId = `mship_financial_${hash([record.id, record.requestHash, reason, observedAmountCents ?? null])}`;
    await tx.outboxMessage.upsert({ where: { eventId }, update: {}, create: { eventId,
      eventType: "marketplace.shipment.financial_reconciliation_required", schemaVersion: 1, merchantId: record.hostMerchantId,
      occurredAt: new Date(), correlationId: record.fundingPlanId, causationId: record.id, producer: "marketplace-shipping", payload: json(payload) } });
  }
}
