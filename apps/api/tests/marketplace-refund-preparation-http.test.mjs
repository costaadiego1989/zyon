import 'reflect-metadata';
import { MarketplaceRefundPreparationService } from '../src/modules/returns/application/marketplace-refund-preparation.service.ts';
import { MarketplaceRefundPreparationController } from '../src/modules/returns/presentation/http/marketplace-refund-preparation.controller.ts';
import { fundingHash } from '../src/modules/marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.ts';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MarketplaceRefundDashboardService } from '../src/modules/marketplace/application/marketplace-refund-dashboard.service.ts';
import { MarketplaceRefundDashboardController } from '../src/modules/marketplace/presentation/http/marketplace-refund-dashboard.controller.ts';
import { ExecuteMarketplaceRefundUseCase } from '../src/modules/marketplace/application/use-cases/execute-marketplace-refund.use-case.ts';
import { PrismaAuthRepository } from '../src/modules/auth/infrastructure/prisma-auth.repository.ts';
import { JwtService } from '../src/modules/auth/domain/services/jwt.service.ts';
import { AuthCookieService } from '../src/modules/auth/domain/services/auth-cookie.service.ts';
import { AuthGuard } from '../src/modules/auth/presentation/auth.guard.ts';
import { TenantInterceptor } from '../src/shared/tenant/tenant.interceptor.ts';
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { PrismaMarketplaceRefundRepository } from "../src/modules/marketplace/infrastructure/repositories/prisma-marketplace-refund.repository.ts";
import { PrismaMarketplaceFundingRepository } from "../src/modules/marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.ts";
import { PrismaMarketplaceFinancialRepository } from "../src/modules/marketplace/infrastructure/repositories/prisma-marketplace-financial.repository.ts";
import { PrismaMarketplacePayoutRepository } from "../src/modules/marketplace/infrastructure/repositories/prisma-marketplace-payout.repository.ts";
import { PrismaMarketplaceTransferReversalRepository } from "../src/modules/marketplace/infrastructure/repositories/prisma-marketplace-transfer-reversal.repository.ts";
import { PrismaPaymentRepository } from "../src/modules/payment/infrastructure/prisma-payment.repository.ts";
import { PaymentIntentEntity } from "../src/modules/payment/domain/payment-intent.entity.ts";
import { cleanMarketplaceInventory } from "./marketplace-inventory-fixtures.mjs";
import { TenantContextService } from "../src/shared/tenant/tenant-context.service.ts";
import { registerTenantMiddleware } from "../src/shared/persistence/tenant.middleware.ts";
import { MarketplaceReturnWorkflowService } from "../src/modules/returns/application/marketplace-return-workflow.service.ts";
import { AcceptMarketplaceReturnUseCase } from "../src/modules/returns/application/use-cases/accept-marketplace-return.use-case.ts";
import { ProcessRefundUseCase } from "../src/modules/returns/application/use-cases/process-refund.use-case.ts";

