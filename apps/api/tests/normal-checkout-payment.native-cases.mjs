import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";

/** Actual Prisma admission/lease/order. No HTTP, signed webhook, PSP or public
 * activation is claimed. Scope deliberately standalone D0, source/coupon next. */
export async function runNormalCheckoutPaymentNativeCases({prisma,check,runId,recordWaiter}){
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runId}]);
  const {PrismaNormalCheckoutCrossSellAdapter,projectNormalCrossSellCart}=await import("../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.adapter.ts");
  const {readNormalCheckoutCrossSellAuthority}=await import("../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.ts");
  const {createNormalCrossSellPaymentAdmission}=await import("../src/modules/payment/infrastructure/prisma-normal-cross-sell-payment-admission.ts");
  const {PaymentIntentEntity}=await import("../src/modules/payment/domain/payment-intent.entity.ts");
  const {PrismaPaymentRepository}=await import("../src/modules/payment/infrastructure/prisma-payment.repository.ts");
  const {PrismaCheckoutRepository}=await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
  const {PrismaPaymentApprovalReader}=await import("../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.ts");
  const {CompleteOrderUseCase}=await import("../src/modules/checkout/application/use-cases/complete-order.use-case.ts");
  const {paymentCartFingerprint}=await import("../src/modules/checkout/domain/services/payment-cart-fingerprint.ts");
  const scope={merchantId:"synthetic-merchant",sessionId:"synthetic-checkout"},adapter=new PrismaNormalCheckoutCrossSellAdapter(prisma);
  const reader=async(tx,s,options)=>{const current=await readNormalCheckoutCrossSellAuthority(tx,s,undefined,options);return {...current,projectedCart:projectNormalCrossSellCart(current)};};
  const capture=createNormalCrossSellPaymentAdmission(reader,()=>149),payment=new PrismaPaymentRepository(prisma,undefined,undefined,capture);
  const checkout=new PrismaCheckoutRepository(prisma),approvalReader=new PrismaPaymentApprovalReader(prisma);
  const complete=new CompleteOrderUseCase(checkout,checkout,checkout,undefined,undefined,undefined,undefined,checkout,
    undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,approvalReader);
  const customer={fullName:"Synthetic Buyer",email:"buyer@example.test",cpf:"12345678901",phone:"11987654321",email_verified:true,address_verified:true,
    address:{zip:"01310100",street:"Synthetic Street",number:"10",complement:"",neighborhood:"Synthetic District",city:"Synthetic City",state:"SP"}};
  const shipping={customerPrice:9,carrier:"Synthetic carrier",method:"Synthetic delivery",deliveryDays:1,destinationZip:"01310100",region:"SP"};
  await prisma.$executeRaw`INSERT INTO merchants(id,name,updated_at) VALUES (${scope.merchantId},'Synthetic',CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO merchant_rules(id,merchant_id,max_discount_percent,minimum_margin_percent,allow_free_shipping,allow_shipping_discount,
    allow_bonus_item,allow_stack_discount_and_free_shipping,coupon_box_enabled,autonomous_engine_enabled,free_shipping_min_cart_value,max_shipping_subsidy,
    max_partial_shipping_discount,offer_expiration_minutes,blocked_regions,brand_voice,updated_at)
    VALUES ('rules',${scope.merchantId},20,99,false,false,false,false,true,true,0,0,0,30,ARRAY[]::text[],'consultative',CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO checkout_settings VALUES ('settings',${scope.merchantId},'[]'::jsonb)`;
  await prisma.$executeRaw`INSERT INTO checkout_sessions(id,merchant_id,session_id,global_user_id,conversation_id,cart,created_at,updated_at)
    VALUES ('checkout-row',${scope.merchantId},${scope.sessionId},'synthetic-buyer','synthetic-conversation','{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO products(id,merchant_id,name,type,metadata,updated_at) VALUES
    ('trigger-product',${scope.merchantId},'Synthetic trigger','physical','{}',CURRENT_TIMESTAMP),('target-product',${scope.merchantId},'Synthetic target','physical','{}',CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO product_variants(id,product_id,sku,updated_at) VALUES ('trigger','trigger-product','TRIGGER',CURRENT_TIMESTAMP),('target','target-product','TARGET',CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO product_prices(id,variant_id,base_price_in_cents) VALUES ('trigger-price','trigger',10000),('target-price','target',2000)`;
  await prisma.$executeRaw`INSERT INTO product_stock(id,variant_id,quantity,reserved) VALUES ('trigger-stock','trigger',100,0),('target-stock','target',100,0)`;
  await prisma.$executeRaw`INSERT INTO cross_sell_promotions(id,merchant_id,name,trigger,recommended_skus,discount_percent,max_discount_percent,status,starts_at,updated_at)
    VALUES ('promo',${scope.merchantId},'Synthetic','{"sku_in_cart":["TRIGGER"]}',ARRAY['TARGET'],10,100,'active',CURRENT_TIMESTAMP-INTERVAL '1 day',CURRENT_TIMESTAMP)`;
  let sequence=0;
  const stored=intent=>prisma.paymentIntent.findUniqueOrThrow({where:{id:intent.id}});
  async function prepare({quantity=1,paidOptions=false}={}){
    // These cases use saveIntent(), not settlement issuance. Never delete or
    // disable append-only ledger records merely to recycle a test session.
    await prisma.completedOrder.deleteMany({where:scope});
    await prisma.paymentIntent.deleteMany({where:scope});await prisma.checkoutEvent.deleteMany({where:scope});await prisma.outboxMessage.deleteMany({where:{merchantId:scope.merchantId}});
    await prisma.crossSellSuggestion.deleteMany({where:scope});await prisma.productPromotion.deleteMany({where:{merchantId:scope.merchantId}});
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=2000 WHERE variant_id='target'`;
    await prisma.product.update({where:{id:"target-product"},data:{metadata:paidOptions?{optionGroups:[{id:"size",name:"Size",required:true,selectionType:"single",items:[{id:"large",name:"Large",priceModifierInCents:500}]}]}:{}},select:{id:true}});
    await prisma.crossSellPromotion.update({where:{id:"promo"},data:{status:"active",updatedAt:new Date(),endsAt:null},select:{id:true}});
    await prisma.checkoutSession.update({where:{merchantId_sessionId:scope},data:{strategyContextVersion:0,paymentMethod:null,customer,shipping:null,shippingOptions:null,
      cart:{currency:"BRL",source:"checkout",total:100,currentDiscount:0,items:[{sku:"TRIGGER",variantId:"trigger",product_id:"trigger-product",productType:"physical",name:"Synthetic trigger",price:100,quantity:1,variant:'["trigger",[]]'}]}},select:{id:true}});
    await prisma.crossSellSuggestion.create({data:{id:"synthetic-suggestion",...scope,promoId:"promo",rankedItems:["TARGET"],agentCopy:"Synthetic",computedDiscount:10,status:"pending",suggestedAt:new Date()},select:{id:true}});
    const quote=await adapter.quote(scope,{suggestion_id:"synthetic-suggestion",targets:[{sku:"TARGET",variant_id:"target",quantity,selected_option_item_ids:paidOptions?["large"]:[]}]});
    await adapter.accept(scope,{suggestion_id:"synthetic-suggestion",accepted_skus:["TARGET"],expected_quote:quote});
    await prisma.checkoutSession.update({where:{merchantId_sessionId:scope},data:{shipping,customer},select:{id:true}});
    const session=await adapter.read(scope),subtotal=Math.round(session.cart.total*100);
    const breakdown={version:1,currency:"BRL",cartFingerprint:paymentCartFingerprint(session),itemsSubtotalCents:subtotal,discountCents:0,shippingCents:900,platformFeeCents:149,totalCents:subtotal+1049};
    const intent=PaymentIntentEntity.create({...scope,idempotencyKey:`normal-native-${++sequence}`,amountCents:breakdown.totalCents,currency:"BRL",method:"pix",amountBreakdown:breakdown});
    intent.prepareCreation({...scope,intentId:intent.id,amountCents:breakdown.totalCents,currency:"BRL",method:"pix"});return {intent,breakdown};
  }
  async function approve(intent,provider="synthetic-normal-provider"){
    intent.claimCreation("first-send",new Date());await payment.saveIntent({intent});intent.completeCreation("first-send");
    intent.markApproved({providerPaymentId:provider,approvedAmountCents:intent.snapshot().amountCents});await payment.saveIntent({intent});
    const b=intent.snapshot().amountBreakdown;return {merchant_id:scope.merchantId,session_id:scope.sessionId,external_order_id:provider,order_total:(b.itemsSubtotalCents+b.shippingCents-b.discountCents)/100,currency:"BRL"};
  }
  await check("normal actual acceptance, admission and frozen evidence commit without widget protocol",async()=>{
    const {intent}=await prepare();await payment.saveIntent({intent});const row=await stored(intent),a=row.creation.normalCrossSellAuthority;
    assert.equal(row.version,1);assert.equal(a.frozenProjection.cart.total,118);assert.equal(a.acceptanceEventIds.length,1);
    assert.equal(a.frozenProjection.cart.items.find(item=>item.sku==="TARGET").price,18);
    assert.equal("_widgetCrossSellAcceptance"in a.frozenProjection.cart,false);assert.equal("normalCrossSellAuthority"in row.creation.input,false);
  });
  await check("normal paid options and quantity are discounted once in admitted cents",async()=>{
    const {intent}=await prepare({quantity:2,paidOptions:true});await payment.saveIntent({intent});const a=(await stored(intent)).creation.normalCrossSellAuthority;
    assert.equal(a.amountCents,15549);assert.equal(a.frozenProjection.cart.total,145);
    const item=a.frozenProjection.cart.items.find(item=>item.sku==="TARGET");assert.equal(item.quantity,2);assert.equal(item.price,22.5);assert.equal(item.originalPrice,25);
    assert.equal(a.frozenProjection.cart.discountBudget.promotionDiscountCents,500);
  });
  await check("normal public legacy completion cannot bypass the actual admitted approval",async()=>{
    await prepare();await assert.rejects(checkout.assertPublicCompletionAllowed(scope.merchantId,scope.sessionId),/payment_approval_required/);
    assert.equal(await prisma.completedOrder.count({where:scope}),0);
  });
  await check("normal journal/outbox failure is a real SQL rollback without caller acknowledgement",async()=>{
    const {intent}=await prepare(),before=await prisma.outboxMessage.count();
    await assert.rejects(payment.saveIntentWithOutbox({intent},{event_id:"normal-rollback",event_type:"synthetic.payment.rollback",schema_version:1,
      merchant_id:scope.merchantId,occurred_at:new Date().toISOString(),correlation_id:"normal",causation_id:intent.id,producer:"normal-native",payload:{}}),error=>{
        assert.match(String(error.message),/synthetic_widget_payment_rollback/);return true;});
    assert.equal(await prisma.paymentIntent.count({where:scope}),0);assert.equal(await prisma.outboxMessage.count(),before);
    assert.equal(intent.snapshot().version,0);assert.equal(intent.snapshot().creation.normalCrossSellAuthority,undefined);
  });
  for(const change of ["catalog","promotion","customer","evidence"])
    await check(`normal first-send refuses changed ${change} without committing lease or repricing`,async()=>{
      const {intent}=await prepare();await payment.saveIntent({intent});const before=await stored(intent);
      if(change==="catalog")await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=2001 WHERE variant_id='target'`;
      if(change==="promotion")await prisma.crossSellPromotion.update({where:{id:"promo"},data:{status:"archived"},select:{id:true}});
      if(change==="customer")await prisma.checkoutSession.update({where:{merchantId_sessionId:scope},data:{customer:{...customer,email:"changed@example.test"}},select:{id:true}});
      if(change==="evidence")await prisma.outboxMessage.deleteMany({where:{merchantId:scope.merchantId,eventType:"cross-sell.offer.accepted"}});
      intent.claimCreation("stale-first",new Date());await assert.rejects(payment.saveIntent({intent}));assert.deepEqual(await stored(intent),before);
    });
  await check("normal uncertain reconciliation preserves admitted identity after catalog change",async()=>{
    const {intent}=await prepare();await payment.saveIntent({intent});intent.claimCreation("sent",new Date());await payment.saveIntent({intent});
    intent.markCreationUncertain("sent","synthetic_lost_provider_ack");await payment.saveIntent({intent});const before=(await stored(intent)).creation.normalCrossSellAuthority;
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=9999 WHERE variant_id='target'`;
    assert.equal(intent.claimCreation("recover",new Date(Date.now()+120000)),"recover");await payment.saveIntent({intent});
    assert.deepEqual((await stored(intent)).creation.normalCrossSellAuthority,before);
  });
  await check("normal paid order is historical despite catalog/contact drift and retry commits once",async()=>{
    const {intent}=await prepare();await payment.saveIntent({intent});const input=await approve(intent),a=(await stored(intent)).creation.normalCrossSellAuthority;
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=9999 WHERE variant_id='target'`;
    await prisma.checkoutSession.update({where:{merchantId_sessionId:scope},data:{customer:{...customer,email:"changed@example.test"}},select:{id:true}});
    assert.equal((await complete.executePaymentApproval(input,intent.id)).idempotent,false);
    const order=await prisma.completedOrder.findFirstOrThrow({where:scope});assert.equal(Number(order.orderTotal),127);assert.equal(order.shippingCents,900);
    assert.deepEqual(order.lineItemsJson.map(item=>[item.sku,item.unitPriceCents,item.quantity]),a.frozenProjection.cart.items.map(item=>[item.sku,Math.round(item.price*100),item.quantity]));
    const count=await prisma.outboxMessage.count();assert.equal((await complete.executePaymentApproval(input,intent.id)).idempotent,true);assert.equal(await prisma.outboxMessage.count(),count);
    const event=await prisma.outboxMessage.findFirstOrThrow({where:{merchantId:scope.merchantId,eventType:"order.confirmed"}});assert.equal(event.payload.buyerEmail,"buyer@example.test");
  });
  await check("normal lost initial commit ACK is recovered by existing lookup without creating second journal",async()=>{
    const {intent}=await prepare();let lost=true;
    const wrapped=new Proxy(prisma,{get(target,key){if(key==="$transaction")return async(...args)=>{const result=await target.$transaction(...args);if(lost){lost=false;throw new Error("synthetic_commit_ack_unknown");}return result;};
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
    const repo=new PrismaPaymentRepository(wrapped,undefined,undefined,capture);await assert.rejects(repo.saveIntent({intent}),/synthetic_commit_ack_unknown/);
    assert.equal(intent.snapshot().version,0);const recovered=await payment.getByIdempotency(scope.merchantId,scope.sessionId,intent.snapshot().idempotencyKey);
    assert.ok(recovered);assert.equal(recovered.id,intent.id);assert.equal(await prisma.paymentIntent.count({where:scope}),1);
    assert.equal(recovered.snapshot().creation.normalCrossSellAuthority.paymentId,intent.id);
  });
  await check("normal actual order and outbox rollback together on the existing SQL constraint",async()=>{
    const {intent}=await prepare();await payment.saveIntent({intent});const input=await approve(intent,"synthetic-provider-rollback");
    const before=await prisma.outboxMessage.count();
    await assert.rejects(complete.executePaymentApproval(input,intent.id),error=>{assert.match(String(error.message),/synthetic_widget_order_rollback/);return true;});
    assert.equal(await prisma.completedOrder.count({where:scope}),0);assert.equal(await prisma.outboxMessage.count(),before);
    assert.equal((await stored(intent)).status,"approved");
  });
  await check("normal refund after approval read cannot commit an order from a detached parsed snapshot",async()=>{
    const {intent}=await prepare();await payment.saveIntent({intent});const input=await approve(intent);
    const racing=new CompleteOrderUseCase(checkout,checkout,checkout,undefined,undefined,undefined,undefined,checkout,
      undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{find:async(...args)=>{
        const result=await approvalReader.find(...args);await prisma.paymentIntent.update({where:{id:intent.id},data:{status:"refunded"},select:{id:true}});return result;}});
    await assert.rejects(racing.executePaymentApproval(input,intent.id));assert.equal(await prisma.completedOrder.count({where:scope}),0);
  });
  await check("normal existing ready own payment cannot exclude a different live journal",async()=>{
    const {intent}=await prepare();await payment.saveIntent({intent});const before=await stored(intent);
    await prisma.paymentIntent.create({data:{id:"other-normal",...scope,idempotencyKey:"other-normal",amountCents:1,currency:"BRL",method:"pix",status:"pending"},select:{id:true}});
    intent.claimCreation("first-send",new Date());await assert.rejects(payment.saveIntent({intent}));assert.deepEqual(await stored(intent),before);
  });
  await check("normal merchant fence waits for catalog writer and admits no stale journal",async()=>{
    const {intent}=await prepare();let release,acquired;
    const locked=new Promise(resolve=>{acquired=resolve;}),unlock=new Promise(resolve=>{release=resolve;});
    const blocker=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM merchants WHERE id=${scope.merchantId} FOR UPDATE`;acquired();await unlock;
      await tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=3000 WHERE variant_id='target'`;},{timeout:15_000});
    await locked;const attempt=payment.saveIntent({intent}).then(value=>({ok:true,value}),error=>({ok:false,error}));
    try{
      let found=false;
      for(let index=0;index<80;index++){
        const rows=await prisma.$queryRaw`SELECT pid FROM pg_stat_activity WHERE application_name=${`aacp_write_native_${runId}`} AND wait_event_type='Lock'`;
        if(rows.length){found=true;recordWaiter();break;}await pause(20);
      }
      assert.equal(found,true,"actual_native_lock_wait_required");
    }finally{release();await blocker;}
    assert.equal((await attempt).ok,false);assert.equal(await prisma.paymentIntent.count({where:scope}),0);
  });
  await check("normal payment wins merchant fence; later catalog update cannot alter journal and blocks first send",async()=>{
    const {intent}=await prepare();let release,acquired;
    const locked=new Promise(resolve=>{acquired=resolve;}),unlock=new Promise(resolve=>{release=resolve;});
    const held=new PrismaPaymentRepository(prisma,undefined,undefined,async(tx,snapshot)=>{
      const result=await capture(tx,snapshot);acquired();await unlock;return result;});
    const admitted=held.saveIntent({intent}).then(value=>({ok:true,value}),error=>({ok:false,error}));await locked;
    const writer=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM merchants WHERE id=${scope.merchantId} FOR UPDATE`;
      await tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=3000 WHERE variant_id='target'`;},{timeout:15_000});
    const settledWriter=writer.then(()=>null,error=>error);
    try{
      let found=false;
      for(let index=0;index<80;index++){
        const rows=await prisma.$queryRaw`SELECT pid FROM pg_stat_activity WHERE application_name=${`aacp_write_native_${runId}`} AND wait_event_type='Lock'`;
        if(rows.length){found=true;recordWaiter();break;}await pause(20);
      }
      assert.equal(found,true,"actual_native_lock_wait_required");
    }finally{release();}
    assert.equal((await admitted).ok,true);assert.equal(await settledWriter,null);
    const before=await stored(intent);assert.equal(before.creation.normalCrossSellAuthority.frozenProjection.cart.total,118);
    intent.claimCreation("after-writer",new Date());await assert.rejects(payment.saveIntent({intent}));assert.deepEqual(await stored(intent),before);
  });
}

