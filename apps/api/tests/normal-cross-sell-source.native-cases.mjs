import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";

/** Reuses the actual owned native schema/Prisma client. No nested lifecycle,
 * provider, env, migration, inferred cart ID or simulated financial delegate. */
export async function createNormalCrossSellSourceNativeFixture({prisma,runId,namespace="adapter"}){
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runId}]);
  assert.ok(["adapter","payment","identity","detachment","couponafter","benefits"].includes(namespace));
  assert.deepEqual(await prisma.$queryRaw`SELECT to_regclass('public.storefront_carts')::text AS source,
    to_regclass('public.coupons')::text AS coupon`,[{source:"storefront_carts",coupon:"coupons"}]);
  const {PrismaNormalCheckoutCrossSellAdapter}=await import("../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.adapter.ts");
  const merchantId=`synthetic-normal-${namespace}`,prefix=`normal-${namespace}`,adapter=new PrismaNormalCheckoutCrossSellAdapter(prisma);
  const ids={trigger:`${prefix}-trigger`,a:`${prefix}-a`,b:`${prefix}-b`,promotion:`${prefix}-promo`};
  const sku={trigger:"NORMAL_TRIGGER",a:"NORMAL_A",b:"NORMAL_B"};
  await prisma.$executeRaw`INSERT INTO merchants(id,name,updated_at) VALUES (${merchantId},'Synthetic normal source',CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO merchant_rules(id,merchant_id,max_discount_percent,minimum_margin_percent,allow_free_shipping,allow_shipping_discount,
    allow_bonus_item,allow_stack_discount_and_free_shipping,coupon_box_enabled,autonomous_engine_enabled,free_shipping_min_cart_value,max_shipping_subsidy,
    max_partial_shipping_discount,offer_expiration_minutes,blocked_regions,brand_voice,updated_at)
    VALUES (${prefix},${merchantId},20,99,false,false,false,false,true,true,0,0,0,30,ARRAY[]::text[],'consultative',CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO checkout_settings(id,merchant_id,advanced_rules) VALUES (${prefix},${merchantId},'[]'::jsonb)`;
  for(const [key,price,metadata]of [["trigger",2000,{}],["a",900,{optionGroups:[{id:"size",name:"Size",required:true,selectionType:"single",items:[{id:"large",name:"Large",priceModifierInCents:100}]}]}],
    ["b",1700,{optionGroups:[{id:"color",name:"Color",required:true,selectionType:"single",items:[{id:"blue",name:"Blue",priceModifierInCents:300}]}]}]]){
    const variantId=ids[key],productId=`${variantId}-product`;
    await prisma.$executeRaw`INSERT INTO products(id,merchant_id,name,type,metadata,updated_at) VALUES (${productId},${merchantId},${sku[key]},'physical',${JSON.stringify(metadata)}::jsonb,CURRENT_TIMESTAMP)`;
    await prisma.$executeRaw`INSERT INTO product_variants(id,product_id,sku,updated_at) VALUES (${variantId},${productId},${sku[key]},CURRENT_TIMESTAMP)`;
    await prisma.$executeRaw`INSERT INTO product_prices(id,variant_id,base_price_in_cents) VALUES (${variantId},${variantId},${price})`;
    await prisma.$executeRaw`INSERT INTO product_stock(id,variant_id,quantity,reserved) VALUES (${variantId},${variantId},100,0)`;
  }
  await prisma.$executeRaw`INSERT INTO cross_sell_promotions(id,merchant_id,name,trigger,recommended_skus,discount_percent,max_discount_percent,status,starts_at,updated_at)
    VALUES (${ids.promotion},${merchantId},'Synthetic normal source',${JSON.stringify({sku_in_cart:[sku.trigger]})}::jsonb,
      ${[sku.a,sku.b]}::text[],10,100,'active',CURRENT_TIMESTAMP-INTERVAL '1 day',CURRENT_TIMESTAMP)`;
  const customer={fullName:"Synthetic Buyer",email:"normal-buyer@example.test",cpf:"12345678901",phone:"11987654321",email_verified:true,address_verified:true,
    address:{zip:"01310100",street:"Synthetic Street",number:"10",complement:"",neighborhood:"Synthetic District",city:"Synthetic City",state:"SP"}};
  const seen=new Set();
  async function seed(label,{coupon=false}={}){
    assert.match(label,/^[a-z0-9-]{1,50}$/);assert.equal(seen.has(label),false);seen.add(label);
    const sessionId=`${prefix}-${label}`,cartId=`${sessionId}-source`,suggestionId=`${sessionId}-suggestion`,scope={merchantId,sessionId};
    const buyerId=`${sessionId}-buyer`,stamp=new Date();
    await prisma.merchantRule.update({where:{merchantId},data:{maxDiscountPercent:20},select:{id:true}});
    const cart={currency:"BRL",source:"storefront",cart_ref:cartId,total:20,currentDiscount:coupon?1:0,
      items:[{sku:sku.trigger,variantId:ids.trigger,product_id:`${ids.trigger}-product`,name:sku.trigger,productType:"physical",quantity:1,price:20,variant:JSON.stringify([ids.trigger,[]])}],
      ...(coupon?{commercialNudge:{kind:"coupon",title:"Cupom aplicado",message:"Synthetic saved D",couponCode:"SAVE"},appliedBenefits:[{kind:"discount",label:"Cupom SAVE",amount:1}]}:{})};
    await prisma.checkoutSession.create({data:{id:sessionId,...scope,globalUserId:buyerId,conversationId:`${sessionId}-conversation`,cart,customer,createdAt:stamp,updatedAt:stamp},select:{id:true}});
    await prisma.storefrontCart.create({data:{id:cartId,merchantId,sessionId:cartId,total:2000,discount:coupon?100:0,couponCode:coupon?"SAVE":null,freeShipping:false,
      items:[{variantId:ids.trigger,productId:`${ids.trigger}-product`,sku:sku.trigger,name:sku.trigger,quantity:1,unitPriceCents:2000}],expiresAt:new Date(Date.now()+3600000)},select:{id:true}});
    if(coupon){
      // One real coupon row per merchant; quota/readers remain actual. Its D is
      // already accepted/reserved, not recomputed upward when targets are added.
      const couponId=`${prefix}-coupon`;
      await prisma.coupon.upsert({where:{merchantId_code:{merchantId,code:"SAVE"}},create:{id:couponId,merchantId,code:"SAVE",discountType:"percent",discountValue:10,
        maxUsages:100,maxPerBuyer:1,startsAt:new Date(0),status:"active"},update:{},select:{id:true}});
      await prisma.couponRedemption.create({data:{id:`${sessionId}-reservation`,merchantId,sessionId:cartId,couponId,buyerGlobalUserId:buyerId,
        discountApplied:1,status:"applied",source:"manual"},select:{id:true}});
    }
    await prisma.crossSellSuggestion.create({data:{id:suggestionId,...scope,promoId:ids.promotion,rankedItems:[sku.a,sku.b],computedDiscount:10,
      agentCopy:"Synthetic normal batch",status:"pending",suggestedAt:stamp},select:{id:true}});
    const request={suggestion_id:suggestionId,targets:[{sku:sku.a,variant_id:ids.a,quantity:1,selected_option_item_ids:["large"]},
      {sku:sku.b,variant_id:ids.b,quantity:1,selected_option_item_ids:["blue"]}]};
    const quote=await adapter.quote(scope,request),acceptance={suggestion_id:suggestionId,accepted_skus:[sku.a,sku.b],expected_quote:quote};
    return{scope,cartId,buyerId,request,quote,acceptance,customer,suggestionId};
  }
  return{prisma,adapter,merchantId,ids,sku,seed,customer};
}

