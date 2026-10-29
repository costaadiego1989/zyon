import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PrismaNormalCheckoutCrossSellAdapter } from "./prisma-normal-checkout-cross-sell.adapter.js";
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import { toProblemDetails } from "../../../../shared/http/problem-details.filter.js";
import { NormalCheckoutCrossSellReviewError, normalCrossSellContextHash } from "./prisma-normal-checkout-cross-sell.authority.js";
import { normalCheckoutFrozenProjectionSchema } from "../../../payment/domain/normal-checkout-payment-authority.schemas.js";
import { normalPaymentAuthorityFixture } from "../../../payment/domain/normal-checkout-payment.fixture.js";
import { readNormalCheckoutSourceProjection } from "../../../../shared/persistence/storefront-normal-checkout-read.js";
import { PrismaStorefrontCrossSellCartAdapter } from "../../../storefront/infrastructure/repositories/prisma-storefront-cross-sell-cart.adapter.js";
import { PrismaStorefrontCartRepository } from "../../../storefront/infrastructure/repositories/prisma-storefront-cart.repository.js";
import { reevaluateCartRules, type CartRulesDependencies } from "../../../storefront/application/services/reevaluate-cart-rules.js";

test("normal stale quote is a public 409 review without private reason", () => {
  const problem = toProblemDetails(new NormalCheckoutCrossSellReviewError("private_catalog_owner_changed"), "synthetic-correlation");
  assert.equal(problem.status, 409);
  assert.equal(problem.code, "cross_sell_quote_review_required");
  assert.equal(problem.detail, "cross_sell_quote_review_required");
  assert.equal(JSON.stringify(problem).includes("private_catalog_owner_changed"), false);
});

const scope = { merchantId: "merchant", sessionId: "session" };
const now = new Date("2026-10-20T12:00:00.000Z");
type TestSource={id:string;merchantId:string;sessionId:string;items:Array<Record<string,unknown>>;total:number;discount:number;
  couponCode:string|null;freeShipping:boolean;createdAt:Date;updatedAt:Date;expiresAt:Date};
