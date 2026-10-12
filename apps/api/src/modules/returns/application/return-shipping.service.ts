import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { MelhorEnvioCarrierAdapter } from "../../shipping/infrastructure/adapters/melhor-envio.carrier.js";
import { ExecuteMarketplaceShipmentService } from "../../shipping/application/use-cases/execute-marketplace-shipment.service.js";
import type { MarketplaceShippingAccountIdentity } from "../../shipping/domain/marketplace-shipping-account-identity.js";
import type { MarketplaceRefundAllocation } from "../../marketplace/domain/services/marketplace-refund-allocation.js";
import type { FrozenMarketplaceFunding } from "../../marketplace/domain/services/marketplace-funding-budget.js";
import { fundingHash } from "../../marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.js";

const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const key = (values: string[]) => createHash("sha256").update(JSON.stringify(values)).digest("hex");

/** Cancelling an unused outbound label never delays the buyer's PSP refund.
 * Native cancellation evidence is kept separate from Melhor Carteira credit. */
@Injectable()
export class ReturnShippingService {
  private readonly logger = new Logger(ReturnShippingService.name);
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(MelhorEnvioCarrierAdapter) private readonly carrier: MelhorEnvioCarrierAdapter,
    @Inject(ExecuteMarketplaceShipmentService) private readonly marketplace: ExecuteMarketplaceShipmentService) {}

  async cancelOrdinary(merchantId: string, returnId: string, fullOrderReturn?: boolean) {
    if (fullOrderReturn === false) return;
    const returned = await this.prisma.return.findFirst({ where: { id: returnId, merchantId }, include: { refund: true, items: true } });
    if (!returned?.refund || !["REFUND_PROCESSING", "REFUND_COMPLETED"].includes(returned.status)) return;
    const completed = await this.prisma.completedOrder.findMany({ where: { merchantId,
      OR: [{ id: returned.orderId }, { externalOrderId: returned.orderId }] }, select: { externalOrderId: true, lineItemsJson: true } });
    if (completed.length !== 1) return;
    const items = Array.isArray(completed[0].lineItemsJson) ? completed[0].lineItemsJson.map(object) : [];
    if (!items.length || items.some(item => !item.variantId || !Number.isSafeInteger(item.quantity) || item.quantity < 1) ||
        new Set(returned.items.map(item => item.variantId)).size !== returned.items.length ||
        new Set(items.map(item => item.variantId)).size !== returned.items.length ||
        items.some(item => returned.items.find(row => row.variantId === item.variantId)?.quantity !==
          items.filter(row => row.variantId === item.variantId).reduce((sum, row) => sum + row.quantity, 0))) return;
    const shipment = await this.prisma.shipment.findFirst({ where: { merchantId,
      externalOrderId: completed[0].externalOrderId, carrier: "melhor-envio" } });
    if (!shipment?.trackingCode) return;
    const purchases = await this.prisma.trackingEvent.findMany({ where: { merchantId, shipmentId: shipment.id,
      trackingCode: shipment.trackingCode, id: { startsWith: "shipping_label_purchase_" } }, take: 2 });
    const receipt = purchases.length === 1 ? object(purchases[0].carrierRaw) : {};
    if (receipt.kind !== "zyon_native_label_purchase" || !receipt.carrier_order_id || !receipt.account_identity ||
        receipt.external_order_id !== completed[0].externalOrderId) {
      await this.prisma.trackingEvent.upsert({ where: { id: `return_shipping_notice_${key([merchantId, returnId, shipment.id])}` }, update: {}, create: {
        id: `return_shipping_notice_${key([merchantId, returnId, shipment.id])}`, merchantId, shipmentId: shipment.id,
        trackingCode: shipment.trackingCode, status: "cancellation_review_required", occurredAt: new Date(),
        description: "Estorno aprovado. A etiqueta original precisa ser conferida no Melhor Envio antes do cancelamento.",
        carrierRaw: { return_id: returnId, reason: "carrier_original_order_unproven", wallet_refund_status: "unproven" } } });
      return;
    }
    const id = `return_label_cancel_${key([merchantId, shipment.id, receipt.carrier_order_id])}`;
    const metadata = { kind: "zyon_return_label_cancel", return_id: returnId, carrier_order_id: receipt.carrier_order_id,
      account_identity: receipt.account_identity, original_purchase_event_id: purchases[0].id, wallet_refund_status: "unproven" };
    let submit = true;
    try { await this.prisma.trackingEvent.create({ data: { id, merchantId, shipmentId: shipment.id, trackingCode: shipment.trackingCode,
      status: "cancellation_unknown", description: "Cancelamento da etiqueta solicitado por estorno aprovado", occurredAt: new Date(), carrierRaw: metadata } }); }
    catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      submit = false;
      const existing = await this.prisma.trackingEvent.findUnique({ where: { id } });
      if (!existing || existing.status !== "cancellation_unknown" || Date.now() - existing.createdAt.getTime() < 60_000) return;
    }
    await this.observe({ id, merchantId, metadata, submit });
  }

  async cancelMarketplace(merchantId: string, returnId: string) {
    const plan = await this.prisma.marketplaceRefundPlan.findFirst({ where: { hostMerchantId: merchantId, returnId }, include: { fundingPlan: true } });
    if (!plan || fundingHash(plan.fundingPlan.instructions) !== plan.fundingPlan.instructionsHash) return;
    const history = await this.prisma.marketplaceRefundPlan.findMany({ where: { hostMerchantId: merchantId, fundingPlanId: plan.fundingPlanId,
      OR: [{ id: plan.id }, { status: "confirmed" }] } });
    if (history.some(row => fundingHash(row.allocation) !== row.allocationHash)) return;
    const instructions = plan.fundingPlan.instructions as unknown as FrozenMarketplaceFunding;
    const lines = history.flatMap(row => (row.allocation as unknown as MarketplaceRefundAllocation).lines);
    const origins = [...new Set((plan.allocation as unknown as MarketplaceRefundAllocation).lines.map(row => row.sellerMerchantId))]
      .filter(origin => instructions.lines.filter(row => row.sellerMerchantId === origin).every(original =>
        lines.some(row => row.lineItemId === original.lineItemId && row.cumulativeQuantity === row.purchasedQuantity)));
    const shipments = await this.prisma.marketplaceShipmentJournal.findMany({ where: { hostMerchantId: merchantId,
      fundingPlanId: plan.fundingPlanId, originMerchantId: { in: origins }, carrierOrderId: { not: null }, purchasedAt: { not: null } } });
    for (const shipment of shipments) {
      try { await this.marketplace.cancel(merchantId, shipment.id, "return"); }
      catch { this.logger.warn(`return_shipping_cancellation_requires_review return=${returnId} shipment=${shipment.id}`); }
    }
  }

  /** This runs in the existing refund worker even after the buyer was refunded. */
  async reconcile(limit = 10) {
    const rows = await this.prisma.trackingEvent.findMany({ where: { id: { startsWith: "return_label_cancel_" },
      status: "cancellation_unknown", createdAt: { lt: new Date(Date.now() - 60_000) } }, orderBy: { occurredAt: "asc" }, take: limit });
    for (const row of rows) {
      try { await this.observe({ id: row.id, merchantId: row.merchantId, metadata: object(row.carrierRaw), submit: false }); }
      catch { this.logger.warn(`return_shipping_reconciliation_unavailable event=${row.id}`); }
    }
  }

  private async observe(input: { id: string; merchantId: string; metadata: Record<string, any>; submit: boolean }) {
    const outcome = await this.carrier.cancelLabel({ merchantId: input.merchantId, carrierOrderId: input.metadata.carrier_order_id,
      accountIdentity: input.metadata.account_identity as MarketplaceShippingAccountIdentity, submit: input.submit });
    await this.prisma.trackingEvent.updateMany({ where: { id: input.id, merchantId: input.merchantId, status: "cancellation_unknown" }, data: {
      status: outcome.status === "unknown" ? "cancellation_unknown" : outcome.status === "canceled" ? "label_canceled" : "cancellation_not_allowed",
      description: outcome.status === "canceled" ? "Etiqueta cancelada. Crédito na Melhor Carteira ainda não confirmado."
        : outcome.status === "not_cancellable" ? "A transportadora não permite cancelar esta etiqueta. O estorno ao comprador segue separado."
          : "Cancelamento da etiqueta em conferência no Melhor Envio", occurredAt: new Date(),
      carrierRaw: { ...input.metadata, wallet_refund_status: "unproven", reason: outcome.reason } } });
    this.logger.log(`return_shipping_cancellation return=${input.metadata.return_id} status=${outcome.status} wallet_credit=unproven`);
  }
}