export async function runNormalCrossSellSourceNativeCases({prisma,check,runId,recordWaiter}){
  const f=await createNormalCrossSellSourceNativeFixture({prisma,runId}),{adapter,seed,merchantId,sku}=f;
  const source=s=>prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:s.cartId}}});
  const session=s=>prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:s.scope}});
  const durable=s=>prisma.outboxMessage.count({where:{merchantId,causationId:s.suggestionId}});
  await check("normal source actual paid-option batch keeps BASE/EFFECTIVE parity and repeated reads stable",async()=>{
    const s=await seed("batch"),before=await source(s);assert.equal(s.quote.pricing.promotionDiscountCents,300);
    const ack=await adapter.accept(s.scope,s.acceptance);assert.equal(ack.persistenceVersion,1);
    assert.equal((await source(s)).total,5000);assert.equal((await source(s)).expiresAt.getTime(),before.expiresAt.getTime());
    assert.equal((await adapter.read(s.scope)).cart.total,47);assert.equal((await adapter.read(s.scope)).cart.total,47);
    assert.equal(await durable(s),1);assert.equal((await session(s)).version,1);
  });
  await check("normal source real coupon reservation D is preserved under shared cap without quota reuse",async()=>{
    const s=await seed("coupon",{coupon:true}),reservation=await prisma.couponRedemption.findFirstOrThrow({where:{merchantId,sessionId:s.cartId}});
    assert.equal(s.quote.pricing.cartDiscountCents,100);assert.equal(s.quote.pricing.payableMerchandiseCents,4600);
    await adapter.accept(s.scope,s.acceptance);const current=await adapter.read(s.scope);
    assert.equal(current.cart.total,47);assert.equal(current.cart.currentDiscount,1);
    assert.deepEqual(await prisma.couponRedemption.findFirstOrThrow({where:{id:reservation.id}}),reservation);
    assert.equal((await source(s)).discount,100);assert.equal(await prisma.couponRedemption.count({where:{merchantId,sessionId:s.cartId}}),1);
  });
  await check("normal source duplicate concurrent accept commits one actual batch and one durable ACK",async()=>{
    const s=await seed("duplicate"),[a,b]=await Promise.all([adapter.accept(s.scope,s.acceptance),adapter.accept(s.scope,s.acceptance)]);
    assert.deepEqual(a,b);assert.equal((await source(s)).items.length,3);assert.equal((await session(s)).version,1);assert.equal(await durable(s),1);
  });
  await check("normal source lost actual COMMIT ACK reconciles without adding or reserving again",async()=>{
    const s=await seed("lost-ack",{coupon:true});let lose=true;
    const wrapped=new Proxy(prisma,{get(target,key){if(key==="$transaction")return async(...args)=>{const result=await target.$transaction(...args);
      if(lose){lose=false;throw new Error("synthetic_normal_source_lost_ack");}return result;};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
    const {PrismaNormalCheckoutCrossSellAdapter}=await import("../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.adapter.ts");
    await assert.rejects(new PrismaNormalCheckoutCrossSellAdapter(wrapped).accept(s.scope,s.acceptance),/synthetic_normal_source_lost_ack/);
    const ack=await adapter.accept(s.scope,s.acceptance);assert.equal(ack.persistenceVersion,1);assert.equal(await durable(s),1);
    assert.equal((await source(s)).items.length,3);assert.equal(await prisma.couponRedemption.count({where:{merchantId,sessionId:s.cartId}}),1);
  });
  await check("normal source+checkout+reservation+event rollback on actual outbox constraint",async()=>{
    const s=await seed("rollback",{coupon:true}),beforeSource=await source(s),beforeSession=await session(s);
    const reservation=await prisma.couponRedemption.findFirstOrThrow({where:{merchantId,sessionId:s.cartId}});
    await prisma.$executeRawUnsafe(`ALTER TABLE outbox_messages ADD CONSTRAINT synthetic_normal_source_rollback
      CHECK (NOT (merchant_id='synthetic-normal-adapter' AND causation_id='normal-adapter-rollback-suggestion'))`);
    try{await assert.rejects(adapter.accept(s.scope,s.acceptance),error=>{assert.match(error.message,/synthetic_normal_source_rollback/);return true;});}
    finally{await prisma.$executeRawUnsafe("ALTER TABLE outbox_messages DROP CONSTRAINT synthetic_normal_source_rollback");}
    assert.deepEqual(await source(s),beforeSource);assert.deepEqual(await session(s),beforeSession);
    assert.deepEqual(await prisma.couponRedemption.findFirstOrThrow({where:{id:reservation.id}}),reservation);
    assert.equal(await prisma.checkoutEvent.count({where:s.scope}),0);assert.equal(await durable(s),0);
    assert.equal((await prisma.crossSellSuggestion.findUniqueOrThrow({where:{id:s.suggestionId}})).status,"pending");
  });
  await check("normal source eligible removal synchronizes both aggregates and keeps real D",async()=>{
    const s=await seed("remove",{coupon:true});await adapter.accept(s.scope,s.acceptance);
    const next=await adapter.updateCart(s.scope,{expectedVersion:1,items:[{sku:sku.a,quantity:0}]});
    assert.equal(next.cart.total,38);assert.equal(next.cart.currentDiscount,1);assert.equal((await source(s)).total,4000);
    assert.equal((await source(s)).items.length,2);assert.equal((await adapter.read(s.scope)).cart.total,38);
  });
  await check("normal source mutation cannot withdraw the sole trigger while retaining its benefit",async()=>{
    const s=await seed("trigger");await adapter.accept(s.scope,s.acceptance);const before=await source(s),stored=await session(s);
    await assert.rejects(adapter.updateCart(s.scope,{expectedVersion:1,items:[{sku:sku.trigger,quantity:0}]}),{code:"cross_sell_quote_review_required",reason:"trigger_not_met"});
    assert.deepEqual(await source(s),before);assert.deepEqual(await session(s),stored);
  });
  await check("normal source rereads canonical source after an observed merchant lock wait",async()=>{
    const s=await seed("source-race"),before=await session(s);let unlock,ready;
    const held=new Promise(resolve=>{ready=resolve;}),release=new Promise(resolve=>{unlock=resolve;});
    const blocker=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;ready();await release;
      const row=await tx.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:s.cartId}}});
      const items=row.items.map(item=>({...item,quantity:2}));await tx.storefrontCart.update({where:{id:row.id},data:{items,total:4000},select:{id:true}});
    },{timeout:15000});
    const blockerResult=blocker.then(()=>undefined,error=>error);
    await Promise.race([held,blockerResult.then(error=>{throw error??new Error("normal_source_blocker_ended_before_lock");})]);
    const result=adapter.accept(s.scope,s.acceptance).then(value=>({value}),error=>({error}));let observed=false;
    try{const deadline=Date.now()+5000;while(Date.now()<deadline){const rows=await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM merchants%'`;
      if(rows[0].n>0){observed=true;recordWaiter();break;}await pause(25);}assert.equal(observed,true,"actual_normal_source_lock_wait_not_observed");}
    finally{unlock();}
    const blockingError=await blockerResult;if(blockingError)throw blockingError;const settled=await result;
    assert.ok(settled.error);assert.equal(settled.error.code,"cross_sell_quote_review_required");assert.equal(settled.error.reason,"source_changed");
    assert.deepEqual(await session(s),before);assert.equal(await durable(s),0);assert.equal((await source(s)).total,4000);
  });
}
