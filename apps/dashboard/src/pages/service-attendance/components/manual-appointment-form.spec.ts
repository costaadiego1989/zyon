import { describe, expect, it } from "vitest";
import type { Product } from "../../../api-client.js";
import type { ServiceProfessionalDTO, ServiceBusinessPolicyDTO, ServiceAvailabilitySlotsDTO } from "../../../api/endpoints/service-attendance.js";
import { createManualAppointmentDraft, manualAppointmentCommand, readManualAppointmentDetail } from "./manual-appointment-form.js";

const BR = "America/Sao_Paulo";
const product = { id: "service", merchantId: "merchant", name: "Consulta", type: "service", isActive: true, variants: [{ id: "variant", sku: "consulta", isActive: true }] } as Product;
const professional = { id: "professional", merchantId: "merchant", publicName: "Ana", version: 7, isActive: true, isPublished: true,
  timeZone: "UTC", services: [{ id: "link", productId: product.id, version: 1 }] } as ServiceProfessionalDTO;
const policy: ServiceBusinessPolicyDTO = { status: "configured", version: 3, policy: { paymentMode: "online", holdEnabled: false, holdMinutes: null, admissionsEnabled: true } };
const availability: ServiceAvailabilitySlotsDTO = { status: "ready", professionalVersion: 7, policyVersion: 3, timeZone: BR, durationMinutes: 30,
  asOf: "2026-11-22T12:00:00.000Z", dates: ["2030-01-02"], slots: [{ date: "2030-01-02", startTime: "10:00", startsAt: "2030-01-02T13:00:00.000Z",
    endsAt: "2030-01-02T13:30:00.000Z", timeZone: BR, durationMinutes: 30 }] };
const draft = () => ({ ...createManualAppointmentDraft({ fromDate: "2030-01-01", toDate: "2030-01-03" }), productId: product.id, variantId: "variant", professionalId: professional.id,
  name: "  Maria  ", phone: "21999990000", date: "2030-01-02", slotStartsAt: availability.slots[0].startsAt });
const context = () => ({ merchantId: "merchant", product, professional, policy, availability, customers: [], commandId: "manual-command" });
const detail = () => ({ id: "appointment", merchantId: "merchant", professionalId: "current-professional", professionalName: "Ana", productId: "service", serviceName: "Consulta", categoryId: null, variantId: "variant",
  startsAt: "2030-01-02T13:00:00.000Z", endsAt: "2030-01-02T13:30:00.000Z", timeZone: BR, durationMinutes: 30, priceInCents: 5000, currency: "BRL", policyVersion: 3,
  operationalStatus: "pending", origin: "manual", version: 2, customer: { name: "Maria" }, payments: [], history: [], historyPartial: false, asOf: "2030-01-01T12:00:00.000Z" });

