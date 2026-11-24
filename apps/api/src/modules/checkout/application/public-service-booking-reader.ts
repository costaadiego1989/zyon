import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { revalidateNativePublicServiceReadScope, type NativePublicServiceReadScope } from "../../../shared/bookings/native-public-service-read-scope.js";
import { lockServiceProfessional } from "../../../shared/bookings/service-professional-lock.js";
import { hasUnclassifiedServiceReservations } from "../../../shared/bookings/service-legacy-readiness.js";
import { serviceSlotStore, type RedisServiceSlots } from "../../../shared/bookings/redis-service-slots.js";
import { professionalSlotId, type ProfessionalCheckoutSelection } from "../../../shared/bookings/service-checkout-selection.js";
import { resolveServiceBusinessPolicy } from "../../merchant/domain/service-business-policy.js";
import { getProfessionalAvailability } from "../../catalog/application/get-professional-availability.js";
import { FIXED_SERVICE_TIME_ZONE } from "../../catalog/domain/services/fixed-service-time-zone.js";
import { publicProfessionalProfile, readProfessionalServiceLink, resolveProfessionalServiceLink } from "../../catalog/domain/services/professional-service-link.js";
import { overlayCurrentProfessionalHolds } from "../../knowledge-base/infrastructure/prisma-current-service-facts-reader.js";
import { executionClock } from "../../revenue-manager/infrastructure/strategy-execution-ledger.js";

/** Private transport authority derived only from a verified embed or conversation
 * capability. Anonymous browsing carries no buyer, cart, session or write grant. */
export interface StorefrontPublicServiceReadScope {
  readonly transport?: undefined;
  readonly merchantId: string;
  readonly allowedOrigin: string;
  readonly expiresAtUnix: number;
}
export type PublicServiceReadScope = StorefrontPublicServiceReadScope | NativePublicServiceReadScope;

type Offer = { productId: string; variantId: string };
type ProfessionalChoice = Offer & { professionalId: string };
type Tx = Prisma.TransactionClient;

/** Published service facts only. These methods never create a cart, lease,
 * checkout, appointment or payment, and never exclude an owner's existing hold. */
export class PublicServiceBookingReader {
  constructor(private readonly prisma: Pick<PrismaClient, "$transaction">,
    private readonly store: () => Pick<RedisServiceSlots, "active"> = serviceSlotStore) {}

