import { BadRequestException, ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import type { CheckoutSession } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../persistence/persistence.module.js";
import { lockCheckoutSessionAnchor } from "../persistence/checkout-session-lock.js";
import { publicServiceSchedule, resolveSelectedServiceSlot, type PublicServiceSchedule } from "../../modules/catalog/domain/services/service-schedule.js";
import { hasProfessionalServiceSelection, professionalHoldRequests, readProfessionalCheckoutSelections } from "./service-checkout-selection.js";
import { readProfessionalCheckout } from "./read-professional-checkout.js";
import { acquireProfessionalLease, assertProfessionalLease } from "./professional-service-lease.js";
import { admitWhatsAppEffectInTransaction } from "../whatsapp/whatsapp-automation-context.js";
import { paymentCartFingerprint } from "../../modules/checkout/domain/services/payment-cart-fingerprint.js";
import { slotFingerprint, RedisServiceSlots, serviceSlotStore, type SlotHold, type SlotRequest } from "./redis-service-slots.js";
import { assertServiceCheckoutCreationCapability, serviceBookingParentFingerprint, type ServiceCheckoutBookingCapability } from "./service-checkout-provenance.js";
import { executionClock } from "../../modules/revenue-manager/infrastructure/strategy-execution-ledger.js";
import { lockStorefrontCart } from "../persistence/storefront-cart-lock.js";
import type { StorefrontCartCommercialSnapshot } from "../../modules/storefront/domain/ports/storefront-cart.port.js";

import { revalidateNativeServiceBookingAdmission } from "./native-service-booking-authority.js";

export function sessionSlotRequests(session: CheckoutSession): SlotRequest[] {
  if (hasProfessionalServiceSelection(session)) return professionalHoldRequests(readProfessionalCheckoutSelections(session));
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
  /** New service selection, separate from historical variant-only schedules. */
  private async storedProfessionalCheckout(tx: Prisma.TransactionClient, session: CheckoutSession) {
    await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${session.merchantId} FOR UPDATE`;
    await lockCheckoutSessionAnchor(tx, session.merchantId, session.sessionId);
    await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${session.merchantId} AND session_id = ${session.sessionId} FOR UPDATE`;
    const persisted = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.sessionId } } });
    if (!persisted || !isDeepStrictEqual(persisted.cart, JSON.parse(JSON.stringify(session.cart)))
      || persisted.globalUserId !== session.globalUserId) throw new ConflictException("checkout_service_slot_changed");
    return persisted;
  }
  private async professionalSelection(tx: Prisma.TransactionClient, session: CheckoutSession) {
    await this.storedProfessionalCheckout(tx, session);
    return readProfessionalCheckout(tx, session, undefined, { store: () => this.store() });
  }
  async isCommittedCheckout(session: CheckoutSession): Promise<boolean> {
    if (!hasProfessionalServiceSelection(session)) return false;
    return this.prisma.$transaction(async tx => {
      await admitWhatsAppEffectInTransaction(tx, session.merchantId);
      await this.storedProfessionalCheckout(tx, session);
      return this.committedServiceCheckout(tx, session);
    });
  }
  private async committedServiceCheckout(tx: Prisma.TransactionClient, session: CheckoutSession): Promise<boolean> {
    if (await tx.completedOrder.findFirst({ where: { merchantId: session.merchantId, sessionId: session.sessionId } })) return true;
    const receipt = await tx.appointmentAudit.findFirst({ where: { merchantId: session.merchantId, actorId: session.globalUserId,
      action: "checkout_confirm", AND: [{ after: { path: ["checkoutSessionId"], equals: session.sessionId } },
        { after: { path: ["cartFingerprint"], equals: paymentCartFingerprint(session) } }] }, select: { after: true } });
    const after = receipt?.after;
    if (!after || typeof after !== "object" || Array.isArray(after) || !Array.isArray(after.appointmentIds)
      || !after.appointmentIds.length || !after.appointmentIds.every((id): id is string => typeof id === "string")
      || new Set(after.appointmentIds).size !== after.appointmentIds.length) return false;
    return await tx.serviceAppointment.count({ where: { merchantId: session.merchantId, buyerGlobalUserId: session.globalUserId,
      id: { in: after.appointmentIds } } }) === after.appointmentIds.length;
  }
  async acquire(session: CheckoutSession): Promise<SlotHold | undefined> {
    if (hasProfessionalServiceSelection(session)) return this.prisma.$transaction(async tx => {
      await admitWhatsAppEffectInTransaction(tx, session.merchantId);
      if (await this.committedServiceCheckout(tx, session)) return undefined;
      const current = await this.professionalSelection(tx, session);
      return acquireProfessionalLease(session.merchantId, current.selections, current.policy,
        { ownerId: session.sessionId, store: () => this.store() });
    });
    const slots = sessionSlotRequests(session);
    if (!slots.length) return undefined;
    return this.prisma.$transaction(async tx => {
      await admitWhatsAppEffectInTransaction(tx, session.merchantId);
      await lockCheckoutSessionAnchor(tx, session.merchantId, session.sessionId);
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
  async prepareProfessionalCheckout(session: CheckoutSession, requestCapability?: ServiceCheckoutBookingCapability, options: { readonlyWinner?: boolean } = {}) {
    const capability = requestCapability ? structuredClone(requestCapability) : undefined;
    return this.prisma.$transaction(async tx => {
      await revalidateNativeServiceBookingAdmission(tx, capability);
      await admitWhatsAppEffectInTransaction(tx, session.merchantId);
      if (await this.committedServiceCheckout(tx, session)) return undefined;
      const current = await this.professionalSelection(tx, session);
      const products = await tx.product.findMany({ where: { merchantId: session.merchantId,
        id: { in: current.selections.map(selection => selection.productId) } }, select: { id: true, name: true } });
      const professionals = await tx.serviceProfessional.findMany({ where: { merchantId: session.merchantId,
        id: { in: current.selections.map(selection => selection.professionalId) } }, select: { id: true, publicName: true } });
      const selections = current.selections.map(selection => {
        const product = products.find(product => product.id === selection.productId);
        const professional = professionals.find(professional => professional.id === selection.professionalId);
        if (!product || !professional) throw new ConflictException("service_offer_changed");
        return { ...selection, productName: product.name, professionalName: professional.publicName };
      });
      if (capability) {
        let source: Awaited<ReturnType<typeof tx.storefrontCart.findUnique>> | undefined = undefined;
        if (capability.storefrontCartRef) {
          await lockStorefrontCart(tx, session.merchantId, capability.storefrontCartRef);
          source = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: session.merchantId, sessionId: capability.storefrontCartRef } } });
          if (!source || !Array.isArray(source.items) || serviceBookingParentFingerprint(source as unknown as StorefrontCartCommercialSnapshot) !== capability.parentCartFingerprint)
            throw new ConflictException("service_booking_parent_changed");
        }
        const now = await executionClock(tx);
        assertServiceCheckoutCreationCapability(session, capability, now);
        if (source && source.expiresAt <= now) throw new ConflictException("checkout_cart_expired");
      }
      let hold: SlotHold | undefined;
      if (capability && options.readonlyWinner && capability.leaseIntent !== "review_checkout") {
        if (current.policy.holdEnabled) {
          hold = await this.store().get(session.merchantId, session.sessionId);
          const now = await executionClock(tx);
          assertServiceCheckoutCreationCapability(session, capability, now);
          if (!hold || Date.parse(hold.expiresAt) <= now.getTime()
            || slotFingerprint(hold.slots) !== slotFingerprint(professionalHoldRequests(current.selections)))
            throw new ConflictException({ code: "service_hold_required", message: "service_hold_required", next_action: "review_checkout" });
        }
      } else hold = await acquireProfessionalLease(session.merchantId, current.selections, current.policy,
        { ownerId: session.sessionId, store: () => this.store() });
      return { paymentMode: current.policy.paymentMode, policyVersion: current.policyVersion,
        requiresHold: current.policy.holdEnabled, selections, ...(hold ? { hold } : {}) };
    });
  }
  /** Capacity checks also serve local confirmation; a new PSP attempt opts into
   * online-policy admission without changing that existing generic contract. */
  async assertBeforePayment(session: CheckoutSession, options: { requireOnline?: boolean } = {}): Promise<void> {
    if (hasProfessionalServiceSelection(session)) return this.prisma.$transaction(async tx => {
      await admitWhatsAppEffectInTransaction(tx, session.merchantId);
      if (await this.committedServiceCheckout(tx, session)) throw new ConflictException("service_checkout_already_confirmed");
      const current = await this.professionalSelection(tx, session);
      if (options.requireOnline && current.policy.paymentMode !== "online") throw new ConflictException("service_pay_at_attendance_required");
      await assertProfessionalLease(session.merchantId, current.selections, current.policy,
        { ownerId: session.sessionId, store: () => this.store() });
    });
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
    if (hasProfessionalServiceSelection(session)) return this.prisma.$transaction(async tx => {
      await admitWhatsAppEffectInTransaction(tx, session.merchantId);
      if (await this.committedServiceCheckout(tx, session)) return undefined;
      const current = await this.professionalSelection(tx, session);
      if (!current.policy.holdEnabled) return undefined;
      const held = await this.store().get(session.merchantId, session.sessionId);
      return held && slotFingerprint(held.slots) === slotFingerprint(professionalHoldRequests(current.selections)) ? held : undefined;
    });
    return sessionSlotRequests(session).length ? this.store().get(session.merchantId, session.sessionId) : undefined;
  }
  async state(session: CheckoutSession) {
    if (hasProfessionalServiceSelection(session)) {
      return this.prisma.$transaction(async tx => {
        await admitWhatsAppEffectInTransaction(tx, session.merchantId);
        if (await this.committedServiceCheckout(tx, session))
          return { requires_hold: false, service_slot_hold: null };
        const current = await this.professionalSelection(tx, session);
        const held = current.policy.holdEnabled ? await this.store().get(session.merchantId, session.sessionId) : undefined;
        return { requires_hold: current.policy.holdEnabled,
          service_slot_hold: held && slotFingerprint(held.slots) === slotFingerprint(professionalHoldRequests(current.selections)) ? held : null };
      });
    }
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
