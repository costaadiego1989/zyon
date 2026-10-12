import { Prisma } from "@prisma/client";
import { fulfillmentPaymentEligible, lockFulfillmentOrder, persistFulfillmentTransition } from "./order-fulfillment.js";
import { readFulfillment } from "../../modules/operations/domain/order-fulfillment.js";

export async function linkShipmentFulfillment(tx: Prisma.TransactionClient, merchantId: string, externalOrderId: string, shipmentId: string): Promise<void> {
  const orders = await tx.completedOrder.findMany({ where: { merchantId, externalOrderId } });
  for (const row of orders) {
    const order = await lockFulfillmentOrder(tx, merchantId, row.id);
    const state = readFulfillment(order.fulfillmentJson);
    if (!state) continue;
    const units = state.units.filter(unit => unit.strategy === "carrier" && !unit.shipmentId && unit.status !== "delivered");
    if (!units.length) continue;
    for (const unit of units) unit.shipmentId = shipmentId;
    await tx.completedOrder.update({ where: { id: order.id }, data: { fulfillmentJson: state as unknown as Prisma.InputJsonValue, fulfillmentVersion: { increment: 1 } } });
  }
}
/** A persisted carrier fact applies exclusively to its explicitly linked units. */
export async function projectShipmentFulfillment(tx: Prisma.TransactionClient, merchantId: string, shipmentId: string): Promise<boolean> {
  const shipment = await tx.shipment.findFirst({ where: { id: shipmentId, merchantId } });
  if (!shipment || !["dispatched", "in_transit", "out_for_delivery", "delivered"].includes(shipment.status)) return false;
  const rows = await tx.completedOrder.findMany({ where: { merchantId, externalOrderId: shipment.externalOrderId } });
  let handled = false;
  for (const row of rows) {
    const order = await lockFulfillmentOrder(tx, merchantId, row.id);
    const state = readFulfillment(order.fulfillmentJson);
    if (!state) continue;
    handled = true;
    if (["cancelled", "returned", "refunded", "failed"].includes(order.status)) continue;
    const payment = await tx.paymentIntent.findFirst({ where: { merchantId, sessionId: order.sessionId, providerPaymentId: order.externalOrderId, status: "approved" } });
    if (!fulfillmentPaymentEligible(order, payment)) continue;
    for (const unit of state.units.filter(unit => unit.strategy === "carrier" && unit.shipmentId === shipmentId && unit.status !== "delivered")) {
      const next = shipment.status === "delivered" ? "delivered" : "shipped";
      if (unit.status === next) continue;
      const fromStatus = unit.status;
      unit.status = next; unit.completedQuantity = next === "delivered" ? unit.quantity : 0;
      await persistFulfillmentTransition(tx, order, state, { unitId: unit.id, action: `carrier_${next}`, commandId: `shipment:${shipmentId}:${unit.id}:${next}`,
        actorId: "carrier", origin: "integration", fromStatus, toStatus: next, quantity: unit.completedQuantity, proof: shipmentId });
      order.fulfillmentVersion++; if (state.units.every(unit => unit.completedQuantity === unit.quantity)) order.fulfilledAt = new Date();
    }
  }
  return handled;
}