function fixture() {
  const state = {
    session: { id: "row", ...scope, globalUserId: "buyer", conversationId: "conversation", version: 0,
      strategyContextVersion: 0, cart: { currency: "BRL" as const, total: 20, currentDiscount: 0,
        items: [{ sku: "TRIGGER", variantId: "trigger", product_id: "p-trigger", name: "Trigger", quantity: 1, price: 20 }] },
      customer: { email: "synthetic@example.test", email_verified: true }, shipping: null, shippingOptions: null,
      abandonmentScore: 0, triggerAgent: false, chatHistory: [], paymentMethod: null, createdAt: now, updatedAt: now },
    suggestion: { id: "suggestion", ...scope, promoId: "promo", status: "pending", rankedItems: ["A", "B"],
      computedDiscount: new Prisma.Decimal(10), suggestedAt: now, resolvedAt: null as Date | null },
    promotion: { id: "promo", merchantId: "merchant", status: "active", updatedAt: now, startsAt: new Date("2026-10-01Z"),
      endsAt: null, recommendedSkus: ["A", "B"], discountPercent: new Prisma.Decimal(10), maxDiscountPercent: new Prisma.Decimal(20),
      trigger: { sku_in_cart: ["TRIGGER"] } },
    cap: 20, activePayment: false, sessionCas: true, suggestionCas: true, failEvent: false, failOutbox: false,strictVersionTrigger:false,
    source:null as TestSource|null,sourceCas:true,lastSessionUpdate:{}as Record<string,unknown>,
    coupon:null as {id:string;merchantId:string;code:string;strategyIncentiveExecutionId:null;discountType:string;discountValue:Prisma.Decimal;minCartTotal:Prisma.Decimal|null;
      maxUsages:number|null;maxPerBuyer:number|null;usagesCount:number;allowedSkus:string[];blockedSkus:string[];allowedRegions:string[];blockedRegions:string[];
      status:string;startsAt:Date;endsAt:Date|null;createdAt:Date;updatedAt:Date}|null,
    reservation:null as {id:string;merchantId:string;sessionId:string;couponId:string;buyerGlobalUserId:string|null;discountApplied:Prisma.Decimal;status:string;orderId:null}|null,
    reservationCount:1,
    owners:[]as Array<{merchantId:string;sessionId:string;buyerId:string;cartRef:string;binding:unknown}>,
    events: [] as Array<Record<string, unknown>>, outbox: [] as Array<Record<string, unknown>>,
    writes: [] as string[], locks: [] as string[], rows: [
      { id: "trigger", sku: "TRIGGER", base: 2000, metadata: null },
      { id: "a", sku: "A", base: 900, metadata: { optionGroups: [{ id: "size", name: "Size", required: true,
        selectionType: "single", items: [{ id: "large", name: "Large", priceModifierInCents: 100 }] }] } },
      { id: "b", sku: "B", base: 1700, metadata: { optionGroups: [{ id: "color", name: "Color", required: true,
        selectionType: "single", items: [{ id: "blue", name: "Blue", priceModifierInCents: 300 }] }] } },
    ].map(row => ({ id: row.id, productId:`p-${row.id}`,sku: row.sku, isActive: true, price: { variantId: row.id, basePriceInCents: row.base, currency: "BRL" },
      product: { id: `p-${row.id}`, merchantId: "merchant", name: row.sku, type: "physical", isActive: true,
        deletedAt: null, metadata: row.metadata, categoryId: null,updatedAt:now }, stock: [{ quantity: 20, reserved: 0 }] })),
  };
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray) => { const text = sql.join("?"); state.locks.push(text);
      const matchingIntent=state.suggestion.status==="accepted"&&state.session.cart.items.some(item=>{
        const intent=Reflect.get(item,"crossSellIntent");return intent?.promotionId===state.suggestion.promoId&&state.suggestion.rankedItems.includes(item.sku);});
      const normalDurable=state.events.some(event=>String((event.metadata as {acceptance_event_id?:string})?.acceptance_event_id).startsWith("normal_cross_sell_"))
        ||state.outbox.some(row=>(row.payload as {protocol?:string})?.protocol==="normal_checkout_cross_sell_v1");
      return text.includes("normal_checkout_source_read")?[{isolation:"read committed",candidates:state.source&&(matchingIntent||normalDurable)?
        [{merchantId:scope.merchantId,sessionId:scope.sessionId,cartRef:state.source.sessionId}]:[]}]:
        text.includes("current_setting('transaction_isolation')")?[{isolation:"read committed",candidates:state.owners}]:
        text.includes("clock_timestamp") ? [{ now }] : text.includes("FROM merchants") ? [{ id: "merchant" }] :text.includes("FROM coupons")?[{id:"coupon"}]: []; },
    $executeRaw:async(sql:TemplateStringsArray)=>{state.locks.push(sql.join("?"));return 1;},
    storefrontCart:{findUnique:async()=>state.source,updateMany:async({data}:{data:Record<string,unknown>})=>{
      state.writes.push("source");if(!state.sourceCas)return{count:0};Object.assign(state.source!,data);return{count:1};}},
    checkoutSession: { findUnique: async () => structuredClone(state.session), updateMany: async ({ data }: {data: Record<string, unknown>}) => {
      state.writes.push("session"); if (!state.sessionCas) return { count: 0 };
      if(state.strictVersionTrigger&&"version"in data&&data.version!==state.session.version)throw Error("CHECKOUT_SESSION_VERSION_READ_ONLY");
      state.lastSessionUpdate=structuredClone(data);
      state.session = { ...state.session, ...data, version: state.session.version + 1,
        strategyContextVersion: state.session.strategyContextVersion } as typeof state.session; return { count: 1 }; } },
    crossSellSuggestion: { findFirst: async () => state.suggestion,
      findMany: async () => state.suggestion.status === "accepted" ? [state.suggestion] : [],
      updateMany: async ({data}: {data: Record<string, unknown>}) => { state.writes.push("suggestion"); if (!state.suggestionCas) return { count: 0 };
        Object.assign(state.suggestion, data); return { count: 1 }; } },
    crossSellPromotion: { findMany: async () => [state.promotion] },
    merchantRule: { findUnique: async () => ({ merchantId: "merchant", maxDiscountPercent: new Prisma.Decimal(state.cap),minimumMarginPercent:new Prisma.Decimal(0),
      allowFreeShipping:false,allowShippingDiscount:false,allowBonusItem:false,allowStackDiscountAndFreeShipping:false,
      freeShippingMinCartValue:new Prisma.Decimal(0),maxShippingSubsidy:new Prisma.Decimal(0),maxPartialShippingDiscount:new Prisma.Decimal(0),
      offerExpirationMinutes:10,blockedRegions:[],brandVoice:"consultative",couponBoxEnabled:true,autonomousEngineEnabled:true }) },
    checkoutSetting: { findUnique: async () => null },
    promptExperiment:{findMany:async()=>[]},
    productVariant: { findMany: async ({where,select}: {where:{sku?:{in:string[]};id?:{in:string[]};product:unknown};select:Record<string,unknown>}) =>
      state.rows.filter(row => (!where.sku || where.sku.in.includes(row.sku))&&(!where.id||where.id.in.includes(row.id))).map(row => select.price ? row : {id:row.id,sku:row.sku}) },
    productPromotion: { findMany: async () => [] },
    paymentIntent: { findFirst: async () => state.activePayment ? { id: "payment" } : null },
    completedOrder: { findFirst: async () => null }, checkoutChatRequest: { findFirst: async () => null },
    coupon:{findFirst:async()=>state.coupon},
    couponRedemption: { findFirst: async () => null,findMany:async()=>state.reservation?[state.reservation]:[],count:async()=>state.reservationCount }, acceptedOffer:{findFirst:async()=>null}, strategyAssignment: { findUnique: async () => null },
    strategyIncentiveReservation: { findFirst: async () => null },
    checkoutEvent: {findMany:async()=>state.events, findFirst: async ({where}: {where:{metadata?:{path:string[];equals:string}}}) =>
      state.events.find(event => (event.metadata as { acceptance_event_id: string }).acceptance_event_id === where.metadata?.equals) ?? null,
      create: async ({data}:{data:Record<string,unknown>}) => { if(state.failEvent) throw new Error("synthetic_event_failure");
        state.writes.push("event"); state.events.push(data); return data; } },
    outboxMessage: { findMany: async()=>[], findFirst: async ({where}:{where:{eventId:string}}) => state.outbox.find(row => row.eventId === where.eventId) ?? null,
      create: async ({data}:{data:Record<string,unknown>}) => { if(state.failOutbox) throw new Error("synthetic_outbox_failure");
        state.writes.push("outbox"); state.outbox.push(data); return data; } },
  };
  const prisma = { $transaction: async (body:(value: typeof tx)=>unknown) => {
    const before = structuredClone({session:state.session,source:state.source, events:state.events, outbox:state.outbox});
    const suggestion = {...state.suggestion};
    try { return await body(tx); } catch(error) {state.session=before.session;state.source=before.source; state.events=before.events;state.outbox=before.outbox;
      state.suggestion=suggestion; throw error;}
  } } as unknown as PrismaClient;
  return { state, adapter: new PrismaNormalCheckoutCrossSellAdapter(prisma),tx:tx as unknown as Prisma.TransactionClient,prisma };
}
const request = { suggestion_id: "suggestion", targets: [
  { sku: "A", variant_id: "a", quantity: 1, selected_option_item_ids: ["large"] },
  { sku: "B", variant_id: "b", quantity: 1, selected_option_item_ids: ["blue"] },
] };
for (const type of ["digital", "service"] as const) test(`normal actual ${type} batch quotes accepts and reads paid options without physical stock`, async () => {
  const { state, adapter } = fixture();
  for (const row of state.rows) {
    row.product.type = type; row.stock = [];
    if (type === "digital") Reflect.set(row.product, "metadata", { ...(row.product.metadata ?? {}), downloadUrl: "https://example.test/file.pdf" });
  }
  Reflect.set(state.session.cart.items[0]!, "productType", type);
  const quote = await adapter.quote(scope, request); assert.equal(quote.pricing.promotionDiscountCents, 300);
  assert.equal(quote.pricing.payableMerchandiseCents, 4700); assert.deepEqual(state.writes, []);
  await adapter.accept(scope, { suggestion_id: "suggestion", accepted_skus: ["A", "B"], expected_quote: quote });
  const next = await adapter.read(scope); assert.equal(next.cart.total, 47);
  assert.ok(next.cart.items.every(item => item.productType === type && item.fulfillmentStrategy === type));
  assert.equal(next.cart.items.find(item => item.sku === "A")!.price, 9); assert.equal(next.cart.items.find(item => item.sku === "B")!.price, 18);
});
test("normal mixed cart preserves virtual trigger and physical discounted targets", async () => {
  const { state, adapter } = fixture(), digital = state.rows[0]!;
  digital.product.type = "digital"; digital.stock = []; Reflect.set(digital.product, "metadata", { downloadUrl: "https://example.test/file.pdf" });
  Reflect.set(state.session.cart.items[0]!, "productType", "digital");
  const quote = await adapter.quote(scope, request); await adapter.accept(scope, { suggestion_id: "suggestion", accepted_skus: ["A", "B"], expected_quote: quote });
  const next = await adapter.read(scope), trigger=next.cart.items.find(item=>item.sku==="TRIGGER")!;
  assert.equal(trigger.productType, "digital"); assert.equal(trigger.fulfillmentStrategy, "digital");
  assert.ok(next.cart.items.filter(item => item.sku !== "TRIGGER").every(item => item.productType === "physical" && item.fulfillmentStrategy === "carrier"));
  assert.equal(next.cart.total, 47); assert.equal(next.cart.discountBudget!.promotionDiscountCents, 300);
});
for (const fault of ["digital_content", "required_option", "service_agenda", "forged_type", "forged_fulfillment"] as const)
  test(`normal catalog fulfillment ${fault} refuses before acceptance or financial writes`, async () => {
    const { state, adapter } = fixture(), row = state.rows[1]!;
    if (fault === "digital_content") row.product.type = "digital";
    if (fault === "service_agenda") { row.product.type = "service"; Reflect.set(row.product, "metadata", { ...row.product.metadata,
      serviceSchedule: { timeZone: "UTC", durationMinutes: 30, slots: [{ id: "slot", date: "2026-10-21", startTime: "12:00" }] } }); }
    if (fault === "forged_type") Reflect.set(state.session.cart.items[0]!, "productType", "digital");
    if (fault === "forged_fulfillment") Reflect.set(state.session.cart.items[0]!, "fulfillmentStrategy", "digital");
    const input = structuredClone(request); if (fault === "required_option") input.targets[0]!.selected_option_item_ids = [];
    await assert.rejects(adapter.quote(scope, input), error => {
      assert.ok(error instanceof Error); assert.equal(error.message,"cross_sell_quote_review_required");
      const reasons={digital_content:"digital_content_unavailable",service_agenda:"service_slot_required",forged_type:"catalog_type_changed",forged_fulfillment:"fulfillment_changed"};
      if(fault!=="required_option")assert.equal((error as NormalCheckoutCrossSellReviewError).reason,reasons[fault]);return true;
    });
    assert.deepEqual(state.writes, []); assert.equal(state.suggestion.status, "pending");
  });

