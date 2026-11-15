import assert from "node:assert/strict";
import test from "node:test";
import { resolveProfessionalAvailability, type ProfessionalAvailabilitySource } from "./professional-availability.js";
import { isServiceOfferAvailable, publicServiceSchedule, resolveSelectedServiceSlot, serviceScheduleError, serviceStartInstant } from "./service-schedule.js";

const range = (start: string, end: string) => ({ startsAt: new Date(start), endsAt: new Date(end) });
const source = (): ProfessionalAvailabilitySource => ({ professionalVersion: 4, policyVersion: 2, timeZone: "UTC", durationMinutes: 30,
  recurring: [{ weekday: 3, startMinute: 600, endMinute: 720, timeZone: "UTC", validFrom: null, validUntil: null }], exceptions: [], appointments: [] });
const query = { fromDate: "2030-01-02", toDate: "2030-01-02", now: new Date("2030-01-01T00:00:00Z") };

test("T23", async t => {
  await t.test("shared civil-time conversion keeps zone offsets and half-hour DST gaps/folds separate", () => {
    for(const [zone,expected] of [["Pacific/Kiritimati","2023-12-31T10:00:00.000Z"],["Asia/Kathmandu","2023-12-31T18:15:00.000Z"],["Pacific/Marquesas","2024-01-01T09:30:00.000Z"],["UTC","2024-01-01T00:00:00.000Z"]])assert.equal(serviceStartInstant("2024-01-01","00:00",zone!)!.toISOString(),expected);
    assert.equal(serviceStartInstant("2024-10-06","02:15","Australia/Lord_Howe"),undefined);assert.equal(serviceStartInstant("2024-04-07","01:45","Australia/Lord_Howe"),undefined);
    assert.equal(serviceStartInstant("2024-10-06","02:30","Australia/Lord_Howe")!.toISOString(),"2024-10-05T15:30:00.000Z");
    assert.equal(serviceStartInstant("2030-02-30","00:00","UTC"),undefined);assert.equal(serviceStartInstant("2030-01-02","10:00","Missing/Zone"),undefined);
    assert.equal(serviceStartInstant("2024-01-01","00:00","UTC")!.toISOString(),"2024-01-01T00:00:00.000Z");
  });
  await t.test("the legacy static service schedule keeps its existing selection and availability contract", () => {
    const schedule={timeZone:"UTC",durationMinutes:30,slots:[{id:"legacy-slot",date:"2030-01-02",startTime:"10:00"}]},metadata={serviceSchedule:schedule};
    const selected={slotId:"legacy-slot",date:"2030-01-02",startTime:"10:00",startsAt:"2030-01-02T10:00:00.000Z",endsAt:"2030-01-02T10:30:00.000Z",timeZone:"UTC",durationMinutes:30};
    assert.equal(serviceScheduleError(schedule),undefined);assert.deepEqual(resolveSelectedServiceSlot(metadata,"legacy-slot",query.now),selected);assert.deepEqual(publicServiceSchedule(metadata,query.now),{timeZone:"UTC",durationMinutes:30,slots:[{...selected,selectable:true}]});
    assert.equal(isServiceOfferAvailable(metadata,query.now),true);assert.equal(isServiceOfferAvailable({serviceSchedule:{...schedule,slots:[]}},query.now),false);assert.equal(isServiceOfferAvailable({},query.now),true);
    assert.equal(serviceScheduleError({...schedule,slots:[...schedule.slots,{id:"overlap",date:"2030-01-02",startTime:"10:15"}]}),"overlapping_service_slots");
  });
  await t.test("explicit rule timezone survives a professional presentation-zone edit across the date boundary", () => {
    const value=source();value.recurring=[{weekday:1,startMinute:1380,endMinute:1440,timeZone:"America/Sao_Paulo",validFrom:null,validUntil:null}];
    const selected={...query,fromDate:"2030-01-08",toDate:"2030-01-08"},day=resolveProfessionalAvailability(value,selected),window=resolveProfessionalAvailability(value,{...selected,fromDate:"2030-01-07"});
    assert.deepEqual(day.slots.map(slot=>slot.startTime),["02:00","02:30"]);assert.deepEqual(day.dates,["2030-01-08"]);assert.deepEqual(day.slots,window.slots.filter(slot=>slot.date==="2030-01-08"));assert.equal(day.slots[0]!.startsAt,"2030-01-08T02:00:00.000Z");assert.equal(value.recurring[0]!.timeZone,"America/Sao_Paulo");
  });
  await t.test("declared cross-midnight origins keep isolated and multi-date fifty-minute choices identical", () => {
    const value=source();value.durationMinutes=50;value.recurring=[{weekday:3,startMinute:1380,endMinute:1440,timeZone:"UTC",validFrom:null,validUntil:null},{weekday:4,startMinute:0,endMinute:60,timeZone:"UTC",validFrom:null,validUntil:null}];
    const window=resolveProfessionalAvailability(value,{...query,toDate:"2030-01-03"}),day=resolveProfessionalAvailability(value,{...query,fromDate:"2030-01-03",toDate:"2030-01-03"});
    assert.deepEqual(window.slots.map(slot=>slot.startTime),["23:00","23:50","00:00"]);assert.deepEqual(day.slots.map(slot=>slot.startTime),["00:00"]);assert.deepEqual(day.slots,window.slots.filter(slot=>slot.date==="2030-01-03"));assert.ok(new Date(window.slots[1]!.endsAt)>new Date(day.slots[0]!.startsAt));
  });
  await t.test("continuous adjacent days cannot make the query buffer choose the fifty-minute anchor", () => {
    const value=source();value.durationMinutes=50;value.recurring=[3,4,5].map(weekday=>({weekday,startMinute:0,endMinute:1440,timeZone:"UTC",validFrom:null,validUntil:null}));
    const day=resolveProfessionalAvailability(value,{...query,fromDate:"2030-01-03",toDate:"2030-01-03"}),window=resolveProfessionalAvailability(value,{...query,toDate:"2030-01-04"});
    assert.equal(day.slots.length,29);assert.equal(day.slots[0]!.startTime,"00:00");assert.equal(day.slots.at(-1)!.startTime,"23:20");assert.deepEqual(day.slots,window.slots.filter(slot=>slot.date==="2030-01-03"));
  });
  await t.test("validity clipping removes candidates without moving their original occurrence anchor", () => {
    const value=source();value.recurring[0]!.validFrom=new Date("2030-01-02T10:05:00Z");
    const actual=resolveProfessionalAvailability(value,query);assert.deepEqual(actual.slots.map(slot=>slot.startTime),["10:30","11:00","11:30"]);assert.equal(value.recurring[0]!.validFrom!.toISOString(),"2030-01-02T10:05:00.000Z");
  });
  await t.test("precise legacy offered intervals remain stored but never masquerade as rounded public minute choices", () => {
    const value=source();value.exceptions=[{...range("2030-01-02T13:00:30.123Z","2030-01-02T14:00:30.123Z"),kind:"one_off"}];
    const actual=resolveProfessionalAvailability(value,query);assert.deepEqual(actual.slots.map(slot=>slot.startTime),["10:00","10:30","11:00","11:30"]);assert.equal(actual.status,"ready");
    assert.equal(value.exceptions[0]!.startsAt.toISOString(),"2030-01-02T13:00:30.123Z");assert.equal(value.exceptions[0]!.endsAt.toISOString(),"2030-01-02T14:00:30.123Z");
  });
  await t.test("precise historical occupancy blocks its actual interval without rounding or re-anchoring public minutes", () => {
    const value=source();value.appointments=[range("2030-01-02T10:00:30.123Z","2030-01-02T10:30:30.123Z")];
    const actual=resolveProfessionalAvailability(value,query);assert.deepEqual(actual.slots.map(slot=>slot.startTime),["11:00","11:30"]);
    assert.ok(actual.slots.every(slot=>new Date(slot.startsAt).getUTCSeconds()===0&&new Date(slot.startsAt).getUTCMilliseconds()===0));
    assert.equal(value.appointments[0]!.startsAt.toISOString(),"2030-01-02T10:00:30.123Z");assert.equal(value.appointments[0]!.endsAt.toISOString(),"2030-01-02T10:30:30.123Z");
  });
  await t.test("dates and slots union offered time and subtract all confirmed occupancy and blocks", () => {
    const value = source();value.exceptions = [{ ...range("2030-01-02T10:30:00Z", "2030-01-02T11:00:00Z"), kind: "block" }, { ...range("2030-01-02T11:30:00Z", "2030-01-02T12:30:00Z"), kind: "one_off" }];value.appointments = [range("2030-01-02T11:00:00Z", "2030-01-02T11:30:00Z")];
    const actual = resolveProfessionalAvailability(value, query);
    assert.equal(actual.status,"ready");assert.deepEqual(actual.dates,["2030-01-02"]);assert.deepEqual(actual.slots.map(slot=>slot.startTime),["10:00","11:30","12:00"]);
    assert.deepEqual(actual.slots[0],{startsAt:"2030-01-02T10:00:00.000Z",endsAt:"2030-01-02T10:30:00.000Z",date:"2030-01-02",startTime:"10:00",timeZone:"UTC",durationMinutes:30});assert.equal(actual.policyVersion,2);assert.equal(actual.asOf,query.now.toISOString());
  });
  await t.test("shared offers and overlapping one-off windows never duplicate professional capacity", () => {
    const first=source();first.exceptions=[{...range("2030-01-02T10:00:00Z","2030-01-02T12:00:00Z"),kind:"one_off"}];first.appointments=[range("2030-01-02T10:15:00Z","2030-01-02T10:45:00Z")];
    const actual=resolveProfessionalAvailability(first,query);assert.deepEqual(actual.slots.map(slot=>slot.startTime),["11:00","11:30"]);assert.equal(new Set(actual.slots.map(slot=>slot.startsAt)).size,actual.slots.length);
    const second={...first,durationMinutes:60};assert.deepEqual(resolveProfessionalAvailability(second,query).slots.map(slot=>slot.startTime),["11:00"]);
    assert.equal(resolveProfessionalAvailability(source(),query).slots.length,4);
  });
  await t.test("another service consumes twenty minutes without removing a previously offered free thirty-minute slot", () => {
    const original=resolveProfessionalAvailability(source(),query);assert.ok(original.slots.some(slot=>slot.startTime==="10:30"));
    const changed=source();changed.appointments=[range("2030-01-02T10:00:00Z","2030-01-02T10:20:00Z")];
    const actual=resolveProfessionalAvailability(changed,query);assert.deepEqual(actual.slots.map(slot=>slot.startTime),["10:30","11:00","11:30"]);
    assert.deepEqual(actual.slots[0],original.slots.find(slot=>slot.startTime==="10:30"));
  });
  await t.test("professional timezone defines the selected date including the UTC boundary", () => {
    const value=source();value.timeZone="America/Sao_Paulo";value.recurring=[];value.exceptions=[{...range("2030-01-03T01:00:00Z","2030-01-03T02:00:00Z"),kind:"one_off"}];
    const actual=resolveProfessionalAvailability(value,query);assert.deepEqual(actual.dates,["2030-01-02"]);assert.deepEqual(actual.slots.map(slot=>slot.startTime),["22:00","22:30"]);assert.equal(actual.slots[0]!.startsAt,"2030-01-03T01:00:00.000Z");
    assert.equal(resolveProfessionalAvailability(value,{...query,fromDate:"2030-01-03",toDate:"2030-01-03"}).status,"empty");
  });
  await t.test("DST gaps and repeated starts do not produce fictional choices", () => {
    for(const date of ["2030-03-10","2030-11-03"]){const value=source();value.timeZone="America/New_York";value.recurring=[{weekday:0,startMinute:60,endMinute:240,timeZone:value.timeZone,validFrom:null,validUntil:null}];const actual=resolveProfessionalAvailability(value,{...query,fromDate:date,toDate:date});assert.equal(actual.status,"ready");assert.ok(actual.slots.every(slot=>date==="2030-03-10"?!slot.startTime.startsWith("02:"):!slot.startTime.startsWith("01:")));assert.ok(actual.slots.every(slot=>new Date(slot.endsAt).getTime()-new Date(slot.startsAt).getTime()===30*60_000));}
  });
  await t.test("empty stale error and bounded window remain distinct", () => {
    const empty=resolveProfessionalAvailability({...source(),recurring:[]},query);assert.equal(empty.status,"empty");assert.deepEqual(empty.slots,[]);
    const stale=resolveProfessionalAvailability(source(),{...query,expectedVersion:3});assert.equal(stale.status,"stale");assert.deepEqual(stale.dates,[]);assert.equal(stale.professionalVersion,4);
    assert.throws(()=>resolveProfessionalAvailability({...source(),appointments:[range("invalid","2030-01-02T10:00:00Z")]},query),/availability_invalid_source/);
    for(const invalid of [{toDate:"2030-02-02"},{fromDate:"2030-02-30"},{toDate:"2030-01-01"}])assert.throws(()=>resolveProfessionalAvailability(source(),{...query,...invalid}),/availability_(window|date)/);
    assert.deepEqual(resolveProfessionalAvailability(source(),{...query,now:new Date("2030-01-02T11:15:00Z")}).slots.map(slot=>slot.startTime),["11:30"]);
  });
});
