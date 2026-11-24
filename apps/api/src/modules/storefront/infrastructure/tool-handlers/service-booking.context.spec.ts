import test from "node:test";
import assert from "node:assert/strict";
import { createServiceBookingHandlers } from "./service-booking.handlers.js";
import { serviceBookingResultSchema } from "../../domain/contracts/service-booking-tool.schemas.js";

const offer = { productId: "service-a", variantId: "variant-a" };
test("T45 context is optional for old blocks and strict against private authority", () => {
  const legacy = { kind: "professionals", professionals: [], has_more: false };
  assert.equal(serviceBookingResultSchema.safeParse(legacy).success, true);
  assert.equal(serviceBookingResultSchema.safeParse({ ...legacy, context: { ...offer, serviceName: "Consulta", parent_cart_fingerprint: "a".repeat(64) } }).success, false);
  assert.equal(serviceBookingResultSchema.safeParse({ ...legacy, context: { ...offer, serviceName: "Consulta", merchantId: "foreign" } }).success, false);
});
test("T45 tools attach only authenticated offer and professional context, never argument labels", async () => {
  const calls: string[] = [];
  const handlers = createServiceBookingHandlers("tenant-a", async () => ({
    professionals: async () => { calls.push("professionals"); return { professionals: [{ id: "professional-a", name: "Ana", version: 2, timeZone: "America/Sao_Paulo" }], has_more: false }; },
    dates: async () => { calls.push("dates"); return { dates: [], professional_version: 2, policy_version: 3, time_zone: "America/Sao_Paulo" }; },
    slots: async () => { calls.push("slots"); return { selections: [] }; },
    select: async () => { throw new Error("select must not run for navigation"); },
    offerName: async () => { calls.push("offerName"); return "Nome canônico"; },
  }), () => new Date("2026-12-01T12:00:00Z"));
  const professionals = await handlers.getServiceProfessionals(offer);
  assert.deepEqual("context" in professionals ? professionals.context : null, { ...offer, serviceName: "Nome canônico" });
  assert.deepEqual(calls, ["professionals", "offerName"]);
  const dates = await handlers.getServiceDates({ ...offer, professionalId: "professional-a", fromDate: "2026-12-01", toDate: "2026-12-31" });
  assert.deepEqual("context" in dates ? dates.context : null, { ...offer, serviceName: "Nome canônico", professional: { id: "professional-a", version: 2 } });
  const slots = await handlers.getServiceSlots({ ...offer, professionalId: "professional-a", date: "2026-12-03" });
  assert.deepEqual("context" in slots ? slots.context : null, { ...offer, serviceName: "Nome canônico" });
  const unauthenticated = createServiceBookingHandlers("tenant-a", async () => undefined);
  assert.deepEqual(await unauthenticated.getServiceProfessionals(offer), { kind: "authentication_required", action: "authenticate" });
});
