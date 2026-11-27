import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { lockServiceProfessional } from "../../../shared/bookings/service-professional-lock.js";
import { hasUnclassifiedServiceReservations } from "../../../shared/bookings/service-legacy-readiness.js";
import { serviceSlotStore, type RedisServiceSlots } from "../../../shared/bookings/redis-service-slots.js";
import { resolveServiceBusinessPolicy } from "../../merchant/domain/service-business-policy.js";
import { readProfessionalServiceLink } from "../../catalog/domain/services/professional-service-link.js";
import { getProfessionalAvailability, type ProfessionalAvailabilityReadInput } from "../../catalog/application/get-professional-availability.js";
import type { ProfessionalSlot } from "../../catalog/domain/services/professional-availability.js";

type ActiveHold = Awaited<ReturnType<RedisServiceSlots["active"]>>[number];
export type CurrentServiceChoice = Readonly<Omit<ProfessionalAvailabilityReadInput, "merchantId" | "now" | "expectedVersion">>;
/** Constructed only by verified transport code. Never a body/model DTO. */
export interface CurrentServiceReadScope { readonly merchantId: string; readonly holdOwnerId?: string }

export function overlayCurrentProfessionalHolds(slots: readonly ProfessionalSlot[], active: readonly ActiveHold[], resourceId: string,
  verifiedHoldOwnerId?: string): ProfessionalSlot[] {
  const own = verifiedHoldOwnerId ? createHash("sha256").update(verifiedHoldOwnerId).digest("hex") : undefined;
  const occupied: Array<{ start: number; end: number }> = [];
  for (const hold of active) {
    if (!hold || typeof hold.owner !== "string" || !hold.owner || !Array.isArray(hold.slots))
      throw new ServiceUnavailableException("service_live_holds_invalid");
    for (const slot of hold.slots) {
      if (!slot || typeof slot.resourceId !== "string") throw new ServiceUnavailableException("service_live_holds_invalid");
      const start = Date.parse(slot.startsAt), end = Date.parse(slot.endsAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
        throw new ServiceUnavailableException("service_live_holds_invalid");
      if (hold.owner !== own && slot.resourceId === resourceId) occupied.push({ start, end });
    }
  }
  return slots.filter(slot => !occupied.some(interval => interval.start < Date.parse(slot.endsAt) && interval.end > Date.parse(slot.startsAt)))
    .map(slot => ({ ...slot }));
}

/** Read-only current operational facts. Source/final-answer admission is
 * separate; callers must not publish model price/slots in place of this result. */
export class PrismaCurrentServiceFactsReader {
  constructor(private readonly prisma: Pick<PrismaClient, "$transaction">,
    private readonly tenant: Pick<TenantContextService, "get">,
    private readonly store: () => Pick<RedisServiceSlots, "active"> = serviceSlotStore,
    private readonly clock: () => Date = () => new Date()) {}

  private assertScope(merchantId: string) {
    if (!merchantId || this.tenant.get()?.merchantId !== merchantId) throw new Error("service_live_scope_mismatch");
  }
  async read(choice: CurrentServiceChoice, scope: CurrentServiceReadScope) {
    this.assertScope(scope.merchantId);
    // Immutable original server selection, never a mutable model/caller alias.
    const input = structuredClone(choice), bound = { ...scope };
    return this.prisma.$transaction(async tx => {
      this.assertScope(bound.merchantId);
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM merchants WHERE id=${bound.merchantId} FOR SHARE`);
      if (locked.length !== 1) throw new ConflictException("service_live_company_unavailable");
      await lockServiceProfessional(tx, bound.merchantId, input.professionalId);
      if (await hasUnclassifiedServiceReservations(tx, bound.merchantId)) throw new ConflictException("service_legacy_classification_required");
      const merchant = await tx.merchant.findUnique({ where: { id: bound.merchantId }, select: {
        businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true,
      } });
      if (!merchant) throw new ConflictException("service_live_company_unavailable");
      const policy = await tx.serviceBusinessPolicy.findUnique({ where: { merchantId: bound.merchantId } });
      const business = resolveServiceBusinessPolicy({ ...merchant, hasLegacyServiceData: false, policy });
      if (!business.capabilities.serviceBooking || !business.policy) throw new ConflictException("service_booking_" + business.bookingBlockReason);
      const currentInput = { ...input, merchantId: bound.merchantId, now: this.clock() };
      const facts = await readProfessionalServiceLink(tx, currentInput);
      const availability = await getProfessionalAvailability(tx, currentInput);
      this.assertScope(bound.merchantId);
      if (availability.status === "stale" || availability.policyVersion !== business.policyVersion)
        throw new ConflictException("service_live_selection_changed");
      const active = business.policy.holdEnabled ? await this.store().active(bound.merchantId, "professional:" + input.professionalId) : [];
      this.assertScope(bound.merchantId);
      const slots = overlayCurrentProfessionalHolds(availability.slots, active, "professional:" + input.professionalId, bound.holdOwnerId);
      const [productLabel, professionalLabel] = await Promise.all([
        tx.product.findFirst({ where: { id: input.productId, merchantId: bound.merchantId }, select: { name: true } }),
        tx.serviceProfessional.findFirst({ where: { id: input.professionalId, merchantId: bound.merchantId }, select: { publicName: true } }),
      ]);
      if (!productLabel || !professionalLabel) throw new ConflictException("service_live_selection_changed");
      // Public live facts describe this new selection in the canonical availability zone.
      // Historical professional and recurring-rule zones stay unchanged in storage.
      return { facts: { ...facts, timeZone: availability.timeZone }, publicLabels: { serviceName: productLabel.name, professionalName: professionalLabel.publicName },
        availability: { ...availability, status: slots.length ? "ready" as const : "empty" as const,
        slots, dates: [...new Set(slots.map(slot => slot.date))] } };
    });
  }
}
