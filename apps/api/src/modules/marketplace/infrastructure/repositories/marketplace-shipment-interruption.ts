import type { Prisma } from "@prisma/client";
import { fundingHash } from "./prisma-marketplace-funding.repository.js";

/** Preserve an in-flight carrier operation's CAS and receipts. Returning money
 * or accepting a dispute never proves that a purchased label was cancelled. */
export async function recordMarketplaceShipmentInterruption(tx: Prisma.TransactionClient, fundingPlanIds: string[],
  reason: "return_after_carrier_submission" | "dispute_after_carrier_submission") {
  if (!fundingPlanIds.length) return;
  const shipments = await tx.marketplaceShipmentJournal.findMany({ where: {
    fundingPlanId: { in: fundingPlanIds }, purchaseClaimedAt: { not: null },
  }, select: { id: true, hostMerchantId: true, originMerchantId: true, fundingPlanId: true, carrierOrderId: true } });
  for (const shipment of shipments) {
    const eventId = `marketplace_shipment_interruption_${fundingHash([shipment.id, reason])}`;
    await tx.outboxMessage.upsert({ where: { eventId }, update: {}, create: {
      eventId, eventType: "marketplace.shipment.reconciliation_required", schemaVersion: 1, producer: "marketplace",
      merchantId: shipment.hostMerchantId, correlationId: shipment.fundingPlanId, causationId: shipment.id, occurredAt: new Date(),
      payload: { shipment_id: shipment.id, funding_plan_id: shipment.fundingPlanId, origin_merchant_id: shipment.originMerchantId,
        carrier_order_id: shipment.carrierOrderId, reason },
    } });
  }
}
