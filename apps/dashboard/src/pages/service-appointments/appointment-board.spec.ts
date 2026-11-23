import { describe, expect, it } from "vitest";
import { APPOINTMENT_COLUMNS, formatAppointmentStart, projectAppointmentBoard } from "./appointment-board.js";

const appointment = (change: Record<string, unknown> = {}) => ({
  id: "appointment-a", merchantId: "merchant-a", professionalId: "professional-a", productId: "service-a", variantId: "variant-a",
  orderId: "order-shared", orderUnitId: "unit-a", startsAt: "2030-01-01T02:30:00.000Z", endsAt: "2030-01-01T03:00:00.000Z",
  timeZone: "America/Sao_Paulo", durationMinutes: 30, priceInCents: 10000, currency: "BRL", operationalStatus: "scheduled", version: 3, ...change,
});
const payment = (change: Record<string, unknown> = {}) => ({
  id: "payment-a", appointmentId: "appointment-a", merchantId: "merchant-a", mode: "at_attendance", status: "pending",
  amountCents: 10000, currency: "BRL", version: 2, requiresRegularization: false, ...change,
});
function ready(rows: unknown[]) {
  const result = projectAppointmentBoard("merchant-a", rows);
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw Error("expected_valid_canonical_appointments");
  return result;
}

describe("T102 canonical appointment projection", () => {
  it("uses exactly the six persisted operational states rather than fulfillment/payment columns", () => {
    expect(APPOINTMENT_COLUMNS.map(column => column.status)).toEqual(["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"]);
  });
  for (const status of ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"])
    it(`keeps ${status} unchanged despite an approved payment`, () => {
      const view = ready([appointment({ operationalStatus: status, payments: [payment({ status: "approved" })] })]);
      expect(view.entries[0].operationalStatus).toBe(status);
      expect(view.columns.find(column => column.status === status)?.entries.map(row => row.id)).toEqual(["appointment-a"]);
      expect(view.entries[0].paymentFacts?.[0].status).toBe("approved");
    });
  for (const status of ["pending", "approved", "failed", "cancelled", "refunded", "partially_refunded"])
    it(`keeps payment fact ${status} separate from a scheduled appointment`, () => {
      const view = ready([appointment({ payments: [payment({ status })] })]);
      expect(view.entries[0]).toMatchObject({ operationalStatus: "scheduled", version: 3, paymentFacts: [{ status, mode: "at_attendance", amountCents: 10000, version: 2 }] });
    });
  it("leaves missing payment facts unknown, with no free/paid/checkout-disabled inference", () => {
    const view = ready([appointment()]);
    expect(view.entries[0].paymentFacts).toBeNull();
    expect(view.entries[0]).not.toHaveProperty("paid"); expect(view.entries[0]).not.toHaveProperty("paymentEnabled");
  });
  it("preserves an explicitly empty payment record set without inventing a financial mode", () => {
    expect(ready([appointment({ payments: [] })]).entries[0].paymentFacts).toEqual([]);
  });
  it("uses the same canonical IDs for list and Kanban even with multiple appointments per order", () => {
    const rows = [appointment(), appointment({ id: "appointment-b", orderUnitId: "unit-b", operationalStatus: "completed" }),
      appointment({ id: "appointment-c", orderId: null, orderUnitId: null, operationalStatus: "pending" })];
    const view = ready(rows);
    expect(view.entries.map(row => row.id)).toEqual(["appointment-a", "appointment-b", "appointment-c"]);
    expect(view.columns.flatMap(column => column.entries).map(row => row.id).sort()).toEqual(view.entries.map(row => row.id).sort());
    expect(view.columns.flatMap(column => column.entries).every(row => view.entries.includes(row))).toBe(true);
    expect(view.loadedCount).toBe(3); expect(view.totalCount).toBeNull(); expect(view.pagination).toBeNull(); expect(view.allowedActions).toBeNull();
  });
  it("does not mistake a loaded page or an empty page for the server total", () => {
    const view = ready(Array.from({ length: 21 }, (_, i) => appointment({ id: "appointment-" + i, orderUnitId: "unit-" + i })));
    expect(view.loadedCount).toBe(21); expect(view.totalCount).toBeNull(); expect(view.pagination).toBeNull();
    const empty = ready([]); expect(empty.loadedCount).toBe(0); expect(empty.totalCount).toBeNull();
  });
  it("cannot create a card from order-only fulfillment history", () => {
    const result = projectAppointmentBoard("merchant-a", [{ id: "order-a", fulfillment: { units: [{ productType: "service", status: "scheduled" }] } }]);
    expect(result).toEqual({ status: "unavailable", reason: "invalid_appointment_facts", totalCount: null, pagination: null, allowedActions: null });
  });
  it("rejects a foreign appointment without returning a partial page or a false total", () => {
    expect(projectAppointmentBoard("merchant-a", [appointment(), appointment({ id: "foreign", merchantId: "merchant-b" })]).status).toBe("unavailable");
  });
  it("rejects duplicate canonical IDs rather than silently merging appointments", () => {
    expect(projectAppointmentBoard("merchant-a", [appointment(), appointment()]).status).toBe("unavailable");
  });
  for (const change of [{ operationalStatus: "awaiting_payment" }, { version: 0 }, { timeZone: "bad-zone" }, { startsAt: "not-a-date" },
    { endsAt: "2029-12-31T00:00:00.000Z" }, { payments: [payment({ appointmentId: "other" })] }, { payments: [payment({ merchantId: "other" })] }])
    it(`fails closed for invalid canonical facts ${JSON.stringify(change)}`, () => {
      expect(projectAppointmentBoard("merchant-a", [appointment(change)]).status).toBe("unavailable");
    });
  for (const [timeZone, date, time] of [["America/Sao_Paulo", "31/12/2029", "23:30"], ["America/Manaus", "31/12/2029", "22:30"], ["UTC", "01/01/2030", "02:30"]])
    it(`formats the stored ${timeZone} instant without rewriting historical zones`, () => {
      const row = ready([appointment({ timeZone })]).entries[0], text = formatAppointmentStart(row);
      expect(text).toContain(date); expect(text).toContain(time); expect(row.timeZone).toBe(timeZone); expect(row.startsAt).toBe("2030-01-01T02:30:00.000Z");
    });
  it("does not mutate source records or project private command/provider metadata", () => {
    const row = appointment({ requestFingerprint: "private-command", customerSnapshot: { phone: "private-contact" }, payments: [payment({ providerEvidence: { token: "private-provider" } })] });
    const before = JSON.stringify(row), view = ready([row]);
    expect(JSON.stringify(row)).toBe(before); expect(JSON.stringify(view)).not.toMatch(/private-command|private-contact|private-provider/);
    expect(view.entries[0]).toMatchObject({ priceInCents: 10000, currency: "BRL", professionalId: "professional-a", productId: "service-a", variantId: "variant-a", version: 3 });
  });
});
