import { BadGatewayException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { MARKETPLACE_SHIPMENT_CARRIER, type MarketplaceShipmentCarrier } from "../../domain/ports/marketplace-shipment-carrier.port.js";
import { PrismaMarketplaceShipmentRepository } from "../../infrastructure/repositories/prisma-marketplace-shipment.repository.js";
import { MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES, marketplaceShipmentPrivatePrintUrl, type MarketplaceShipmentRecord, type MarketplaceShipmentStage, type MarketplaceShipmentStageEvidence,
  type MarketplaceShipmentCancellationReason, type MarketplaceShipmentCancellationEvidence } from "../../domain/marketplace-shipment-journal.js";

/** Mutations require explicit cart, purchase or generate commands. Recovery
 * only retrieves existing carrier records and never advances by another POST. */
@Injectable()
export class ExecuteMarketplaceShipmentService {
  constructor(@Inject(PrismaMarketplaceShipmentRepository) private readonly repository: PrismaMarketplaceShipmentRepository,
    @Inject(MARKETPLACE_SHIPMENT_CARRIER) private readonly carrier: MarketplaceShipmentCarrier) {}

  async execute(hostMerchantId: string, shipmentId: string) {
    return this.run(hostMerchantId, shipmentId, false);
  }

  async recoveryStatus(hostMerchantId: string, shipmentId: string) {
    return this.recoveryView(await this.repository.recoveryRecord(hostMerchantId, shipmentId));
  }

  async recoverCart(hostMerchantId: string, shipmentId: string, suppliedCarrierOrderId: string, operatorUserId: string) {
    if (typeof suppliedCarrierOrderId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(suppliedCarrierOrderId) ||
        typeof operatorUserId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(operatorUserId)) throw new ConflictException("marketplace_shipment_recovery_scope_invalid");
    const carrierOrderId = suppliedCarrierOrderId.toLowerCase();
    const record = await this.repository.recoveryRecord(hostMerchantId, shipmentId);
    if (record.carrierOrderId && record.carrierOrderId !== carrierOrderId) throw new ConflictException("marketplace_shipment_carrier_order_already_bound");
    if (this.recoveryView(record).recovery_status === "confirmed") return this.recoveryView(record);
    if (record.status !== "cart_unknown" || record.cancellationStatus) throw new ConflictException("marketplace_shipment_cart_recovery_not_ready");
    // The original bounded POST still owns its receipt pointer during this
    // window. An operator cannot steal that version while it is in flight.
    if (this.recoveryView(record).recovery_status === "in_flight") return this.recoveryView(record);
    let evidence;
    try { evidence = await this.carrier.reconcileCart(record.request, carrierOrderId); }
    catch { return this.recoveryView(record); }
    // A browser supplies an identifier only. Only a complete authenticated
    // carrier GET can bind it; a failed lookup never persists the supplied ID.
    if (evidence.status !== "cart_created" || evidence.carrierOrderId !== carrierOrderId) return this.recoveryView(record);
    let stored;
    try { stored = await this.repository.record(record, evidence, { operatorUserId }); }
    catch (error) {
      if ((error as { code?: string })?.code === "P2002") throw new ConflictException("marketplace_shipment_carrier_order_already_bound");
      throw error;
    }
    const current = stored ?? await this.repository.recoveryRecord(hostMerchantId, shipmentId);
    if (current.carrierOrderId && current.carrierOrderId !== carrierOrderId) throw new ConflictException("marketplace_shipment_carrier_order_already_bound");
    return this.recoveryView(current);
  }

  private recoveryView(record: MarketplaceShipmentRecord) {
    const recovery_status = record.status === "cart_unknown" ? (!record.carrierOrderId && record.claimedAt && Date.now() - record.claimedAt.getTime() < 60000 ? "in_flight" : "required")
      : record.carrierOrderId && ["cart_created", "purchase_unknown", "purchased", "generate_unknown", "generated"].includes(record.status) ? "confirmed" : "not_applicable";
    return { shipment_id: record.id, origin_merchant_id: record.originMerchantId, reference: record.reference,
      status: record.status, carrier_order_id: record.carrierOrderId, recovery_status,
      financial_reconciliation_required: MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES.includes(record.blockReason as any),
      financial_reconciliation_reason: MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES.includes(record.blockReason as any) ? record.blockReason : null };
  }

  private async run(hostMerchantId: string, shipmentId: string, reconcileOnly: boolean) {
    const claim = await this.repository.claim(hostMerchantId, shipmentId, new Date(), reconcileOnly);
    if (!claim) return { status: "not_claimed" };
    let record = claim.record;
    let reconciled = false;
    if (record.cancellationStatus) return this.reconcileCancellation(record, false);
    if (claim.submit && !reconcileOnly) {
      let outcome;
      try { outcome = await this.carrier.createCart(record.request); }
      catch { outcome = { status: "unknown" as const, observedAt: new Date() }; }
      if (outcome.notSubmitted === true) {
        await this.repository.releaseUnsubmitted(record);
        return { status: "not_submitted" };
      }
      const stored = await this.repository.record(record, outcome);
      if (!stored) return { status: "stale_claim" };
      record = stored;
    }
    // Defend against an incorrect repository adapter: recovery never submits.
    if (reconcileOnly && claim.submit) return { status: "recovery_submission_rejected" };
    if (record.status === "cart_unknown") {
      // A concurrent observer must not consume the submitting worker's CAS
      // version before its bounded 15s POST can persist the receipt pointer.
      if (!record.carrierOrderId && !claim.submit && record.claimedAt && Date.now() - record.claimedAt.getTime() < 60000) {
        return { status: "cart_unknown", shipmentId: record.id, carrierOrderId: null, nextStep: "carrier_cart_in_flight" };
      }
      const evidence = record.carrierOrderId ? await this.carrier.reconcileCart(record.request, record.carrierOrderId)
        : { status: "unknown" as const, observedAt: new Date(), reason: "carrier_order_id_recovery_required" };
      const stored = await this.repository.record(record, evidence);
      reconciled = stored?.status === "cart_created";
      record = stored ?? record;
    }
    if (["purchase_unknown", "generate_unknown"].includes(record.status)) {
      return this.reconcileStage(record, record.status === "purchase_unknown" ? "purchase" : "generate", false);
    }
    if (["cart_created", "purchased", "generated"].includes(record.status) && record.carrierOrderId) {
      const evidence = await this.carrier.tracking(record.request, record.carrierOrderId, record.purchaseReceipt, record.generationReceipt);
      if (evidence?.financialIssue) {
        await this.repository.recordTrackingException(record, evidence);
        return { status: record.status, shipmentId: record.id, carrierOrderId: record.carrierOrderId, reconciled: false,
          nextStep: evidence.financialIssue };
      }
      if (evidence) reconciled = (await this.repository.recordTracking(record, evidence)) || reconciled;
      else await this.repository.touchUnprovenTracking(record);
    }
    return { status: record.status, shipmentId: record.id, carrierOrderId: record.carrierOrderId, reconciled,
      nextStep: this.nextStep(record) };
  }

  async recover(limit = 20) {
    const rows = await this.repository.listRecoverable(limit), result = { attempted: 0, reconciled: 0, failed: 0 };
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (index < rows.length) {
        const row = rows[index++]; result.attempted++;
        try { const out = await this.run(row.hostMerchantId, row.id, true); if ("reconciled" in out && out.reconciled) result.reconciled++; }
        catch { result.failed++; }
      }
    }));
    return result;
  }

  async purchase(hostMerchantId: string, shipmentId: string) { return this.advance(hostMerchantId, shipmentId, "purchase"); }
  async generate(hostMerchantId: string, shipmentId: string) { return this.advance(hostMerchantId, shipmentId, "generate"); }

  async cancel(hostMerchantId: string, shipmentId: string, reason: MarketplaceShipmentCancellationReason) {
    const claim = await this.repository.claimCancellation(hostMerchantId, shipmentId, reason);
    if (!claim) return { status: "not_claimed", reconciled: false };
    if (!claim.submit) return this.reconcileCancellation(claim.record, false);
    const record = claim.record;
    if (!record.carrierOrderId || !record.purchaseReceipt || !record.cancellationReason) throw new ConflictException("marketplace_shipment_cancellation_not_ready");
    let outcome: MarketplaceShipmentCancellationEvidence;
    try { outcome = await this.carrier.cancel(record.request, record.carrierOrderId, record.purchaseReceipt, record.generationReceipt, record.cancellationReason); }
    catch { outcome = { status: "unknown", carrierOrderId: record.carrierOrderId, observedAt: new Date() }; }
    if (outcome.notSubmitted === true) {
      await this.repository.releaseUnsubmittedCancellation(record);
      return { status: "not_submitted", reconciled: false, walletRefundStatus: "unproven" };
    }
    // Never promote a POST acknowledgement into a cancellation receipt.
    const stored = await this.repository.recordCancellation(record, { ...outcome, status: "unknown", receipt: undefined });
    if (!stored) return { status: "stale_claim", reconciled: false };
    return this.reconcileCancellation(stored, true);
  }

  private async reconcileCancellation(record: MarketplaceShipmentRecord, ownsSubmission: boolean) {
    const response = (current: MarketplaceShipmentRecord, reconciled = false) => ({
      status: current.cancellationStatus === "canceled" ? "canceled" : "cancellation_unknown", shipmentStatus: current.status,
      shipmentId: current.id, carrierOrderId: current.carrierOrderId, reconciled, walletRefundStatus: "unproven" as const,
      nextStep: current.cancellationStatus === "canceled" ? "carrier_wallet_refund_reconciliation_required" : "carrier_cancellation_reconciliation_required",
    });
    if (record.cancellationStatus === "canceled") return response(record);
    if (!ownsSubmission && record.cancellationClaimedAt && Date.now() - record.cancellationClaimedAt.getTime() < 60000) return response(record);
    if (!record.carrierOrderId || !record.purchaseReceipt) throw new ConflictException("marketplace_shipment_cancellation_not_ready");
    let evidence: MarketplaceShipmentCancellationEvidence;
    try { evidence = await this.carrier.reconcileCancellation(record.request, record.carrierOrderId, record.purchaseReceipt, record.generationReceipt); }
    catch { evidence = { status: "unknown", carrierOrderId: record.carrierOrderId, observedAt: new Date() }; }
    const stored = await this.repository.recordCancellation(record, evidence);
    return response(stored ?? record, stored?.cancellationStatus === "canceled");
  }

  async print(hostMerchantId: string, shipmentId: string) {
    const record = await this.repository.printable(hostMerchantId, shipmentId);
    let result;
    try { result = await this.carrier.print(record.request, record.carrierOrderId!, record.purchaseReceipt!, record.generationReceipt!); }
    catch { throw new BadGatewayException("marketplace_shipment_print_unavailable"); }
    const url = result && marketplaceShipmentPrivatePrintUrl(result.url, record.request.environment);
    if (!result || !url || result.mode !== "private" || result.carrierOrderId !== record.carrierOrderId ||
        !(result.observedAt instanceof Date) || Math.abs(Date.now() - result.observedAt.getTime()) > 300000 ||
        !Number.isFinite(result.observedAt.getTime())) throw new BadGatewayException("marketplace_shipment_print_unavailable");
    await this.repository.recordPrintLinkObtained(record);
    return { shipmentId: record.id, originMerchantId: record.originMerchantId, carrierOrderId: record.carrierOrderId,
      mode: "private" as const, requiresCarrierLogin: true, url };
  }

  private async advance(host: string, id: string, stage: MarketplaceShipmentStage) {
    if (!host?.trim() || !id?.trim()) throw new ConflictException("marketplace_shipment_scope_required");
    const claim = await this.repository.claimStage(host, id, stage);
    if (!claim) return { status: "not_claimed", reconciled: false };
    let record = claim.record;
    if (!claim.submit) return this.run(host, id, true);
    if (!record.carrierOrderId || (stage === "generate" && !record.purchaseReceipt)) throw new ConflictException("marketplace_shipment_stage_not_ready");
    let outcome: MarketplaceShipmentStageEvidence & { notSubmitted?: boolean };
    try { outcome = stage === "purchase" ? await this.carrier.purchase(record.request, record.carrierOrderId)
      : await this.carrier.generate(record.request, record.carrierOrderId, record.purchaseReceipt!); }
    catch { outcome = { status: "unknown", carrierOrderId: record.carrierOrderId, observedAt: new Date() }; }
    if (outcome.notSubmitted === true) {
      await this.repository.releaseUnsubmittedStage(record, stage);
      return { status: "not_submitted", reconciled: false };
    }
    // A provider POST can only store evidence for later confirmation. Even a
    // wrongly implemented adapter cannot promote the journal with POST alone.
    const stored = await this.repository.recordStage(record, stage, { ...outcome, status: "unknown", generationReceipt: undefined });
    if (!stored) return { status: "stale_claim", reconciled: false };
    record = stored;
    return this.reconcileStage(record, stage, true);
  }

  private async reconcileStage(record: MarketplaceShipmentRecord, stage: MarketplaceShipmentStage, ownsSubmission: boolean) {
    const claimedAt = stage === "purchase" ? record.purchaseClaimedAt : record.generationClaimedAt;
    if (!ownsSubmission && claimedAt && Date.now() - claimedAt.getTime() < 60000 && (stage === "generate" || !record.purchaseReceipt)) {
      return { status: record.status, shipmentId: record.id, carrierOrderId: record.carrierOrderId, reconciled: false, nextStep: `carrier_${stage}_in_flight` };
    }
    if (!record.carrierOrderId || (stage === "generate" && !record.purchaseReceipt)) {
      throw new ConflictException("marketplace_shipment_stage_not_ready");
    }
    const evidence = stage === "purchase" ? await this.carrier.reconcilePurchase(record.request, record.carrierOrderId, record.purchaseReceipt)
      : await this.carrier.reconcileGeneration(record.request, record.carrierOrderId, record.purchaseReceipt!);
    const stored = await this.repository.recordStage(record, stage, evidence);
    const reconciled = !!stored && stored.status === (stage === "purchase" ? "purchased" : "generated");
    record = stored ?? record;
    return { status: record.status, shipmentId: record.id, carrierOrderId: record.carrierOrderId, reconciled, nextStep: this.nextStep(record) };
  }

  private nextStep(record: MarketplaceShipmentRecord) {
    return record.status === "cart_created" ? "purchase_command_required" : record.status === "purchased" ? "generate_command_required"
      : record.status === "generated" ? "label_print_or_dispatch_required" : record.blockReason;
  }
}
