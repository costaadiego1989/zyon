import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { ServiceBookingClient, ServiceBookingReadClient, serviceBookingContext, ServiceBookingRequestError, ServiceBookingUncertainError } from "../src/api/service-booking.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const context = { productId: "service-a", variantId: "variant-a", serviceName: "Consulta" };
const selection = { productId: "service-a", variantId: "variant-a", professionalId: "professional-a", professionalVersion: 2, policyVersion: 3,
  date: "2026-12-03", startsAt: "2026-12-03T13:00:00.000Z", endsAt: "2026-12-03T13:30:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 30, priceInCents: 5000, currency: "BRL", slotId: "a".repeat(64) };
const review = () => ({ selection, service: { name: "Consulta" }, professional: { name: "Ana" }, parent_cart_fingerprint: "b".repeat(64),
  policy: { version: 3, paymentMode: "at_attendance", holdEnabled: false, holdMinutes: null } });
const preparation = (mode = "at_attendance") => ({ session_id: "server-session", replayed: false, confirmed: false, cart_fingerprint: "c".repeat(64), payment_mode: mode, policy_version: 3,
  requires_hold: false, service_slot_hold: null, selections: [{ ...selection, productName: "Consulta", professionalName: "Ana" }] });
function fixture(response: unknown | ((url: string) => Response), status = 200) {
  const calls: Array<{ url: string; init: RequestInit; body?: unknown }> = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return typeof response === "function" ? response(String(input)) : Response.json(response, { status });
  };
  const api = new ServiceBookingClient({ merchantId: "store-a", embedToken: "provided-embed", buyerAccessToken: "provided-buyer", apiBaseUrl: "https://fixture.invalid", embedApiBaseUrl: "https://fixture.invalid", globalUserId: "buyer-a" });
  return { api, calls };
}
test("T45 public navigation keeps optional legacy context harmless and never imports private authority", () => {
  assert.equal(serviceBookingContext({ kind: "professionals", professionals: [], has_more: false }), null);
  assert.equal(serviceBookingContext({ kind: "authentication_required", action: "authenticate" }), null);
  assert.deepEqual(serviceBookingContext({ kind: "professionals", context }), context);
  assert.equal(serviceBookingContext({ kind: "slots", context: { ...context, parent_cart_fingerprint: "b".repeat(64) } }), null);
  assert.equal(serviceBookingContext({ kind: "professionals", context: { ...context, merchantId: "foreign" } }), null);
});
test("T45 canonical reads use only existing signed headers and scoped query fields", async () => {
  const f = fixture({ professionals: [{ id: "professional-a", name: "Ana", version: 2, timeZone: "America/Sao_Paulo" }], has_more: true });
  assert.equal((await f.api.professionals(context)).has_more, true);
  const headers = new Headers(f.calls[0]!.init.headers); assert.equal(headers.get("authorization"), "Bearer provided-embed"); assert.equal(headers.get("x-buyer-access-token"), "provided-buyer");
  assert.equal(new URL(f.calls[0]!.url).pathname, "/embed/service-booking/professionals");
  assert.deepEqual(Object.fromEntries(new URL(f.calls[0]!.url).searchParams), { productId: "service-a", variantId: "variant-a" });
  assert.equal(f.calls[0]!.init.cache, "no-store"); assert.equal(f.calls[0]!.body, undefined);
});
test("T45 select, prepare and confirm are separate gestures with private fingerprints and one command", async () => {
  const f = fixture(url => url.endsWith("/select") ? Response.json(review()) : url.endsWith("/prepare") ? Response.json(preparation()) : Response.json({ replayed: false, appointments: [{ id: "appointment-a", ...selection,
    operationalStatus: "scheduled", version: 1, payments: [{ id: "balance-a", mode: "at_attendance", status: "pending", amountCents: 5000, currency: "BRL", receivedAt: null, requiresRegularization: false }] }] }));
  const selected = await f.api.select(selection); assert.equal(f.calls.length, 1); assert.equal(selected.parent_cart_fingerprint, "b".repeat(64));
  const prepared = await f.api.prepare(selected); assert.equal(f.calls.length, 2); assert.equal(prepared.confirmed, false);
  assert.deepEqual(f.calls[0]!.body, { selection }); assert.deepEqual(f.calls[1]!.body, { selection, parent_cart_fingerprint: "b".repeat(64) });
  const result = await f.api.confirm(prepared); assert.equal(result.appointments[0]!.operationalStatus, "scheduled"); assert.equal(f.calls.length, 3);
  const command = f.calls[2]!.body as Record<string, string>; assert.equal(command.session_id, "server-session"); assert.equal(command.cart_fingerprint, "c".repeat(64)); assert.ok(command.command_id);
  await f.api.confirm(prepared); assert.deepEqual(f.calls[3]!.body, command);
  assert.equal(JSON.stringify(f.calls.map(call => call.body)).includes("provided-embed"), false); assert.equal(JSON.stringify(f.calls.map(call => call.body)).includes("provided-buyer"), false);
});
test("T45 online preparation cannot be treated as paid or locally confirmed", async () => {
  const f = fixture(preparation("online")); const prepared = await f.api.prepare({ ...review(), policy: { ...review().policy, paymentMode: "online" } });
  await assert.rejects(f.api.confirm(prepared), (error: unknown) => error instanceof ServiceBookingRequestError && error.code === "service_online_payment_required");
  assert.equal(f.calls.length, 1); assert.equal(prepared.confirmed, false);
});
test("T45 a canonical parent with other appointments keeps every reviewed service before confirmation", async () => {
  const other = { ...selection, productId: "service-b", variantId: "variant-b", professionalId: "professional-b", slotId: "d".repeat(64), productName: "Retorno", professionalName: "Bia" };
  const f = fixture({ ...preparation(), selections: [other, { ...selection, productName: "Consulta", professionalName: "Ana" }] });
  const prepared = await f.api.prepare(review()); assert.equal(prepared.selections.length, 2); assert.equal(prepared.selections[0]!.productName, "Retorno"); assert.equal(prepared.confirmed, false); assert.equal(f.calls.length, 1);
});
test("T45 invalid or changed tuples, professional scope and range dispatch no forged command", async () => {
  const f = fixture({ selections: [{ ...selection, professionalId: "foreign" }] });
  await assert.rejects(f.api.slots(context, "professional-a", selection.date), /service_booking_response_invalid/);
  const count = f.calls.length;
  await assert.rejects(f.api.select({ ...selection, slotId: "forged" }));
  await assert.rejects(f.api.dates(context, "professional-a", "2026-01-01", "2026-03-01")); assert.equal(f.calls.length, count);
});
test("T45 conflicts and uncertain unsafe IO never retry, charge or confirm automatically", async () => {
  const f = fixture({ code: "service_slot_unavailable" }, 409);
  await assert.rejects(f.api.select(selection), (error: unknown) => error instanceof ServiceBookingRequestError && error.status === 409); assert.equal(f.calls.length, 1);
  globalThis.fetch = async () => { throw new TypeError("synthetic disconnected response"); };
  await assert.rejects(f.api.prepare(review()), (error: unknown) => error instanceof ServiceBookingUncertainError);
});

