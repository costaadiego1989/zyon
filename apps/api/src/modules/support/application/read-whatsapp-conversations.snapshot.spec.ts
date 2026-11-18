import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import { ReadWhatsAppConversationsUseCase } from "./read-whatsapp-conversations.use-case.js";

const principal={kind:"human",tenantId:"tenant",userId:"operator",role:"staff"} as TenantPrincipal;
function fixture(failure?: Error){
  const reads:string[]=[],transactions:unknown[]=[],ticket={id:"case",status:"in_progress",buyerMessage:"Synthetic request",createdAt:new Date(),updatedAt:new Date()};
  const tx={supportTicket:{findMany:async()=>{reads.push("ticket");if(failure)throw failure;return[ticket];},findFirst:async()=>{reads.push("ticket");return ticket;}},
    whatsAppHandoffBinding:{findMany:async()=>{reads.push("binding");return[];},findFirst:async()=>{reads.push("binding");return null;}},
    supportTicketMessage:{findMany:async()=>{reads.push("messages");return[];}}};
  const prisma={$transaction:async(work:(value:unknown)=>Promise<unknown>,options:unknown)=>{transactions.push(options);return work(tx);}};
  return{reader:new ReadWhatsAppConversationsUseCase(prisma as unknown as PrismaClient),reads,transactions};
}
test("T58 list reads ticket and binding only inside one repeatable SQL snapshot",async()=>{
  const f=fixture(),result=await f.reader.list(principal,{});
  assert.equal(result.data[0].id,"case");assert.deepEqual(f.reads,["ticket","binding"]);
  assert.deepEqual(f.transactions,[{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead}]);
});
test("T58 detail reads history in the same snapshot and retains absence of binding",async()=>{
  const f=fixture(),result=await f.reader.detail(principal,"case",{});
  assert.equal(result.ticket.id,"case");assert.equal(result.binding,null);assert.equal(result.channel,null);
  assert.deepEqual(f.reads,["ticket","binding","messages"]);
  assert.deepEqual(f.transactions,[{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead}]);
});
test("T58 invalid input never starts a transaction and SQL failure is not empty success",async()=>{
  const error=new Error("synthetic_sql_failure"),f=fixture(error);
  await assert.rejects(f.reader.list(principal,{merchantId:"foreign"}),/invalid_whatsapp_queue_query/);
  assert.deepEqual(f.transactions,[]);assert.deepEqual(f.reads,[]);
  await assert.rejects(f.reader.list(principal,{}),value=>value===error);
  assert.deepEqual(f.reads,["ticket"]);assert.equal(f.transactions.length,1);
});
