import { describe, expect, it } from "vitest";
import { createDashboardApi } from "../index.js";
import { serviceAppointmentOperationEndpoints } from "./service-appointment-operations.js";

const profile = { id: "merchant/a", user_id: "owner" };
const command = { commandId: "command-a", professionalId: "professional", productId: "service", variantId: "variant", expectedProfessionalVersion: 3,
  expectedPolicyVersion: 2, startsAt: "2030-01-01T13:00:00.000Z", customer: { kind: "contact" as const, name: "Cliente", phone: "21999990000" } };
function receipt(change: Record<string, unknown> = {}) {
  return { replayed: false, professionalVersion: 3, availabilityExceptionId: null, appointment: { id: "appointment", merchantId: profile.id,
    professionalId: "professional", productId: "service", variantId: "variant", version: 1, operationalStatus: "scheduled", privateLease: "private-lease",
    customerSnapshot: { email: "private-customer" }, payments: [{ providerEvidence: "private-provider" }] }, ...change };
}
function fixture(result = receipt(), status = 200) {
  const requests: Array<{ url: string; init?: RequestInit; body: unknown }> = [];
  const fetchImpl = (async (input, init) => { requests.push({ url: String(input), init, body: JSON.parse(String(init?.body)) }); return Response.json(result, { status }); }) as typeof fetch;
  return { requests, fetchImpl, client: serviceAppointmentOperationEndpoints("https://api.example.test", fetchImpl).serviceAppointmentOperations(profile) };
}

describe("T79 canonical manual appointment transport", () => {
  it("uses the existing manual route and returns only the canonical receipt identity and state", async () => {
    const f = fixture(), api = createDashboardApi({ baseUrl: "https://api.example.test///", fetchImpl: f.fetchImpl });
    const result = await api.serviceAppointmentOperations(profile).createManual(command);
    expect(f.requests[0].url).toBe("https://api.example.test/v1/merchants/merchant%2Fa/service-appointments/manual");
    expect(result).toEqual({ replayed: false, professionalVersion: 3, availabilityExceptionId: null,
      appointment: { id: "appointment", merchantId: profile.id, professionalId: "professional", productId: "service", variantId: "variant", version: 1, operationalStatus: "scheduled" } });
    expect(JSON.stringify(result)).not.toContain("private-");
  });
  it("captures the profile, sends exact expected versions and never sends caller financial or tenant authority", async () => {
    const f = fixture(), mutable = { ...profile };
    const client = serviceAppointmentOperationEndpoints("https://api.example.test", f.fetchImpl).serviceAppointmentOperations(mutable);
    mutable.id = "foreign";
    const signal = new AbortController().signal;
    await client.createManual({ ...command, merchantId: "foreign", actorId: "forged", priceInCents: 1, durationMinutes: 1,
      customer: { ...command.customer, role: "owner", emailVerified: true } } as never, { signal });
    expect(f.requests[0].body).toEqual(command);
    expect(f.requests[0].init).toMatchObject({ method: "POST", credentials: "include", cache: "no-store", signal });
    expect(new Headers(f.requests[0].init?.headers).get("Idempotency-Key")).toBe(command.commandId);
    expect(f.requests[0].url).not.toContain("foreign");
  });
  it("preserves known-customer identity without adding contact data or accepting arbitrary customer fields", async () => {
    const f = fixture();
    await f.client.createManual({ ...command, customer: { kind: "known", customerId: "customer-a", phone: "forged" } } as never);
    expect((f.requests[0].body as { customer: unknown }).customer).toEqual({ kind: "known", customerId: "customer-a" });
  });
  it("sends explicit one-off intent and reason without inventing an end time, timezone or price", async () => {
    const f = fixture(receipt({ professionalVersion: 4, availabilityExceptionId: "one-off" }));
    await f.client.createManual({ ...command, explicitOneOff: { reason: "Horário combinado" } });
    expect(f.requests[0].body).toEqual({ ...command, explicitOneOff: { reason: "Horário combinado" } });
    await f.client.createManual({ ...command, explicitOneOff: {} });
    expect((f.requests[1].body as { explicitOneOff: unknown }).explicitOneOff).toEqual({});
  });
  it("keeps an explicit replay's command and HTTP idempotency key stable", async () => {
    const f = fixture(receipt({ replayed: true }));
    await f.client.createManual(command); await f.client.createManual(command);
    expect(f.requests.map(value => new Headers(value.init?.headers).get("Idempotency-Key"))).toEqual([command.commandId, command.commandId]);
    expect(f.requests.map(value => value.body)).toEqual([command, command]);
  });
  it("keeps the current professional and state when an old command replays after a later reschedule", async () => {
    const current = receipt({ replayed: true, appointment: { ...receipt().appointment, professionalId: "new-professional", version: 4, operationalStatus: "in_service" } });
    const f = fixture(current), result = await f.client.createManual(command);
    expect(result.replayed).toBe(true);
    expect(result.appointment).toMatchObject({ id: "appointment", merchantId: profile.id, professionalId: "new-professional", version: 4, operationalStatus: "in_service" });
    expect(f.requests[0].body).toEqual(command);
  });
  it("rejects invalid profile, identity, versions and times before HTTP", async () => {
    const f = fixture();
    for (const bad of [null, { id: "", user_id: "owner" }, { id: "merchant", user_id: "" }])
      expect(() => serviceAppointmentOperationEndpoints("https://api.example.test", f.fetchImpl).serviceAppointmentOperations(bad as never)).toThrow();
    for (const patch of [{ commandId: "" }, { professionalId: " " }, { expectedProfessionalVersion: 0 }, { expectedPolicyVersion: 1.5 },
      { startsAt: "tomorrow" }, { customer: { kind: "contact", name: "Cliente" } }, { customer: { kind: "unknown" } }, { explicitOneOff: { reason: "x".repeat(1201) } }])
      await expect(f.client.createManual({ ...command, ...patch } as never)).rejects.toBeInstanceOf(TypeError);
    expect(f.requests).toEqual([]);
  });
  it("refuses malformed or foreign success without displaying partial confirmation", async () => {
    for (const value of [{}, receipt({ replayed: "yes" }), receipt({ appointment: { ...receipt().appointment, merchantId: "foreign" } }),
      receipt({ appointment: { ...receipt().appointment, professionalId: "different" } }), receipt({ appointment: { ...receipt().appointment, operationalStatus: "paid" } })])
      await expect(fixture(value as ReturnType<typeof receipt>).client.createManual(command)).rejects.toMatchObject({ name: "DashboardJsonParseError" });
  });
  it.each([400, 403, 409, 503])("preserves HTTP %s and never retries a manual mutation automatically", async status => {
    const f = fixture(receipt(), status);
    await expect(f.client.createManual(command)).rejects.toMatchObject({ name: "DashboardHttpError", status });
    expect(f.requests).toHaveLength(1);
  });
});
