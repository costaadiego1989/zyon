import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import type { PrismaWhatsAppHandoffRepository } from "../../whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import { CloseWhatsAppConversationUseCase } from "./close-whatsapp-conversation.use-case.js";

const principal={kind:"human",tenantId:"merchant-a",userId:"operator-a",role:"staff"} as TenantPrincipal;
test("T56",async t=>{
  const noDatabase={whatsAppHandoffBinding:{findFirst(){assert.fail("invalid_close_must_not_read_or_write");}},
    $transaction(){assert.fail("invalid_close_must_not_start_transaction");}} as unknown as PrismaClient;
  const noBindings={} as PrismaWhatsAppHandoffRepository;
  const command=new CloseWhatsAppConversationUseCase(noDatabase,noBindings);
  await t.test("rejects machine and unprivileged roles before database effects",async()=>{
    for(const actor of [{...principal,kind:"m2m"},{...principal,role:"customer"}])
      await assert.rejects(command.execute(actor as TenantPrincipal,"ticket-a",{expectedEpoch:7}),{message:"human_operator_required"});
  });
  await t.test("rejects malformed ticket, epoch and status or body identity grants before database effects",async()=>{
    for(const input of [null,[],{}, {expectedEpoch:-1},{expectedEpoch:7.5},{expectedEpoch:2_147_483_648},
      {expectedEpoch:7,status:"open"},{expectedEpoch:7,merchantId:"foreign"},{expectedEpoch:7,accountId:"new-sender"}])
      await assert.rejects(command.execute(principal,"ticket-a",input),{message:"invalid_whatsapp_close"});
    await assert.rejects(command.execute(principal,"",{expectedEpoch:7}),{message:"invalid_whatsapp_close"});
  });
  await t.test("a missing scoped binding is a not-found result and cannot enter a mutation transaction",async()=>{
    let read:unknown;
    const db={whatsAppHandoffBinding:{async findFirst(input:unknown){read=input;return null;}},
      $transaction(){assert.fail("missing_close_must_not_mutate");}} as unknown as PrismaClient;
    await assert.rejects(new CloseWhatsAppConversationUseCase(db,noBindings).execute(principal,"ticket-a",{expectedEpoch:7}),
      {message:"whatsapp_handoff_ticket_not_found"});
    assert.deepEqual(read,{where:{merchantId:"merchant-a",ticketId:"ticket-a"}});
  });
});
