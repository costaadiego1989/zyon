import assert from "node:assert/strict";
import test from "node:test";
import { parseProfessionalAvailabilityQuery } from "./service-availability.controller.js";

test("T24", async t => {
  const resource = { productId: "service", variantId: "variant", professionalId: "professional" }, now = new Date("2030-01-01T00:00:00Z");
  await t.test("dates window and selected-date slots use the same server clock and explicit version", () => {
    const dates = parseProfessionalAvailabilityQuery({ ...resource, fromDate: "2030-01-02", toDate: "2030-01-03", expectedVersion: "4" }, "dates", now);
    const slots = parseProfessionalAvailabilityQuery({ ...resource, date: "2030-01-02", expectedVersion: "4" }, "slots", now);
    assert.equal(dates.now, now);assert.equal(slots.now, now);assert.equal(dates.expectedVersion,4);assert.equal(slots.fromDate,dates.fromDate);assert.equal(slots.toDate,slots.fromDate);
  });
  await t.test("query resource date volume and forged clock are rejected before database access", () => {
    const valid={...resource,date:"2030-01-02"};
    for(const invalid of [{professionalId:["foreign"]},{variantId:""},{date:"2030-02-30"},{expectedVersion:"0"},{expectedVersion:"invalid"},{now:"2031-01-01"},{merchantId:"foreign"}])assert.throws(()=>parseProfessionalAvailabilityQuery({...valid,...invalid},"slots",now),/availability/);
    assert.throws(()=>parseProfessionalAvailabilityQuery({...resource,fromDate:"2030-01-01",toDate:"2030-02-01"},"dates",now),/availability_window/);
  });
});
