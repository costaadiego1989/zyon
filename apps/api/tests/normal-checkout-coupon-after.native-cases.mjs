import assert from "node:assert/strict";

/** Existing owned normal-payment PostgreSQL harness only. This extension never
 * fabricates financial proof, changes environment, deletes a ledger or contacts
 * a provider. All new grants use actual quote/accept/coupon transaction commands. */
export async function runNormalCheckoutCouponAfterNativeCases({prisma,check,runId}){
  const {createNormalCrossSellSourceNativeFixture}=await import("./normal-cross-sell-source.native-cases.mjs");
  const f=await createNormalCrossSellSourceNativeFixture({prisma,runId,namespace:"couponafter"});
  const {readNormalCheckoutCrossSellAuthority}=await import("../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.ts");
  const {projectNormalCrossSellCart}=await import("../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.adapter.ts");
  const {toCheckoutSession}=await import("../src/modules/checkout/domain/services/checkout-session-projection.ts");
  const {ApplyCouponUseCase}=await import("../src/modules/coupons/application/use-cases/apply-coupon.use-case.ts");
  const {PrismaCouponRepository}=await import("../src/modules/coupons/infrastructure/repositories/prisma-coupon.repository.ts");
  const {PrismaCouponTransactionRepository}=await import("../src/modules/coupons/infrastructure/repositories/prisma-coupon-transaction.repository.ts");
  const {RulesEngineDiscountAdapter}=await import("../src/modules/coupons/infrastructure/adapters/rules-engine-discount.adapter.ts");
  const {createNormalCrossSellPaymentAdmission}=await import("../src/modules/payment/infrastructure/prisma-normal-cross-sell-payment-admission.ts");
  const {captureStorefrontCouponForPayment}=await import("../src/shared/persistence/storefront-coupon/admission.ts");
  const {PaymentIntentEntity}=await import("../src/modules/payment/domain/payment-intent.entity.ts");
  const {PrismaPaymentRepository}=await import("../src/modules/payment/infrastructure/prisma-payment.repository.ts");
  const {PrismaCheckoutRepository}=await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
  const {PrismaPaymentApprovalReader}=await import("../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.ts");
  const {CompleteOrderUseCase}=await import("../src/modules/checkout/application/use-cases/complete-order.use-case.ts");
  const {PrismaBoundCouponRedemption}=await import("../src/modules/coupons/infrastructure/repositories/prisma-bound-coupon-redemption.ts");
  const {paymentCartFingerprint}=await import("../src/modules/checkout/domain/services/payment-cart-fingerprint.ts");
  const read=async(tx,scope,options)=>{const current=await readNormalCheckoutCrossSellAuthority(tx,scope,undefined,options);
    return{...current,projectedCart:projectNormalCrossSellCart(current)};};
  const canonical=async(tx,scope)=>{const current=await read(tx,scope);return toCheckoutSession({...current.stored,cart:current.projectedCart});};
  const commandFor=client=>new ApplyCouponUseCase(new PrismaCouponRepository(client),new PrismaCouponTransactionRepository(client),new RulesEngineDiscountAdapter(),client,canonical);
  const command=commandFor(prisma),capture=createNormalCrossSellPaymentAdmission(read,()=>149);
  const payment=new PrismaPaymentRepository(prisma,captureStorefrontCouponForPayment,undefined,capture),checkout=new PrismaCheckoutRepository(prisma);
  const complete=new CompleteOrderUseCase(checkout,checkout,checkout,undefined,undefined,undefined,undefined,checkout,
    undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,new PrismaPaymentApprovalReader(prisma));
  const couponId="normal-couponafter-coupon";
  await prisma.coupon.create({data:{id:couponId,merchantId:f.merchantId,code:"SAVE",discountType:"fixed",discountValue:1,
    maxUsages:100,maxPerBuyer:1,startsAt:new Date(0),status:"active"},select:{id:true}});
  async function seed(label,source,historical=false){
    const s=await f.seed(label);
    if(!source||historical){
      const stored=await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:s.scope}});
      const {cart_ref:_ref,...cart}=stored.cart;
      if(historical){
        const sourceRow=await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:f.merchantId,sessionId:s.cartId}}});
        await prisma.storefrontCart.update({where:{id:sourceRow.id},data:{total:1800,
          items:sourceRow.items.map(item=>({...item,unitPriceCents:1800}))},select:{id:true}});
      }
      await prisma.checkoutSession.update({where:{id:stored.id},data:{cart:{...(source?stored.cart:cart),...(!source?{source:"checkout"}:{}),
        ...(historical?{total:18,items:stored.cart.items.map(item=>({...item,price:18}))}:{})}},select:{id:true}});
      s.quote=await f.adapter.quote(s.scope,s.request);s.acceptance={...s.acceptance,expected_quote:s.quote};
    }
    await f.adapter.accept(s.scope,s.acceptance);
    const stored=await prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:s.scope}});
    return{...s,source,input:{merchant_id:s.scope.merchantId,session_id:s.scope.sessionId,code:"SAVE",expectedVersion:stored.version}};
  }
  const sourceRow=s=>prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId:f.merchantId,sessionId:s.cartId}}});
  const sessionRow=s=>prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:s.scope}});
  const reserved=s=>prisma.couponRedemption.findFirstOrThrow({where:{merchantId:f.merchantId,sessionId:s.source?s.cartId:s.scope.sessionId}});
  async function makeIntent(s){
    const shipping={customerPrice:9,carrier:"Synthetic normal carrier",method:"Synthetic delivery",deliveryDays:1,destinationZip:"01310100",region:"SP"};
    await prisma.checkoutSession.update({where:{merchantId_sessionId:s.scope},data:{shipping},select:{id:true}});
    const current=await f.adapter.read(s.scope),itemsSubtotalCents=Math.round(current.cart.total*100),discountCents=Math.round(current.cart.currentDiscount*100);
    const breakdown={version:1,currency:"BRL",cartFingerprint:paymentCartFingerprint(current),itemsSubtotalCents,discountCents,
      shippingCents:900,platformFeeCents:149,totalCents:itemsSubtotalCents-discountCents+1049};
    const intent=PaymentIntentEntity.create({...s.scope,idempotencyKey:`${s.scope.sessionId}-payment`,amountCents:breakdown.totalCents,currency:"BRL",method:"pix",amountBreakdown:breakdown});
    intent.prepareCreation({...s.scope,intentId:intent.id,amountCents:breakdown.totalCents,currency:"BRL",method:"pix"});
    const storefrontCouponScope={merchantId:f.merchantId,checkoutSessionId:s.scope.sessionId,cartId:s.cartId,buyerId:s.buyerId};
    const settlementPlan={merchantId:f.merchantId,paymentIntentId:intent.id,provider:"synthetic-normal-native",currency:"BRL",plannedGrossCents:breakdown.totalCents,
      plannedPlatformFeeCents:149,plannedMerchantNetCents:breakdown.totalCents-149,plannedProviderFeeCents:0,occurredAt:new Date(),entries:[
        {entryKey:"platform_fee",entryType:"platform_fee",direction:"credit",recipientType:"platform",plannedAmountCents:149},
        {entryKey:"merchant_payout",entryType:"merchant_payout",direction:"credit",recipientType:"merchant",plannedAmountCents:breakdown.totalCents-149}]};
    const admit=()=>payment.saveIntentWithSettlementPlan({intent,settlementPlan,...(s.source?{storefrontCouponScope}:{})});
    return{intent,breakdown,admit};
  }
  for(const source of [true,false]){
    const kind=source?"source":"standalone";
    await check(`normal ${kind} actual coupon AFTER acceptance preserves P, paid options and exact reserve ownership`,async()=>{
      const s=await seed(`${kind}-apply`,source),before=await sourceRow(s),result=await command.executeForCheckout(s.input),row=await reserved(s);
      assert.equal(result.session.cart.total,47);assert.equal(result.session.cart.currentDiscount,1);
      assert.deepEqual(result.session.cart.discountBudget,{version:1,originalSubtotalCents:5000,promotionDiscountCents:300});
      assert.equal(row.sessionId,source?s.cartId:s.scope.sessionId);assert.equal(Number(row.discountApplied),1);
      const event=await prisma.outboxMessage.findFirstOrThrow({where:{merchantId:f.merchantId,eventType:"coupon.applied",payload:{path:["redemption_id"],equals:row.id}}});
      assert.equal(event.payload.reservation_updated_at,row.updatedAt.toISOString());
      const after=await sourceRow(s);if(source){assert.equal(after.total,5000);assert.equal(after.discount,100);assert.deepEqual(after.items,before.items);}
      else assert.deepEqual(after,before);
      const{intent,admit}=await makeIntent(s);await admit();const journal=await prisma.paymentIntent.findUniqueOrThrow({where:{id:intent.id}});
      assert.equal(journal.amountCents,5649);assert.equal(journal.creation.normalCrossSellAuthority.amountBreakdown.discountCents,100);
      if(source){assert.equal(journal.creation.couponAuthority.redemptionId,row.id);assert.equal(journal.creation.normalCrossSellAuthority.discountOwner,undefined);}
      else{assert.equal(journal.creation.couponAuthority,undefined);assert.equal(journal.creation.normalCrossSellAuthority.discountOwner.redemptionId,row.id);}
      intent.claimCreation("first-send",new Date());await payment.saveIntent({intent});
      assert.deepEqual((await prisma.paymentIntent.findUniqueOrThrow({where:{id:intent.id}})).creation.normalCrossSellAuthority,journal.creation.normalCrossSellAuthority);
    });
    await check(`normal ${kind} coupon failure in checkout CAS rolls source/reservation/outbox back`,async()=>{
      const s=await seed(`${kind}-rollback`,source),beforeSession=await sessionRow(s),beforeSource=await sourceRow(s);
      const constraint=`synthetic_couponafter_${kind}`;
      // Exact owned synthetic identity, not arbitrary shell/production SQL.
      assert.equal(beforeSession.version,s.input.expectedVersion);
      await prisma.$executeRawUnsafe(`ALTER TABLE checkout_sessions ADD CONSTRAINT ${constraint} CHECK (NOT (session_id='${s.scope.sessionId}' AND version>${beforeSession.version}))`);
      try{await assert.rejects(command.executeForCheckout(s.input));}
      finally{await prisma.$executeRawUnsafe(`ALTER TABLE checkout_sessions DROP CONSTRAINT ${constraint}`);}
      assert.deepEqual(await sessionRow(s),beforeSession);assert.deepEqual(await sourceRow(s),beforeSource);
      assert.equal(await prisma.couponRedemption.count({where:{merchantId:f.merchantId,sessionId:source?s.cartId:s.scope.sessionId}}),0);
      assert.equal(await prisma.outboxMessage.count({where:{merchantId:f.merchantId,eventType:"coupon.applied",payload:{path:["session_id"],equals:source?s.cartId:s.scope.sessionId}}}),0);
    });
    await check(`normal ${kind} concurrent coupon commands reserve once under actual version fences`,async()=>{
      const s=await seed(`${kind}-race`,source),outcomes=await Promise.allSettled([command.executeForCheckout(s.input),command.executeForCheckout(s.input)]);
      assert.equal(outcomes.filter(result=>result.status==="fulfilled").length,1);
      assert.equal(await prisma.couponRedemption.count({where:{merchantId:f.merchantId,sessionId:source?s.cartId:s.scope.sessionId}}),1);
      assert.equal((await sessionRow(s)).version,s.input.expectedVersion+1);
    });
  }
  await check("normal standalone approved coupon order consumes actual frozen reference once, not live catalog eligibility",async()=>{
    const s=await seed("standalone-paid",false);await command.executeForCheckout(s.input);
    const{intent,breakdown,admit}=await makeIntent(s);await admit();intent.claimCreation("send",new Date());await payment.saveIntent({intent});
    intent.completeCreation("send");const provider=`${s.scope.sessionId}-provider`;
    intent.markApproved({providerPaymentId:provider,approvedAmountCents:breakdown.totalCents});await payment.saveIntent({intent});
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=901 WHERE variant_id=${f.ids.a}`;
    try{await complete.executePaymentApproval({merchant_id:f.merchantId,session_id:s.scope.sessionId,external_order_id:provider,
      order_total:55,currency:"BRL"},intent.id);}finally{await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=900 WHERE variant_id=${f.ids.a}`;}
    const source=await prisma.outboxMessage.findFirstOrThrow({where:{merchantId:f.merchantId,eventType:"order.completed",payload:{path:["session_id"],equals:s.scope.sessionId}}});
    assert.equal(source.payload.normal_coupon_owner.redemptionId,(await reserved(s)).id);
    const consumer=new PrismaBoundCouponRedemption(prisma),before=await prisma.coupon.findUniqueOrThrow({where:{id:couponId}});
    await consumer.redeem({merchantId:f.merchantId,eventId:source.eventId});await consumer.redeem({merchantId:f.merchantId,eventId:source.eventId});
    assert.equal((await reserved(s)).status,"redeemed");assert.equal((await reserved(s)).orderId,provider);
    assert.equal((await prisma.coupon.findUniqueOrThrow({where:{id:couponId}})).usagesCount,before.usagesCount+1);
  });
  await check("normal standalone coupon first-send rejects a changed actual reservation generation without altering journal",async()=>{
    const s=await seed("standalone-generation",false);await command.executeForCheckout(s.input);const{intent,admit}=await makeIntent(s);await admit();
    const before=await prisma.paymentIntent.findUniqueOrThrow({where:{id:intent.id}}),row=await reserved(s);
    await prisma.couponRedemption.update({where:{id:row.id},data:{updatedAt:new Date(row.updatedAt.getTime()+1000)},select:{id:true}});
    intent.claimCreation("changed-generation",new Date());await assert.rejects(payment.saveIntent({intent}));
    assert.deepEqual(await prisma.paymentIntent.findUniqueOrThrow({where:{id:intent.id}}),before);
  });
  await check("normal coupon lost COMMIT ACK is observed through existing state without automatic reapplication",async()=>{
    const s=await seed("standalone-lost-ack",false);let lose=true;
    const wrapped=new Proxy(prisma,{get(target,key){if(key==="$transaction")return async(...args)=>{const result=await target.$transaction(...args);
      if(lose){lose=false;throw Error("synthetic_couponafter_commit_ack_unknown");}return result;};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
    await assert.rejects(commandFor(wrapped).executeForCheckout(s.input),/synthetic_couponafter_commit_ack_unknown/);
    assert.equal((await f.adapter.read(s.scope)).cart.currentDiscount,1);assert.equal((await reserved(s)).status,"applied");
    assert.equal(await prisma.couponRedemption.count({where:{merchantId:f.merchantId,sessionId:s.scope.sessionId}}),1);
    await assert.rejects(command.executeForCheckout(s.input));assert.equal((await sessionRow(s)).version,s.input.expectedVersion+1);
  });
  for(const historical of [false,true])for(const source of [false,true])await check(`normal ${source?"source":"standalone"} coupon after removing all targets retains ${historical?"historical P200 and ":""}actual owner through first send and frozen order`,async()=>{
    const s=await seed(`${source?"source":"standalone"}-remove-targets${historical?"-historical":""}`,source,historical);await command.executeForCheckout(s.input);
    const before=await sessionRow(s),row=await reserved(s);
    if(historical){
      const beforeSource=await sourceRow(s);
      await assert.rejects(f.adapter.updateCart(s.scope,{expectedVersion:before.version,items:[{sku:f.sku.a,quantity:0},{sku:f.sku.b,quantity:0},{sku:f.sku.trigger,quantity:2}]}),{code:"cross_sell_quote_review_required"});
      assert.deepEqual(await sessionRow(s),before);assert.deepEqual(await sourceRow(s),beforeSource);assert.deepEqual(await reserved(s),row);
    }
    const current=await f.adapter.updateCart(s.scope,{expectedVersion:before.version,items:[{sku:f.sku.a,quantity:0},{sku:f.sku.b,quantity:0}]});
    assert.equal(current.cart.items.length,1);assert.equal(current.cart.items[0].sku,f.sku.trigger);
    assert.equal(current.cart.items.some(item=>item.crossSellIntent!==undefined),false);
    assert.equal(current.cart.total,historical?18:20);assert.equal(current.cart.currentDiscount,1);
    if(historical)assert.equal(current.cart.items[0].originalPrice,20);
    assert.deepEqual(await reserved(s),row,"removing targets must not donate or recreate coupon ownership");
    const{intent,admit,breakdown}=await makeIntent(s);
    if(historical){
      const rule=await prisma.merchantRule.findUniqueOrThrow({where:{merchantId:f.merchantId},select:{maxDiscountPercent:true}}),stable=await sessionRow(s),stableSource=await sourceRow(s);
      await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=10 WHERE merchant_id=${f.merchantId}`;
      try{
        await assert.rejects(admit);assert.equal(await prisma.paymentIntent.count({where:{id:intent.id}}),0);
        assert.equal(await prisma.paymentSettlement.count({where:{paymentIntentId:intent.id}}),0);
        assert.deepEqual(await sessionRow(s),stable);assert.deepEqual(await sourceRow(s),stableSource);assert.deepEqual(await reserved(s),row);
      }finally{await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=${rule.maxDiscountPercent} WHERE merchant_id=${f.merchantId}`;}
    }
    await admit();
    const actual=await prisma.paymentIntent.findUniqueOrThrow({where:{id:intent.id}}),authority=actual.creation.normalCrossSellAuthority;
    assert.ok(authority,"actual normal coupon history cannot become an unproved legacy journal");
    const owner=source?actual.creation.couponAuthority:authority.discountOwner;
    if(source){assert.equal(authority.discountOwner,undefined);assert.equal(owner.cartId,s.cartId);}
    else assert.equal(owner.kind,"checkout_coupon");
    assert.equal(owner.redemptionId,row.id);assert.equal(owner.discountCents,100);
    assert.equal(authority.amountBreakdown.itemsSubtotalCents,historical?1800:2000);assert.equal(authority.amountBreakdown.discountCents,100);
    assert.equal(authority.frozenProjection.cart.discountBudget.promotionDiscountCents,historical?200:0);
    assert.equal(authority.frozenProjection.cart.items.some(item=>item.crossSellIntent),false);
    intent.claimCreation("remaining-coupon-send",new Date());await payment.saveIntent({intent});
    assert.deepEqual((await prisma.paymentIntent.findUniqueOrThrow({where:{id:intent.id}})).creation.normalCrossSellAuthority,authority);
    intent.completeCreation("remaining-coupon-send");const provider=`${s.scope.sessionId}-provider`;
    intent.markApproved({providerPaymentId:provider,approvedAmountCents:breakdown.totalCents});await payment.saveIntent({intent});
    await complete.executePaymentApproval({merchant_id:f.merchantId,session_id:s.scope.sessionId,external_order_id:provider,order_total:historical?26:28,currency:"BRL"},intent.id);
    const event=await prisma.outboxMessage.findFirstOrThrow({where:{merchantId:f.merchantId,eventType:"order.completed",payload:{path:["session_id"],equals:s.scope.sessionId}}});
    if(source)assert.equal(event.payload.coupon_authority.redemptionId,row.id);
    else assert.equal(event.payload.normal_coupon_owner.redemptionId,row.id);
    const consumer=new PrismaBoundCouponRedemption(prisma),beforeUsage=await prisma.coupon.findUniqueOrThrow({where:{id:couponId}});
    await consumer.redeem({merchantId:f.merchantId,eventId:event.eventId});await consumer.redeem({merchantId:f.merchantId,eventId:event.eventId});
    assert.equal((await reserved(s)).status,"redeemed");assert.equal((await reserved(s)).orderId,provider);
    assert.equal((await prisma.coupon.findUniqueOrThrow({where:{id:couponId}})).usagesCount,beforeUsage.usagesCount+1);
  });
}
