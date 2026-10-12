import { BadRequestException, ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import type { CheckoutSession } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../persistence/persistence.module.js";
import { publicServiceSchedule, resolveSelectedServiceSlot, type PublicServiceSchedule } from "../../modules/catalog/domain/services/service-schedule.js";
import { RedisServiceSlots, serviceSlotStore, type SlotHold, type SlotRequest } from "./redis-service-slots.js";

export function sessionSlotRequests(session: CheckoutSession): SlotRequest[] {
  return session.cart.items.filter(item => item.fulfillmentStrategy === "scheduled_service").map(item => {
    if (item.productType !== "service" || !item.variantId || !item.fulfillmentSchedule || item.quantity !== 1) throw new BadRequestException("service_schedule_required");
    const { slotId, startsAt, endsAt } = item.fulfillmentSchedule;
    return { resourceId: item.variantId, slotId, startsAt, endsAt };
  });
}
export async function lockServiceResource(tx: Prisma.TransactionClient, merchantId: string, resourceId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`${merchantId}:service:${resourceId}`}, 0))`);
}
@Injectable()
export class ServiceSlotHoldsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient, @Optional() private readonly testStore?: RedisServiceSlots) {}
  private store() { return this.testStore ?? serviceSlotStore(); }
  async acquire(session: CheckoutSession): Promise<SlotHold | undefined> {
    const slots = sessionSlotRequests(session);
    if (!slots.length) return undefined;
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${session.merchantId} AND session_id = ${session.sessionId} FOR UPDATE`;
      if (await tx.completedOrder.findFirst({ where: { merchantId: session.merchantId, sessionId: session.sessionId } })) return undefined;
      const persisted = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.sessionId } } });
      if (!persisted || !isDeepStrictEqual((persisted.cart as any).items, JSON.parse(JSON.stringify(session.cart.items)))) throw new ConflictException("checkout_service_slot_changed");
      for (const id of [...new Set(slots.map(s => s.resourceId))].sort()) await lockServiceResource(tx, session.merchantId, id);
      for (const [index, slot] of slots.entries()) {
        if (slots.slice(0, index).some(s => s.resourceId === slot.resourceId && s.startsAt < slot.endsAt && s.endsAt > slot.startsAt)) throw new BadRequestException("service_slot_quantity_invalid");
        const variant = await tx.productVariant.findFirst({ where: { id: slot.resourceId, isActive: true, product: { merchantId: session.merchantId, type: "service", isActive: true } }, include: { product: true } });
        let current;
        try { current = resolveSelectedServiceSlot(variant?.product.metadata, slot.slotId); } catch { throw new ConflictException("service_slot_unavailable"); }
        const selected = session.cart.items.find(item => item.variantId === slot.resourceId && item.fulfillmentSchedule?.slotId === slot.slotId)?.fulfillmentSchedule;
        if (!variant || !current || !selected || current.startsAt !== selected.startsAt || current.endsAt !== selected.endsAt || current.timeZone !== selected.timeZone || current.durationMinutes !== selected.durationMinutes) throw new ConflictException("checkout_service_slot_changed");
        const booked = await tx.serviceReservation.findFirst({ where: { merchantId: session.merchantId, resourceId: slot.resourceId, status: "reserved", startsAt: { lt: new Date(slot.endsAt) }, endsAt: { gt: new Date(slot.startsAt) }, order: { status: { notIn: ["cancelled", "refunded", "returned", "failed"] } } } });
        if (booked) throw new ConflictException("service_slot_unavailable");
      }
      return this.store().acquire(session.merchantId, session.sessionId, slots);
    }, { timeout: 15000 });
  }
  async assertBeforePayment(session: CheckoutSession): Promise<void> {
    const slots = sessionSlotRequests(session);
    if (!slots.length) return;
    for (const slot of slots) {
      const variant = await this.prisma.productVariant.findFirst({ where: { id: slot.resourceId, isActive: true, product: { merchantId: session.merchantId, type: "service", isActive: true } }, include: { product: true } });
      let current;
      try { current = resolveSelectedServiceSlot(variant?.product.metadata, slot.slotId); } catch { throw new ConflictException("checkout_service_slot_changed"); }
      if (!variant || !current || current.startsAt !== slot.startsAt || current.endsAt !== slot.endsAt) throw new ConflictException("checkout_service_slot_changed");
    }
    await this.store().assertActive(session.merchantId, session.sessionId, slots);
  }
  async get(session: CheckoutSession): Promise<SlotHold | undefined> {
    return sessionSlotRequests(session).length ? this.store().get(session.merchantId, session.sessionId) : undefined;
  }
  async state(session: CheckoutSession) {
    const required = sessionSlotRequests(session).length > 0 && !await this.prisma.completedOrder.findFirst({ where: { merchantId: session.merchantId, sessionId: session.sessionId } });
    return { requires_hold: required, service_slot_hold: required ? await this.get(session) ?? null : null };
  }
  async release(merchantId: string, sessionId: string, fingerprint?: string) { await this.store().release(merchantId, sessionId, fingerprint); }
  async availability(merchantId: string, resourceId: string, metadata: unknown, exclude?: { orderId: string; unitId: string }): Promise<PublicServiceSchedule | undefined> {
    const schedule = publicServiceSchedule(metadata);
    if (!schedule) return undefined;
    return this.prisma.$transaction(async tx => {
      await lockServiceResource(tx, merchantId, resourceId);
      const booked = await tx.serviceReservation.findMany({ where: { merchantId, resourceId, status: "reserved", ...(exclude ? { NOT: exclude } : {}), order: { status: { notIn: ["cancelled", "refunded", "returned", "failed"] } } } });
      const holds = await this.store().active(merchantId, resourceId);
      const result = { ...schedule, slots: schedule.slots.map(slot => ({ ...slot, selectable: slot.selectable
        && !booked.some(b => b.startsAt < new Date(slot.endsAt) && b.endsAt > new Date(slot.startsAt))
        && !holds.some(h => h.slots.some(s => s.resourceId === resourceId && s.startsAt < slot.endsAt && s.endsAt > slot.startsAt)) })) };
      await this.store().cacheSchedule(merchantId, resourceId, result);
      return result;
    }, { timeout: 15000 });
  }
}