for(const change of ["type","digital_delivery_configuration"]as const)test(`normal stale displayed quote refuses canonical ${change} change with unchanged price`,async()=>{
  const{state,adapter}=fixture(),row=state.rows[1]!;
  if(change==="digital_delivery_configuration"){
    row.product.type="digital";Reflect.set(row.product,"metadata",{...row.product.metadata,downloadUrl:"https://example.test/file-one.pdf"});}
  const quote=await adapter.quote(scope,request);
  if(change==="type")row.product.type="digital";
  Reflect.set(row.product,"metadata",{...row.product.metadata,downloadUrl:"https://example.test/file-two.pdf"});
  row.product.updatedAt=new Date(now.getTime()+1000);
  const fresh=await adapter.quote(scope,request);assert.deepEqual(fresh.pricing,quote.pricing);assert.notEqual(fresh.basisHash,quote.basisHash);
  await assert.rejects(adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote}),
    {code:"cross_sell_quote_review_required",reason:"quote_changed"});
  assert.deepEqual(state.writes,[]);assert.equal(state.suggestion.status,"pending");assert.equal(state.session.cart.total,20);
});

test("normal accept and mutation leave checkout version to the real DB trigger and verify the increment",async()=>{
  const{state,adapter}=fixture();state.strictVersionTrigger=true;
  const quote=await adapter.quote(scope,request),ack=await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  assert.equal(ack.persistenceVersion,1);assert.equal(state.session.version,1);
  const next=await adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0}]});
  assert.equal(next.persistenceVersion,2);assert.equal(state.session.version,2);
});

test("normal accept leaves strategy context DB-owned and unchanged without an assignment",async()=>{
  const{state,adapter}=fixture();state.session.strategyContextVersion=7;
  const quote=await adapter.quote(scope,request),ack=await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  assert.equal(ack.persistenceVersion,1);assert.equal(state.session.version,1);
  assert.equal(state.session.strategyContextVersion,7);
  assert.equal("strategyContextVersion"in state.lastSessionUpdate,false,"normal writer must not SET the independently DB-owned strategy context");
});

test("normal cart mutation leaves strategy context DB-owned while checkout version advances",async()=>{
  const{state,adapter}=fixture();state.session.strategyContextVersion=7;
  const quote=await adapter.quote(scope,request);await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  const next=await adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0}]});
  assert.equal(next.persistenceVersion,2);assert.equal(state.session.version,2);
  assert.equal(state.session.strategyContextVersion,7);
  assert.equal("strategyContextVersion"in state.lastSessionUpdate,false,"normal writer must not SET the independently DB-owned strategy context");
});

test("public quote context never hashes OTP challenges, delivery receipts or unlisted customer secrets", () => {
  const {state}=fixture(),before=normalCrossSellContextHash(state.session);
  Object.assign(state.session.customer,{otp_code:"123456",phone_otp_code:"654321",otp_expires_at:"2026-10-20T12:10:00Z",
    otp_delivery_id:"private-delivery",otp_delivery_email:"private-email",internal_secret:"private-canary"});
  assert.equal(normalCrossSellContextHash(state.session),before);
  Object.assign(state.session.customer,{otp_code:"999999",phone_otp_code:"111111",otp_expires_at:"2026-10-20T12:20:00Z"});
  assert.equal(normalCrossSellContextHash(state.session),before);
});
test("challenge replacement still invalidates quotes by persisted version, not by a brute-forceable OTP digest", () => {
  const {state}=fixture(),before=normalCrossSellContextHash(state.session);
  state.session.version++;
  assert.notEqual(normalCrossSellContextHash(state.session),before);
});
test("public context remains bound to actual buyer, address, cart and verified identity fields", () => {
  for(const mode of ["buyer","address","email","verification","cart"]){const {state}=fixture(),before=normalCrossSellContextHash(state.session);
    if(mode==="buyer")state.session.globalUserId="different-buyer";
    if(mode==="address")Reflect.set(state.session.customer,"address",{zip:"01310000",city:"Sao Paulo",state:"SP"});
    if(mode==="email")state.session.customer.email="different@example.test";
    if(mode==="verification")state.session.customer.email_verified=false;
    if(mode==="cart")state.session.cart.total=21;
    assert.notEqual(normalCrossSellContextHash(state.session),before);}
});
test("actual normal session quotes a paid-option batch without persistence", async () => {
  const {state,adapter}=fixture(); const quote=await adapter.quote(scope,request);
  assert.equal(quote.pricing.originalSubtotalCents,5000); assert.equal(quote.pricing.promotionDiscountCents,300);
  assert.deepEqual(quote.pricing.targets.map(line=>line.maximumUnitPriceCents),[900,1800]); assert.deepEqual(state.writes,[]);
});
test("batch accept commits effective/original/V1 and technical evidence atomically; read never discounts twice", async () => {
  const {state,adapter}=fixture(), quote=await adapter.quote(scope,request);
  const ack=await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  assert.equal(ack.persistenceVersion,1);assert.equal(state.session.cart.total,47);
  assert.deepEqual(state.writes,["suggestion","session","event","outbox"]);
  const session=await adapter.read(scope);assert.equal(session.cart.total,47);assert.equal(session.cart.discountBudget?.promotionDiscountCents,300);
  assert.equal((await adapter.read(scope)).cart.total,47); assert.equal(state.session.customer.email_verified,true);
});

