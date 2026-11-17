import "reflect-metadata";
import test,{after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {createPrismaClient} from "../../../shared/persistence/prisma-client.js";
import {PrismaCheckoutRepository} from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import {checkoutSession} from "../../checkout/__tests__/checkout-test-fixtures.js";
import {RecoveryResumeOriginService} from "../application/services/recovery-resume-origin.service.js";
import prismaDeploymentConfig from "../../../../prisma.config.js";

const db=createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");after(async()=>db.$disconnect());
for(const deviceId of ["META-CLOUD:official-config","METAXCLOUD:official-config","meta_cloud:official-config","META_CLOUD:"]) {
 test("configured backfill cannot grant native origin to unsupported device "+deviceId,async t=>{
  const merchantId="qa_native_prefix_"+randomUUID();await db.merchant.create({data:{id:merchantId,name:"Owned prefix QA"}});
  t.after(async()=>{assert.ok(merchantId.startsWith("qa_native_prefix_"));await db.whatsAppSession.deleteMany({where:{merchantId}});await db.checkoutSession.deleteMany({where:{merchantId}});await db.merchant.delete({where:{id:merchantId}});});
  const checkout=checkoutSession({merchantId,sessionId:randomUUID(),conversationId:randomUUID()});await new PrismaCheckoutRepository(db).saveSession(checkout);
  await db.whatsAppSession.create({data:{merchantId,buyerPhone:"5511000000000",deviceId,checkoutSessionId:checkout.sessionId}});
  const origins=new RecoveryResumeOriginService(db,{findById:async()=>({id:"official-config",merchantId,enabled:true,provider:"META_CLOUD",status:"ACTIVE",whatsappNumber:"+55 21 99999-0000",credentials:{accessToken:"local-only",wabaId:"123456789",phoneNumberId:"987654321"}})} as any);
  await assert.rejects(origins.resolve(checkout),/recovery_whatsapp_connection_unavailable/);
  const before=await db.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:checkout.sessionId}}});
  const sql=readFileSync(prismaDeploymentConfig.migrations!.path+"/20261117053000_recovery_origin_evidence/migration.sql","utf8");
  await db.$executeRawUnsafe(sql);
  assert.deepEqual(await db.checkoutEvent.findMany({where:{merchantId,eventName:"whatsapp_recovery_origin_v1"}}),[],"unsupported device must not receive native-origin evidence");
  await assert.rejects(origins.resolve(checkout),/recovery_whatsapp_connection_unavailable/);
  assert.deepEqual(await db.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:checkout.sessionId}}}),before);
 });
}
