import assert from "node:assert/strict";
import test from "node:test";
import { createServiceBookingHandlers } from "./service-booking.handlers.js";
import { createServiceBookingTools, serviceBookingDefinitions } from "../../domain/tools/service-booking-tools.js";
import { professionalSlotId } from "../../../../shared/bookings/service-checkout-selection.js";

const now = new Date("2030-01-01T12:00:00Z"), offer = { productId: "service", variantId: "variant" };
const tuple = { ...offer, professionalId: "professional", professionalVersion: 3, policyVersion: 2, date: "2030-01-02",
  startsAt: "2030-01-02T13:00:00.000Z", endsAt: "2030-01-02T13:30:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 30, priceInCents: 5000, currency: "BRL" };
const selected = { ...tuple, slotId: professionalSlotId("merchant", tuple) };
function fixture() {
  const calls: any[] = [];
  let professionals: any = { professionals: [{ id: "professional", name: "Dra. Joana", version: 3, timeZone: "America/Sao_Paulo", profile: {} }], has_more: false };
  let selection: any = { selection: selected, service: { name: "Consultation" }, professional: { name: "Dra. Joana" },
    parent_cart_fingerprint: "a".repeat(64), policy: { version: 2, paymentMode: "at_attendance", holdEnabled: false, holdMinutes: null }, secret: "private-result" };
  const reader = {
    offerName: async () => "Consultation",
    professionals: async (input: unknown) => { calls.push(["professionals", input]); return professionals; },
    dates: async (input: unknown) => { calls.push(["dates", input]); return { dates: [selected.date], professional_version: 3, policy_version: 2, time_zone: "America/Sao_Paulo" }; },
    slots: async (input: unknown) => { calls.push(["slots", input]); return { selections: [selected] }; },
    select: async (input: unknown) => { calls.push(["select", input]); if (selection instanceof Error) throw selection; return selection; },
  };
  const handlers = createServiceBookingHandlers("merchant", async () => reader as never, () => now);
  return { handlers, calls, setProfessionals: (value: unknown) => { professionals = value; }, setSelection: (value: unknown) => { selection = value; } };
}
const hints = () => ({ ...offer, professionalName: "Dra. Joana", date: { kind: "relative", value: "tomorrow" }, time: { kind: "exact", value: "10:00" } });

test("T43", async t => {
  await t.test("missing verified buyer or existing embed authority returns an authentication UI action without a read", async () => {
    const handlers = createServiceBookingHandlers("merchant", async () => undefined, () => now);
    assert.deepEqual(await handlers.getServiceProfessionals(offer), { kind: "authentication_required", action: "authenticate" });
  });
  await t.test("professionals are the actual canonical roster including source completeness without inferred availability", async () => {
    const f = fixture(); f.setProfessionals({ professionals: [{ id: "professional", name: "Dra. Joana", version: 3, timeZone: "UTC", profile: {}, privateProfile: "private" }], has_more: true });
    const result = await f.handlers.getServiceProfessionals(offer);
    assert.equal(result.kind, "professionals"); assert.equal((result as any).has_more, true);
    assert.equal(JSON.stringify(result).includes("private"), false); assert.equal(JSON.stringify(result).includes("inStock"), false);
    assert.deepEqual(f.calls, [["professionals", offer]]);
  });
  await t.test("dates delegate the exact calendar request and retain backend labels and versions", async () => {
    const f = fixture(), args = { ...offer, professionalId: "professional", fromDate: "2030-01-02", toDate: "2030-01-02" };
    const value = await f.handlers.getServiceDates(args); assert.equal(value.kind, "dates");
    assert.deepEqual((value as any).dates, ["2030-01-02"]); assert.equal((value as any).professional_version, 3); assert.equal((value as any).policy_version, 2);
    assert.deepEqual(f.calls, [["dates", args]]);
  });
  await t.test("slot tuples and current cents come from the canonical reader, not a model or stock flag", async () => {
    const f = fixture(), args = { ...offer, professionalId: "professional", date: "2030-01-02" };
    const value = await f.handlers.getServiceSlots(args); assert.equal(value.kind, "slots");
    assert.deepEqual((value as any).selections, [selected]); assert.equal((value as any).has_more, false); assert.deepEqual(f.calls, [["slots", args]]);
  });
  await t.test("unknown commercial, tenant, cart, buyer, scope and clock overrides never reach a handler", async () => {
    const f = fixture(), tools = createServiceBookingTools(f.handlers);
    const tool = tools.find(value => value.name === "resolve_service_selection")!;
    for (const extra of [{ priceInCents: 1 }, { merchantId: "foreign" }, { cartRef: "foreign" }, { buyer: "foreign" }, { scopes: ["appointments:confirm"] }, { now: "2030" }, { professionalId: "professional" }])
      assert.equal((await tool.execute({ ...hints(), ...extra })).ok, false);
    assert.deepEqual(f.calls, []);
  });
  await t.test("semantic resolution reads the full roster/current dates/slots then revalidates the exact proposal through T40 select", async () => {
    const f = fixture(), value = await f.handlers.resolveServiceSelection(hints()); assert.equal(value.kind, "selection");
    assert.deepEqual(f.calls.map(call => call[0]), ["professionals", "dates", "slots", "select"]);
    assert.deepEqual(f.calls.at(-1), ["select", { selection: selected }]); assert.deepEqual((value as any).selection, selected);
    assert.equal((value as any).action, "review_service_booking"); assert.equal((value as any).authorizesPayment, false); assert.equal((value as any).authorizesConfirmation, false);
  });
  await t.test("homonyms remain ambiguous when the second eligible professional has no slots", async () => {
    const f = fixture(); f.setProfessionals({ professionals: [
      { id: "professional", name: "Dra. Joana", version: 3, timeZone: "America/Sao_Paulo", profile: {} },
      { id: "without-slots", name: "Dra. Joana", version: 1, timeZone: "America/Sao_Paulo", profile: {} },
    ], has_more: false });
    const value = await f.handlers.resolveServiceSelection(hints()); assert.equal(value.kind, "selection_resolution");
    assert.equal((value as any).resolution.reason, "choose_professional"); assert.equal((value as any).resolution.professionals.length, 2);
    assert.deepEqual(f.calls.map(call => call[0]), ["professionals"]);
  });
  await t.test("has_more without a cursor cannot be promoted to a complete or unique roster", async () => {
    const f = fixture(); f.setProfessionals({ professionals: [{ id: "professional", name: "Dra. Joana", version: 3, timeZone: "UTC", profile: {} }], has_more: true });
    const value = await f.handlers.resolveServiceSelection(hints()); assert.equal(value.kind, "selection_resolution");
    assert.equal((value as any).resolution.reason, "more_current_professionals"); assert.deepEqual(f.calls.map(call => call[0]), ["professionals"]);
  });
  await t.test("stale final select errors propagate without retrying or creating a preparation", async () => {
    const f = fixture(); f.setSelection(new Error("service_selection_stale"));
    await assert.rejects(f.handlers.resolveServiceSelection(hints()), /service_selection_stale/);
    assert.equal(f.calls.filter(call => call[0] === "select").length, 1);
  });
  await t.test("review output omits buyer data, parent fingerprints and unexpected private service fields", async () => {
    const value = await fixture().handlers.resolveServiceSelection(hints());
    assert.equal(JSON.stringify(value).includes("private"), false); assert.equal(JSON.stringify(value).includes("parent_cart_fingerprint"), false);
    assert.equal((value as any).serviceName, "Consultation"); assert.equal((value as any).professionalName, "Dra. Joana");
  });
  await t.test("no advertised or bound model tool prepares, confirms, charges or creates a token", () => {
    assert.deepEqual(serviceBookingDefinitions(fixture().handlers).map(value => value.name), ["get_service_professionals", "get_service_dates", "get_service_slots", "resolve_service_selection"]);
    assert.equal(serviceBookingDefinitions(fixture().handlers).some(value => /prepare|confirm|pay|issue/.test(value.name)), false);
    assert.deepEqual(Object.keys(fixture().handlers).sort(), ["getServiceDates", "getServiceProfessionals", "getServiceSlots", "resolveServiceSelection"]);
  });
  await t.test("negative canonical outcomes cannot be stripped into a successful roster", async () => {
    const f = fixture(); f.setProfessionals({ professionals: [], has_more: false, error: "private-error" });
    const result = await createServiceBookingTools(f.handlers)[0]!.execute(offer); assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes("private-error"), false);
  });
  await t.test("current online or at-attendance policy is returned as fact without changing operational or payment state", async () => {
    for (const paymentMode of ["online", "at_attendance"] as const) {
      const f = fixture(); f.setSelection({ selection: selected, service: { name: "Consultation" }, professional: { name: "Dra. Joana" },
        parent_cart_fingerprint: "a".repeat(64), policy: { version: 2, paymentMode, holdEnabled: false, holdMinutes: null } });
      const value = await f.handlers.resolveServiceSelection(hints()); assert.equal((value as any).policy.paymentMode, paymentMode);
      assert.equal((value as any).authorizesPayment, false); assert.equal((value as any).authorizesConfirmation, false);
      assert.equal(JSON.stringify(value).includes('"confirmed":true'), false);
    }
  });
});