describe("T79 canonical manual command and detail form contracts", () => {
  it("keeps the canonical detail projection while stripping private or undeclared server fields", () => {
    const value = { ...detail(), privatePaymentContinuation: "private-token", customer: { name: "Maria", cpf: "private-document" },
      payments: [{ id: "payment", mode: "at_attendance", status: "pending", amountCents: 5000, currency: "BRL", version: 1, receivedAt: null,
        requiresRegularization: false, providerEvidence: "private-provider" }],
      history: [{ id: "audit", action: "manual_create", actorId: null, origin: "operator", version: 1, occurredAt: "2030-01-01T12:00:00.000Z", privateLease: "private-lease" }] };
    const result = readManualAppointmentDetail(value, { merchantId: "merchant", appointmentId: "appointment", productId: "service", variantId: "variant", minimumVersion: 1 });
    expect(result).not.toBeNull(); expect(result?.customer).toEqual({ name: "Maria" }); expect(JSON.stringify(result)).not.toContain("private-");
    expect(result?.payments).toEqual([{ id: "payment", mode: "at_attendance", status: "pending", amountCents: 5000, currency: "BRL", version: 1, receivedAt: null, requiresRegularization: false }]);
    expect(result?.history).toEqual([{ id: "audit", action: "manual_create", actorId: null, origin: "operator", version: 1, occurredAt: "2030-01-01T12:00:00.000Z" }]);
  });
  it.each(["payments", "history"] as const)("rejects a detail exceeding the served %s bound without presenting a partial success", key => {
    const value = detail();
    const rows = Array.from({ length: 101 }, (_, index) => key === "payments"
      ? { id: "payment-" + index, mode: "at_attendance", status: "pending", amountCents: 5000, currency: "BRL", version: 1, receivedAt: null, requiresRegularization: false }
      : { id: "audit-" + index, action: "manual_create", actorId: null, origin: "operator", version: 1, occurredAt: "2030-01-01T12:00:00.000Z" });
    expect(readManualAppointmentDetail({ ...value, [key]: rows }, { merchantId: "merchant", appointmentId: "appointment", productId: "service", variantId: "variant", minimumVersion: 1 })).toBeNull();
  });
  it("submits only actual T31 fields using the selected server slot and versions", () => {
    expect(manualAppointmentCommand(draft(), context())).toEqual({ commandId: "manual-command", professionalId: "professional", productId: "service", variantId: "variant",
      expectedProfessionalVersion: 7, expectedPolicyVersion: 3, startsAt: availability.slots[0].startsAt, customer: { kind: "contact", name: "Maria", phone: "21999990000" } });
  });
  it("known customer IDs must be from the current captured list rather than arbitrary input", () => {
    const known = { ...draft(), customerMode: "known" as const, knownCustomerId: "buyer" };
    expect(() => manualAppointmentCommand(known, context())).toThrow();
    const value = manualAppointmentCommand(known, { ...context(), customers: [{ id: "buyer", profile: { fullName: "Maria" }, first_seen_at: "2026-01-01T00:00Z", last_seen_at: "2026-01-01T00:00Z" }] });
    expect(value.customer).toEqual({ kind: "known", customerId: "buyer" });
  });
  it("explicit one-off uses Brasilia and never derives an end or price in the browser", () => {
    const value = manualAppointmentCommand({ ...draft(), explicitOneOff: true, oneOffStart: "2030-01-02T14:00", reason: "Pedido explícito" }, { ...context(), availability: null });
    expect(value.startsAt).toBe("2030-01-02T17:00:00.000Z"); expect(value.explicitOneOff).toEqual({ reason: "Pedido explícito" });
    expect(value).not.toHaveProperty("endsAt"); expect(value).not.toHaveProperty("priceInCents"); expect(value).not.toHaveProperty("merchantId"); expect(value).not.toHaveProperty("timeZone");
  });
  it.each([{ professionalVersion: 8 }, { policyVersion: 4 }, { timeZone: "UTC" }, { status: "stale" as const }])("rejects a stale or differently scoped canonical calendar %j", change => {
    expect(() => manualAppointmentCommand(draft(), { ...context(), availability: { ...availability, ...change } })).toThrow();
  });
  it("requires an active linked service professional and configured open admissions", () => {
    expect(() => manualAppointmentCommand(draft(), { ...context(), professional: { ...professional, services: [] } })).toThrow();
    expect(() => manualAppointmentCommand(draft(), { ...context(), product: { ...product, merchantId: "foreign" } })).toThrow();
    expect(() => manualAppointmentCommand(draft(), { ...context(), policy: { status: "unconfigured", version: 0, policy: null } })).toThrow();
    expect(() => manualAppointmentCommand(draft(), { ...context(), policy: { ...policy, policy: { ...policy.policy!, admissionsEnabled: false } } as ServiceBusinessPolicyDTO })).toThrow();
  });
  it("contact validation requires a name and one real contact channel", () => {
    expect(() => manualAppointmentCommand({ ...draft(), name: " " }, context())).toThrow();
    expect(() => manualAppointmentCommand({ ...draft(), phone: "", email: "" }, context())).toThrow();
    expect(() => manualAppointmentCommand({ ...draft(), email: "invalid" }, context())).toThrow();
  });
  it("detail is a canonical current read and can reflect a later reschedule without guessing a new appointment", () => {
    const value = detail(), result = readManualAppointmentDetail(value, { merchantId: "merchant", appointmentId: "appointment", productId: "service", variantId: "variant", minimumVersion: 1 });
    expect(result?.professionalId).toBe("current-professional"); expect(result?.payments).toEqual([]); expect(result?.operationalStatus).toBe("pending");
  });
  it.each([{ merchantId: "foreign" }, { id: "other" }, { productId: "other" }, { version: 0 }, { payments: [{ id: "invented" }] }])("invalid or foreign detail cannot become a success summary %j", changed => {
    expect(readManualAppointmentDetail({ ...detail(), ...changed }, { merchantId: "merchant", appointmentId: "appointment", productId: "service", variantId: "variant", minimumVersion: 1 })).toBeNull();
  });
});
