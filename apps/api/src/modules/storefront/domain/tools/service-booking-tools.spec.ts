import assert from "node:assert/strict";
import test from "node:test";
import { buildStoreTools, buildExecutableStoreTools } from "./index.js";
import { createServiceBookingTools, serviceBookingDefinitions } from "./service-booking-tools.js";

test("T43 optional service registry", async t => {
  await t.test("the default product definitions and executable count are preserved", () => {
    const legacy = buildStoreTools(), executable = buildExecutableStoreTools({ merchantId: "merchant", sessionId: "cart", handlers: {} as never });
    assert.equal(legacy.length, executable.length); assert.equal(legacy.some(value => /service/.test(value.name)), false);
    assert.deepEqual(serviceBookingDefinitions(undefined), []); assert.deepEqual(createServiceBookingTools(undefined), []);
  });
  await t.test("optional definitions are read/proposal-only and the runtime uses the same strict argument fields", () => {
    const handlers = {} as never, definitions = serviceBookingDefinitions(handlers), tools = createServiceBookingTools(handlers);
    assert.equal(definitions.length, 4); assert.deepEqual(tools.map(value => value.name), definitions.map(value => value.name));
    for (const definition of definitions) { assert.equal(definition.parameters.additionalProperties, false);
      for (const key of ["merchantId", "buyer", "scope", "cartRef", "priceInCents", "confirmed"]) assert.equal(Object.hasOwn(definition.parameters.properties, key), false); }
  });
  await t.test("unknown fields are rejected before every optional handler", async () => {
    let calls = 0; const handlers = new Proxy({}, { get: () => async () => { calls++; return {}; } }) as never;
    for (const tool of createServiceBookingTools(handlers)) assert.equal((await tool.execute({ __unexpected: "private" })).ok, false);
    assert.equal(calls, 0);
  });
  await t.test("canonical source errors stay fixed and cannot leak a provider or credential value", async () => {
    const tools = createServiceBookingTools({ getServiceProfessionals: async () => { throw new Error("private-token-provider-data"); } } as never);
    const result = await tools[0]!.execute({ productId: "service", variantId: "variant" }); assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes("private-token"), false);
  });
  await t.test("a negative canonical envelope cannot be relabeled as a successful authentication result", async () => {
    for (const failure of [{ error: "private-error" }, { ok: false }, { success: false }]) {
      const tools = createServiceBookingTools({ getServiceProfessionals: async () => ({ kind: "authentication_required", action: "authenticate", ...failure }) } as never);
      const result = await tools[0]!.execute({ productId: "service", variantId: "variant" });
      assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes("private-error"), false);
    }
  });
  await t.test("a public result cannot carry a hidden executable field", async () => {
    const tools = createServiceBookingTools({ getServiceProfessionals: async () => ({ kind: "authentication_required", action: "authenticate", execute: "confirm_booking" }) } as never);
    const result = await tools[0]!.execute({ productId: "service", variantId: "variant" });
    assert.deepEqual(result, { ok: false, error: "service_booking_unconfirmed", code: "service_booking_unconfirmed" });
  });
});