const url = process.env.READY_PROD_TEST_DATABASE_URL, target = new URL(url);
if (!['localhost','127.0.0.1'].includes(target.hostname) || target.pathname !== '/ready_prod_test') throw Error('disposable_database_required');
const { PrismaClient } = createRequire(import.meta.url)(process.env.READY_PROD_TEST_PRISMA_CLIENT);
const context = new TenantContextService(), prisma = registerTenantMiddleware(new PrismaClient({ datasources: { db: { url } } }), context);
const refunds = new PrismaMarketplaceRefundRepository(prisma), funding = new PrismaMarketplaceFundingRepository(prisma), financial = new PrismaMarketplaceFinancialRepository(prisma);
const payouts = new PrismaMarketplacePayoutRepository(prisma), reversals = new PrismaMarketplaceTransferReversalRepository(prisma);
const prefix = `prepare_http_${randomUUID()}`, host = `${prefix}_host`, seller = `${prefix}_seller`, foreign = `${prefix}_foreign`, merchants = [host,seller,foreign];
const terms = { returnWindowDays:7, payoutDelayDays:14, chargebackWindowDays:30 };
const components = { commission:'refund',platformFees:'refund',hostPlatformFee:'refund',buyerServiceFeeCents:0,shipping:[] };
// Provider port is simulated. Nest, auth, tenant middleware, journals and ledger commits are real.
const calls = [], modes = new Map();
const provider = {
  async submit(request) { calls.push({method:'POST',reference:request.reference}); if (modes.get(request.providerPaymentId)==='timeout') throw Error('PRIVATE_PROVIDER_TOKEN');
    return {state:'pending',providerOperationId:`re_${request.reference}`,amountCents:request.amountCents,observedAt:new Date().toISOString()}; },
  async reconcile(request) { calls.push({method:'GET',reference:request.reference}); return {state:'confirmed',providerOperationId:`re_${request.reference}`,amountCents:request.amountCents,observedAt:new Date().toISOString()}; },
};
const executor = new ExecuteMarketplaceRefundUseCase(refunds,provider), dashboard = new MarketplaceRefundDashboardService(prisma,executor);
const workflow = new MarketplaceReturnWorkflowService(prisma,refunds);
const preparation = new MarketplaceRefundPreparationService(prisma,workflow);
const jwt = new JwtService('local-refund-http-not-production',3600,new PrismaAuthRepository(prisma)), credentials={};
let app,base;
before(async()=>{
  for(const id of merchants) await prisma.merchant.create({data:{id,name:'Synthetic refund merchant',billingSubscription:{create:{planKey:'scale',status:'active'}},paymentConnections:{create:{provider:'stripe',environment:'test',status:'active',chargesEnabled:true,payoutsEnabled:true,externalAccountId:`acct_${id}`}}}});
  for(const [name,merchantId,role] of [['owner',host,'owner'],['admin',host,'admin'],['staff',host,'staff'],['seller',seller,'owner'],['foreign',foreign,'owner'],['revoked',host,'owner']]) {
    const user=await prisma.merchantUser.create({data:{merchantId,role,email:`${name}_${prefix}@example.invalid`,teamMembers:{create:{merchantId,role:role.toUpperCase()}}}});
    credentials[name]=await jwt.issue({userId:user.id,merchantId,email:user.email,role},user.authVersion);
  }
  await jwt.revoke(credentials.revoked);
  const cookies=new AuthCookieService('aacp_access_token',false);
  class HttpModule {}
  Module({controllers:[MarketplaceRefundDashboardController,MarketplaceRefundPreparationController],providers:[{provide:MarketplaceRefundPreparationService,useValue:preparation},{provide:MarketplaceRefundDashboardService,useValue:dashboard},{provide:AuthGuard,useValue:new AuthGuard(jwt,cookies)},
    {provide:JwtService,useValue:jwt},{provide:AuthCookieService,useValue:cookies}]})(HttpModule);
  Reflect.defineMetadata('design:paramtypes',[JwtService,AuthCookieService],AuthGuard);
  app=await NestFactory.create(HttpModule,{logger:false,abortOnError:false});app.useGlobalInterceptors(new TenantInterceptor(context));await app.listen(0,'127.0.0.1');base=await app.getUrl();
});
after(async()=>{
  if(app) await app.close();
  await prisma.marketplaceTransferReversal.deleteMany({where:{hostMerchantId:{in:merchants}}});
  await prisma.marketplaceRefundOperation.deleteMany({where:{refundPlan:{hostMerchantId:{in:merchants}}}});
  await prisma.marketplaceRefundPlan.deleteMany({where:{hostMerchantId:{in:merchants}}});
  await cleanMarketplaceInventory(prisma,merchants);
  await prisma.return.deleteMany({where:{merchantId:{in:merchants}}});
  await prisma.marketplacePayout.deleteMany({where:{fundingPlan:{hostMerchantId:{in:merchants}}}});
  await prisma.stockReservation.deleteMany({where:{variant:{product:{merchantId:{in:merchants}}}}});
  await prisma.marketplaceFundingPlan.deleteMany({where:{hostMerchantId:{in:merchants}}});
  await prisma.marketplaceSettlement.deleteMany({where:{hostMerchantId:{in:merchants}}});
  await prisma.marketplaceOrderLedger.deleteMany({where:{hostMerchantId:{in:merchants}}});
  await prisma.crossStoreLineItem.deleteMany({where:{hostMerchantId:{in:merchants}}});
  await prisma.product.deleteMany({where:{merchantId:{in:merchants}}});
  await prisma.paymentIntent.deleteMany({where:{merchantId:{in:merchants}}});
  await prisma.checkoutSession.deleteMany({where:{merchantId:{in:merchants}}});
  await prisma.merchantAuthSession.deleteMany({where:{merchantId:{in:merchants}}});
  await prisma.merchantUser.deleteMany({where:{merchantId:{in:merchants}}});
  await prisma.merchant.deleteMany({where:{id:{in:merchants}}});await prisma.$disconnect();
});
async function refundHttp(role='owner',suffix='',body) {
 const response=await fetch(`${base}/marketplace/dashboard/refunds${suffix}`,{method:body?'POST':'GET',headers:{...(role?{authorization:`Bearer ${credentials[role]}`} :{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};
}
const confirmation=p=>({confirmed:true,expected_amount_cents:p.amountCents});
async function prepared(options){ const f=await fixture(options), returned=await f.returned(),plan=await f.prepare(returned);return {...f,returned,plan}; }
async function fixture({ provider = "stripe", fee = 99, merchantId = host, freight = false } = {}) {
  const host = merchantId;
  const sessionId = randomUUID(), providerPaymentId = `${provider === "stripe" ? "pi" : "pay"}_${randomUUID()}`;
  const lines = [];
  for (let index = 0; index < 2; index++) {
    const id = randomUUID(), product = await prisma.product.create({ data: { merchantId: seller, name: "Seller digital", type: "digital",
      variants: { create: { sku: id } } }, include: { variants: true } });
    lines.push(await prisma.crossStoreLineItem.create({ data: { id, sourceVariantId: product.variants[0].id,
      hostMerchantId: host, sellerMerchantId: seller, checkoutSessionId: sessionId, federatedProductId: randomUUID(),
      quantity: 3, unitPriceCents: 1000, commissionRateBps: 1670, commissionCents: 501, sellerNetCents: 2499, termsJson: terms } }));
  }
  const own = await prisma.product.create({ data: { merchantId: host, name: "Host digital", type: "digital",
    variants: { create: { sku: `own_${sessionId}` } } }, include: { variants: true } });
  const hostStockItems = [{ lineItemId: `host:${own.variants[0].sku}`, variantId: own.variants[0].id, sku: own.variants[0].sku, quantity: 3, requiresStock: false }];
  const cart = { currency: "BRL", total: 90, currentDiscount: 0, items: [
    { sku: own.variants[0].sku, variantId: own.variants[0].id, price: 10, quantity: 3 },
    ...lines.map(row => ({ sku: row.id, variantId: row.sourceVariantId, price: 10, quantity: 3,
      marketplace: { lineItemId: row.id, sourceMerchantId: seller, commissionCents: 501 } })),
  ] };
  await prisma.checkoutSession.create({ data: { merchantId: host, sessionId, globalUserId: prefix, conversationId: sessionId,
    cart, shipping: { customerPrice: 0 }, createdAt: new Date(), updatedAt: new Date() } });
  const instructions = { hostMerchantId: host, feePolicy: "proportional_seller_sales_v1", hostTerms: terms, hostStockItems,
    provider, environment: "test", accountFingerprint: "refund-test-account", currency: "BRL", amountCents: freight ? 9399 : 9099,
    buyerServiceFeeCents: 99, hostPlatformFeeCents: 33,
    lines: [{ lineItemId: hostStockItems[0].lineItemId, sellerMerchantId: host, grossAmountCents: 3000, commissionCents: 0, platformFeeCents: 0 },
      ...lines.map(row => ({ lineItemId: row.id, sellerMerchantId: seller, grossAmountCents: 3000, commissionCents: 501, platformFeeCents: 50 }))],
    shipping: freight ? [{merchantId:host,amountCents:100},{merchantId:seller,amountCents:200}] : [], destinations: [host, seller].map(merchantId => ({ merchantId, destination: `${provider === "stripe" ? "acct" : "wallet"}_${merchantId}` })) };
  const intent = PaymentIntentEntity.create({ merchantId: host, sessionId, idempotencyKey: sessionId, amountCents: freight ? 9399 : 9099, currency: "BRL", method: "pix" });
  intent.prepareCreation({ merchantId: host, sessionId, intentId: intent.id, provider, providerAccountFingerprint: instructions.accountFingerprint,
    method: "pix", currency: "BRL", amountCents: freight ? 9399 : 9099, marketplaceFunding: instructions });
  if (freight) {
    // Existing captured-contract fixture with frozen per-origin freight. Full checkout admission is tested by the shipping suite.
    await prisma.paymentIntent.create({data:{id:intent.id,merchantId:host,sessionId,idempotencyKey:sessionId,amountCents:9399,currency:'BRL',method:'pix',status:'pending',creation:intent.snapshot().creation}});
    await prisma.marketplaceFundingPlan.create({data:{paymentIntentId:intent.id,hostMerchantId:host,checkoutSessionId:sessionId,provider,environment:'test',accountFingerprint:instructions.accountFingerprint,amountCents:9399,instructions,instructionsHash:fundingHash(instructions)}});
  } else await new PrismaPaymentRepository(prisma).saveIntentWithSettlementPlan({ intent, settlementPlan: null });
  await prisma.paymentIntent.update({ where: { id: intent.id }, data: { providerPaymentId, status: "approved", approvedAmountCents: freight ? 9399 : 9099 } });
  await financial.placeOrder({ hostMerchantId: host, orderId: providerPaymentId, checkoutSessionId: sessionId, purchasedAt: new Date("2026-08-01") });
  await prisma.marketplaceSettlement.updateMany({ where: { hostMerchantId: host, orderId: providerPaymentId }, data: { status: "transfer_scheduled" } });
  await funding.fund(intent.id, { provider, environment: "test", accountFingerprint: instructions.accountFingerprint,
    currency: "BRL", providerPaymentId, sourceId: `ch_${sessionId}`, amountCents: freight ? 9399 : 9099, providerFeeCents: fee, netAmountCents: (freight ? 9399 : 9099) - fee });
  const returned = async (items = [{ variantId: lines[0].sourceVariantId, quantity: 1 }], merchantId = host) => prisma.return.create({ data: {
    merchantId, orderId: providerPaymentId, buyerId: prefix, reason: "CHANGED_MIND", imageUrls: [], status: "INSPECTED_PASS", items: { create: items } } });
  const prepare = async (r, selected = components) => refunds.prepare({ hostMerchantId: host, paymentIntentId: intent.id, returnId: r.id, components: selected });
  return { intent, lines, own, instructions, providerPaymentId, returned, prepare };
}


async function http(role='owner',suffix='',body) {
 const response=await fetch(`${base}/marketplace/dashboard/refund-candidates${suffix}`,{method:body?'POST':'GET',headers:{...(role?{authorization:`Bearer ${credentials[role]}`} :{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};
}
async function candidate(options,items) {const f=await fixture(options),ret=await f.returned(items?items(f):undefined),r=await http('owner',`/${ret.id}`);assert.equal(r.status,200,JSON.stringify(r));return {...f,ret,candidate:r.body.candidate};}
const bodyFor=c=>({confirmed:true,expected_preparation_hash:c.expected_preparation_hash,components:{...components,buyerServiceFeeCents:c.buyer_service_fee_refund_cents,shipping:c.shipping.map(row=>({merchantId:row.merchant_id,amountCents:row.refund_cents}))}});

test('approved candidate pages filter ordinary and uninspected returns, with scoped cursors and no sensitive payloads',async()=>{
 const f=await candidate();await prisma.return.create({data:{merchantId:host,orderId:'ordinary_missing',buyerId:'PRIVATE_BUYER',reason:'OTHER',status:'INSPECTED_PASS',imageUrls:[]}});
 const unapproved=await f.returned();await prisma.return.update({where:{id:unapproved.id},data:{status:'RECEIVED'}});
 let cursor,found=[];do{const r=await http('owner',`?limit=1${cursor?`&cursor=${cursor}`:''}`);assert.equal(r.status,200);assert.equal(r.cache,'no-store');found.push(...r.body.candidates);cursor=r.body.next_cursor;}while(cursor);
 assert.deepEqual(found.map(row=>row.return_id),[f.ret.id]);assert.equal(found[0].products_amount_cents,1000);assert.equal(found[0].shipping[0].available_cents,0);
 assert.equal(/buyerId|PRIVATE|accountFingerprint|sourceId|requestHash/.test(JSON.stringify(found)),false);assert.equal((await http('owner',`/${unapproved.id}`)).status,409);assert.equal(calls.length,0);
});
test('owner/admin prepare concurrently after downgrade without PSP or legacy markers and timeout lookup returns same plan',async()=>{
 const f=await candidate();await prisma.merchantBillingSubscription.update({where:{merchantId:host},data:{planKey:'starter',status:'canceled'}});
 const before=calls.length,results=await Promise.all(Array.from({length:5},()=>http('admin',`/${f.ret.id}/prepare`,bodyFor(f.candidate))));
 assert.ok(results.every(r=>r.status===201),JSON.stringify(results));assert.equal(new Set(results.map(r=>r.body.prepared_refund.refund_id)).size,1);assert.equal(calls.length,before);
 const result=await http('owner',`/${f.ret.id}`);assert.equal(result.body.candidate,null);assert.equal(result.body.prepared_refund.status,'prepared');
 assert.equal((await prisma.return.findUniqueOrThrow({where:{id:f.ret.id}})).status,'INSPECTED_PASS');assert.equal(await prisma.returnRefund.count({where:{returnId:f.ret.id}}),0);
 const detail=await refundHttp('owner',`/${result.body.prepared_refund.refund_id}`);assert.equal(detail.body.amount_cents,1000);assert.equal(detail.body.can_execute,true);
});
test('tenant protection rejects foreign IDs, revoked/sessionless users and staff before mutations',async()=>{
 const f=await candidate(),payload=bodyFor(f.candidate),n=calls.length;
 for(const [role,status]of[[null,401],['staff',403],['revoked',401]]) {assert.equal((await http(role)).status,status);assert.equal((await http(role,`/${f.ret.id}/prepare`,payload)).status,status);}
 for(const role of ['seller','foreign']) {assert.equal((await http(role,`/${f.ret.id}`)).status,404);assert.equal((await http(role,`?cursor=${f.ret.id}`)).status,404);assert.equal((await http(role,`/${f.ret.id}/prepare`,payload)).status,404);}
 await context.run({merchantId:seller,userId:'fixture',role:'owner'},async()=>{assert.deepEqual(await preparation.list(host,20),{candidates:[],next_cursor:null});await assert.rejects(preparation.detail(host,f.ret.id),/not_found/);await assert.rejects(preparation.prepare(host,f.ret.id,payload.expected_preparation_hash,payload.components),/not_found/);});
 assert.equal(calls.length,n);assert.equal(await prisma.marketplaceRefundPlan.count({where:{returnId:f.ret.id}}),0);
});
test('changed item identity with identical price is stale and creates neither allocation nor financial hold',async()=>{
 const f=await candidate();await prisma.returnItem.updateMany({where:{returnId:f.ret.id},data:{variantId:f.lines[1].sourceVariantId}});
 const r=await http('owner',`/${f.ret.id}/prepare`,bodyFor(f.candidate));assert.equal(r.status,409);assert.equal(await prisma.marketplaceRefundPlan.count({where:{returnId:f.ret.id}}),0);
 const updated=await http('owner',`/${f.ret.id}`);assert.notEqual(updated.body.candidate.expected_preparation_hash,f.candidate.expected_preparation_hash);
 assert.equal((await http('owner',`/${f.ret.id}/prepare`,bodyFor(updated.body.candidate))).status,201);
 // Real repository race: the service read succeeds, then identities change before the core takes its order lock.
 const race=await candidate(),originalPrepare=workflow.prepare;
 workflow.prepare=async function(...args){
   await prisma.returnItem.updateMany({where:{returnId:race.ret.id},data:{variantId:race.lines[1].sourceVariantId}});
   return originalPrepare.apply(this,args);
 };
 try {
   const raced=await http('owner',`/${race.ret.id}/prepare`,bodyFor(race.candidate));assert.equal(raced.status,409,JSON.stringify(raced));
   assert.equal(raced.body.message,'marketplace_return_preparation_changed_or_unavailable');
   assert.equal(await prisma.marketplaceRefundPlan.count({where:{returnId:race.ret.id}}),0);
 } finally {workflow.prepare=originalPrepare;}
});
test('original per-origin freight is automatically proportional and included in the prepared amount',async()=>{
 const f=await candidate({freight:true},f=>[{variantId:f.own.variants[0].id,quantity:1},{variantId:f.lines[0].sourceVariantId,quantity:1}]);
 assert.equal(f.candidate.products_amount_cents,2000);assert.deepEqual(f.candidate.shipping.map(r=>r.available_cents).sort((a,b)=>a-b),[100,200]);
 assert.deepEqual(f.candidate.shipping.map(r=>r.refund_cents),[33,33]); assert.equal(f.candidate.buyer_service_fee_refund_cents,0);
 const payload=bodyFor(f.candidate);
 const before=calls.length,r=await http('owner',`/${f.ret.id}/prepare`,payload);assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.body.prepared_refund.amount_cents,2066);assert.equal(calls.length,before);
});
test('full refund records an explicit contribution block without sending money',async()=>{
 const f=await candidate({},f=>[{variantId:f.own.variants[0].id,quantity:3},...f.lines.map(l=>({variantId:l.sourceVariantId,quantity:3}))]);
 const payload=bodyFor(f.candidate);payload.components.buyerServiceFeeCents=99;const before=calls.length,r=await http('owner',`/${f.ret.id}/prepare`,payload);
 assert.equal(r.status,201);assert.equal(r.body.prepared_refund.status,'blocked');assert.equal(r.body.prepared_refund.amount_cents,9099);assert.equal(calls.length,before);
});
test('pending history disables preparation; confirmed history preserves policy and subtracts buyer/freight components',async()=>{
 const f=await candidate({freight:true}),payload=bodyFor(f.candidate);
 const r=await http('owner',`/${f.ret.id}/prepare`,payload),ret2=await f.returned();assert.equal((await http('owner',`/${ret2.id}`)).body.candidate.can_prepare,false);
 await executor.execute(host,r.body.prepared_refund.refund_id);await executor.recover(100);
 const next=await http('owner',`/${ret2.id}`);assert.equal(next.body.candidate.can_prepare,true);assert.equal(next.body.candidate.buyer_service_fee_available_cents,99);assert.equal(next.body.candidate.shipping[0].available_cents,167);
 assert.equal(next.body.candidate.shipping[0].refund_cents,33);
 assert.deepEqual(next.body.candidate.required_policy,{commission:'refund',platformFees:'refund',hostPlatformFee:'refund'});
});
test('missing policy, omitted origin, fractional values and caller-supplied host/amount are rejected without writes',async()=>{
 const f=await candidate(),good=bodyFor(f.candidate);
 const invalid=[{...good,confirmed:false},{...good,hostMerchantId:host},{...good,components:{...good.components,commission:undefined}},{...good,components:{...good.components,shipping:[]}},{...good,components:{...good.components,buyerServiceFeeCents:0.5}},{...good,components:{...good.components,shipping:[{merchantId:foreign,amountCents:0}]}},{...good,components:{...good.components,buyerServiceFeeCents:100}}];
 for(const payload of invalid)assert.equal((await http('owner',`/${f.ret.id}/prepare`,payload)).status,400);
 for(const suffix of ['?limit=0','?limit=51',`?merchantId=${host}`])assert.equal((await http('owner',suffix)).status,400);
 assert.equal(await prisma.marketplaceRefundPlan.count({where:{returnId:f.ret.id}}),0);
});

async function completedAlias(f,kind,merchantId=host) {
 const payment=await prisma.paymentIntent.findUniqueOrThrow({where:{id:f.intent.id}});
 const commerceOrderId=payment.commerceOrderId??`commerce_${randomUUID()}`;
 if(!payment.commerceOrderId)await prisma.paymentIntent.update({where:{id:f.intent.id},data:{commerceOrderId}});
 if(kind==='commerce')return commerceOrderId;
 const externalOrderId=kind==='completed_provider'?f.providerPaymentId:kind==='session_only'?`legacy_${randomUUID()}`:commerceOrderId;
 const sessionId=merchantId===host?payment.sessionId:randomUUID();
 if(merchantId!==host)await prisma.checkoutSession.create({data:{merchantId,sessionId,globalUserId:prefix,conversationId:sessionId,cart:{},shipping:{},createdAt:new Date(),updatedAt:new Date()}});
 const completed=await prisma.completedOrder.create({data:{merchantId,sessionId,externalOrderId,
   orderTotal:90.99,currency:'BRL',status:'approved',completedAt:new Date()}});
 return completed.id;
}

test('commerce and CompletedOrder aliases advance through preparation, reversal, buyer refund and immutable replay',async()=>{
 for(const kind of ['commerce','completed_provider','completed_commerce']) {
   const f=await fixture(),orderId=await completedAlias(f,kind);
   await prisma.marketplaceSettlement.updateMany({where:{hostMerchantId:host,orderId:f.providerPaymentId},data:{transferScheduledAt:new Date('2026-08-02')}});
   const originalPayouts=await prisma.marketplacePayout.findMany({where:{fundingPlanId:f.intent.id}});
   const openReturn=await f.returned();await prisma.return.update({where:{id:openReturn.id},data:{orderId}});
   for(const payout of originalPayouts)assert.equal(await payouts.claim(payout.id,new Date()),undefined,`${kind}: open return must hold the payout before preparation`);
   assert.equal(await prisma.marketplacePayout.count({where:{fundingPlanId:f.intent.id,status:'planned',claimedAt:null}}),originalPayouts.length);
   await prisma.return.update({where:{id:openReturn.id},data:{status:'CANCELLED'}});
   for(const payout of originalPayouts) {
     const claim=await payouts.claim(payout.id,new Date());assert.equal(claim.submit,true);
     await payouts.record(claim.operation,{state:'confirmed',providerTransferId:`tr_${randomUUID().replaceAll('-','')}`});
   }
   const ret=await f.returned();await prisma.return.update({where:{id:ret.id},data:{orderId}});
   const candidate=await http('owner',`/${ret.id}`);assert.equal(candidate.status,200,kind);assert.equal(candidate.body.candidate.can_prepare,true);
   const payload=bodyFor(candidate.body.candidate),before=calls.length;
   const prepared=await http('owner',`/${ret.id}/prepare`,payload);assert.equal(prepared.status,201,JSON.stringify(prepared));
   assert.equal(prepared.body.prepared_refund.status,'blocked');assert.equal(calls.length,before);
   const refundId=prepared.body.prepared_refund.refund_id,rows=await reversals.prepare(host,refundId);assert.ok(rows.length>0);
   await context.run({merchantId:seller,userId:'seller',role:'owner'},async()=>{
     await assert.rejects(reversals.prepare(host,refundId),/order_missing/);
   });
   for(const row of rows) {
     const claim=await reversals.claim(host,row.id,new Date());assert.equal(claim.submit,true);
     await reversals.record(claim.operation,{state:'confirmed',providerOperationId:`trr_${randomUUID().replaceAll('-','')}`,amountCents:row.amountCents,observedAt:new Date().toISOString()});
   }
   assert.equal(await reversals.releaseRefund(host,refundId),true);
   const sent=await refundHttp('owner',`/${refundId}/execute`,{confirmed:true,expected_amount_cents:1000});assert.equal(sent.status,202);
   await executor.recover(100);
   assert.equal((await refundHttp('owner',`/${refundId}`)).body.status,'confirmed');
   const replay=await http('owner',`/${ret.id}/prepare`,payload);assert.equal(replay.status,201);assert.equal(replay.body.prepared_refund.refund_id,refundId);
   assert.deepEqual((await reversals.prepare(host,refundId)).map(row=>row.id),rows.map(row=>row.id));
   assert.equal(await reversals.releaseRefund(host,refundId),true);
   assert.equal(calls.slice(before).filter(row=>row.method==='POST').length,1,'Only the explicit buyer execution submits to the simulated provider');
 }
});

test('alias resolution refuses foreign, ambiguous and session-only candidates and detects legacy refund fences through commerce aliases',async()=>{
 const f=await fixture(),ret=await f.returned(),foreignOrder=await completedAlias(f,'completed_commerce',foreign);
 await prisma.return.update({where:{id:ret.id},data:{orderId:foreignOrder}});
 assert.equal((await http('owner',`/${ret.id}`)).status,404);
 await assert.rejects(refunds.prepare({hostMerchantId:host,paymentIntentId:f.intent.id,returnId:ret.id,components}),/return_not_approved/);
 const sessionOnly=await completedAlias(f,'session_only');await prisma.return.update({where:{id:ret.id},data:{orderId:sessionOnly}});
 assert.equal((await http('owner',`/${ret.id}`)).status,404);
 const other=await fixture();await prisma.paymentIntent.update({where:{id:f.intent.id},data:{commerceOrderId:other.providerPaymentId}});
 await prisma.return.update({where:{id:ret.id},data:{orderId:other.providerPaymentId}});
 assert.equal((await http('owner',`/${ret.id}`)).status,409);
 await assert.rejects(workflow.prepare(host,ret.id,components),/identity_unreconciled/);
 assert.equal(await prisma.marketplaceRefundPlan.count({where:{returnId:ret.id}}),0);
 const g=await fixture(),alias=await completedAlias(g,'completed_commerce'),approved=await g.returned(),legacy=await g.returned();
 await prisma.return.updateMany({where:{id:{in:[approved.id,legacy.id]}},data:{orderId:alias}});
 await prisma.returnRefund.create({data:{returnId:legacy.id,amountInCents:1,status:'PENDING'}});
 const candidate=await http('owner',`/${approved.id}`);assert.equal(candidate.status,200);
 const result=await http('owner',`/${approved.id}/prepare`,bodyFor(candidate.body.candidate));assert.equal(result.status,409);
 assert.equal(await prisma.marketplaceRefundPlan.count({where:{fundingPlanId:g.intent.id}}),0);
});
