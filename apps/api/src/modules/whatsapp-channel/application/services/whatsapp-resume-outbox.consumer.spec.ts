import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { DomainEvent, DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import type { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { PrismaWhatsAppHandoffRepository } from "../../infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import type { WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import { WHATSAPP_RESUME_REQUESTED } from "../../domain/services/whatsapp-resume-command.js";
import { WhatsAppResumeOutboxConsumer } from "./whatsapp-resume-outbox.consumer.js";

test("T56 resume consumer refuses unowned purpose and lease before transport",async t=>{
  const bindings={} as PrismaWhatsAppHandoffRepository,events={} as DomainEventBus;
  const tenant={get:()=>undefined} as unknown as TenantContextService;
  const sender={async sendText(){assert.fail("unowned_resume_must_not_send");}} as WhatsAppSenderPort;
  await t.test("a body-shaped human/operator/AI claim cannot enter any database operation",async()=>{
    const db={outboxMessage:{async findFirst(){assert.fail("invalid_purpose_must_not_read_database");}}} as unknown as PrismaClient;
    const consumer=new WhatsAppResumeOutboxConsumer(db,bindings,tenant,sender,events);
    for(const input of [{eventType:"whatsapp.support.message.requested",merchantId:"merchant-a",payload:{}},
      {eventType:WHATSAPP_RESUME_REQUESTED,merchantId:"merchant-a",payload:{epoch:8,operatorId:"operator-a"}}])
      await assert.rejects(consumer.handle(input as DomainEvent),{message:"resume_dispatch_proof_required"});
  });
  await t.test("a well-shaped event still cannot authorize transport without its actual durable lease row",async()=>{
    const db={outboxMessage:{async findFirst(){return null;}},async $queryRaw(){return[{now:new Date()}];}} as unknown as PrismaClient;
    const consumer=new WhatsAppResumeOutboxConsumer(db,bindings,tenant,sender,events);
    const input={eventType:WHATSAPP_RESUME_REQUESTED,eventId:"event-a",merchantId:"merchant-a",schemaVersion:1,deliveryLeaseToken:"invented-lease",
      correlationId:"support_resume:binding-a:8",causationId:"message-a",
      payload:{messageId:"message-a",ticketId:"ticket-a",bindingId:"binding-a",previousEpoch:7,epoch:8}};
    await assert.rejects(consumer.handle(input),{message:"resume_dispatch_lease_lost"});
  });
});
