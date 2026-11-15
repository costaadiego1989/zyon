import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { saveAvailabilityException, validateAvailabilityException } from "./save-availability-exception.use-case.js";

test("T22", async t => {
  const valid = { kind: "one_off", startsAt: "2030-01-02T10:00:00Z", endsAt: "2030-01-02T10:30:00Z", timeZone: "UTC", reason: "Private operator note" };
  await t.test("new active times require exact minutes and historical withdrawal preserves its precise instants", () => {
    for (const kind of ["one_off", "block"]) {
      const precise={...valid,kind,id:"historical-exception",startsAt:"2030-01-02T10:00:30.123Z",endsAt:"2030-01-02T10:30:30.123Z"};
      assert.throws(()=>validateAvailabilityException(precise),/availability_minute_precision_required/);
      const withdrawn=validateAvailabilityException({...precise,isActive:false});assert.equal(withdrawn.startsAt.toISOString(),precise.startsAt);assert.equal(withdrawn.endsAt.toISOString(),precise.endsAt);assert.equal(withdrawn.isActive,false);
    }
  });
  await t.test("a new inactive row cannot bypass minute precision", () => {
    assert.throws(() => validateAvailabilityException({...valid,isActive:false,startsAt:"2030-01-02T10:00:30.123Z",endsAt:"2030-01-02T10:30:30.123Z"}),/availability_minute_precision_required/);
  });
  await t.test("withdrawal after a professional timezone edit preserves the original exception fields", async () => {
    const actor={merchantId:"merchant",userId:"operator",role:"owner"};
    const before={id:"historical",merchantId:actor.merchantId,professionalId:"professional",kind:"block",startsAt:new Date("2030-01-02T09:00:30.123Z"),endsAt:new Date("2030-01-02T09:30:30.123Z"),timeZone:"UTC",reason:"Historical private reason",actorId:"previous-operator",version:3,isActive:true};
    const tx={
      $queryRaw:async()=>[{id:"resource"}],
      merchant:{findUnique:async()=>({businessMode:"services",businessModeSelectedAt:new Date(),businessModeNeedsReview:false})},
      serviceProfessional:{findFirst:async()=>({id:before.professionalId,merchantId:actor.merchantId,timeZone:"America/Sao_Paulo",version:5,isActive:false}),updateMany:async()=>({count:1})},
      availabilityException:{findFirst:async()=>before,update:async({data}:{data:Record<string,unknown>})=>({...before,...data,version:before.version+1})},
    } as unknown as Prisma.TransactionClient;
    const result=await saveAvailabilityException(tx,actor,before.professionalId,5,{...valid,id:before.id,reason:"Replacement must not rewrite history",isActive:false});
    assert.equal(result.version,6);assert.deepEqual(result.exception,{...before,actorId:actor.userId,isActive:false,version:4});
  });
  await t.test("one-off and block preserve explicit UTC interval and private reason", () => {
    for (const kind of ["one_off", "block"]) { const actual = validateAvailabilityException({ ...valid, kind }); assert.equal(actual.kind, kind);assert.equal(actual.startsAt.toISOString(), "2030-01-02T10:00:00.000Z");assert.equal(actual.endsAt.toISOString(), "2030-01-02T10:30:00.000Z");assert.equal(actual.reason, valid.reason); }
  });
  await t.test("invalid interval calendar zone kind and forged actor are refused", () => {
    for (const invalid of [{ kind: "appointment" },{ endsAt: valid.startsAt },{ startsAt: valid.endsAt },{ startsAt: "2030-02-30T10:00:00Z" },{ startsAt: "2030-01-02T10:00:00" },{ timeZone: "Missing/Zone" },{ actorId: "forged" },{ reason: "a".repeat(1201) }]) assert.throws(() => validateAvailabilityException({ ...valid, ...invalid }), /availability|timezone/);
  });
});
