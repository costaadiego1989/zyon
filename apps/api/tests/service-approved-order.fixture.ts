// Builds scoped SQL evidence after real service HTTP setup.
// The stored approval is synthetic local evidence, never a PSP/webhook claim.
import { randomUUID } from "node:crypto";
import { professionalSlotId } from "../src/shared/bookings/service-checkout-selection.js";
import { serviceCheckoutProvenance } from "../src/shared/bookings/service-checkout-provenance.js";
export async function seedApprovedProfessionalCase(f: any, suffix: string, options: { origin?: "storefront" | "whatsapp"; proven?: boolean; startsAt?: string; manualAppointment?: true } = {}) {
  const c = await f.prepare("approved-" + suffix, "online"), startsAt = options.startsAt ?? c.command.startsAt;
  // Historical paid UTC facts precede every selector, receipt and order; new manual terms keep their actual snapshot.
  if (!options.manualAppointment) c.professional = await f.prisma.serviceProfessional.update({ where: { id: c.professional.id }, data: { timeZone: "UTC" } });
  const timeZone = options.manualAppointment ? c.appointment.timeZone : "UTC";
  const endsAt = new Date(Date.parse(startsAt) + 20 * 60_000).toISOString(), sessionId = "paid-session-" + suffix, buyerId = "paid-buyer-" + suffix;
  const selected = { productId: c.product.id, variantId: c.product.variants[0].id, professionalId: c.professional.id,
    professionalVersion: c.professional.version, policyVersion: c.command.expectedPolicyVersion, date: startsAt.slice(0, 10), startsAt, endsAt,
    timeZone, durationMinutes: 20, priceInCents: 5000, currency: "BRL" };
  const schedule = { professionalId: selected.professionalId, professionalVersion: selected.professionalVersion, policyVersion: selected.policyVersion,
    date: selected.date, startsAt, endsAt, timeZone, durationMinutes: 20, slotId: professionalSlotId(c.merchantId, selected) };
  const unitId = "paid-unit-" + suffix, intentId = "paid-intent-" + suffix, providerId = "synthetic-provider-" + suffix;
  const scope = { merchantId: c.merchantId, sessionId, globalUserId: buyerId }, now = new Date();
  const provenance = options.proven === false ? {} : serviceCheckoutProvenance(scope, { serverChannel: options.origin ?? "storefront",
    trustedBuyer: { globalUserId: buyerId, customer: { email: "verified@example.test", email_verified: true } } });
  await f.prisma.checkoutSession.create({ data: { ...scope, conversationId: "paid-conversation-" + suffix, cart: { items: [], total: 50, currency: "BRL" },
    customer: { fullName: "Synthetic paid customer", email: "verified@example.test", email_verified: true }, createdAt: now, updatedAt: now,
    abandonmentScore: 0, triggerAgent: false, ...provenance } });
  const payment = await f.prisma.paymentIntent.create({ data: { id: intentId, merchantId: c.merchantId, sessionId, idempotencyKey: "synthetic-paid-" + suffix,
    amountCents: 5000, approvedAmountCents: 5000, currency: "BRL", method: "pix", status: "approved", providerPaymentId: providerId } });
  const order = await f.prisma.completedOrder.create({ data: { id: randomUUID(), merchantId: c.merchantId, sessionId, externalOrderId: providerId,
    orderTotal: 50, currency: "BRL", completedAt: now, lineItemsJson: [{ snapshotVersion: 2, lineId: unitId, sku: "paid-sku-" + suffix,
      productType: "service", fulfillmentStrategy: "scheduled_service", variantId: selected.variantId, unitPriceCents: 5000, quantity: 1, schedule }] } });
  return { ...c, payment, order, unitId, selected, schedule, buyerId, sessionId };
}