/** Source+coupom uses unique scopes and the real append-only accounting plan.
 * Never recycle a payment's ledger or infer a source cart ID from checkout ID. */
export async function runNormalCheckoutSourcePaymentNativeCases({prisma,check,runId}){
  const {createNormalCrossSellSourceNativeFixture}=await import("./normal-cross-sell-source.native-cases.mjs");
  const fixture=await createNormalCrossSellSourceNativeFixture({prisma,runId,namespace:"payment"});
  const {readNormalCheckoutCrossSellAuthority}=await import("../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.ts");
  const {projectNormalCrossSellCart}=await import("../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.adapter.ts");
  const {captureStorefrontCouponForPayment}=await import("../src/shared/persistence/storefront-coupon/admission.ts");
  const {createNormalCrossSellPaymentAdmission}=await import("../src/modules/payment/infrastructure/prisma-normal-cross-sell-payment-admission.ts");
  const {PrismaPaymentRepository}=await import("../src/modules/payment/infrastructure/prisma-payment.repository.ts");
  const {PaymentIntentEntity}=await import("../src/modules/payment/domain/payment-intent.entity.ts");
  const {PrismaCheckoutRepository}=await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
  const {PrismaPaymentApprovalReader}=await import("../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.ts");
  const {CompleteOrderUseCase}=await import("../src/modules/checkout/application/use-cases/complete-order.use-case.ts");
  const {PrismaBoundCouponRedemption}=await import("../src/modules/coupons/infrastructure/repositories/prisma-bound-coupon-redemption.ts");
  const {paymentCartFingerprint}=await import("../src/modules/checkout/domain/services/payment-cart-fingerprint.ts");
  const capture=createNormalCrossSellPaymentAdmission(async(tx,scope,options)=>{
    const current=await readNormalCheckoutCrossSellAuthority(tx,scope,undefined,options);return {...current,projectedCart:projectNormalCrossSellCart(current)};
  },()=>149);
  const payment=new PrismaPaymentRepository(prisma,captureStorefrontCouponForPayment,undefined,capture),checkout=new PrismaCheckoutRepository(prisma);
  const completion=new CompleteOrderUseCase(checkout,checkout,checkout,undefined,undefined,undefined,undefined,checkout,
    undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,new PrismaPaymentApprovalReader(prisma));
  const shipping={customerPrice:9,carrier:"Synthetic source carrier",method:"Synthetic delivery",deliveryDays:1,destinationZip:"01310100",region:"SP"};
  const rawSession=s=>prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:s.scope}});
  const source=s=>prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:s.scope.merchantId,sessionId:s.cartId}}});
  const journal=s=>prisma.paymentIntent.findUniqueOrThrow({where:{id:s.intent.id}});
  const reservation=s=>prisma.couponRedemption.findUniqueOrThrow({where:{id:`${s.scope.sessionId}-reservation`}});
  async function prepare(label,coupon=true){
    const s=await fixture.seed(label,{coupon});await fixture.adapter.accept(s.scope,s.acceptance);
    await prisma.checkoutSession.update({where:{merchantId_sessionId:s.scope},data:{shipping},select:{id:true}});
    const current=await fixture.adapter.read(s.scope),subtotal=Math.round(current.cart.total*100),discount=Math.round((current.cart.currentDiscount??0)*100);
    assert.equal(subtotal,4700);assert.equal(discount,coupon?100:0);
    const breakdown={version:1,currency:"BRL",cartFingerprint:paymentCartFingerprint(current),itemsSubtotalCents:subtotal,discountCents:discount,
      shippingCents:900,platformFeeCents:149,totalCents:subtotal-discount+1049};
    const intent=PaymentIntentEntity.create({...s.scope,idempotencyKey:`${label}-payment`,currency:"BRL",method:"pix",amountCents:breakdown.totalCents,amountBreakdown:breakdown});
    intent.prepareCreation({...s.scope,intentId:intent.id,amountCents:breakdown.totalCents,currency:"BRL",method:"pix"});
    const plan={merchantId:s.scope.merchantId,paymentIntentId:intent.id,provider:"synthetic-normal-native",currency:"BRL",plannedGrossCents:breakdown.totalCents,
      plannedPlatformFeeCents:149,plannedMerchantNetCents:breakdown.totalCents-149,plannedProviderFeeCents:0,occurredAt:new Date(),entries:[
        {entryKey:"platform_fee",entryType:"platform_fee",direction:"credit",recipientType:"platform",plannedAmountCents:149},
        {entryKey:"merchant_payout",entryType:"merchant_payout",direction:"credit",recipientType:"merchant",plannedAmountCents:breakdown.totalCents-149}]};
    const trustedScope={merchantId:s.scope.merchantId,checkoutSessionId:s.scope.sessionId,cartId:s.cartId,buyerId:s.buyerId};
    return {...s,intent,breakdown,plan,coupon,trustedScope};
  }
  const admit=(s,repo=payment)=>repo.saveIntentWithSettlementPlan({intent:s.intent,settlementPlan:s.plan,...(s.coupon?{storefrontCouponScope:s.trustedScope}:{})});
  async function approve(s){
    s.intent.claimCreation("source-first-send",new Date());await payment.saveIntent({intent:s.intent});s.intent.completeCreation("source-first-send");
    const provider=`${s.scope.sessionId}-provider`;s.intent.markApproved({providerPaymentId:provider,approvedAmountCents:s.breakdown.totalCents});await payment.saveIntent({intent:s.intent});
    return {merchant_id:s.scope.merchantId,session_id:s.scope.sessionId,external_order_id:provider,
      order_total:(s.breakdown.itemsSubtotalCents-s.breakdown.discountCents+s.breakdown.shippingCents)/100,currency:"BRL"};
  }
  await check("normal source D0 actual admission and first-send preserve source reference, paid options and plan",async()=>{
    const s=await prepare("d0",false);await admit(s);let row=await journal(s);
    assert.equal(row.amountCents,5749);assert.equal(row.creation.normalCrossSellAuthority.frozenProjection.cart.cart_ref,s.cartId);
    assert.equal(row.creation.couponAuthority,undefined);assert.equal((await source(s)).total,5000);
    assert.equal(await prisma.paymentSettlement.count({where:{paymentIntentId:s.intent.id}}),1);
    s.intent.claimCreation("first",new Date());await payment.saveIntent({intent:s.intent});row=await journal(s);
    assert.equal(row.creation.firstAttemptAt,s.intent.snapshot().creation.firstAttemptAt);assert.equal(row.creation.normalCrossSellAuthority.frozenProjection.cart.total,47);
  });
  await check("normal source P+D captures real reservation and both immutable siblings in journal/ledger transaction",async()=>{
    const s=await prepare("pd"),before=await reservation(s);await admit(s);const row=await journal(s),cart=(await rawSession(s)).cart;
    assert.equal(row.amountCents,5649);assert.equal(row.creation.couponAuthority.redemptionId,before.id);assert.equal(row.creation.couponAuthority.cartId,s.cartId);
    assert.equal(cart._storefrontCouponBinding.state,"active");assert.equal(cart._storefrontCouponBinding.discountCents,100);
    assert.equal(row.creation.normalCrossSellAuthority.amountBreakdown.discountCents,100);
    assert.equal(row.creation.normalCrossSellAuthority.frozenProjection.cart.discountBudget.promotionDiscountCents,300);
    assert.deepEqual(await reservation(s),before);assert.equal(await prisma.paymentSettlement.count({where:{paymentIntentId:s.intent.id}}),1);
    const admitted=structuredClone(row.creation);s.intent.claimCreation("pd-first",new Date());await payment.saveIntent({intent:s.intent});
    const sent=await journal(s);assert.deepEqual(sent.creation.normalCrossSellAuthority,admitted.normalCrossSellAuthority);assert.deepEqual(sent.creation.couponAuthority,admitted.couponAuthority);
    assert.equal(await prisma.paymentSettlement.count({where:{paymentIntentId:s.intent.id}}),1);
  });
  await check("normal source D0 first send cannot charge a stale source even without coupon binding",async()=>{
    const s=await prepare("d0-changed",false);await admit(s);const before=await journal(s),current=await source(s);
    const items=current.items.map((item,index)=>index===0?{...item,quantity:item.quantity+1}:item);
    await prisma.storefrontCart.update({where:{id:current.id},data:{items,total:7000},select:{id:true}});
    s.intent.claimCreation("stale-source",new Date());await assert.rejects(payment.saveIntent({intent:s.intent}));assert.deepEqual(await journal(s),before);
  });
  await check("normal source P+D first send refuses catalog drift with exact D/reservation/journal preserved",async()=>{
    const s=await prepare("pd-catalog");await admit(s);const before=await journal(s),reserved=await reservation(s);
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=901 WHERE variant_id=${fixture.ids.a}`;
    try{s.intent.claimCreation("stale-pd",new Date());await assert.rejects(payment.saveIntent({intent:s.intent}));}
    finally{await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=900 WHERE variant_id=${fixture.ids.a}`;}
    assert.deepEqual(await journal(s),before);assert.deepEqual(await reservation(s),reserved);
  });
  await check("normal source P+D uncertain recovery preserves admitted siblings after source expiration without replay",async()=>{
    const s=await prepare("pd-unknown");await admit(s);s.intent.claimCreation("sent",new Date());await payment.saveIntent({intent:s.intent});
    s.intent.markCreationUncertain("sent","synthetic_provider_ack_unknown");await payment.saveIntent({intent:s.intent});const before=await journal(s),reserved=await reservation(s);
    await prisma.storefrontCart.update({where:{id:s.cartId},data:{expiresAt:new Date(0)},select:{id:true}});
    assert.equal(s.intent.claimCreation("recover",new Date(Date.now()+120000)),"recover");await payment.saveIntent({intent:s.intent});const after=await journal(s);
    assert.deepEqual(after.creation.normalCrossSellAuthority,before.creation.normalCrossSellAuthority);assert.deepEqual(after.creation.couponAuthority,before.creation.couponAuthority);
    assert.equal(after.creation.firstAttemptAt,before.creation.firstAttemptAt);assert.deepEqual(await reservation(s),reserved);
  });
  await check("normal source P+D reservation disagreement refuses first-send without silently repairing or allocating D",async()=>{
    const s=await prepare("pd-reservation");await admit(s);const before=await journal(s);
    await prisma.couponRedemption.update({where:{id:`${s.scope.sessionId}-reservation`},data:{discountApplied:2},select:{id:true}});
    const changed=await reservation(s);s.intent.claimCreation("reservation-disagrees",new Date());await assert.rejects(payment.saveIntent({intent:s.intent}));
    assert.deepEqual(await journal(s),before);assert.deepEqual(await reservation(s),changed);assert.equal((await source(s)).discount,100);
  });
  await check("normal source P+D ledger failure rolls back journal/binding with reservation and source intact",async()=>{
    const s=await prepare("pd-ledger-fault"),before=await rawSession(s),src=await source(s),reserved=await reservation(s);
    assert.match(s.intent.id,/^pay_int_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_normal_pd_ledger_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.payment_intent_id='${s.intent.id}' THEN RAISE EXCEPTION 'synthetic_normal_pd_ledger_fault'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe("CREATE TRIGGER synthetic_normal_pd_ledger_fault BEFORE INSERT ON payment_settlements FOR EACH ROW EXECUTE FUNCTION synthetic_normal_pd_ledger_fault()");
    try{await assert.rejects(admit(s),error=>{assert.match(error.message,/synthetic_normal_pd_ledger_fault/);return true;});}
    finally{await prisma.$executeRawUnsafe("DROP TRIGGER synthetic_normal_pd_ledger_fault ON payment_settlements");}
    assert.equal(await prisma.paymentIntent.count({where:{id:s.intent.id}}),0);assert.equal(await prisma.paymentSettlement.count({where:{paymentIntentId:s.intent.id}}),0);
    assert.deepEqual(await rawSession(s),before);assert.deepEqual(await source(s),src);assert.deepEqual(await reservation(s),reserved);
  });
  await check("normal source P+D lost commit ACK recovers one journal/plan/generation without another reservation",async()=>{
    const s=await prepare("pd-lost-ack"),reserved=await reservation(s);let lost=true;
    const wrapped=new Proxy(prisma,{get(target,key){if(key==="$transaction")return async(...args)=>{const result=await target.$transaction(...args);if(lost){lost=false;throw new Error("synthetic_pd_commit_ack_unknown");}return result;};
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
    const repo=new PrismaPaymentRepository(wrapped,captureStorefrontCouponForPayment,undefined,capture);
    await assert.rejects(admit(s,repo),/synthetic_pd_commit_ack_unknown/);assert.equal(s.intent.snapshot().version,0);
    const recovered=await payment.getByIdempotency(s.scope.merchantId,s.scope.sessionId,s.intent.snapshot().idempotencyKey);assert.ok(recovered);
    const row=await journal(s);assert.equal(row.creation.couponAuthority.bindingId,(await rawSession(s)).cart._storefrontCouponBinding.bindingId);
    assert.deepEqual(recovered.snapshot().creation.normalCrossSellAuthority,row.creation.normalCrossSellAuthority);
    assert.equal(await prisma.paymentSettlement.count({where:{paymentIntentId:s.intent.id}}),1);
    assert.equal(await prisma.paymentSettlementEntry.count({where:{merchantId:s.scope.merchantId,settlement:{paymentIntentId:s.intent.id}}}),2);
    assert.deepEqual(await reservation(s),reserved);
  });
  await check("normal source P+D approved order and actual bound consumer use frozen cents once after catalog/TTL drift",async()=>{
    const s=await prepare("pd-order");await admit(s);const input=await approve(s),before=await journal(s);
    await prisma.storefrontCart.update({where:{id:s.cartId},data:{expiresAt:new Date(0)},select:{id:true}});
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=9999 WHERE variant_id=${fixture.ids.a}`;
    try{
      assert.equal((await completion.executePaymentApproval(input,s.intent.id)).idempotent,false);
      const order=await prisma.completedOrder.findFirstOrThrow({where:s.scope});assert.equal(Number(order.orderTotal),55);
      assert.deepEqual(order.lineItemsJson.map(item=>[item.sku,item.unitPriceCents,item.quantity]),before.creation.normalCrossSellAuthority.frozenProjection.cart.items.map(item=>[item.sku,Math.round(item.price*100),item.quantity]));
      const event=await prisma.outboxMessage.findFirstOrThrow({where:{merchantId:s.scope.merchantId,eventType:"order.completed",payload:{path:["payment_intent_id"],equals:s.intent.id}}});
      assert.equal(event.payload.coupon_authority.discountCents,100);assert.equal(event.payload.coupon_authority.cartId,s.cartId);
      const couponId=`normal-payment-coupon`,old=(await prisma.coupon.findUniqueOrThrow({where:{id:couponId}})).usagesCount;
      const consumer=new PrismaBoundCouponRedemption(prisma);await consumer.redeem({merchantId:s.scope.merchantId,eventId:event.eventId});
      await consumer.redeem({merchantId:s.scope.merchantId,eventId:event.eventId});
      assert.equal((await reservation(s)).status,"redeemed");assert.equal((await reservation(s)).orderId,input.external_order_id);
      assert.equal((await prisma.coupon.findUniqueOrThrow({where:{id:couponId}})).usagesCount,old+1);
      const count=await prisma.outboxMessage.count({where:{merchantId:s.scope.merchantId}});
      assert.equal((await completion.executePaymentApproval(input,s.intent.id)).idempotent,true);assert.equal(await prisma.outboxMessage.count({where:{merchantId:s.scope.merchantId}}),count);
    }finally{await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=900 WHERE variant_id=${fixture.ids.a}`;}
  });
}
