import { ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { getProfessionalAvailability } from "../../modules/catalog/application/get-professional-availability.js";
import { resolveServiceBusinessPolicy } from "../../modules/merchant/domain/service-business-policy.js";
import { lockServiceProfessional } from "./service-professional-lock.js";
import { hasUnclassifiedServiceReservations } from "./service-legacy-readiness.js";
import { readProfessionalCheckoutSelections, type ProfessionalSelectionCart } from "./service-checkout-selection.js";

/** Caller owns the transaction and supplies an authenticated persisted cart.
 * All catalog/calendar mutations share merchant -> sorted professional locks. */
export async function readProfessionalCheckout(
  tx: Prisma.TransactionClient,
  session: ProfessionalSelectionCart,
  clock: () => Date = () => new Date(),
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
  const now = clock();
  if (!Number.isFinite(now.getTime())) throw new ConflictException("service_checkout_invalid_clock");
  for (const selected of selections) {
    if (selected.policyVersion !== business.policyVersion) throw new ConflictException("service_policy_changed");
    const variant = await tx.productVariant.findFirst({ where: { id: selected.variantId, productId: selected.productId,
      isActive: true, product: { merchantId: session.merchantId, type: "service", isActive: true, deletedAt: null } },
      select: { price: { select: { basePriceInCents: true, currency: true } } } });
    if (!variant?.price || variant.price.basePriceInCents !== selected.priceInCents || variant.price.currency !== selected.currency)
      throw new ConflictException("service_offer_changed");
    const availability = await getProfessionalAvailability(tx, { merchantId: session.merchantId,
      productId: selected.productId, variantId: selected.variantId, professionalId: selected.professionalId,
      fromDate: selected.date, toDate: selected.date, expectedVersion: selected.professionalVersion, now });
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
