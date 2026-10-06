import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { fulfillmentPaymentEligible, lockFulfillmentOrder, persistFulfillmentTransition, projectDigitalFulfillment, reserveService } from "../../../shared/persistence/order-fulfillment.js";
import { hasMarketplaceFulfillmentFunding } from "../../fulfillment/infrastructure/repositories/marketplace-fulfillment-guard.js";
import { actionsForUnit, readFulfillment } from "../domain/order-fulfillment.js";
import { publicServiceSchedule, resolveSelectedServiceSlot } from "../../catalog/domain/services/service-schedule.js";
import { applyFulfillmentSeed, fulfillmentSeedManifest, SANDBOX_ENVIRONMENT_ID, SANDBOX_MERCHANT_ID } from "../infrastructure/order-fulfillment-qa-fixtures.js";

@Injectable()
export class OrderFulfillmentUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  async seedSandbox(merchantId: string) {
    if (process.env.RAILWAY_ENVIRONMENT_ID !== SANDBOX_ENVIRONMENT_ID || merchantId !== SANDBOX_MERCHANT_ID) throw new BadRequestException("qa_seed_sandbox_only");
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (merchant?.storeSlug !== "zyon-demo-alimentos-e-servicos") throw new BadRequestException("qa_seed_merchant_mismatch");
    const manifest = fulfillmentSeedManifest(merchantId);
    const result = await applyFulfillmentSeed(this.prisma, manifest);
    return { ...result, marker: manifest.marker, synthetic: true, orders: manifest.orders.map(order => ({ id: order.id, key: order.key, externalOrderId: order.externalOrderId })) };
  }
  async serviceSlots(merchantId: string, orderId: string, unitId: string) {
    const order = await this.prisma.completedOrder.findFirst({ where: { id: orderId, merchantId } });
    const unit = readFulfillment(order?.fulfillmentJson)?.units.find(item => item.id === unitId);
    if (!order || unit?.strategy !== "scheduled_service") throw new BadRequestException("service_schedule_required");
    const variant = await this.prisma.productVariant.findFirst({ where: { id: unit.variantId, product: { merchantId } }, include: { product: true } });
    const schedule = publicServiceSchedule(variant?.product.metadata);
    const reservations = await this.prisma.serviceReservation.findMany({ where: { merchantId, resourceId: unit.variantId, status: "reserved", NOT: { orderId, unitId }, order: { status: { notIn: ["cancelled", "refunded", "returned", "failed"] } } } });
    return { slots: (schedule?.slots ?? []).map(slot => ({ ...slot, selectable: slot.selectable && !reservations.some(reservation => reservation.startsAt < new Date(slot.endsAt) && reservation.endsAt > new Date(slot.startsAt)) })) };
  }
  async execute(input: { merchantId: string; orderId: string; unitId: string; action: string; expectedVersion: number; commandId: string; actorId: string; proof?: string; quantity?: number; scheduleSlotId?: string }) {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || !/^[A-Za-z0-9_:-]{8,191}$/.test(input.commandId)) throw new BadRequestException("fulfillment_command_invalid");
    const proof = input.proof?.trim();
    if (proof && proof.length > 500) throw new BadRequestException("fulfillment_proof_invalid");
    const fingerprint = createHash("sha256").update(JSON.stringify([input.orderId, input.unitId, input.action, input.expectedVersion, input.quantity ?? null, proof ?? null, input.scheduleSlotId ?? null])).digest("hex");
    return this.prisma.$transaction(async tx => {
      const order = await lockFulfillmentOrder(tx, input.merchantId, input.orderId);
      const prior = await tx.orderFulfillmentAction.findUnique({ where: { merchantId_commandId: { merchantId: input.merchantId, commandId: input.commandId } } });
      if (prior) {
        if (prior.orderId !== order.id || prior.fingerprint !== fingerprint) throw new ConflictException("fulfillment_idempotency_conflict");
        return { changed: false };
      }
      if (order.fulfillmentVersion !== input.expectedVersion) throw new ConflictException("fulfillment_version_conflict");
      if (["cancelled", "refunded", "returned", "failed"].includes(order.status)) throw new ConflictException("fulfillment_order_cancelled");
      const payment = await tx.paymentIntent.findFirst({ where: { merchantId: input.merchantId, sessionId: order.sessionId, providerPaymentId: order.externalOrderId, status: "approved" } });
      if (!fulfillmentPaymentEligible(order, payment)) throw new ConflictException("fulfillment_payment_required");
      if (await hasMarketplaceFulfillmentFunding(tx, { merchantId: order.merchantId, orderId: order.externalOrderId, sessionId: order.sessionId })) throw new ConflictException("marketplace_delivery_proof_required");
      const state = readFulfillment(order.fulfillmentJson);
      const unit = state?.units.find(unit => unit.id === input.unitId);
      if (!state || !unit) throw new BadRequestException("fulfillment_snapshot_review_required");
      const allowed = actionsForUnit(unit).find(action => action.action === input.action);
      if (!allowed) throw new ConflictException("fulfillment_action_not_allowed");
      if (allowed.requiresProof && (!proof || proof.length < 3)) throw new BadRequestException("fulfillment_proof_required");
      if (input.action === "refresh_digital") {
        // The existing delivery service owns retries and provider outcomes.
        // A gesture can request reconciliation, never assert acceptance.
        await projectDigitalFulfillment(tx, input.merchantId, order.id);
        await tx.orderFulfillmentAction.create({ data: { id: `${order.merchantId}:${input.commandId}`, merchantId: input.merchantId, orderId: order.id, unitId: unit.id, commandId: input.commandId, fingerprint,
          action: input.action, actorId: input.actorId, origin: "operator", fromStatus: unit.status, toStatus: unit.status, quantity: 0, occurredAt: new Date() } });
        return { changed: true };
      }
      if (unit.strategy === "scheduled_service") {
        if (input.action === "reschedule_service") {
          const variant = await tx.productVariant.findFirst({ where: { id: unit.variantId, product: { merchantId: input.merchantId } }, include: { product: true } });
          try { unit.schedule = resolveSelectedServiceSlot(variant?.product.metadata, input.scheduleSlotId); }
          catch { throw new BadRequestException("service_schedule_invalid"); }
          if (!unit.schedule) throw new BadRequestException("service_schedule_required");
          await reserveService(tx, order, unit);
          delete unit.attention;
        }
        else if (input.action === "confirm_schedule") { await reserveService(tx, order, unit); delete unit.attention; }
        else if (["start_service", "complete_service", "no_show"].includes(input.action)) {
          const reservation = await tx.serviceReservation.findUnique({ where: { orderId_unitId: { orderId: order.id, unitId: unit.id } } });
          if (!reservation || reservation.status !== "reserved" || !unit.schedule || reservation.startsAt.toISOString() !== unit.schedule.startsAt || reservation.endsAt.toISOString() !== unit.schedule.endsAt) throw new ConflictException("service_reservation_required");
        }
      }
      if (unit.strategy === "scheduled_service" && ["start_service", "no_show"].includes(input.action) && unit.schedule && new Date(unit.schedule.startsAt) > new Date()) throw new ConflictException("service_schedule_not_started");
      const finishing = allowed.targetStage === "completed";
      const quantity = finishing ? input.quantity ?? unit.quantity - unit.completedQuantity : 0;
      if (finishing && (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > unit.quantity - unit.completedQuantity)) throw new BadRequestException("fulfillment_quantity_invalid");
      const fromStatus = unit.status;
      unit.completedQuantity += quantity;
      if (!finishing || unit.completedQuantity === unit.quantity) unit.status = allowed.targetStatus;
      if (input.action === "no_show") unit.attention = "service_no_show";
      await persistFulfillmentTransition(tx, order, state, { unitId: unit.id, action: input.action, commandId: input.commandId, fingerprint,
        actorId: input.actorId, origin: "operator", fromStatus, toStatus: unit.status, quantity, ...(proof ? { proof } : {}) });
      if (unit.strategy === "scheduled_service" && ["completed", "no_show"].includes(unit.status)) await tx.serviceReservation.update({ where: { orderId_unitId: { orderId: order.id, unitId: unit.id } }, data: { status: unit.status } });
      return { changed: true };
    }, { timeout: 15000 });
  }
}
