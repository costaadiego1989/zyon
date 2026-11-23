import { ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { getProfessionalAvailability } from "../../modules/catalog/application/get-professional-availability.js";
import { resolveServiceBusinessPolicy } from "../../modules/merchant/domain/service-business-policy.js";
import { lockServiceProfessional } from "./service-professional-lock.js";
import { hasUnclassifiedServiceReservations } from "./service-legacy-readiness.js";
import { readProfessionalCheckoutSelections, type ProfessionalSelectionCart } from "./service-checkout-selection.js";
import { isDeepStrictEqual } from "node:util";
import { FIXED_SERVICE_TIME_ZONE } from "../../modules/catalog/domain/services/fixed-service-time-zone.js";
import { preserveVerifiedProfessionalAvailability } from "../../modules/catalog/application/professional-availability-continuation.js";
import { captureAppointmentLease } from "./appointment-lease-proof.js";
import { professionalHoldRequests } from "./service-checkout-selection.js";
import { serviceSlotStore, type RedisServiceSlots } from "./redis-service-slots.js";
import { stripStoredCheckoutCouponBinding } from "../../modules/checkout/domain/services/checkout-coupon-storage.js";

/** Caller owns the transaction and supplies an authenticated persisted cart.
 * All catalog/calendar mutations share merchant -> sorted professional locks. */
export async function readProfessionalCheckout(
  tx: Prisma.TransactionClient,
  session: ProfessionalSelectionCart & { sessionId?: string },
  clock: () => Date = () => new Date(),
  context: { store?: () => Pick<RedisServiceSlots, "assertActive"> } = {},
) {
  const selections = readProfessionalCheckoutSelections(session);
  if (!selections.length || selections.length !== session.cart.items.length)
    throw new ConflictException("service_professional_selection_required");
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id = ${session.merchantId} FOR UPDATE`;
  if (locked.length !== 1) throw new NotFoundException("merchant_not_found");
  for (const id of [...new Set(selections.map(selection => selection.professionalId))].sort())
    await lockServiceProfessional(tx, session.merchantId, id);
  if (await hasUnclassifiedServiceReservations(tx, session.merchantId))
    throw new ConflictException("service_legacy_classification_required");
  const merchant = await tx.merchant.findUniqueOrThrow({ where: { id: session.merchantId }, select: {
    businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true,
  } });
  const row = await tx.serviceBusinessPolicy.findUnique({ where: { merchantId: session.merchantId } });
  const business = resolveServiceBusinessPolicy({ ...merchant, hasLegacyServiceData: false, policy: row });
  if (!business.capabilities.serviceBooking || !business.policy || business.policyVersion === null)
    throw new ConflictException("service_booking_" + business.bookingBlockReason);
  const policy = business.policy;
  const now = clock();
  if (!Number.isFinite(now.getTime())) throw new ConflictException("service_checkout_invalid_clock");
  // A saved cart alone cannot preserve an old civil-date contract. Require
  // its exact SQL session and current original Redis generation, read-only.
  const historic = selections.filter(selected => selected.timeZone !== FIXED_SERVICE_TIME_ZONE);
  let verifiedHistoric = false;
  const verifyHistoric = async () => {
    if (verifiedHistoric) return;
    if (!policy.holdEnabled || !session.sessionId) throw new ConflictException("service_timezone_selection_required");
    const persisted = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.sessionId } } });
    if (!persisted || !isDeepStrictEqual(stripStoredCheckoutCouponBinding(persisted.cart), JSON.parse(JSON.stringify(stripStoredCheckoutCouponBinding(session.cart)))))
      throw new ConflictException("checkout_service_slot_changed");
    const proof = await (context.store ?? serviceSlotStore)().assertActive(session.merchantId, session.sessionId, professionalHoldRequests(selections));
    for (const selected of historic) {
      const capture = captureAppointmentLease(session.merchantId, session.sessionId, proof, professionalHoldRequests([selected])[0]);
      if (Date.parse(capture.expiresAt) <= now.getTime()) throw new ConflictException("checkout_service_hold_expired");
    }
    verifiedHistoric = true;
  };
  for (const selected of selections) {
    if (selected.policyVersion !== business.policyVersion) throw new ConflictException("service_policy_changed");
    const variant = await tx.productVariant.findFirst({ where: { id: selected.variantId, productId: selected.productId,
      isActive: true, product: { merchantId: session.merchantId, type: "service", isActive: true, deletedAt: null } },
      select: { price: { select: { basePriceInCents: true, currency: true } } } });
    if (!variant?.price || variant.price.basePriceInCents !== selected.priceInCents || variant.price.currency !== selected.currency)
      throw new ConflictException("service_offer_changed");
    if (historic.includes(selected)) await verifyHistoric();
    const availability = await getProfessionalAvailability(tx, { merchantId: session.merchantId,
      productId: selected.productId, variantId: selected.variantId, professionalId: selected.professionalId,
      fromDate: selected.date, toDate: selected.date, expectedVersion: selected.professionalVersion, now },
      historic.includes(selected) ? { continuation: preserveVerifiedProfessionalAvailability(session.merchantId, selected) } : {});
    if (availability.status === "stale" || availability.professionalVersion !== selected.professionalVersion)
      throw new ConflictException("service_selection_stale");
    if (availability.policyVersion !== selected.policyVersion) throw new ConflictException("service_policy_changed");
    if (availability.status !== "ready" || !availability.slots.some(slot => slot.date === selected.date
      && slot.startsAt === selected.startsAt && slot.endsAt === selected.endsAt
      && slot.timeZone === selected.timeZone && slot.durationMinutes === selected.durationMinutes))
      throw new ConflictException("service_slot_unavailable");
  }
  return { selections, policy: business.policy, policyVersion: business.policyVersion };
}
