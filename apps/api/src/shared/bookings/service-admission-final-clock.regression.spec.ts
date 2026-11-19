import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { Prisma, ServiceAppointment } from "@prisma/client";
import { admitServiceAppointment, type ServiceAppointmentAdmissionInput } from "./service-appointment-admission.service.js";
import { professionalSlotId, professionalHoldRequests } from "./service-checkout-selection.js";
import { slotFingerprint } from "./redis-service-slots.js";

// Separate causal regression. Existing T26/30/31 single-read tests are intact.
// No clock-contract/source repair is applied before the concrete review gate.
function fixture(stage: "availability" | "lease" | "approved-evidence") {
  const startsAt = "2030-01-02T10:00:00.000Z", endsAt = "2030-01-02T10:30:00.000Z";
  let current = new Date("2030-01-02T09:59:59.000Z");
  const input: ServiceAppointmentAdmissionInput = { merchantId: "m", professionalId: "p", productId: "service", variantId: "v",
    professionalVersion: 3, policyVersion: 2, date: "2030-01-02", startsAt, endsAt, priceInCents: 5000, currency: "BRL",
    customer: { name: "Synthetic buyer", email: "clock@example.test" }, buyerGlobalUserId: "buyer", origin: "storefront", actorId: "buyer",
    idempotencyKey: "last-io-" + stage, confirmation: stage === "availability" ? { kind: "at_attendance" }
      : { kind: "approved_order_unit", orderId: "order", unitId: "unit" } };
  const appointments: ServiceAppointment[] = [], audits: unknown[] = [], events: unknown[] = [];
  const payment = { status: "approved", amountCents: 5000, approvedAmountCents: 5000, currency: "BRL", providerPaymentId: "provider-id" };
  const selected = { ...input, timeZone: "UTC", durationMinutes: 30, slotId: "" }; selected.slotId = professionalSlotId("m", selected);
  const slots = professionalHoldRequests([selected]), owner = "original-payment-session";
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray | Prisma.Sql) => {
      const strings = Array.isArray(sql) ? sql : (sql as Prisma.Sql).strings;
      return strings.join(" ").includes("FROM appointment_audits") ? [] : [{ id: "resource" }]; },
    merchant: { findUnique: async () => ({ businessMode: "services", businessModeSelectedAt: current, businessModeNeedsReview: false }) },
    serviceBusinessPolicy: { findUnique: async () => ({ version: 2, configuredAt: current, admissionsEnabled: true,
      paymentMode: stage === "availability" ? "at_attendance" : "online", holdEnabled: stage === "lease", holdMinutes: stage === "lease" ? 7 : null }) },
    serviceReservation: { findFirst: async () => null },
    productVariant: { findFirst: async () => ({ id: "v", productId: "service", price: { basePriceInCents: 5000, currency: "BRL" },
      product: { id: "service", merchantId: "m", type: "service", isActive: true, deletedAt: null } }) },
    serviceAppointment: { findUnique: async () => null, create: async ({ data }: any) => { const row = { ...data, id: "a", version: 1 }; appointments.push(row); return row; } },
    appointmentAudit: { create: async ({ data }: any) => { audits.push(data); return data; } },
    outboxMessage: { create: async ({ data }: any) => { events.push(data); return data; } },
    completedOrder: { findFirst: async () => ({ id: "order", merchantId: "m", sessionId: owner, externalOrderId: "provider-id", status: "paid", orderTotal: 50, currency: "BRL",
      lineItemsJson: [{ lineId: "unit", snapshotVersion: 2, productType: "service", fulfillmentStrategy: "scheduled_service", quantity: 1,
        variantId: "v", unitPriceCents: 5000, schedule: { professionalId: "p", professionalVersion: 3, policyVersion: 2,
          date: input.date, startsAt, endsAt, timeZone: "UTC", durationMinutes: 30 } }] }) },
    checkoutSession: { findUnique: async () => ({ globalUserId: "buyer" }) },
    paymentIntent: { findFirst: async () => { if (stage === "approved-evidence") current = new Date(startsAt); return payment; } },
  } as unknown as Prisma.TransactionClient;
  const context = { clock: () => new Date(current), leaseSelections: [selected], leaseOwner: { ownerId: owner, store: () => ({
    acquire: async () => assert.fail("regression must not acquire a new lease"), release: async () => assert.fail("regression must not release original hold"),
    get: async () => assert.fail("never reconstruct original proof from get"),
    assertActive: async () => { current = new Date(startsAt); return { merchantId: "m", ownerHash: createHash("sha256").update(owner).digest("hex"),
      generation: "00000000-0000-4000-8000-000000000001", fingerprint: slotFingerprint(slots), selectionFingerprint: slotFingerprint(slots),
      expiresAt: startsAt, slots }; },
  }) }, readAvailability: async () => { if (stage === "availability") current = new Date(startsAt); return { status: "ready" as const,
    professionalVersion: 3, policyVersion: 2, timeZone: "UTC", durationMinutes: 30, dates: [input.date], asOf: "2030-01-02T09:59:59.000Z",
    slots: [{ date: input.date, startTime: "10:00", startsAt, endsAt, timeZone: "UTC", durationMinutes: 30 }] }; } };
  return { tx, input, context, appointments, audits, events, payment };
}

test("T35 causal final admission IO clock regression", async t => {
  for (const stage of ["availability", "lease", "approved-evidence"] as const) await t.test("slot start reached during " + stage + " never confirms a past booking or changes approved money", async () => {
    const f = fixture(stage), approvedBefore = structuredClone(f.payment);
    await assert.rejects(admitServiceAppointment(f.tx, f.input, f.context), /service_slot_unavailable/);
    assert.deepEqual(f.appointments, []); assert.deepEqual(f.audits, []); assert.deepEqual(f.events, []); assert.deepEqual(f.payment, approvedBefore);
  });
});
