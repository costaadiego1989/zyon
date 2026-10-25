import "reflect-metadata";
import { before, after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { PrismaPlanNoticeRepository } from "../infrastructure/repositories/prisma-plan-notice.repository.js";
import { PlanNoticeJob } from "../application/services/plan-notice.job.js";
import { reconcileStockAlert } from "../../inventory/infrastructure/repositories/reconcile-stock-alert.js";
import { StockAlertMonitorJob } from "../../inventory/infrastructure/jobs/stock-alert-monitor.job.js";
import { PrismaInventoryAlertRepository } from "../../inventory/infrastructure/repositories/prisma-inventory-alert.repository.js";
import { PrismaHypothesisRepository } from "../../revenue-manager/infrastructure/prisma-hypothesis.repository.js";
import { HypothesisEntity } from "../../revenue-manager/domain/entities/hypothesis.entity.js";
import { PrismaExperimentRepository } from "../../experiments/infrastructure/repositories/prisma-experiment.repository.js";
import { PromptExperimentEntity } from "../../experiments/domain/entities/prompt-experiment.entity.js";

const clientPath=process.env.READY_PROD_TEST_PRISMA_CLIENT, databaseUrl=process.env.READY_PROD_TEST_DATABASE_URL;
describe("merchant alerts on disposable PostgreSQL",{skip:!clientPath||!databaseUrl},()=>{
  let db:any,other:any;const merchants:string[]=[];
  before(()=>{
    const url=new URL(databaseUrl!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"5548");assert.equal(url.pathname,"/merchant_alerts");
    const {PrismaClient}=createRequire(import.meta.url)(clientPath!);
    const config={datasources:{db:{url:databaseUrl}},transactionOptions:{maxWait:30000,timeout:15000}};
    db=new PrismaClient(config);other=new PrismaClient(config);
  });
  afterEach(async()=>{
    await db.promptExperiment.deleteMany({where:{merchantId:{in:merchants}}});
    await db.merchantPlanNotice.deleteMany({where:{merchantId:{in:merchants}}});
    await db.merchantNotification.deleteMany({where:{merchantId:{in:merchants}}});
    await db.revenueManagerObservation.deleteMany({where:{merchantId:{in:merchants}}});
    await db.merchant.deleteMany({where:{id:{in:merchants}}});
    merchants.length=0;
  });
  after(async()=>{await db?.$disconnect();await other?.$disconnect();});
  async function merchant() {const id="alerts_"+randomUUID();merchants.push(id);await db.merchant.create({data:{id,name:"Loja de teste"}});return id;}
  async function item(quantity=4,threshold:number|null=5) {
    const merchantId=await merchant();const location=await db.inventoryLocation.create({data:{merchantId,name:"Principal",isDefault:true}});
    return db.inventoryItem.create({data:{merchantId,locationId:location.id,sku:"SKU",productName:"Produto",quantity,lowStockThreshold:threshold}});
  }
  async function billing() { const merchantId=await merchant(); const end=new Date("2026-10-10T12:00:00Z");
    await db.merchantBillingSubscription.create({data:{merchantId,status:"active",planKey:"growth",provider:"asaas",asaasSubscriptionId:"sub_"+merchantId,currentPeriodEnd:end}});
    return {merchantId,end,repo:new PrismaPlanNoticeRepository(db)}; }
  it("concurrent stock monitoring creates one alert and one inbox notice",async()=>{
    const row=await item();
    await Promise.all(Array.from({length:12},(_,i)=>(i%2?db:other).$transaction((tx:any)=>reconcileStockAlert(tx,row.merchantId,row.id))));
    assert.equal(await db.inventoryAlert.count({where:{itemId:row.id,resolvedAt:null}}),1);
    assert.equal(await db.merchantNotification.count({where:{merchantId:row.merchantId}}),1);
  });
  it("acknowledgement suppresses repeats, depletion escalates, replenishment closes and later depletion reopens",async()=>{
    const row=await item();const sync=()=>db.$transaction((tx:any)=>reconcileStockAlert(tx,row.merchantId,row.id));
    const alert=await sync();const repo=new PrismaInventoryAlertRepository(db);
    await repo.acknowledge(row.merchantId,alert.id);await sync();
    assert.equal(await db.merchantNotification.count({where:{merchantId:row.merchantId,read:false}}),0);
    await db.inventoryItem.update({where:{id:row.id},data:{quantity:0}});await sync();
    assert.equal((await db.inventoryAlert.findUnique({where:{id:alert.id}})).severity,"critical");
    assert.equal(await db.merchantNotification.count({where:{merchantId:row.merchantId,read:false}}),1);
    await db.inventoryItem.update({where:{id:row.id},data:{quantity:20}});await sync();
    assert.equal(await db.inventoryAlert.count({where:{itemId:row.id,resolvedAt:null}}),0);
    await db.inventoryItem.update({where:{id:row.id},data:{quantity:0,lowStockThreshold:null}});const reopened=await sync();
    assert.notEqual(reopened.id,alert.id);assert.equal(reopened.severity,"critical");
  });
  it("monitor catches stock changed by ERP and applies reserved quantity",async()=>{
    const row=await item(20,null);
    await db.inventoryItem.update({where:{id:row.id},data:{quantity:3,reserved:3}});
    const result=await new StockAlertMonitorJob(db).run();assert.ok(result!.checked>0);
    const alert=await db.inventoryAlert.findFirst({where:{itemId:row.id}});
    assert.equal(alert.severity,"critical");
    await new PrismaInventoryAlertRepository(db).acknowledge("other_merchant",alert.id);
    assert.equal((await db.inventoryAlert.findUnique({where:{id:alert.id}})).acknowledged,false);
  });
  it("alert and inbox changes roll back together when the stock transaction fails",async()=>{
    const row=await item();
    await assert.rejects(db.$transaction(async(tx:any)=>{await reconcileStockAlert(tx,row.merchantId,row.id);throw Error("abort");}),/abort/);
    assert.equal(await db.inventoryAlert.count({where:{itemId:row.id}}),0);
    assert.equal(await db.merchantNotification.count({where:{merchantId:row.merchantId}}),0);
  });
  it("four deadlines queue once each across replicas with independent email and WhatsApp deliveries",async()=>{
    const f=await billing();
    for(const days of [7,3,1,0]) {
      const now=new Date(f.end.getTime()-days*86400000);
      await Promise.all([f.repo.scan(now),new PrismaPlanNoticeRepository(other).scan(now)]);
    }
    const notices=await db.merchantPlanNotice.findMany({where:{merchantId:f.merchantId},include:{deliveries:true}});
    assert.equal(notices.length,4);assert.ok(notices.every((n:any)=>n.deliveries.length===2));
    assert.equal(await db.merchantNotification.count({where:{merchantId:f.merchantId}}),4);
  });
  it("after downtime only the current reminder is queued, and a renewal invalidates it",async()=>{
    const f=await billing(),now=new Date(f.end.getTime()-2*86400000);
    await f.repo.scan(now);const notice=await db.merchantPlanNotice.findFirst({where:{merchantId:f.merchantId}});
    assert.equal(notice.milestone,"3d");
    await db.merchantBillingSubscription.update({where:{merchantId:f.merchantId},data:{currentPeriodEnd:new Date(f.end.getTime()+30*86400000)}});
    let sends=0;const sender={prepare:async()=>{sends++;return {send:async()=>({status:"accepted"})};}};
    await new PlanNoticeJob(f.repo,sender as never).run(()=>now);
    assert.equal(sends,0);
    const deliveries=await db.merchantPlanNoticeDelivery.findMany({where:{noticeId:notice.id}});
    assert.ok(deliveries.every((d:any)=>d.status==="skipped"));
  });
  it("delivery leases exclude a second worker and uncertain sends never re-enter the queue",async()=>{
    const f=await billing(),now=new Date(f.end.getTime()-86400000);await f.repo.scan(now);
    const otherRepo=new PrismaPlanNoticeRepository(other);
    const claims=await Promise.all([f.repo.claim(now),otherRepo.claim(now),f.repo.claim(now)]);
    const owned=claims.filter(Boolean);assert.equal(owned.length,2);assert.notEqual(owned[0]!.id,owned[1]!.id);
    for(const claim of owned)assert.equal(await f.repo.begin(claim!,now),true);
    assert.equal(await f.repo.expireSending(new Date(now.getTime()+91000)),2);
    assert.equal(await f.repo.claim(new Date(now.getTime()+92000)),null);
  });
  async function hypothesis(type:"prompt"|"discount_rule"="prompt") {
    const merchantId=await merchant();
    const obs=await db.revenueManagerObservation.create({data:{merchantId,observationWindowStart:new Date(),observationWindowEnd:new Date(),
      funnelJson:{},abandonmentJson:{},objectionsJson:{},crossSellJson:{},cohortsJson:{},revenueJson:{},dataQualityJson:{},aiCostsCents:0,fingerprint:randomUUID()}});
    const rule={id:"rule_test",name:"Teste",enabled:false,priority:1,conditions:[{field:"cart_total",operator:"gte",value:200}],
      action:{type:"offer_discount",params:{percent:10,maxDiscountReais:30}}};
    const h=HypothesisEntity.create({merchant_id:merchantId,observation_id:obs.id,hypothesis_text:"Estratégia de teste",reasoning:"Observação real",expected_lift_percent:5,risk_level:"low",
      approval_strategy:"manual",hypothesis_type:type,...(type==="discount_rule"?{discount_rule_json:rule as never}:{}),
      template:{name:"Teste",description:"Comparar",variant_a:{name:"A",weight:50,is_control:true,system_prompt:"Atual"},
        variant_b:{name:"B",weight:50,is_control:false,system_prompt:"Proposta"}}});
    return {h,merchantId,repo:new PrismaHypothesisRepository(db)};
  }
  it("prompt and discount suggestions atomically notify once, including repeated saves",async()=>{
    for(const type of ["prompt","discount_rule"] as const) {
      const f=await hypothesis(type);await Promise.all([f.repo.save(f.h),new PrismaHypothesisRepository(other).save(f.h)]);
      assert.equal(await db.merchantNotification.count({where:{merchantId:f.merchantId,type:"ai_strategy_suggestion"}}),1);
      assert.equal(await f.repo.findById(f.h.id,"other_merchant"),null);
    }
  });
  it("approve and decline race has one winner and resolves the notification",async()=>{
    const f=await hypothesis();await f.repo.save(f.h);
    const results=await Promise.allSettled([f.repo.save(f.h.approve("owner")),new PrismaHypothesisRepository(other).save(f.h.reject("Não aplicar"))]);
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(await db.merchantNotification.count({where:{merchantId:f.merchantId,read:false}}),0);
    await f.repo.save(f.h);
    assert.notEqual((await f.repo.findById(f.h.id,f.merchantId))!.status,"pending_review");
  });
  it("A/B lifecycle persists tenant-scoped variants, results, and winner without losing results",async()=>{
    const merchantId=await merchant();const repo=new PrismaExperimentRepository(db);
    const draft=PromptExperimentEntity.create({merchant_id:merchantId,name:"Persistência A/B",description:"Teste real",
      variants:[{name:"Controle",system_prompt:"Baseline",weight:50,is_control:true},{name:"Tratamento",system_prompt:"Challenger",weight:50,is_control:false}]});
    await repo.save(draft);const running=draft.start();await repo.save(running);
    const loaded=await repo.findRunning(merchantId);assert.ok(loaded);assert.equal(loaded.variants.length,2);
    assert.equal(await repo.findById(draft.id,"other_merchant"),null);
    const treatment=loaded.variants.find(v=>!v.is_control)!;
    await db.promptVariantResult.create({data:{variantId:treatment.id,sessionId:"audit_"+randomUUID(),converted:true,revenue:125}});
    const completed=loaded.complete().setWinner(treatment.id);await repo.save(completed);
    assert.equal(await db.promptVariantResult.count({where:{variantId:treatment.id}}),1);
    const stored=await repo.findById(draft.id,merchantId);
    assert.equal(stored?.status,"completed");assert.equal(stored?.winner_variant_id,treatment.id);
  });
});
