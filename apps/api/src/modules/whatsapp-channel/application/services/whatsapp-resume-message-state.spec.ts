import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, WhatsAppDelivery } from "@prisma/client";
import { WHATSAPP_RESUME_REQUESTED, initialResumeDelivery, parseResumeDispatch } from "../../domain/services/whatsapp-resume-command.js";
import { readStoredResumeAuthority, saveResumeDeliveryWithin, type StoredResumeCommand } from "./whatsapp-resume-message-state.js";

const event={eventId:"event-a",eventType:WHATSAPP_RESUME_REQUESTED,merchantId:"merchant-a",schemaVersion:1,deliveryLeaseToken:"lease-a",
  correlationId:"support_resume:binding-a:8",causationId:"message-a",
  payload:{messageId:"message-a",ticketId:"ticket-a",bindingId:"binding-a",previousEpoch:7,epoch:8}};
const proof=parseResumeDispatch(event);assert.ok(proof);
const authority={merchantId:"merchant-a",configId:"config-a",whatsappSessionId:"session-a",deviceId:"device-a",provider:"META_CLOUD",
  bindingId:"binding-a",ticketId:"ticket-a",operatorId:"operator-a",previousEpoch:7,epoch:8,
  identityStatus:"available",accountId:"original-account",recipient:"+5511999999999"};
const row=(unavailable=false)=>({id:event.correlationId,merchantId:"merchant-a",configId:"config-a",deviceId:"device-a",providerMessageId:null,
  state:unavailable?"failed":"queued",processingToken:"not_started",response:{purpose:"human_resume",schemaVersion:1,
    outboxEventId:"event-a",messageId:"message-a",ticketId:"ticket-a",authority:unavailable?{...authority,identityStatus:"unavailable",accountId:null}:authority,
    delivery:initialResumeDelivery(unavailable?"unavailable":"available")}} as unknown as WhatsAppDelivery);

test("T56 resume intent identity is historical and purpose-exclusive",async t=>{
  await t.test("reads only the exact original sender and epoch without consulting a current account",()=>{
    assert.deepEqual(readStoredResumeAuthority(row(),proof),authority);
    for(const field of ["accountId","recipient","deviceId","operatorId","previousEpoch","epoch"]){
      const changed=row(),saved=changed.response as Prisma.JsonObject,a={...(saved.authority as Prisma.JsonObject)};
      delete a[field];changed.response={...saved,authority:a};assert.equal(readStoredResumeAuthority(changed,proof),undefined);
    }
  });
  await t.test("cannot adopt operator-message, foreign config, device or outbox identity",()=>{
    for(const change of [{purpose:"support_message"},{outboxEventId:"other-event"},{messageId:"other-message"}]){
      const changed=row();changed.response={...(changed.response as Prisma.JsonObject),...change};assert.equal(readStoredResumeAuthority(changed,proof),undefined);
    }
    for(const change of [{merchantId:"foreign"},{configId:"other-config"},{deviceId:"other-device"}])
      assert.equal(readStoredResumeAuthority({...row(),...change},proof),undefined);
  });
  await t.test("unavailable original preserves missing identity as null and cannot become a started attempt",()=>{
    const saved=readStoredResumeAuthority(row(true),proof);assert.ok(saved);assert.equal(saved.identityStatus,"unavailable");assert.equal(saved.accountId,null);
    for(const change of [{state:"started"},{processingToken:"later-attempt"}])assert.equal(readStoredResumeAuthority({...row(true),...change},proof),undefined);
    const changed=row(true),response=changed.response as Prisma.JsonObject;
    changed.response={...response,submission:{phase:"started"}};assert.equal(readStoredResumeAuthority(changed,proof),undefined);
  });
  await t.test("a delivery writer cannot upgrade an unavailable intent even with a later provider result",async()=>{
    const unavailable=readStoredResumeAuthority(row(true),proof);assert.ok(unavailable);
    const command={authority:unavailable} as StoredResumeCommand;
    const tx={} as Prisma.TransactionClient;
    await assert.rejects(saveResumeDeliveryWithin(tx,command,{status:"accepted",providerMessageId:"later-account-result"}),
      {message:"resume_identity_unavailable_no_start"});
    assert.equal(unavailable.accountId,null);assert.equal(unavailable.identityStatus,"unavailable");
  });
});
