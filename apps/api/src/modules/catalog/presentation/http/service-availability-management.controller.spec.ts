import assert from "node:assert/strict";
import test from "node:test";
import { availabilityMutationEnvelope, ServiceAvailabilityManagementController } from "./service-availability-management.controller.js";

test("T25", async t => {
  await t.test("mutation envelope retains explicit expectedVersion and command payload", () => {
    assert.deepEqual(availabilityMutationEnvelope({expectedVersion:4,timeZone:"UTC",rows:[]}),{expectedVersion:4,input:{timeZone:"UTC",rows:[]}});
    for(const value of [null,[],"invalid"])assert.throws(()=>availabilityMutationEnvelope(value),/invalid_availability_payload/);
  });
  await t.test("exception identity is controlled by the route and cannot be smuggled in a body", () => {
    const controller=new ServiceAvailabilityManagementController({} as never,{execute:async()=>assert.fail("forged identity cannot write")} as never,{} as never);
    assert.throws(()=>controller.saveException({} as never,"professional",{expectedVersion:4,id:"foreign"} as never),/invalid_availability_exception/);
    assert.throws(()=>controller.editException({} as never,"professional","owned",{expectedVersion:4,id:"foreign"} as never),/invalid_availability_exception/);
  });
});
