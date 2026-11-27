import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { arrangeIssuance } from "../../../../tests/fiscal-issuance-harness.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaReturnRepository } from "../../returns/infrastructure/repositories/prisma-return.repository.js";
import { PrismaPaymentRepository } from "../../payment/infrastructure/prisma-payment.repository.js";
import { FiscalCancellationService } from "../application/fiscal-cancellation.service.js";
import { FiscalReconciliationService } from "../application/fiscal-reconciliation.service.js";
import { PrismaFiscalStockCoordinator } from "../../../shared/persistence/fiscal-stock-coordination.js";
import { OnOrderFiscalReviewHandler } from "./on-order-fiscal-review.handler.js";
let f: Awaited<ReturnType<typeof createFiscalFixture>>;
before(async () => { f = await createFiscalFixture(); }, { timeout: 120000 }); after(async () => f?.close());
async function sale(authorized = false) {
 const a = await arrangeIssuance(f);
 const payment = await f.prisma.paymentIntent.create({ data: { id: "payment_" + a.sale.intent.id, merchantId: a.sale.orderMerchantId, sessionId: a.sale.completedOrder.sessionId,
 idempotencyKey: a.sale.intent.id, amountCents: 2101, approvedAmountCents: 2101, currency: "BRL", method: "card", status: "approved", providerPaymentId: a.sale.orderId } });
 const repo = new PrismaCheckoutRepository(f.prisma);
 const returns = new PrismaReturnRepository(f.prisma);
 if (authorized) { await a.run(); a.setRemote("authorized"); await new FiscalReconciliationService(a.store,a.factory,{read:async()=>({found:false,reasonCode:"none"})},new PrismaFiscalStockCoordinator(f.prisma)).reconcile(a.scope,a.sale.intent.id); }
 const service = new FiscalCancellationService(f.prisma,a.store,a.factory);
 const cancel = () => repo.cancelCompletedOrder({merchantId:a.sale.orderMerchantId,sessionId:a.sale.completedOrder.sessionId,externalOrderId:a.sale.orderId,reason:"cancelamento comercial",cancelledAt:new Date().toISOString()});
 const createReturn = async (amount = 2101, status = "COMPLETED") => {
   const ret = await f.prisma.return.create({data:{merchantId:a.sale.orderMerchantId,orderId:a.sale.orderId,buyerId:"synthetic_buyer",reason:"OTHER",status:"REFUND_PROCESSING"}});
   await returns.saveRefund({returnId:ret.id,paymentIntentId:payment.id,providerRefundId:"refund_"+ret.id,amountInCents:amount,status});return ret;
 };
 return {...a,payment,repo,returns,service,cancel,createReturn};
}
test("FISCAL-13 real cancelled-order commit fences claimed worker while review outbox is paused",async()=>{
 const a=await sale();const stale=await a.store.open((await a.claim())!);await a.cancel();
 assert.equal((await f.prisma.completedOrder.findUniqueOrThrow({where:{id:a.sale.completedOrder.id}})).status,"cancelled");
 assert.equal((await a.current()).state,"suppressed");assert.equal(await stale.journal.begin({identity:stale.context.identity,stage:"invoice.submit",reference:stale.context.identity.reference,outcome:"started",payloadHash:"a".repeat(64)}),false);
 assert.equal(a.calls.length,0);assert.equal(await f.prisma.outboxMessage.count({where:{merchantId:a.sale.merchantId,eventType:"fiscal.commercial.review_requested",status:"pending"}}),1);
});
test("FISCAL-51 real cancellation after admitted write retains reconciliation and later original authorization review",async()=>{
 const a=await sale();await a.run();await a.cancel();assert.equal((await a.current()).state,"reconciliation_required");a.setRemote("authorized");
 await new FiscalReconciliationService(a.store,a.factory,{read:async()=>({found:false,reasonCode:"none"})},new PrismaFiscalStockCoordinator(f.prisma)).reconcile(a.scope,a.sale.intent.id);
 const doc=await f.prisma.fiscalDocument.findUniqueOrThrow({where:{intentId:a.sale.intent.id}});assert.equal(doc.state,"authorized");assert.equal(doc.cancellationProtocol,null);
 assert.equal(await f.prisma.fiscalCancellationReview.count({where:{documentId:doc.id,triggerKind:"cancelled"}}),1);assert.equal(a.calls.filter(x=>x.method==="DELETE").length,0);
});
test("FISCAL-51 real cancellation replay and durable consumer produce one review",async()=>{
 const a=await sale(true);await a.cancel();assert.equal((await a.cancel())?.idempotent,true);
 const event=await f.prisma.outboxMessage.findFirstOrThrow({where:{merchantId:a.sale.merchantId,eventType:"fiscal.commercial.review_requested"}});
 const handler=new OnOrderFiscalReviewHandler(f.prisma,{} as any,a.service);for(let i=0;i<2;i++)await handler.consume({eventId:event.eventId,eventType:event.eventType,merchantId:event.merchantId,payload:event.payload});
 assert.equal(await f.prisma.fiscalCancellationReview.count({where:{merchantId:a.sale.merchantId}}),1);assert.equal(a.calls.filter(x=>x.method==="DELETE").length,0);
});
test("FISCAL-51 cancellation participant failure rolls back commercial commit and fence",async()=>{
 const a=await sale();await f.sql.query(`CREATE FUNCTION fail_commercial_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='fiscal.commercial.review_requested' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_commercial_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION fail_commercial_outbox()`);
 await assert.rejects(a.cancel());await f.sql.query("DROP TRIGGER fail_commercial_outbox ON outbox_messages; DROP FUNCTION fail_commercial_outbox()");
 assert.notEqual((await f.prisma.completedOrder.findUniqueOrThrow({where:{id:a.sale.completedOrder.id}})).status,"cancelled");assert.equal((await a.current()).state,"queued");assert.equal(await f.prisma.fiscalEvent.count({where:{intentId:a.sale.intent.id,action:"commercial.cancelled"}}),0);
});
test("FISCAL-51 actual ordinary completed refund creates review in same transaction without fiscal cancellation",async()=>{
 const a=await sale(true);const ret=await a.createReturn();assert.equal((await f.prisma.returnRefund.findUniqueOrThrow({where:{returnId:ret.id}})).status,"COMPLETED");
 const review=await f.prisma.fiscalCancellationReview.findFirstOrThrow({where:{merchantId:a.sale.merchantId}});assert.equal(review.triggerKind,"refund");assert.equal(review.reviewState,"needs_confirmation");assert.equal(a.calls.filter(x=>x.method==="DELETE").length,0);
});
test("FISCAL-55 ordinary pending refund has no fiscal effect until reconciliation commits COMPLETED",async()=>{
 const a=await sale();const ret=await a.createReturn(1000,"PENDING");assert.equal((await a.current()).state,"queued");await a.returns.updateRefundStatus(ret.id,"COMPLETED",new Date());await a.returns.updateRefundStatus(ret.id,"COMPLETED",new Date());
 assert.equal((await a.current()).state,"action_required");assert.equal((await a.current()).lastErrorCode,"fiscal_partial_refund_requires_review");assert.equal(await f.prisma.fiscalEvent.count({where:{intentId:a.sale.intent.id,action:"commercial.partial_refund"}}),1);
 assert.equal(await f.prisma.fiscalEvent.count({where:{intentId:a.sale.intent.id,action:"stock_effect_suppressed"}}),0);assert.equal(a.calls.length,0);
});
test("FISCAL-51 failed ordinary refund does not suppress or create a review",async()=>{
 const a=await sale();await a.createReturn(2101,"FAILED");assert.equal((await a.current()).state,"queued");assert.equal(await f.prisma.fiscalEvent.count({where:{intentId:a.sale.intent.id,action:{startsWith:"commercial."}}}),0);
});
test("FISCAL-55 real original payment repository persists authenticated partial observation without full transition",async()=>{
 const a=await sale(true);const repo=new PrismaPaymentRepository(f.prisma);const observation={merchantId:a.sale.merchantId,paymentIntentId:a.payment.id,providerPaymentId:a.sale.orderId,amountCents:2101,currency:"brl",refundedCents:101,providerEventRef:"stripe-refund:ch_original:101"};
 await repo.recordFiscalRefundObservation(observation);await repo.recordFiscalRefundObservation(observation);assert.equal((await f.prisma.paymentIntent.findUniqueOrThrow({where:{id:a.payment.id}})).status,"approved");
 assert.equal((await f.prisma.fiscalCancellationReview.findFirstOrThrow({where:{merchantId:a.sale.merchantId}})).triggerKind,"partial_refund");assert.equal(await f.prisma.fiscalCancellationReview.count({where:{merchantId:a.sale.merchantId}}),1);
});
test("FISCAL-51 foreign or unpersisted commercial event cannot review an original invoice",async()=>{
 const a=await sale(true);const handler=new OnOrderFiscalReviewHandler(f.prisma,{} as any,a.service);await assert.rejects(handler.consume({eventId:"invented",eventType:"fiscal.commercial.review_requested",merchantId:a.sale.merchantId,payload:{intentId:a.sale.intent.id}}),/untrusted/);
 await assert.rejects(new PrismaPaymentRepository(f.prisma).recordFiscalRefundObservation({merchantId:"foreign",paymentIntentId:a.payment.id,providerPaymentId:a.sale.orderId,amountCents:2101,currency:"BRL",refundedCents:100,providerEventRef:"foreign"}),/mismatch/);assert.equal(await f.prisma.fiscalCancellationReview.count({where:{merchantId:a.sale.merchantId}}),0);
});
import { PrismaMarketplaceRefundRepository } from "../../marketplace/infrastructure/repositories/prisma-marketplace-refund.repository.js";
import { fundingHash } from "../../marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
async function marketplaceRecord() {
 const host=f.tag+"_marketplace_"+crypto.randomUUID();const first=await seedFiscalSale(f,{orderMerchantId:host,issuance:true});const second=await seedFiscalSale(f,{orderMerchantId:host,orderId:first.orderId,issuance:true});
 const payment=await f.prisma.paymentIntent.create({data:{id:"mp_"+first.intent.id,merchantId:host,sessionId:first.completedOrder.sessionId,idempotencyKey:first.intent.id,amountCents:4202,approvedAmountCents:4202,currency:"BRL",method:"card",status:"approved",providerPaymentId:"pi_distinct_"+first.intent.id,commerceOrderId:first.orderId}});
 await f.prisma.marketplaceFundingPlan.create({data:{paymentIntentId:payment.id,hostMerchantId:host,checkoutSessionId:first.completedOrder.sessionId,provider:"stripe",environment:"test",accountFingerprint:"original_account",providerPaymentId:payment.providerPaymentId,amountCents:4202,instructions:{},instructionsHash:fundingHash({})}});
 const ret=await f.prisma.return.create({data:{merchantId:host,orderId:first.orderId,buyerId:"buyer",reason:"OTHER",status:"REFUND_PROCESSING"}});
 const allocation={version:1,lines:[{sellerMerchantId:first.merchantId,lineItemId:"line_a",variantId:"variant_a",quantity:1,cumulativeQuantity:1,purchasedQuantity:2}],cumulativeRefundCents:101,amountCents:101};
 const plan=await f.prisma.marketplaceRefundPlan.create({data:{fundingPlanId:payment.id,hostMerchantId:host,returnId:ret.id,inputHash:fundingHash({}),allocation,allocationHash:fundingHash(allocation),amountCents:101,status:"submitted"}});
 const raw={provider:"stripe",reference:"refund_"+plan.id,accountFingerprint:"original_account",amountCents:101};const request={...raw,requestHash:fundingHash(raw)};
 const op=await f.prisma.marketplaceRefundOperation.create({data:{refundPlanId:plan.id,provider:"stripe",accountFingerprint:"original_account",request,requestHash:request.requestHash,reference:raw.reference,status:"unknown"}});
 await f.prisma.returnRefund.create({data:{id:"mrefund_return_"+fundingHash(plan.id),returnId:ret.id,paymentIntentId:payment.id,amountInCents:101,status:"PENDING"}});
 const repo=new PrismaMarketplaceRefundRepository(f.prisma);const operation={operationId:op.id,refundPlanId:plan.id,hostMerchantId:host,version:0,state:"unknown" as const,request:request as any};
 const record=()=>repo.record(operation,{state:"confirmed",providerOperationId:"re_original_"+plan.id,amountCents:101,observedAt:new Date().toISOString()});
 return{host,first,second,payment,plan,ret,record};
}
test("FISCAL-55 actual marketplace confirmed repository resolves commercial alias and only affected original seller",async()=>{
 const a=await marketplaceRecord();assert.equal(await a.record(),true);assert.equal(await a.record(),false);
 assert.equal((await f.prisma.fiscalIntent.findUniqueOrThrow({where:{id:a.first.intent.id}})).state,"action_required");assert.equal((await f.prisma.fiscalIntent.findUniqueOrThrow({where:{id:a.second.intent.id}})).state,"queued");
 assert.equal(await f.prisma.fiscalIntent.count({where:{merchantId:a.host}}),0);assert.equal((await f.prisma.paymentIntent.findUniqueOrThrow({where:{id:a.payment.id}})).status,"approved");
 const event=await f.prisma.outboxMessage.findFirstOrThrow({where:{merchantId:a.first.merchantId,eventType:"fiscal.commercial.review_requested"}});assert.equal((event.payload as any).trigger.kind,"partial_refund");
 assert.equal(await f.prisma.outboxMessage.count({where:{merchantId:a.second.merchantId,eventType:"fiscal.commercial.review_requested"}}),0);assert.equal(await f.prisma.outboxMessage.count({where:{merchantId:a.host,eventType:"marketplace.refund.confirmed"}}),1);
});
test("FISCAL-51 marketplace fiscal persistence failure rolls back financial confirmation and durable original event",async()=>{
 const a=await marketplaceRecord();await f.sql.query(`CREATE FUNCTION fail_marketplace_fiscal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='fiscal.commercial.review_requested' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_marketplace_fiscal BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION fail_marketplace_fiscal()`);
 await assert.rejects(a.record());await f.sql.query("DROP TRIGGER fail_marketplace_fiscal ON outbox_messages; DROP FUNCTION fail_marketplace_fiscal()");
 assert.equal((await f.prisma.marketplaceRefundPlan.findUniqueOrThrow({where:{id:a.plan.id}})).status,"submitted");assert.equal((await f.prisma.returnRefund.findUniqueOrThrow({where:{returnId:a.ret.id}})).status,"PENDING");
 assert.equal((await f.prisma.fiscalIntent.findUniqueOrThrow({where:{id:a.first.intent.id}})).state,"queued");assert.equal(await f.prisma.outboxMessage.count({where:{merchantId:a.host,eventType:"marketplace.refund.confirmed"}}),0);
});
import { CancelOrderUseCase } from "../../operations/application/order-command.use-cases.js";
import { PrismaOperationsReadRepository } from "../../operations/infrastructure/prisma-operations-read.repository.js";
import { ProcessRefundUseCase } from "../../returns/application/use-cases/process-refund.use-case.js";
test("FISCAL-51 actual operations cancel use case with real read and write repositories commits fiscal review",async()=>{
 const a=await sale(true);await f.prisma.completedOrder.update({where:{id:a.sale.completedOrder.id},data:{status:"paid"}});let notifications=0;
 const useCase=new CancelOrderUseCase(new PrismaOperationsReadRepository(f.prisma),a.repo,{} as any,{publish:async()=>{notifications++;}} as any,f.prisma);
 const result=await useCase.execute({merchantId:a.sale.merchantId,orderId:a.sale.completedOrder.id,reason:"Cancelamento confirmado"});
 assert.equal(result.status,"cancelled");assert.equal(notifications,1);assert.equal(await f.prisma.fiscalCancellationReview.count({where:{merchantId:a.sale.merchantId,triggerKind:"cancelled"}}),1);assert.equal(a.calls.filter(x=>x.method==="DELETE").length,0);
});
for(const reconciled of [false,true])test(`FISCAL-51 actual ordinary ProcessRefund ${reconciled?"reconciliation":"initial success"} commits durable fiscal review without second refund`,async()=>{
 const a=await sale(true);const ret=await f.prisma.return.create({data:{merchantId:a.sale.merchantId,orderId:a.sale.orderId,buyerId:"buyer",reason:"OTHER",status:reconciled?"REFUND_PROCESSING":"INSPECTED_PASS"}});
 if(reconciled)await a.returns.beginRefund({returnId:ret.id,paymentIntentId:a.payment.id,amountInCents:2101,status:"PENDING"});
 let financialWrites=0;const financial={prepareOrderRefund:async()=>({paymentIntentId:a.payment.id,providerRequest:{},amountCents:2101,fullOrderReturn:true}),refundPreparedPayment:async()=>{financialWrites++;return{refunded:true,providerRefundId:"confirmed_refund"};},reconcileRefundPayment:async()=>({state:"succeeded"})};
 const useCase=new ProcessRefundUseCase(a.returns,financial as any);const result=await useCase.execute(a.sale.merchantId,ret.id);await useCase.execute(a.sale.merchantId,ret.id);
 assert.equal(result.status,"REFUND_COMPLETED");assert.equal(financialWrites,reconciled?0:1);assert.equal(await f.prisma.fiscalCancellationReview.count({where:{merchantId:a.sale.merchantId,triggerKind:"refund"}}),1);assert.equal(a.calls.filter(x=>x.method==="DELETE").length,0);
});