test("normal acceptance extends the existing accepted-event v1 payload without dropping its public fields", async () => {
  const {state,adapter}=fixture(),quote=await adapter.quote(scope,request);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["B","A"],expected_quote:quote});
  const payload=state.outbox[0]!.payload;
  assert.ok(payload&&typeof payload==="object");
  for(const [key,value] of Object.entries({session_id:"session",suggestion_id:"suggestion",promo_id:"promo",accepted_skus:["A","B"],computed_discount:10}))
    assert.deepEqual(Reflect.get(payload,key),value);
});

for(const [field,value] of Object.entries({session_id:"foreign-session",suggestion_id:"foreign-suggestion",promo_id:"foreign-promo",accepted_skus:["A"],computed_discount:11}))
test(`altered accepted-event compatibility field ${field} cannot authorize reading or replay`,async()=>{
  const {state,adapter}=fixture(),quote=await adapter.quote(scope,request),body={suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote};
  await adapter.accept(scope,body);
  const payload=state.outbox[0]!.payload;assert.ok(payload&&typeof payload==="object");Reflect.set(payload,field,value);
  await assert.rejects(adapter.read(scope),{code:"cross_sell_quote_review_required"});
  await assert.rejects(adapter.accept(scope,body),{code:"cross_sell_quote_review_required"});
});
test("lost ACK reconciles durable event without rerunning catalog or adding lines", async () => {
  const {state,adapter}=fixture(),quote=await adapter.quote(scope,request), body={suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote};
  const ack=await adapter.accept(scope,body);state.rows=[];
  assert.deepEqual(await adapter.accept(scope,body),ack); assert.equal(state.writes.length,4);
});
for(const reason of ["sessionCas","suggestionCas","failEvent","failOutbox"] as const) test(`rollback on ${reason} preserves all prices/status/evidence`,async()=>{
  const {state,adapter}=fixture(),quote=await adapter.quote(scope,request),before=structuredClone(state.session);
  state[reason]=reason.startsWith("fail");
  await assert.rejects(adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote}),
    reason.startsWith("fail")?new RegExp(`synthetic_${reason==="failEvent"?"event":"outbox"}_failure`):{code:"cross_sell_quote_review_required",reason:reason==="sessionCas"?"session_changed":"suggestion_changed"});
  assert.deepEqual(state.session,before);assert.equal(state.suggestion.status,"pending");assert.equal(state.events.length,0);assert.equal(state.outbox.length,0);
});
test("stale displayed quote, foreign scope and active payment refuse without writes",async()=>{
  for(const mode of ["stale","tenant","payment"]){const{state,adapter}=fixture(),quote=await adapter.quote(scope,request);
    if(mode==="stale")state.rows[1]!.price.basePriceInCents++;
    if(mode==="payment")state.activePayment=true;
    await assert.rejects(adapter.accept(mode==="tenant"?{...scope,merchantId:"foreign"}:scope,
      {suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote}),{code:"cross_sell_quote_review_required"});assert.deepEqual(state.writes,[]);}
});
test("accepted JSON without actual accepted event cannot authorize normal read",async()=>{
  const{state,adapter}=fixture(),quote=await adapter.quote(scope,request);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});state.outbox=[];
  await assert.rejects(adapter.read(scope),{code:"cross_sell_quote_review_required"});
});
test("removing external trigger after acceptance requires review, not target self-qualification",async()=>{
  const{state,adapter}=fixture(),quote=await adapter.quote(scope,request);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  state.session.cart.items=state.session.cart.items.filter(line=>line.sku!=="TRIGGER");state.session.cart.total=27;
  await assert.rejects(adapter.read(scope),{code:"cross_sell_quote_review_required"});
});
test("a batch sibling remains excluded when an external OR-trigger later disappears",async()=>{
  const{state,adapter}=fixture();state.promotion.trigger.sku_in_cart=["TRIGGER","A","B"];
  const quote=await adapter.quote(scope,request);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  state.session.cart.items=state.session.cart.items.filter(line=>line.sku!=="TRIGGER");state.session.cart.total=27;
  await assert.rejects(adapter.read(scope),{code:"cross_sell_quote_review_required",reason:"trigger_not_met"});
});
test("reordered target selection has one canonical basis and accepts the exact shown quote",async()=>{
  const{adapter}=fixture();const first=await adapter.quote(scope,request),reversed=await adapter.quote(scope,{...request,targets:[...request.targets].reverse()});
  assert.deepEqual(reversed,first);
  assert.equal((await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["B","A"],expected_quote:reversed})).status,"accepted");
});
test("pending acceptance conflicts with a changed quote instead of donating the durable ACK",async()=>{
  const{adapter}=fixture(),quote=await adapter.quote(scope,request),body={suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote};
  await adapter.accept(scope,body);const changed=structuredClone(body);changed.expected_quote.contextHash="a".repeat(64);
  await assert.rejects(adapter.accept(scope,changed),{code:"cross_sell_quote_review_required",reason:"request_conflict"});
});
test("canonical option requirement and maximum cardinality are not inferred from model choices",async()=>{
  for(const mode of ["missing","unknown","minimum"]){const{state,adapter}=fixture(),body=structuredClone(request);
    if(mode==="missing")body.targets[0]!.selected_option_item_ids=[];
    if(mode==="unknown")body.targets[0]!.selected_option_item_ids=["invented"];
    if(mode==="minimum"){const group=state.rows[1]!.product.metadata!.optionGroups[0]!;
      Reflect.set(group,"selectionType","multiple");Reflect.set(group,"minSelections",2);Reflect.set(group,"maxSelections",2);
      group.items.push({id:"second",name:"Second",priceModifierInCents:100});}
    await assert.rejects(adapter.quote(scope,body),{code:"cross_sell_quote_review_required"});assert.deepEqual(state.writes,[]);}
});
test("same variant with different option lines uses aggregate actual stock and atomic batch pricing",async()=>{
  const{state,adapter}=fixture(),group=state.rows[1]!.product.metadata!.optionGroups[0]!;
  group.items.push({id:"small",name:"Small",priceModifierInCents:200});
  const body={suggestion_id:"suggestion",targets:[request.targets[0]!,{sku:"A",variant_id:"a",quantity:1,selected_option_item_ids:["small"]}]};
  const quote=await adapter.quote(scope,body);assert.equal(quote.pricing.targets.length,2);
  state.rows[1]!.stock[0]!.quantity=1;
  await assert.rejects(adapter.quote(scope,body),{code:"cross_sell_quote_review_required",reason:"stock_unavailable"});
});
test("ambiguous exact SKU, malformed metadata and inactive catalog cannot silently fall back",async()=>{
  for(const mode of ["ambiguous","metadata","inactive"]){const{state,adapter}=fixture();
    if(mode==="ambiguous")state.rows.push({...structuredClone(state.rows[1]!),id:"other"});
    if(mode==="metadata")Reflect.set(state.rows[1]!.product,"metadata",{optionGroups:"invalid"});
    if(mode==="inactive")state.rows[1]!.isActive=false;
    await assert.rejects(adapter.quote(scope,request),{code:"cross_sell_quote_review_required"});assert.deepEqual(state.writes,[]);}
});
test("standalone reader does not adopt source cart, coupon ownership, private receipt or body money",async()=>{
  for(const patch of [{source:"storefront",cart_ref:"foreign"},{_storefrontCouponBinding:{}},{_widgetCrossSellAcceptance:{}},{currentDiscount:1}]){
    const{state,adapter}=fixture();Object.assign(state.session.cart,patch);
    await assert.rejects(adapter.quote(scope,request),{code:"cross_sell_quote_review_required"});assert.deepEqual(state.writes,[]);}
});
test("preserved old quantities consume P0 once and a new batch shares the company cap",async()=>{
  const{state,adapter}=fixture();state.session.cart.items[0]!.price=18;state.session.cart.total=18;
  const quote=await adapter.quote(scope,request);assert.equal(quote.pricing.preservedSavingsCents,200);
  assert.equal(quote.pricing.promotionDiscountCents,500);assert.equal(quote.pricing.merchandiseSubtotalCents,4500);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  assert.equal((await adapter.read(scope)).cart.total,45);
});
test("cap exact warning is financial output, while missing cost is never a gate",async()=>{
  const{state,adapter}=fixture();state.cap=4;
  const quote=await adapter.quote(scope,request);assert.equal(quote.pricing.promotionDiscountCents,200);
  assert.equal(quote.pricing.notice,"discount_limit_reached");assert.equal(quote.pricing.remainingDiscountCents,0);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  assert.equal((await adapter.read(scope)).cart.commercialNotices?.[0]?.code,"discount_limit_reached");
});
test("accepted quantity extension, donated buyer and event scope mismatch never reauthorize",async()=>{
  for(const mode of ["quantity","buyer","event"]){const{state,adapter}=fixture(),quote=await adapter.quote(scope,request);
    await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
    if(mode==="quantity"){state.session.cart.items.find(item=>item.sku==="A")!.quantity=2;state.session.cart.total=56;}
    if(mode==="buyer")state.session.globalUserId="foreign-buyer";
    if(mode==="event")state.events[0]!.merchantId="foreign";
    await assert.rejects(adapter.read(scope),{code:"cross_sell_quote_review_required"});}
});
test("expected session is a concurrency precondition, not a body-authored price source",async()=>{
  const{adapter}=fixture(),quote=await adapter.quote(scope,request);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  const session=await adapter.read(scope);assert.equal((await adapter.read(scope,session)).cart.total,47);
  session.cart.items[0]!.price=0;
  await assert.rejects(adapter.read(scope,session),{code:"cross_sell_quote_review_required",reason:"snapshot_changed"});
});
async function acceptedFixture(){const result=fixture(),quote=await result.adapter.quote(scope,request);
  await result.adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});return result;}
