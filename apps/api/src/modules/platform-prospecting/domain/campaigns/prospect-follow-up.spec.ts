import assert from "node:assert/strict";
import test from "node:test";
import {prospectFollowUpAt} from "./prospect-follow-up.js";
const due=(time:string|null,zone?:string)=>prospectFollowUpAt({deliveredAt:time?new Date(time):null,trustedTimezone:zone})?.toISOString()??null;
test("PROS-18 AC1 the single follow-up requires confirmed delivery and waits 48 elapsed hours, including timezone transitions",()=>{
 assert.equal(due(null),null);
 assert.equal(due("2026-11-16T14:30:10Z"),"2026-11-18T14:30:10.000Z");
 assert.equal(due("2026-03-07T15:30:00Z","America/New_York"),"2026-03-09T15:30:00.000Z");
 assert.equal(due("2026-10-31T15:30:00Z","America/New_York"),"2026-11-02T15:30:00.000Z");
 assert.equal(prospectFollowUpAt({deliveredAt:new Date(),hasReply:true}),null);
});
test("PROS-18 AC2 09:00 inclusive, 18:00 exclusive, weekends and missing or invalid trusted timezone use the next business window",()=>{
 assert.equal(due("2026-11-19T19:00:00Z"),"2026-11-23T12:00:00.000Z");
 assert.equal(due("2026-11-16T12:00:00Z"),"2026-11-18T12:00:00.000Z");
 assert.equal(due("2026-11-16T11:59:00Z"),"2026-11-18T12:00:00.000Z");
 assert.equal(due("2026-11-18T21:00:00Z","Unknown/City"),"2026-11-23T12:00:00.000Z");
 assert.equal(due("2026-11-16T20:59:59Z","America/Sao_Paulo"),"2026-11-18T20:59:59.000Z");
 const sundayOpening=(delivery:string,start:string,end:string)=>prospectFollowUpAt({deliveredAt:new Date(delivery),trustedTimezone:"America/New_York",window:{weekdays:[7],start,end}})?.toISOString();
 assert.equal(sundayOpening("2026-03-06T06:00:00Z","02:10","04:00"),"2026-03-08T07:00:00.000Z");
 assert.equal(sundayOpening("2026-10-30T05:50:00Z","00:30","01:30"),"2026-11-01T06:00:00.000Z");
 assert.equal(sundayOpening("2026-10-30T06:10:00Z","01:20","01:30"),"2026-11-01T06:20:00.000Z");
 assert.equal(prospectFollowUpAt({deliveredAt:new Date("2026-11-19T12:00Z"),trustedTimezone:"America/New_York",window:{weekdays:[6],start:"10:00",end:"12:00"}})?.toISOString(),"2026-11-21T15:00:00.000Z");
});