  private async authorize(tx: Tx, scope: PublicServiceReadScope) {
    if (!scope || typeof scope.merchantId !== "string" || !scope.merchantId || !Number.isSafeInteger(scope.expiresAtUnix))
      throw new ForbiddenException("service_booking_capability_invalid");
    if (scope.transport !== undefined) return revalidateNativePublicServiceReadScope(tx, scope);
    try {
      const origin = new URL(scope.allowedOrigin);
      if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== scope.allowedOrigin)
        throw new Error("invalid_origin");
    } catch { throw new ForbiddenException("service_booking_capability_invalid"); }
    const now = await executionClock(tx);
    if (scope.expiresAtUnix <= Math.floor(now.getTime() / 1000)) throw new UnauthorizedException("embed_session_token_expired");
    return now;
  }
  private async merchant(tx: Tx, scope: PublicServiceReadScope) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id=${scope.merchantId} FOR SHARE`;
    if (rows.length !== 1) throw new NotFoundException("merchant_not_found");
    await this.authorize(tx, scope);
    if (await hasUnclassifiedServiceReservations(tx, scope.merchantId)) throw new ConflictException("service_legacy_classification_required");
    const merchant = await tx.merchant.findUnique({ where: { id: scope.merchantId }, select: {
      businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true } });
    if (!merchant) throw new NotFoundException("merchant_not_found");
    const policy = await tx.serviceBusinessPolicy.findUnique({ where: { merchantId: scope.merchantId } });
    const business = resolveServiceBusinessPolicy({ ...merchant, hasLegacyServiceData: false, policy });
    if (!business.capabilities.serviceBooking || !business.policy || business.policyVersion === null)
      throw new ConflictException("service_booking_" + business.bookingBlockReason);
    return { policy: business.policy, version: business.policyVersion };
  }
  private async read<T>(scope: PublicServiceReadScope, professionalId: string | undefined,
    work: (tx: Tx, bound: PublicServiceReadScope, business: Awaited<ReturnType<PublicServiceBookingReader["merchant"]>>) => Promise<T>) {
    const bound: PublicServiceReadScope = scope.transport === "whatsapp" ? scope
      : Object.freeze({ merchantId: scope.merchantId, allowedOrigin: scope.allowedOrigin, expiresAtUnix: scope.expiresAtUnix });
    return this.prisma.$transaction(async tx => {
      await this.authorize(tx, bound);
      const business = await this.merchant(tx, bound);
      if (professionalId) await lockServiceProfessional(tx, bound.merchantId, professionalId);
      const result = await work(tx, bound, business);
      await this.authorize(tx, bound);
      return result;
    }, { timeout: 15_000 });
  }
  private async availability(tx: Tx, scope: PublicServiceReadScope,
    input: ProfessionalChoice & { fromDate: string; toDate: string }, business: Awaited<ReturnType<PublicServiceBookingReader["merchant"]>>) {
    const facts = await readProfessionalServiceLink(tx, { ...input, merchantId: scope.merchantId });
    const now = await this.authorize(tx, scope);
    const availability = await getProfessionalAvailability(tx, { ...input, merchantId: scope.merchantId, now });
    if (availability.policyVersion !== business.version) throw new ConflictException("service_policy_changed");
    let active: Awaited<ReturnType<RedisServiceSlots["active"]>> = [];
    if (business.policy.holdEnabled) {
      try { active = await this.store().active(scope.merchantId, "professional:" + input.professionalId); }
      catch { throw new ServiceUnavailableException("service_schedule_temporarily_unavailable"); }
    }
    const current = await this.authorize(tx, scope);
    const slots = overlayCurrentProfessionalHolds(availability.slots, active, "professional:" + input.professionalId)
      .filter(slot => Date.parse(slot.startsAt) > current.getTime());
    return { facts: { ...facts, timeZone: availability.timeZone }, slots, dates: [...new Set(slots.map(slot => slot.date))] };
  }
  async professionals(scope: PublicServiceReadScope, input: Offer) {
    return this.read(scope, undefined, async (tx, bound) => {
      const variant = await tx.productVariant.findFirst({ where: { id: input.variantId, productId: input.productId, isActive: true,
        product: { merchantId: bound.merchantId, type: "service", isActive: true, deletedAt: null } }, select: { id: true } });
      if (!variant) throw new NotFoundException("professional_service_not_found");
      const rows = await tx.professionalService.findMany({ where: { merchantId: bound.merchantId, productId: input.productId, isActive: true,
        professional: { merchantId: bound.merchantId, isActive: true, isPublished: true } },
        include: { professional: true, product: { include: { category: true, variants: { where: { id: input.variantId }, include: { price: true }, take: 1 } } } },
        orderBy: { id: "asc" }, take: 51 });
      const professionals = rows.slice(0, 50).map(row => {
        const variant = row.product.variants[0];
        if (!variant) throw new NotFoundException("professional_service_not_found");
        const facts = resolveProfessionalServiceLink({ merchantId: bound.merchantId, professional: row.professional, link: row,
          product: row.product, category: row.product.category, variant });
        return { id: facts.professionalId, name: row.professional.publicName, version: facts.professionalVersion,
          timeZone: FIXED_SERVICE_TIME_ZONE, profile: publicProfessionalProfile(row.professional.publicProfile) };
      });
      return { professionals, has_more: rows.length > 50 };
    });
  }
  async dates(scope: PublicServiceReadScope, input: ProfessionalChoice & { fromDate: string; toDate: string }) {
    return this.read(scope, input.professionalId, async (tx, bound, business) => {
      const result = await this.availability(tx, bound, input, business);
      return { dates: result.dates, professional_version: result.facts.professionalVersion, policy_version: business.version, time_zone: result.facts.timeZone };
    });
  }
  async slots(scope: PublicServiceReadScope, input: ProfessionalChoice & { date: string }) {
    return this.read(scope, input.professionalId, async (tx, bound, business) => {
      const result = await this.availability(tx, bound, { ...input, fromDate: input.date, toDate: input.date }, business);
      return { selections: result.slots.map(slot => {
        const value: Omit<ProfessionalCheckoutSelection, "slotId"> = { productId: result.facts.productId, variantId: result.facts.variantId,
          professionalId: result.facts.professionalId, professionalVersion: result.facts.professionalVersion, policyVersion: business.version,
          date: slot.date, startsAt: slot.startsAt, endsAt: slot.endsAt, timeZone: slot.timeZone, durationMinutes: slot.durationMinutes,
          priceInCents: result.facts.priceInCents, currency: result.facts.currency };
        return { ...value, slotId: professionalSlotId(bound.merchantId, value) };
      }) };
    });
  }
  /** Read-only review of an exact current public slot. A later Continue must
   * independently resolve private authority and revalidate the canonical offer. */
  async preview(scope: PublicServiceReadScope, input: { selection: ProfessionalCheckoutSelection }) {
    const choice = structuredClone(input.selection);
    return this.read(scope, choice.professionalId, async (tx, bound, business) => {
      const result = await this.availability(tx, bound, { ...choice, fromDate: choice.date, toDate: choice.date }, business);
      const slot = result.slots.find(value => value.startsAt === choice.startsAt && value.endsAt === choice.endsAt);
      if (!slot) throw new ConflictException("service_slot_unavailable");
      const value = { productId: result.facts.productId, variantId: result.facts.variantId, professionalId: result.facts.professionalId,
        professionalVersion: result.facts.professionalVersion, policyVersion: business.version, date: slot.date, startsAt: slot.startsAt,
        endsAt: slot.endsAt, timeZone: slot.timeZone, durationMinutes: slot.durationMinutes, priceInCents: result.facts.priceInCents, currency: result.facts.currency };
      const selection = { ...value, slotId: professionalSlotId(bound.merchantId, value) };
      if (!isDeepStrictEqual(selection, choice)) throw new ConflictException("service_selection_stale");
      const [product, professional] = await Promise.all([
        tx.product.findFirst({ where: { id: choice.productId, merchantId: bound.merchantId }, select: { name: true } }),
        tx.serviceProfessional.findFirst({ where: { id: choice.professionalId, merchantId: bound.merchantId }, select: { publicName: true } }),
      ]);
      if (!product || !professional) throw new NotFoundException("professional_service_not_found");
      return { selection, service: { name: product.name }, professional: { name: professional.publicName },
        policy: { version: business.version, ...business.policy } };
    });
  }
}