test("normal quantity removal is revalidated and committed with shipping invalidation in one transaction",async()=>{
  const{state,adapter}=await acceptedFixture();Reflect.set(state.session,"shipping",{carrier:"own_delivery_flat",customerPrice:5,method:"Entrega"});
  const next=await adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0}]});
  assert.equal(next.cart.total,38);assert.equal(next.cart.items.length,2);assert.equal(next.shipping,undefined);assert.equal(next.persistenceVersion,2);
  assert.equal((await adapter.read(scope)).cart.total,38);assert.equal(state.events.length,2);
});
test("removing all accepted targets returns normal canonical cart without inventing a new intent",async()=>{
  const{adapter}=await acceptedFixture();const next=await adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0},{sku:"B",quantity:0}]});
  assert.equal(next.cart.total,20);assert.equal(next.cart.discountBudget?.promotionDiscountCents,0);
  assert.equal(next.cart.items.some(item=>item.crossSellIntent!==undefined),false);
});
test("removing the final cart item commits empty cart and zero money rather than a fabricated target",async()=>{
  const{state,adapter}=await acceptedFixture();const next=await adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0},{sku:"B",quantity:0},{sku:"TRIGGER",quantity:0}]});
  assert.deepEqual(next.cart.items,[]);assert.equal(next.cart.total,0);assert.equal(next.cart.discountBudget?.promotionDiscountCents,0);
  assert.deepEqual(state.session.cart.items,[]);assert.equal(state.session.cart.total,0);
});
test("retained intent cannot authorize withdrawal of its external trigger",async()=>{
  const{state,adapter}=await acceptedFixture(),before=structuredClone(state.session),writes=state.writes.length;
  await assert.rejects(adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"TRIGGER",quantity:0}]}),{code:"cross_sell_quote_review_required",reason:"trigger_not_met"});
  assert.deepEqual(state.session,before);assert.equal(state.writes.length,writes);
});
test("accepted and preserved quantities cannot expand a saved price, while unchanged retry writes nothing",async()=>{
  const{state,adapter}=await acceptedFixture();const writes=state.writes.length;
  await assert.rejects(adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:2}]}),{code:"cross_sell_quote_review_required",reason:"quantity_exceeds_acceptance"});
  const unchanged=await adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:1}]});
  assert.equal(unchanged.persistenceVersion,1);assert.equal(state.writes.length,writes);
});
test("removal can resolve an unavailable target without authorizing another unit or ignoring remaining stock",async()=>{
  const{state,adapter}=await acceptedFixture();state.rows[1]!.stock[0]!.quantity=0;
  const next=await adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0}]});assert.equal(next.cart.total,38);
});
test("normal mutation stale-version, unknown line and CAS failures never persist partial money",async()=>{
  for(const mode of ["stale","unknown","cas"]){const{state,adapter}=await acceptedFixture(),before=structuredClone(state.session);
    if(mode==="cas")state.sessionCas=false;
    await assert.rejects(adapter.updateCart(scope,{expectedVersion:mode==="stale"?0:1,items:[{sku:mode==="unknown"?"FOREIGN":"A",quantity:0}]}),
      {code:"cross_sell_quote_review_required",reason:mode==="stale"?"snapshot_changed":mode==="unknown"?"line_identity_required":"session_changed"});
    assert.deepEqual(state.session,before);assert.equal(state.events.length,1);}
});
function sourceFixture(){const result=fixture();Reflect.set(result.state.session.cart,"source","storefront");Reflect.set(result.state.session.cart,"cart_ref","actual-cart");
  result.state.source={id:"source-row",merchantId:"merchant",sessionId:"actual-cart",items:[{variantId:"trigger",productId:"p-trigger",sku:"TRIGGER",name:"Trigger",quantity:1,unitPriceCents:2000}],
    total:2000,discount:0,couponCode:null,freeShipping:false,createdAt:now,updatedAt:now,expiresAt:new Date("2026-10-22T12:00:00.000Z")};return result;}

