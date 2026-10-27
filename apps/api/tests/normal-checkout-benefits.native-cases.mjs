import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

/** Real owned PG repository/engine/admission/first-send/frozen-order checks.
 * NOT PSP/webhook/HTTP proof. Parent owns schema/worker lifetime and cleanup. */
export async function runNormalCheckoutBenefitsNativeCases({prisma,check,runId}){
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runId}]);
  assert.deepEqual(await prisma.$queryRaw`SELECT tgname FROM pg_trigger WHERE tgrelid='checkout_sessions'::regclass
    AND tgname='checkout_session_write_version_guard' AND NOT tgisinternal AND tgenabled='O'`,
    [{tgname:"checkout_session_write_version_guard"}],"actual_db_owned_checkout_version_trigger_required");
  assert.deepEqual(await prisma.$queryRaw`SELECT tgname FROM pg_trigger WHERE tgrelid='checkout_sessions'::regclass
    AND tgname='strategy_session_context_version_guard' AND NOT tgisinternal AND tgenabled='O'`,
    [{tgname:"strategy_session_context_version_guard"}],"actual_db_owned_strategy_version_trigger_required");
  const {createNormalCrossSellSourceNativeFixture}=await import("./normal-cross-sell-source.native-cases.mjs");
  const f=await createNormalCrossSellSourceNativeFixture({prisma,runId,namespace:"benefits"});
  // Expand only columns actually queried by this policy reader, using the real
  // schema/migration definitions; do not fake absent policy/model properties.
  const settings=await readFile(new URL("../prisma/migrations/20260501133000_checkout_settings_module/migration.sql",import.meta.url),"utf8");
  assert.ok(settings.includes('"intervention_policy" JSONB NOT NULL'));
  await prisma.$executeRawUnsafe(`ALTER TABLE checkout_settings ADD COLUMN intervention_policy JSONB NOT NULL DEFAULT '{}'::jsonb`);
  assert.ok(settings.includes('"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP'));
  assert.ok(settings.includes('"updated_at" TIMESTAMP(3) NOT NULL'));
  await prisma.$executeRawUnsafe(`ALTER TABLE checkout_settings ADD COLUMN created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  // Temporary default backfills the already-owned fixture row only; remove it
  // before runtime commands so Prisma's real @updatedAt contract stays intact.
  await prisma.$executeRawUnsafe(`ALTER TABLE checkout_settings ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await prisma.$executeRawUnsafe(`ALTER TABLE checkout_settings ALTER COLUMN updated_at DROP DEFAULT`);
  const prompts=await readFile(new URL("../prisma/migrations/20260818000000_add_ab_testing_prompts/migration.sql",import.meta.url),"utf8");
  for(const table of ["prompt_experiments","prompt_variants"]){
    const match=prompts.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`));
    assert.ok(match,"exact_prompt_table_declaration_required");await prisma.$executeRawUnsafe(match[0]);
  }
  // Current canonical Prisma model has this nullable reference; its presence
  // is required for a real variant query, not a fabricated updatedAt/version.
  await prisma.$executeRawUnsafe(`ALTER TABLE prompt_variants ADD COLUMN applied_rule_id TEXT`);
  const {readNormalCheckoutCrossSellAuthority}=await import("../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.ts");
  const {projectNormalCrossSellCart}=await import("../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.adapter.ts");
  const {createNormalCrossSellPaymentAdmission}=await import("../src/modules/payment/infrastructure/prisma-normal-cross-sell-payment-admission.ts");
  const {captureStorefrontCouponForPayment}=await import("../src/shared/persistence/storefront-coupon/admission.ts");
  const {PaymentIntentEntity}=await import("../src/modules/payment/domain/payment-intent.entity.ts");
  const {PrismaPaymentRepository}=await import("../src/modules/payment/infrastructure/prisma-payment.repository.ts");
  const {PrismaCheckoutRepository}=await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
  const {PrismaPaymentApprovalReader}=await import("../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.ts");
  const {CompleteOrderUseCase}=await import("../src/modules/checkout/application/use-cases/complete-order.use-case.ts");
  const {paymentCartFingerprint}=await import("../src/modules/checkout/domain/services/payment-cart-fingerprint.ts");
  const {NORMAL_COMMERCIAL_BENEFIT_EVENT,normalCommercialBenefitAuthorizationSchema}=await import("../src/modules/checkout/domain/contracts/normal-commercial-benefit-proof.schemas.ts");
  const {resolveProgressiveDiscountStage}=await import("../src/modules/checkout/domain/services/progressive-discount-policy.service.ts");
  const read=async(tx,scope,options)=>{const current=await readNormalCheckoutCrossSellAuthority(tx,scope,undefined,options);
    return {...current,projectedCart:projectNormalCrossSellCart(current)};};
  const capture=createNormalCrossSellPaymentAdmission(read,()=>149),payment=new PrismaPaymentRepository(prisma,captureStorefrontCouponForPayment,undefined,capture);
  const checkout=new PrismaCheckoutRepository(prisma),complete=new CompleteOrderUseCase(checkout,checkout,checkout,undefined,undefined,undefined,undefined,checkout,
    undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,new PrismaPaymentApprovalReader(prisma));
  const session=s=>prisma.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:s.scope}});
  const grants=s=>prisma.checkoutEvent.findMany({where:{...s.scope,eventName:NORMAL_COMMERCIAL_BENEFIT_EVENT}});
  async function seed(label,{source=true}={}){
    await prisma.checkoutSetting.update({where:{merchantId:f.merchantId},data:{advancedRules:[],interventionPolicy:{progressiveDiscount:{enabled:true,stages:{payment_nudge:15}}}},select:{id:true}});
    await prisma.product.updateMany({where:{merchantId:f.merchantId},data:{categoryId:null}});
    const s=await f.seed(label);
    if(!source){const row=await session(s),{cart_ref:_ref,...cart}=row.cart;
      await prisma.checkoutSession.update({where:{id:row.id},data:{cart:{...cart,source:"checkout"}},select:{id:true}});
      s.quote=await f.adapter.quote(s.scope,s.request);s.acceptance={...s.acceptance,expected_quote:s.quote};}
    await f.adapter.accept(s.scope,s.acceptance);return {...s,version:(await session(s)).version};
  }
  async function offer(s,value=1){
    const id=`${s.scope.sessionId}-offer`;
    await prisma.authorizedOffer.create({data:{id,...s.scope,type:"discount_fixed",value,approved:true,reason:"synthetic approved",
      marginAfterOffer:0,expiresAt:new Date(Date.now()+3600000)},select:{id:true}});
    return{offerId:id,expectedVersion:(await session(s)).version};
  }
  async function intent(s){
    const shipping={customerPrice:9,carrier:"Synthetic carrier",method:"Synthetic delivery",deliveryDays:1,destinationZip:"01310100",region:"SP"};
    await prisma.checkoutSession.update({where:{merchantId_sessionId:s.scope},data:{shipping},select:{id:true}});
    const current=await f.adapter.read(s.scope),subtotal=Math.round(current.cart.total*100),discount=Math.round(current.cart.currentDiscount*100);
    const breakdown={version:1,currency:"BRL",cartFingerprint:paymentCartFingerprint(current),itemsSubtotalCents:subtotal,discountCents:discount,
      shippingCents:900,platformFeeCents:149,totalCents:subtotal-discount+1049};
    const entity=PaymentIntentEntity.create({...s.scope,idempotencyKey:`${s.scope.sessionId}-payment`,amountCents:breakdown.totalCents,currency:"BRL",method:"pix",amountBreakdown:breakdown});
    entity.prepareCreation({...s.scope,intentId:entity.id,amountCents:breakdown.totalCents,currency:"BRL",method:"pix"});return entity;
  }
  for(const source of [true,false])await check(`normal ${source?"source":"standalone"} actual progressive preserves P300+D700 within B5000 cap20 without margin`,async()=>{
    const s=await seed(`policy-${source}`,{source}),sourceBefore=await prisma.storefrontCart.findUniqueOrThrow({where:{id:s.cartId}});
    let result;
    try{result=await f.adapter.prepareBenefits(s.scope,{expectedVersion:s.version,method:"pix"});}
    catch(error){const reason=Object.getOwnPropertyDescriptor(error,"normalBenefitWriteVerification")?.value;
      const allowed=["row","scope","buyer","version","strategy","cart","method"];
      console.log(JSON.stringify({phase:"normal_benefit_write_verification",reason:allowed.includes(reason)?reason:"not_postwrite_diagnostic"}));throw error;}
    assert.equal(result.session.cart.total,47);assert.equal(result.session.cart.currentDiscount,7);
    assert.deepEqual(result.session.cart.discountBudget,{version:1,originalSubtotalCents:5000,promotionDiscountCents:300});
    const rows=await grants(s);assert.equal(rows.length,1);const grant=normalCommercialBenefitAuthorizationSchema.parse(rows[0].metadata);
    assert.equal(grant.discountCents,700);assert.equal(grant.checkoutVersion,s.version+1);
    const actualContextEvents=await prisma.checkoutEvent.findMany({where:{...s.scope,eventName:{not:NORMAL_COMMERCIAL_BENEFIT_EVENT}},
      orderBy:[{occurredAt:"asc"},{id:"asc"}],select:{id:true,merchantId:true,sessionId:true,eventName:true}});
    assert.deepEqual(actualContextEvents.map(row=>row.eventName),["cross_sell_accepted","payment_method_selected"]);
    assert.ok(actualContextEvents.every(row=>row.merchantId===s.scope.merchantId&&row.sessionId===s.scope.sessionId));
    assert.deepEqual(grant.stageEventIds,actualContextEvents.map(row=>row.id));
    assert.equal(resolveProgressiveDiscountStage("cross_sell_accepted"),null);
    assert.equal(resolveProgressiveDiscountStage("payment_method_selected"),"payment_nudge");
    assert.deepEqual(await prisma.storefrontCart.findUniqueOrThrow({where:{id:s.cartId}}),sourceBefore);
    assert.equal(sourceBefore.discount,0);assert.equal(sourceBefore.couponCode,null);
    assert.equal(await prisma.couponRedemption.count({where:{merchantId:f.merchantId,sessionId:s.cartId,status:{not:"cancelled"}}}),0);
    const entity=await intent(s);await payment.saveIntent({intent:entity});const before=await prisma.paymentIntent.findUniqueOrThrow({where:{id:entity.id}});
    assert.equal(before.creation.couponAuthority,undefined);
    assert.equal(before.creation.normalCrossSellAuthority.discountOwner.kind,"checkout_policy");assert.equal(before.amountCents,5049);
    entity.claimCreation("first",new Date());await payment.saveIntent({intent:entity});
    assert.deepEqual((await prisma.paymentIntent.findUniqueOrThrow({where:{id:entity.id}})).creation.normalCrossSellAuthority,before.creation.normalCrossSellAuthority);
  });
  await check("normal actual accepted offer before method selection captures exact AuthorizedOffer and AcceptedOffer identities",async()=>{
    const s=await seed("offer-proof"),request=await offer(s),result=await f.adapter.applyOffer(s.scope,request);
    assert.equal(result.session.cart.currentDiscount,1);assert.equal(result.offer.id,request.offerId);assert.equal((await session(s)).paymentMethod,null);
    const accepted=await prisma.acceptedOffer.findFirstOrThrow({where:s.scope});
    const grant=normalCommercialBenefitAuthorizationSchema.parse((await grants(s))[0].metadata);
    assert.equal(grant.offer.acceptedOfferRowId,accepted.id);assert.equal(grant.offer.authorizedOfferId,request.offerId);assert.equal(grant.paymentMethod,undefined);
    const entity=await intent(s);await payment.saveIntent({intent:entity});
    const row=await prisma.paymentIntent.findUniqueOrThrow({where:{id:entity.id}});
    assert.equal(row.creation.normalCrossSellAuthority.discountOwner.authorizedOfferId,request.offerId);
    entity.claimCreation("offer-first",new Date());await payment.saveIntent({intent:entity});
  });
  await check("normal fixed offer above remaining company headroom refuses all effects",async()=>{
    const s=await seed("offer-cap"),request=await offer(s,8),before=await session(s);
    await assert.rejects(f.adapter.applyOffer(s.scope,request));assert.deepEqual(await session(s),before);
    assert.equal(await prisma.acceptedOffer.count({where:s.scope}),0);assert.equal((await grants(s)).length,0);
  });
  for(const kind of ["policy","offer"])await check(`normal ${kind} journal fault rolls actual session/stage/acceptance TX back`,async()=>{
    const s=await seed(`${kind}-rollback`),request=kind==="offer"?await offer(s):{expectedVersion:s.version,method:"pix"},before=await session(s);
    const constraint=`synthetic_benefits_${kind}`;
    await prisma.$executeRawUnsafe(`ALTER TABLE checkout_events ADD CONSTRAINT ${constraint} CHECK (NOT (session_id='${s.scope.sessionId}' AND event_name='${NORMAL_COMMERCIAL_BENEFIT_EVENT}'))`);
    try{await assert.rejects(kind==="offer"?f.adapter.applyOffer(s.scope,request):f.adapter.prepareBenefits(s.scope,request));}
    finally{await prisma.$executeRawUnsafe(`ALTER TABLE checkout_events DROP CONSTRAINT ${constraint}`);}
    assert.deepEqual(await session(s),before);assert.equal(await prisma.acceptedOffer.count({where:s.scope}),0);assert.equal((await grants(s)).length,0);
    assert.equal(await prisma.checkoutEvent.count({where:{...s.scope,eventName:"payment_method_selected"}}),0);
  });
  for(const kind of ["policy","offer"])await check(`normal ${kind} first-send rereads current terms and refuses drift before lease commit`,async()=>{
    const s=await seed(`${kind}-drift`),request=kind==="offer"?await offer(s):{expectedVersion:s.version,method:"pix"};
    await(kind==="offer"?f.adapter.applyOffer(s.scope,request):f.adapter.prepareBenefits(s.scope,request));
    const entity=await intent(s);await payment.saveIntent({intent:entity});const before=await prisma.paymentIntent.findUniqueOrThrow({where:{id:entity.id}});
    if(kind==="offer")await prisma.authorizedOffer.update({where:{id:request.offerId},data:{value:2},select:{id:true}});
    else await prisma.checkoutSetting.update({where:{merchantId:f.merchantId},data:{interventionPolicy:{progressiveDiscount:{enabled:false}}},select:{id:true}});
    entity.claimCreation("stale-first",new Date());await assert.rejects(payment.saveIntent({intent:entity}));
    assert.deepEqual(await prisma.paymentIntent.findUniqueOrThrow({where:{id:entity.id}}),before);
  });
  await check("normal duplicate preparation at one version commits one exact D and grant",async()=>{
    const s=await seed("policy-race"),results=await Promise.allSettled([f.adapter.prepareBenefits(s.scope,{expectedVersion:s.version,method:"pix"}),f.adapter.prepareBenefits(s.scope,{expectedVersion:s.version,method:"pix"})]);
    assert.equal(results.filter(result=>result.status==="fulfilled").length,1);assert.equal((await grants(s)).length,1);
    assert.equal((await session(s)).version,s.version+1);assert.equal((await f.adapter.read(s.scope)).cart.currentDiscount,7);
  });
  await check("normal current category rule is actual catalog provenance, not a stored category hint",async()=>{
    const s=await seed("category-policy");
    const category=await prisma.productCategory.create({data:{id:"synthetic-normal-benefits-category",merchantId:f.merchantId,
      name:"Synthetic canonical category",slug:"normal-benefits-category"},select:{id:true,merchantId:true}});
    assert.equal(category.merchantId,f.merchantId);
    await prisma.product.updateMany({where:{merchantId:f.merchantId},data:{categoryId:category.id}});
    await prisma.checkoutSetting.update({where:{merchantId:f.merchantId},data:{interventionPolicy:{progressiveDiscount:{enabled:false}},advancedRules:[{
      id:"category-rule",enabled:true,priority:1,conditions:[{field:"category_in_cart",operator:"contains",value:category.id}],action:{type:"offer_discount",params:{percent:5}}}]},select:{id:true}});
    assert.equal((await f.adapter.prepareBenefits(s.scope,{expectedVersion:s.version,method:"card"})).session.cart.currentDiscount,2.35);
    assert.equal((await f.adapter.read(s.scope)).cart.currentDiscount,2.35);
    await prisma.product.updateMany({where:{merchantId:f.merchantId},data:{categoryId:null}});await assert.rejects(f.adapter.read(s.scope));
  });
  await check("normal uncertain recovery does not reprice or reauthorize policy after first external-send boundary",async()=>{
    const s=await seed("policy-unknown");await f.adapter.prepareBenefits(s.scope,{expectedVersion:s.version,method:"pix"});const entity=await intent(s);
    await payment.saveIntent({intent:entity});entity.claimCreation("sent",new Date());await payment.saveIntent({intent:entity});
    entity.markCreationUncertain("sent","synthetic_lost_ack");await payment.saveIntent({intent:entity});
    const before=(await prisma.paymentIntent.findUniqueOrThrow({where:{id:entity.id}})).creation.normalCrossSellAuthority;
    await prisma.checkoutSetting.update({where:{merchantId:f.merchantId},data:{interventionPolicy:{progressiveDiscount:{enabled:false}}},select:{id:true}});
    assert.equal(entity.claimCreation("recover",new Date(Date.now()+120000)),"recover");await payment.saveIntent({intent:entity});
    assert.deepEqual((await prisma.paymentIntent.findUniqueOrThrow({where:{id:entity.id}})).creation.normalCrossSellAuthority,before);
  });
  await check("normal paid explicit offer settles exact frozen D despite later offer/catalog drift",async()=>{
    const s=await seed("offer-frozen"),request=await offer(s);await f.adapter.applyOffer(s.scope,request);const entity=await intent(s);
    await payment.saveIntent({intent:entity});entity.claimCreation("send",new Date());await payment.saveIntent({intent:entity});entity.completeCreation("send");
    const provider=`${s.scope.sessionId}-synthetic-provider`;entity.markApproved({providerPaymentId:provider,approvedAmountCents:entity.snapshot().amountCents});await payment.saveIntent({intent:entity});
    await prisma.authorizedOffer.update({where:{id:request.offerId},data:{approved:false,value:99},select:{id:true}});
    // Fixture catalog drift through a bound, tenant-scoped SQL update. The
    // reduced owned schema does not claim ProductPrice ORM updatedAt coverage.
    assert.equal(await prisma.$executeRaw`UPDATE product_prices AS price SET base_price_in_cents=9999
      FROM product_variants AS variant JOIN products AS product ON product.id=variant.product_id
      WHERE price.variant_id=variant.id AND variant.id=${f.ids.a} AND product.merchant_id=${f.merchantId}`,1);
    const input={merchant_id:f.merchantId,session_id:s.scope.sessionId,external_order_id:provider,order_total:55,currency:"BRL"};
    assert.equal((await complete.executePaymentApproval(input,entity.id)).idempotent,false);
    const order=await prisma.completedOrder.findFirstOrThrow({where:s.scope});assert.equal(Number(order.orderTotal),55);assert.equal(order.shippingCents,900);
    assert.equal(order.lineItemsJson.reduce((sum,item)=>sum+item.unitPriceCents*item.quantity,0)+order.shippingCents-Math.round(Number(order.orderTotal)*100),100);
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({where:{id:entity.id}})).creation.normalCrossSellAuthority.amountBreakdown.discountCents,100);
    assert.equal((await complete.executePaymentApproval(input,entity.id)).idempotent,true);
  });
}
