import { describe, expect, it } from "vitest";
import { readAppointmentSnapshot } from "./appointment-read-snapshot.js";

export const appointmentQuery = { fromDate: "2030-01-01", toDate: "2030-01-02" };
export function appointmentPage(merchantId = "merchant-a", patch: Record<string, unknown> = {}) {
  return { items: [{ id: "appointment-a", merchantId, professionalId: "professional-a", professionalName: "Ana", productId: "service-a", serviceName: "Consulta",
    categoryId: "category-a", variantId: "variant-a", startsAt: "2030-01-01T13:00:00.000Z", endsAt: "2030-01-01T13:30:00.000Z",
    timeZone: "UTC", durationMinutes: 30, priceInCents: 10000, currency: "BRL", policyVersion: 2, operationalStatus: "scheduled", origin: "manual", version: 3,
    customer: { name: "Cliente", phone: "21999990000" }, payments: [{ id: "payment-a", mode: "at_attendance", status: "pending", amountCents: 10000,
      currency: "BRL", version: 1, requiresRegularization: false, receivedAt: null }] }],
    nextCursor: null, totalCount: 1, countsByStatus: { pending: 0, scheduled: 1, in_service: 0, completed: 0, no_show: 0, cancelled: 0 },
    asOf: "2030-01-01T12:00:00.000Z", timeZone: "America/Sao_Paulo", ...patch };
}

describe("T102 canonical appointment read snapshot", () => {
  it("uses canonical totals independently of loaded rows and keeps action permission unknown", () => {
    const value = appointmentPage("merchant-a", { nextCursor: "next_page", totalCount: 40,
      countsByStatus: { pending: 5, scheduled: 30, in_service: 1, completed: 2, no_show: 1, cancelled: 1 } });
    const snapshot = readAppointmentSnapshot("merchant-a", appointmentQuery, value)!;
    expect(snapshot.page.totalCount).toBe(40); expect(snapshot.page.nextCursor).toBe("next_page");
    expect(snapshot.board.loadedCount).toBe(1); expect(snapshot.board.allowedActions).toBeNull();
    expect(snapshot.page.countsByStatus.scheduled).toBe(30);
    expect(snapshot.page.items[0]).toMatchObject({ serviceName: "Consulta", professionalName: "Ana", timeZone: "UTC", priceInCents: 10000,
      customer: { name: "Cliente" }, payments: [{ mode: "at_attendance", status: "pending", amountCents: 10000 }] });
  });
  it("accepts a true empty response and preserves all six zero counts", () => {
    const empty = appointmentPage("merchant-a", { items: [], totalCount: 0,
      countsByStatus: { pending: 0, scheduled: 0, in_service: 0, completed: 0, no_show: 0, cancelled: 0 } });
    expect(readAppointmentSnapshot("merchant-a", appointmentQuery, empty)?.board.loadedCount).toBe(0);
    expect(readAppointmentSnapshot("merchant-a", appointmentQuery, empty)?.page.totalCount).toBe(0);
  });
  it("rejects any foreign, duplicate or malformed row without exposing a partial page", () => {
    const page = appointmentPage();
    for (const items of [[{ ...page.items[0], merchantId: "foreign" }], [page.items[0], page.items[0]],
      [{ ...page.items[0], operationalStatus: "paid" }], [{ ...page.items[0], customer: null }], [{ ...page.items[0], payments: undefined }]])
      expect(readAppointmentSnapshot("merchant-a", appointmentQuery, { ...page, items })).toBeNull();
  });
  it("rejects totals, financial facts and pagination that do not describe the returned records", () => {
    const page = appointmentPage();
    for (const patch of [{ totalCount: 0 }, { totalCount: -1 }, { countsByStatus: { ...page.countsByStatus, scheduled: 0 } },
      { countsByStatus: { ...page.countsByStatus, paid: 1 } }, { nextCursor: "?" }, { items: [], nextCursor: "next" },
      { timeZone: "UTC" }, { asOf: null }, { items: [{ ...page.items[0], payments: [{ ...page.items[0].payments[0], receivedAt: "yesterday" }] }] }])
      expect(readAppointmentSnapshot("merchant-a", appointmentQuery, { ...page, ...patch })).toBeNull();
  });
  it("binds the page to all selected filters and Brasilia civil dates", () => {
    const page = appointmentPage();
    for (const filter of [{ professionalId: "other" }, { categoryId: "other" }, { productId: "other" }, { status: "pending" as const },
      { fromDate: "2030-01-02", toDate: "2030-01-02" }])
      expect(readAppointmentSnapshot("merchant-a", { ...appointmentQuery, ...filter }, page)).toBeNull();
    const before = { ...page.items[0], startsAt: "2030-01-01T02:30:00.000Z", endsAt: "2030-01-01T03:00:00.000Z" };
    expect(readAppointmentSnapshot("merchant-a", appointmentQuery, { ...page, items: [before] })).toBeNull();
  });
  it("projects only public fields without mutating the source or inferring attendance from payment", () => {
    const page = appointmentPage();
    const unsafe = { ...page, privateLease: "private-root", items: [{ ...page.items[0], operationalStatus: "pending",
      orderId: "private-order", orderUnitId: "private-order-unit",
      privatePaymentContinuation: "private-unit", customer: { ...page.items[0].customer, token: "private-customer" },
      payments: [{ ...page.items[0].payments[0], status: "approved", providerEvidence: "private-provider" }] }],
      countsByStatus: { ...page.countsByStatus, pending: 1, scheduled: 0 } };
    const before = JSON.stringify(unsafe), snapshot = readAppointmentSnapshot("merchant-a", appointmentQuery, unsafe)!;
    expect(snapshot.page.items[0].operationalStatus).toBe("pending"); expect(snapshot.board.entries[0].paymentFacts?.[0].status).toBe("approved");
    expect(JSON.stringify(snapshot)).not.toContain("private-"); expect(JSON.stringify(unsafe)).toBe(before);
    expect(snapshot.page.items[0]).not.toHaveProperty("paid");
  });
});
