import test from "node:test";
import assert from "node:assert/strict";
import { parseServicePolicyUpdate } from "../../application/configure-service-business-policy.use-case.js";
import { assertServiceBusinessActor } from "./service-business-policy.controller.js";

test("T11", async t => {
  await t.test("ONB-03 requires explicit choices and a nonnegative expected version", () => {
    for (const invalid of [null, [], {}, { expectedVersion: -1 }, { expectedVersion: "0" }, { expectedVersion: 2_147_483_647, holdEnabled: false, paymentMode: "online" },
      { expectedVersion: 0, paymentMode: "online" }, { expectedVersion: 0, holdEnabled: false },
      { expectedVersion: 0, holdEnabled: true, holdMinutes: 0, paymentMode: "online" },
      { expectedVersion: 0, holdEnabled: false, paymentMode: "online", admissionsEnabled: "true" },
      { expectedVersion: 0, holdEnabled: false, paymentMode: "online", merchantId: "foreign" }]) {
      assert.throws(() => parseServicePolicyUpdate(invalid));
    }
  });
  await t.test("ONB-03 preserves each explicit combination and leaves admission disabled by default", () => {
    for (const holdEnabled of [false, true]) for (const paymentMode of ["online", "at_attendance"]) {
      assert.deepEqual(parseServicePolicyUpdate({ expectedVersion: 3, holdEnabled, holdMinutes: 7, paymentMode }), {
        expectedVersion: 3, holdEnabled, holdMinutes: holdEnabled ? 7 : null, paymentMode, admissionsEnabled: false,
      });
    }
    assert.equal(parseServicePolicyUpdate({ expectedVersion: 0, holdEnabled: false, paymentMode: "online", admissionsEnabled: true }).admissionsEnabled, true);
  });
  await t.test("ATEND-08 rejects foreign actors, staff and service credentials", () => {
    const actor = { kind: "human" as const, tenantId: "own", userId: "owner", role: "owner" as const, email: "private@example.test" };
    assert.deepEqual(assertServiceBusinessActor("own", { tenantPrincipal: actor }), actor);
    assert.throws(() => assertServiceBusinessActor("foreign", { tenantPrincipal: actor }), /service_business_forbidden/);
    assert.throws(() => assertServiceBusinessActor("own", { tenantPrincipal: { ...actor, role: "staff" } }), /service_business_forbidden/);
    assert.throws(() => assertServiceBusinessActor("own", { tenantPrincipal: { kind: "service", tenantId: "own", credentialId: "key", environment: "test", scopes: ["configuration:write"] } }), /service_business_forbidden/);
  });
});
