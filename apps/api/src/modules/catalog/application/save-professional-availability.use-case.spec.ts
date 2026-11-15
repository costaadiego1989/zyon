import assert from "node:assert/strict";
import test from "node:test";
import { parseServiceInstant, validateRecurringAvailability } from "../domain/services/professional-availability-input.js";
import { serviceStartInstant } from "../domain/services/service-schedule.js";

test("T21", async t => {
  const row = { weekday: 1, startMinute: 600, endMinute: 660 };
  await t.test("new grid validity requires exact minutes while the generic historical parser retains precision", () => {
    for (const field of ["validFrom", "validUntil"]) for (const instant of ["2030-01-01T00:00:01Z", "2030-01-01T00:00:00.001Z"]) assert.throws(() => validateRecurringAvailability({timeZone:"UTC",rows:[{...row,[field]:instant}]}),/availability_minute_precision_required/);
    assert.equal(parseServiceInstant("2030-01-01T10:00:30.123Z").toISOString(),"2030-01-01T10:00:30.123Z");
    assert.equal(validateRecurringAvailability({timeZone:"UTC",rows:[{...row,validFrom:"2030-01-01T00:00:00.000Z"}]}).rows[0]!.validFrom!.toISOString(),"2030-01-01T00:00:00.000Z");
  });
  await t.test("valid timezone, effective boundaries and adjacent intervals preserve exact wall minutes", () => {
    const input = validateRecurringAvailability({ timeZone: "America/Sao_Paulo", rows: [{ ...row, validFrom: "2030-01-01T00:00:00Z", validUntil: "2031-01-01T00:00:00Z" }, { ...row, startMinute: 660, endMinute: 720 }] });
    assert.equal(input.timeZone, "America/Sao_Paulo");assert.equal(input.rows[0]!.startMinute, 600);assert.equal(input.rows[0]!.validFrom!.toISOString(), "2030-01-01T00:00:00.000Z");assert.equal(input.rows[1]!.endMinute,720);
  });
  await t.test("invalid bounds, overlap, validity and timezone are refused", () => {
    for (const invalid of [{weekday:7},{startMinute:-1},{endMinute:600},{endMinute:1441},{startMinute:1.5},{validFrom:"2030-02-01T00:00:00Z",validUntil:"2030-01-01T00:00:00Z"}]) assert.throws(()=>validateRecurringAvailability({timeZone:"UTC",rows:[{...row,...invalid}]}),/recurring/);
    assert.throws(()=>validateRecurringAvailability({timeZone:"UTC",rows:[row,{...row,startMinute:630}]}),/overlapping_recurring/);
    assert.throws(()=>validateRecurringAvailability({timeZone:"Missing/Zone",rows:[row]}),/timezone/);
    assert.throws(()=>validateRecurringAvailability({timeZone:"UTC",rows:Array(101).fill(row)}),/recurring_rows/);
  });
  await t.test("DST gaps and repeated wall times cannot be fabricated into appointment instants", () => {
    assert.equal(serviceStartInstant("2030-03-10","02:30","America/New_York"),undefined);
    assert.equal(serviceStartInstant("2030-11-03","01:30","America/New_York"),undefined);
    assert.equal(serviceStartInstant("2030-03-10","03:30","America/New_York")!.toISOString(),"2030-03-10T07:30:00.000Z");
  });
});