test("plain legacy accepted zero-benefit suggestion without NORMAL intent/durables does not become a NORMAL owner",async()=>{
  const f=sourceFixture();f.state.suggestion.status="accepted";f.state.suggestion.resolvedAt=now;
  f.state.rows[0]!.sku="A";f.state.session.cart.items[0]!.sku="A";f.state.source!.items[0]!.sku="A";
  const before=structuredClone(f.state.source);
  assert.equal(await readNormalCheckoutSourceProjection(f.tx,{merchantId:"merchant",cartId:"actual-cart"}),undefined);
  assert.equal(await new PrismaStorefrontCrossSellCartAdapter(f.prisma).projectNormalSource({merchantId:"merchant",cartId:"actual-cart"}),undefined);
  assert.deepEqual(f.state.source,before);assert.deepEqual(f.state.writes,[]);
});
test("accepted NORMAL-shaped intent without BOTH durable proofs refuses instead of taking the legacy path",async()=>{
  const f=sourceFixture(),quote=await f.adapter.quote(scope,request);
  await f.adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  f.state.events=[];f.state.outbox=[];const writes=f.state.writes.length;
  await assert.rejects(readNormalCheckoutSourceProjection(f.tx,{merchantId:"merchant",cartId:"actual-cart"}),{code:"cross_sell_quote_review_required",reason:"source_invalid"});
  assert.equal(f.state.writes.length,writes);
});

for(const coupon of [false,true])test(`normal source history with ALL targets removed preserves ${coupon?"coupon D":"P0"} through actual GET rules without writes`,async()=>{
  const f=coupon?couponFixture():sourceFixture();
  const quote=await f.adapter.quote(scope,request);
  await f.adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  await f.adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0},{sku:"B",quantity:0}]});
  const before=structuredClone(f.state.source),writes=f.state.writes.length,repo=new PrismaStorefrontCartRepository(f.prisma);
  const base=await repo.getOrCreate("merchant","actual-cart");assert.equal(base.items.some(item=>item.crossSellIntent),false);
  const crossSellCart=new PrismaStorefrontCrossSellCartAdapter(f.prisma);
  const deps={prisma:f.prisma,cartRepo:repo,crossSellCart,
    merchantRepo:{} as CartRulesDependencies["merchantRepo"]};
  const result=await reevaluateCartRules(deps,"merchant","actual-cart",base);
  assert.equal(result.cart.total,2000);assert.equal(result.cart.discount,coupon?100:0);
  assert.equal(result.cart.couponCode,coupon?"SAVE":null);
  assert.equal(f.state.writes.length,writes);assert.deepEqual(f.state.source,before);
});
test("NORMAL source coupon projection compares the exact BASE snapshot without relaxing the legacy V1 quote",async()=>{
  const f=couponFixture(),quote=await f.adapter.quote(scope,request);
  await f.adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  const repo=new PrismaStorefrontCartRepository(f.prisma),adapter=new PrismaStorefrontCrossSellCartAdapter(f.prisma);
  const base=await repo.getOrCreate("merchant","actual-cart"),writes=f.state.writes.length;
  const projected=await adapter.project({merchantId:"merchant",cartId:"actual-cart"},base);
  assert.equal(projected.total,4700);assert.equal(projected.discount,100);assert.equal(projected.couponCode,"SAVE");
  await assert.rejects(adapter.project({merchantId:"merchant",cartId:"actual-cart"},{...base,discount:99}),{message:"storefront_cart_snapshot_conflict"});
  assert.equal(f.state.writes.length,writes);assert.equal(f.state.source!.total,5000);
});

for(const [hostType,targetType]of [["physical","physical"],["digital","digital"],["service","service"],["physical","digital"],["food","food"]]as const)
  test(`trusted source GET ${hostType}/${targetType} reuses actual NORMAL proof before source locks without writes or a second P`,async()=>{
    const f=sourceFixture(),{state,adapter}=f;
    for(const[index,row]of state.rows.entries()){
      const type=index===0?hostType:targetType;row.product.type=type;
      if(type==="digital")Reflect.set(row.product,"metadata",{...(row.product.metadata??{}),downloadUrl:"https://example.test/synthetic.pdf"});
      if(type==="digital"||type==="service")row.stock=[];
    }
    Reflect.set(state.session.cart.items[0]!,"productType",hostType);
    const quote=await adapter.quote(scope,request);
    await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
    const before=structuredClone({source:state.source,session:state.session,events:state.events,outbox:state.outbox}),writes=state.writes.length;
    state.locks.length=0;
    const base=await new PrismaStorefrontCartRepository(f.prisma).getOrCreate("merchant","actual-cart");
    assert.equal(base.total,5000);assert.deepEqual(base.items,state.source!.items);
    const projected=await new PrismaStorefrontCrossSellCartAdapter(f.prisma).project({merchantId:"merchant",cartId:"actual-cart"},base);
    assert.equal(projected.total,4700);assert.equal(projected.discount,0);
    assert.deepEqual(projected.discountBudget,{version:1,originalSubtotalCents:5000,promotionDiscountCents:300});
    assert.equal(projected.items.find(item=>item.sku==="A")!.unitPriceCents,900);
    assert.equal(projected.items.find(item=>item.sku==="A")!.selectedOptions?.[0]!.itemId,"large");
    assert.equal(state.writes.length,writes);
    assert.deepEqual(structuredClone({source:state.source,session:state.session,events:state.events,outbox:state.outbox}),before);
    const checkoutLock=state.locks.findIndex(sql=>sql.includes("FROM checkout_sessions")&&sql.includes("FOR UPDATE"));
    const cartLock=state.locks.findIndex((sql,index)=>index>checkoutLock&&sql.includes("pg_advisory_xact_lock"));
    assert.ok(checkoutLock>=0);assert.ok(cartLock>checkoutLock);
    assert.match(state.locks[0]!,/FROM merchants[\s\S]*FOR UPDATE/);
  });
for(const corruption of ["outbox","event","catalog-type","active-payment"]as const)
  test(`trusted source owner ${corruption} cannot fall back to generic projection or mutate the source`,async()=>{
    const f=sourceFixture(),quote=await f.adapter.quote(scope,request);
    await f.adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
    if(corruption==="outbox")f.state.outbox=[];
    if(corruption==="event")f.state.events=[];
    if(corruption==="catalog-type"){f.state.rows[1]!.product.type="digital";Reflect.set(f.state.rows[1]!.product,"metadata",{downloadUrl:"https://example.test/file.pdf"});}
    if(corruption==="active-payment")f.state.activePayment=true;
    const before=structuredClone(f.state.source),writes=f.state.writes.length;
    await assert.rejects(new PrismaStorefrontCartRepository(f.prisma).getOrCreate("merchant","actual-cart"));
    await assert.rejects(new PrismaStorefrontCrossSellCartAdapter(f.prisma).project({merchantId:"merchant",cartId:"actual-cart"}));
    assert.equal(f.state.writes.length,writes);assert.deepEqual(f.state.source,before);
  });
