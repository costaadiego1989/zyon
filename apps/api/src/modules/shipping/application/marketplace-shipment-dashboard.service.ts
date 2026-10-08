import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { marketplaceShipmentVolume, type MarketplaceShipmentRequest } from "../domain/marketplace-shipment-journal.js";

const statuses = ["prepared", "cart_unknown", "cart_created", "purchase_unknown", "purchased", "generate_unknown", "generated", "blocked"];

/** Read-only discovery of existing host obligations, independent of current plan. */
@Injectable()
export class MarketplaceShipmentDashboardService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async list(hostMerchantId: string, limit: number, cursor?: string) {
    try {
      // Journal tables have no tenant middleware. Establish the caller through a
      // protected PaymentIntent read before querying a journal, including cursors.
      const ownership = await this.prisma.paymentIntent.findFirst({
        where: { merchantId: hostMerchantId, marketplaceFunding: { is: { hostMerchantId,
          shipments: { some: { hostMerchantId } } } } }, select: { merchantId: true },
      });
      if (!ownership || ownership.merchantId !== hostMerchantId) {
        if (cursor) throw new NotFoundException("marketplace_shipment_not_found");
        return { shipments: [], next_cursor: null };
      }
      const scope = { hostMerchantId, fundingPlan: { hostMerchantId, payment: { merchantId: hostMerchantId } } };
      const anchor = cursor ? await this.prisma.marketplaceShipmentJournal.findFirst({
        where: { ...scope, id: cursor }, select: { id: true, createdAt: true },
      }) : undefined;
      if (cursor && !anchor) throw new NotFoundException("marketplace_shipment_not_found");
      const rows = await this.prisma.marketplaceShipmentJournal.findMany({
        where: { ...scope, ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
        select: { id: true, fundingPlanId: true, originMerchantId: true, reference: true, status: true, carrierOrderId: true,
          claimedAt: true, cancellationStatus: true, createdAt: true, trackingStatus: true, volumeIndex: true, request: true,
          carrierPurchaseId: true, purchaseReceiptHash: true, purchasedAt: true, generationReceiptHash: true, generatedAt: true,
          fundingPlan: { select: { status: true, fundedAt: true, payment: { select: { status: true } }, _count: { select: { refunds: true } } } } },
      });
      // Only public store names of origins already proven in this host's page.
      const origins = await this.prisma.merchant.findMany({ where: { id: { in: [...new Set(rows.slice(0, limit).map(row => row.originMerchantId))] } },
        select: { id: true, name: true } });
      const names = new Map(origins.map(origin => [origin.id, origin.name]));
      return { shipments: rows.slice(0, limit).map(row => {
        const status = statuses.includes(row.status) ? row.status : "blocked";
        const volume = marketplaceShipmentVolume(row.request as unknown as MarketplaceShipmentRequest);
        const recoveryStatus = status === "cart_unknown" ? (!row.carrierOrderId && row.claimedAt && Date.now() - row.claimedAt.getTime() < 60000 ? "in_flight" : "required")
          : row.carrierOrderId && ["cart_created", "purchase_unknown", "purchased", "generate_unknown", "generated"].includes(status) ? "confirmed" : "not_applicable";
        return { shipment_id: row.id, payment_intent_id: row.fundingPlanId, origin_merchant_id: row.originMerchantId,
          origin_name: names.get(row.originMerchantId) ?? "Loja de origem", reference: row.reference, created_at: row.createdAt.toISOString(),
          status, carrier_order_id: row.carrierOrderId, recovery_status: recoveryStatus,
          volume_index: row.volumeIndex, volume_count: volume.count,
          can_recover: recoveryStatus === "required" && !row.cancellationStatus,
          // This is an action hint. The command revalidates complete receipts,
          // stock and financial eligibility both before and after carrier I/O.
          can_print: status === "generated" && !row.cancellationStatus && !!row.carrierOrderId && !!row.carrierPurchaseId &&
            !!row.purchaseReceiptHash && !!row.purchasedAt && !!row.generationReceiptHash && !!row.generatedAt &&
            !["canceled", "expired", "undelivered", "suspended"].includes(row.trackingStatus ?? "") &&
            row.fundingPlan.status === "funded" && !!row.fundingPlan.fundedAt && row.fundingPlan.payment.status === "approved" && row.fundingPlan._count.refunds === 0 };
      }), next_cursor: rows.length > limit ? rows[limit - 1].id : null };
    } catch (error) {
      if (error instanceof NotFoundException) throw new NotFoundException("marketplace_shipment_not_found");
      throw new ServiceUnavailableException("marketplace_shipment_list_temporarily_unavailable");
    }
  }
}
