import type { PrismaClient } from "@prisma/client";
import type { ServiceAppointmentAdmissionInput } from "../src/shared/bookings/service-appointment-admission.service.js";

export async function seedServiceBookingFixture(prisma: PrismaClient, now: Date) {
  await prisma.merchant.create({ data: { id: "booking-services", name: "Synthetic service business", businessMode: "services", businessModeSelectedAt: now } });
  await prisma.merchant.create({ data: { id: "booking-foreign", name: "Synthetic foreign business", businessMode: "services", businessModeSelectedAt: now } });
  await prisma.serviceBusinessPolicy.create({ data: { merchantId: "booking-services", admissionsEnabled: true,
    holdEnabled: false, paymentMode: "at_attendance", configuredAt: now, version: 1 } });
  await prisma.serviceProfessional.create({ data: { id: "booking-professional", merchantId: "booking-services", publicName: "Synthetic professional",
    timeZone: "UTC", isActive: true, isPublished: true } });
  for (const [id, duration, price] of [["booking-short", 20, 5000], ["booking-long", 30, 7000]] as const) {
    await prisma.product.create({ data: { id, merchantId: "booking-services", name: "Synthetic " + id, type: "service", isActive: true,
      metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: duration, slots: [] } } } });
    await prisma.productVariant.create({ data: { id: id + "-variant", productId: id, sku: id, isActive: true,
      price: { create: { basePriceInCents: price, currency: "BRL" } } } });
    await prisma.professionalService.create({ data: { merchantId: "booking-services", professionalId: "booking-professional", productId: id } });
  }
  await prisma.professionalAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({
    merchantId: "booking-services", professionalId: "booking-professional", weekday, startMinute: 600, endMinute: 720, timeZone: "UTC",
  })) });
}

export function serviceBookingRequest(date: string, key: string, overrides: Partial<ServiceAppointmentAdmissionInput> = {}): ServiceAppointmentAdmissionInput {
  return { merchantId: "booking-services", professionalId: "booking-professional", productId: "booking-short", variantId: "booking-short-variant",
    date, startsAt: date + "T10:00:00.000Z", endsAt: date + "T10:20:00.000Z", professionalVersion: 1,
    policyVersion: 1, priceInCents: 5000, currency: "BRL", customer: { name: "Synthetic buyer", phone: "+5521999990000" },
    buyerGlobalUserId: "synthetic-buyer", origin: "whatsapp", actorId: "synthetic-buyer", idempotencyKey: key,
    confirmation: { kind: "at_attendance" }, ...overrides };
}