test("source-backed batch synchronizes actual BASE source and EFFECTIVE checkout atomically without TTL renewal",async()=>{
  const{state,adapter}=sourceFixture(),expiry=state.source!.expiresAt.getTime(),quote=await adapter.quote(scope,request);
  assert.deepEqual(state.writes,[]);assert.equal(quote.pricing.promotionDiscountCents,300);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  assert.deepEqual(state.writes,["suggestion","source","session","event","outbox"]);
  assert.equal(state.source!.total,5000);assert.equal(state.source!.items.length,3);assert.equal(state.source!.expiresAt.getTime(),expiry);
  assert.equal((await adapter.read(scope)).cart.total,47);assert.equal(state.session.cart.total,47);
  assert.equal(state.source!.items.find(item=>item.sku==="A")!.unitPriceCents,1000);
});
test("unbound source changed after checkout start cannot leave a payable stale session",async()=>{
  const{state,adapter}=sourceFixture(),quote=await adapter.quote(scope,request);state.source!.items[0]!.quantity=2;state.source!.total=4000;
  await assert.rejects(adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote}),{code:"cross_sell_quote_review_required",reason:"source_changed"});
  assert.deepEqual(state.writes,[]);assert.equal(state.session.cart.total,20);
});
test("source CAS/session CAS/outbox failure rolls back BOTH source and checkout plus acceptance status",async()=>{
  for(const mode of ["source","session","outbox"]){const{state,adapter}=sourceFixture(),quote=await adapter.quote(scope,request),source=structuredClone(state.source),session=structuredClone(state.session);
    if(mode==="source")state.sourceCas=false;if(mode==="session")state.sessionCas=false;if(mode==="outbox")state.failOutbox=true;
    await assert.rejects(adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote}),mode==="outbox"?/synthetic_outbox_failure/:
      {code:"cross_sell_quote_review_required",reason:mode==="source"?"source_changed":"session_changed"});
    assert.deepEqual(state.source,source);assert.deepEqual(state.session,session);assert.equal(state.suggestion.status,"pending");assert.equal(state.events.length,0);assert.equal(state.outbox.length,0);}
});
test("normal source mutation updates exact real source and checkout in the same transaction",async()=>{
  const{state,adapter}=sourceFixture(),quote=await adapter.quote(scope,request);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  const next=await adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0}]});
  assert.equal(next.cart.total,38);assert.equal(state.source!.total,4000);assert.equal(state.source!.items.length,2);
  assert.equal((await adapter.read(scope)).cart.total,38);
});
test("source legacy savings consume P0 once rather than treating effective source projection as new BASE",async()=>{
  const{state,adapter}=sourceFixture();state.source!.items[0]!.unitPriceCents=1800;state.source!.total=1800;
  state.session.cart.items[0]!.price=18;state.session.cart.total=18;
  const quote=await adapter.quote(scope,request);assert.equal(quote.pricing.preservedSavingsCents,200);assert.equal(quote.pricing.promotionDiscountCents,500);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  assert.equal(state.source!.total,4800);assert.equal((await adapter.read(scope)).cart.total,45);
});
test("foreign source, missing reference, stale price and expired source fail without upsert or writes",async()=>{
  for(const mode of ["foreign","reference","price","expired"]){const{state,adapter}=sourceFixture();
    if(mode==="foreign")state.source!.merchantId="foreign";if(mode==="reference")Reflect.deleteProperty(state.session.cart,"cart_ref");
    if(mode==="price"){state.source!.items[0]!.unitPriceCents=1900;state.source!.total=1900;}
    if(mode==="expired")state.source!.expiresAt=new Date("2026-10-19T12:00:00.000Z");
    await assert.rejects(adapter.quote(scope,request),{code:"cross_sell_quote_review_required"});assert.deepEqual(state.writes,[]);}
});
function couponFixture(){const result=sourceFixture(),{state}=result;state.source!.discount=100;state.source!.couponCode="SAVE";state.session.cart.currentDiscount=1;
  Object.assign(state.session.cart,{commercialNudge:{kind:"coupon",couponCode:"SAVE",discountPercent:5},appliedBenefits:[{kind:"discount",label:"Cupom SAVE",amount:1}]});
  state.coupon={id:"coupon",merchantId:"merchant",code:"SAVE",strategyIncentiveExecutionId:null,discountType:"percent",discountValue:new Prisma.Decimal(10),
    minCartTotal:null,maxUsages:10,maxPerBuyer:1,usagesCount:1,allowedSkus:[],blockedSkus:[],allowedRegions:[],blockedRegions:[],status:"active",
    startsAt:new Date("2020-01-01T00:00:00.000Z"),endsAt:null,createdAt:now,updatedAt:now};
  state.reservation={id:"reservation",merchantId:"merchant",sessionId:"actual-cart",couponId:"coupon",buyerGlobalUserId:"buyer",discountApplied:new Prisma.Decimal(1),status:"applied",orderId:null};
  return result;}