test("T45 guest availability uses the existing scoped embed proof without any buyer header or write surface", async () => {
  const f = fixture(url => url.includes("/professionals") ? Response.json({ professionals: [{ id: "professional-a", name: "Ana", version: 2, timeZone: "America/Sao_Paulo", privateCanary: "must-not-escape" }], has_more: false })
    : url.includes("/dates") ? Response.json({ dates: [selection.date], professional_version: 2, policy_version: 3, time_zone: selection.timeZone }) : Response.json({ selections: [selection] }));
  const read = new ServiceBookingReadClient({ merchantId: "store-a", embedToken: "real-public-scoped-proof", apiBaseUrl: "https://fixture.invalid" });
  const professionals = await read.professionals(context); await read.dates(context, selection.professionalId, selection.date, selection.date); await read.slots(context, selection.professionalId, selection.date);
  assert.equal(f.calls.length, 3); assert.equal(JSON.stringify(professionals).includes("must-not-escape"), false);
  for (const call of f.calls) { assert.equal(call.init.method, "GET"); assert.equal(call.body, undefined); const headers = new Headers(call.init.headers); assert.equal(headers.get("authorization"), "Bearer real-public-scoped-proof"); assert.equal(headers.get("x-buyer-access-token"), null); }
  assert.equal("select" in read, false); assert.equal("prepare" in read, false); assert.equal("confirm" in read, false);
});
test("T45 private commands retain real buyer authorization even when public browsing is available", async () => {
  assert.throws(() => new ServiceBookingClient({ merchantId: "store-a", embedToken: "public-proof", buyerAccessToken: "", globalUserId: "", apiBaseUrl: "https://fixture.invalid" }), error => error instanceof ServiceBookingRequestError && error.status === 401);
  const f = fixture(review()); await f.api.select(selection); const headers = new Headers(f.calls[0]!.init.headers);
  assert.equal(headers.get("authorization"), "Bearer provided-embed"); assert.equal(headers.get("x-buyer-access-token"), "provided-buyer"); assert.equal(f.calls[0]!.init.method, "POST"); assert.deepEqual(f.calls[0]!.body, { selection });
});