test("actual source reader preserves historical P200 and coupon D100 after removing every target without extending saved quantity",async()=>{
  const{state,adapter}=couponFixture();state.source!.items[0]!.unitPriceCents=1800;state.source!.total=1800;
  state.session.cart.items[0]!.price=18;state.session.cart.total=18;
  const quote=await adapter.quote(scope,request);assert.equal(quote.pricing.preservedSavingsCents,200);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  const before=structuredClone(state.session),sourceBefore=structuredClone(state.source),reserveBefore=JSON.stringify(state.reservation);
  await assert.rejects(adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0},{sku:"B",quantity:0},{sku:"TRIGGER",quantity:2}]}),{code:"cross_sell_quote_review_required"});
  assert.deepEqual(state.session,before);assert.deepEqual(state.source,sourceBefore);assert.equal(JSON.stringify(state.reservation),reserveBefore);
  const current=await adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0},{sku:"B",quantity:0}]});
  assert.equal(current.cart.total,18);assert.equal(current.cart.currentDiscount,1);assert.equal(current.cart.items[0]!.originalPrice,20);
  assert.deepEqual(current.cart.discountBudget,{version:1,originalSubtotalCents:2000,promotionDiscountCents:200});
  assert.equal(current.cart.items.some(item=>item.crossSellIntent),false);assert.equal(JSON.stringify(state.reservation),reserveBefore);
  const stable=structuredClone(state.session);state.cap=10;
  await assert.rejects(adapter.read(scope),{code:"cross_sell_quote_review_required"});assert.deepEqual(state.session,stable);
  state.cap=20;const verified=await adapter.read(scope),f=normalPaymentAuthorityFixture();
  const{commercialNudge:_nudge,appliedBenefits:_benefits,...frozenCart}=verified.cart;
  const projected=normalCheckoutFrozenProjectionSchema.parse({globalUserId:verified.globalUserId,cart:frozenCart,
    shipping:f.authority.frozenProjection.shipping,customer:f.authority.frozenProjection.customer});
  assert.equal(projected.cart.total,18);assert.equal(projected.cart.discountBudget.promotionDiscountCents,200);
});
test("actual source coupon D shares the cap with paid-option batch and never silently increases percent D",async()=>{
  const{state,adapter}=couponFixture();const reservation=state.reservation,quote=await adapter.quote(scope,request);
  assert.equal(quote.pricing.promotionDiscountCents,300);assert.equal(quote.pricing.cartDiscountCents,100);assert.equal(quote.pricing.payableMerchandiseCents,4600);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  assert.equal(state.source!.discount,100);assert.equal(state.source!.couponCode,"SAVE");assert.equal(state.reservation,reservation);
  const next=await adapter.read(scope);assert.equal(next.cart.total,47);assert.equal(next.cart.currentDiscount,1);
  assert.equal(next.cart.appliedBenefits?.[0]?.amount,1);assert.equal(next.cart.commercialNudge?.couponCode,"SAVE");
  assert.notEqual(next.cart.commercialNudge?.discountPercent,5);
});
test("combined source P plus real D reaches the cap with an explicit warning instead of discount loss",async()=>{
  const{state,adapter}=couponFixture();state.cap=8;const quote=await adapter.quote(scope,request);
  assert.equal(quote.pricing.cartDiscountCents,100);assert.equal(quote.pricing.promotionDiscountCents,300);assert.equal(quote.pricing.notice,"discount_limit_reached");
});
test("arbitrary D, foreign buyer, wrong reservation amount/status and exhausted quota cannot become coupon authority",async()=>{
  for(const mode of ["D","buyer","amount","status","quota"]){const{state,adapter}=couponFixture();
    if(mode==="D")state.session.cart.currentDiscount=2;if(mode==="buyer")state.reservation!.buyerGlobalUserId="foreign";
    if(mode==="amount")state.reservation!.discountApplied=new Prisma.Decimal(2);if(mode==="status")state.reservation!.status="cancelled";
    if(mode==="quota")state.reservationCount=2;
    await assert.rejects(adapter.quote(scope,request),{code:"cross_sell_quote_review_required",reason:mode==="D"?"existing_benefit_requires_review":mode==="quota"?"coupon_quota_changed":"coupon_owner_required"});assert.deepEqual(state.writes,[]);assert.equal(state.source!.discount,100);}
});
test("blocked target and ineligible removal cannot retain coupon D without current conditions",async()=>{
  const blocked=couponFixture();blocked.state.coupon!.blockedSkus=["B"];
  await assert.rejects(blocked.adapter.quote(scope,request),{code:"cross_sell_quote_review_required",reason:"coupon_owner_required"});assert.deepEqual(blocked.state.writes,[]);
  const{state,adapter}=couponFixture(),quote=await adapter.quote(scope,request);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});state.coupon!.allowedSkus=["A"];
  const before=structuredClone(state.session),source=structuredClone(state.source);
  await assert.rejects(adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0}]}),{code:"cross_sell_quote_review_required",reason:"coupon_owner_required"});
  assert.deepEqual(state.session,before);assert.deepEqual(state.source,source);assert.equal(state.reservation!.status,"applied");
});
test("eligible source-coupon removal preserves the SAME reservation/D without quota allocation",async()=>{
  const{state,adapter}=couponFixture(),quote=await adapter.quote(scope,request);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  const next=await adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0}]});
  assert.equal(next.cart.total,38);assert.equal(next.cart.currentDiscount,1);assert.equal(state.reservation!.id,"reservation");assert.equal(state.source!.discount,100);
});
test("actual active coupon binding permits only scoped read, never a normal financial mutation",async()=>{
  const{state,adapter}=couponFixture(),quote=await adapter.quote(scope,request);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  const binding={version:1,bindingId:"20000000-0000-4000-8000-000000000001",merchantId:"merchant",checkoutSessionId:"session",cartId:"actual-cart",buyerId:"buyer",reservationBuyerId:"buyer",
    redemptionId:"reservation",couponId:"coupon",discountCents:100,basisHash:paymentCartFingerprint({cart:state.session.cart}),state:"active"};
  Reflect.set(state.session.cart,"_storefrontCouponBinding",binding);
  state.owners=[{...scope,buyerId:"buyer",cartRef:"actual-cart",binding}];const writes=state.writes.length;
  const current=await adapter.read(scope);assert.equal(current.cart.currentDiscount,1);assert.equal("_storefrontCouponBinding"in current.cart,false);
  assert.equal((await adapter.read(scope,current)).cart.total,47);
  await assert.rejects(adapter.updateCart(scope,{expectedVersion:1,items:[{sku:"A",quantity:0}]}),{code:"cross_sell_quote_review_required",reason:"coupon_owner_required"});
  await assert.rejects(adapter.quote(scope,request),{code:"cross_sell_quote_review_required",reason:"coupon_owner_required"});assert.equal(state.writes.length,writes);
});
test("unknown binding owner or an unrelated coupon reservation cannot adopt a source checkout",async()=>{
  const{state,adapter}=couponFixture(),quote=await adapter.quote(scope,request);
  await adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote});
  const binding={version:1,bindingId:"20000000-0000-4000-8000-000000000001",merchantId:"merchant",checkoutSessionId:"session",cartId:"actual-cart",buyerId:"buyer",reservationBuyerId:"buyer",
    redemptionId:"FOREIGN",couponId:"coupon",discountCents:100,basisHash:paymentCartFingerprint({cart:state.session.cart}),state:"active"};
  Reflect.set(state.session.cart,"_storefrontCouponBinding",binding);state.owners=[{...scope,buyerId:"buyer",cartRef:"actual-cart",binding}];
  await assert.rejects(adapter.read(scope),{code:"cross_sell_quote_review_required",reason:"coupon_owner_required"});
});
test("coupon source/session/outbox failure preserves the exact real reservation and both price representations",async()=>{
  for(const mode of ["source","session","outbox"]){const{state,adapter}=couponFixture(),quote=await adapter.quote(scope,request);
    const session=structuredClone(state.session),source=structuredClone(state.source),reservation=state.reservation;
    if(mode==="source")state.sourceCas=false;if(mode==="session")state.sessionCas=false;if(mode==="outbox")state.failOutbox=true;
    await assert.rejects(adapter.accept(scope,{suggestion_id:"suggestion",accepted_skus:["A","B"],expected_quote:quote}),mode==="outbox"?/synthetic_outbox_failure/:
      {code:"cross_sell_quote_review_required",reason:mode==="source"?"source_changed":"session_changed"});
    assert.deepEqual(state.session,session);assert.deepEqual(state.source,source);assert.equal(state.reservation,reservation);assert.equal(state.reservation!.discountApplied.toNumber(),1);
    assert.equal(state.events.length,0);assert.equal(state.outbox.length,0);}
});
