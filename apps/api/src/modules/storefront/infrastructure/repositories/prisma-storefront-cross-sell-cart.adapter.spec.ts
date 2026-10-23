import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { PrismaStorefrontCrossSellCartAdapter } from "./prisma-storefront-cross-sell-cart.adapter.js";
import { PrismaStorefrontCartRepository } from "./prisma-storefront-cart.repository.js";

// Explicit serialized delegate fakes prove application control flow, NOT SQL lock
// exclusion/rollback. Root's disposable native window must prove that separately.
const initial = (): StorefrontCart & { expiresAt: Date } => ({ id: "row", merchantId: "merchant", sessionId: "cart", createdAt: new Date(0), updatedAt: new Date(0), expiresAt: new Date("2100-01-01"),
  items: [{ variantId: "host", productId: "product-host", sku: "HOST", name: "Host", quantity: 1, unitPriceCents: 10000 }],
  total: 10000, discount: 0, couponCode: null, freeShipping: false });
const policy = () => ({ merchantId: "merchant", maxDiscountPercent: new Prisma.Decimal(20), minimumMarginPercent: new Prisma.Decimal(10),
  allowFreeShipping: false, allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false,
  freeShippingMinCartValue: new Prisma.Decimal(0), maxShippingSubsidy: new Prisma.Decimal(0), maxPartialShippingDiscount: new Prisma.Decimal(0),
  offerExpirationMinutes: 15, blockedRegions: [], brandVoice: "consultative", couponBoxEnabled: true, autonomousEngineEnabled: true });
const variant = (id: string) => ({ id, sku: id.toUpperCase(), isActive: true,
  product: { id: `product-${id}`, merchantId: "merchant", name: id === "host" ? "Host" : "Target", type: "physical", metadata: {},
    isActive: true, deletedAt: null, categoryId: null },
  price: { variantId: id, currency: "BRL", basePriceInCents: 10000, costInCents: 2000 as number | null }, stock: [{ quantity: 20, reserved: 0 }] });
const promotion = () => ({ id: "promotion", merchantId: "merchant", updatedAt: new Date("2026-10-18T00:00:00.000Z"),
  startsAt: new Date(0), endsAt: new Date("2100-01-01T00:00:00.000Z"), status: "active", recommendedSkus: ["TARGET"],
  discountPercent: new Prisma.Decimal(10), maxDiscountPercent: new Prisma.Decimal(10), trigger: { sku_in_cart: ["HOST"] } });
function project(value: unknown, selection: Record<string, unknown>): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(row => project(row, selection));
  const row = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(selection).map(([key, field]) => [key,
    field === true ? row[key] : project(row[key], (field as { select: Record<string, unknown> }).select)]));
}
function fixture() {
  let stored = initial(), tail = Promise.resolve(); const calls: string[] = [];
  const variants = [variant("host"), variant("target")], rules = policy(), promo = promotion(); let missingPolicy = false;
  let beforeBegin: Promise<void> | undefined, activeReservation = false;
  let failRead = false, readFailure: unknown, failCommit = false, commitFailure: unknown;
  const prisma = { async $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const pending = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; });
    const pause = beforeBegin; beforeBegin = undefined; await pause; await pending; calls.push("begin"); let working = structuredClone(stored);
    const tx = { async $executeRaw() { calls.push("lock"); return 1; },
      async $queryRaw(sql: TemplateStringsArray) {
        const query = sql.join("?");
        if(query.includes("normal_checkout_source_read"))return [{isolation:"read committed",candidates:[]}];
        if (query.includes("FROM merchants")) { calls.push("merchant-fence"); return [{ id: "merchant" }]; }
        if (query.includes("FROM merchant_rules")) { calls.push("rules-fence"); return []; }
        if (query.includes("FROM checkout_settings")) { calls.push("settings-fence"); return []; }
        if (query.includes("FOR SHARE")) { calls.push("authority-row-fence"); return []; }
        return [{ isolation: "read committed", candidates: [] }];
      }, storefrontCart: {
      async findUnique() { calls.push("cart-read"); if (failRead) throw readFailure; return structuredClone(working); },
      async upsert() { calls.push("upsert"); return structuredClone(working); },
      async update(args: { data: Partial<StorefrontCart> }) { calls.push("write"); working = { ...working, ...structuredClone(args.data) }; return structuredClone(working); },
    }, productVariant: {
      async findFirst(args: { where: { id: string }; select: Record<string, unknown> }) { calls.push("catalog"); return project(variants.find(row => row.id === args.where.id), args.select); },
      async findMany(args: { where: { id?: { in: string[] }; sku?: string }; select: Record<string, unknown> }) { calls.push("catalog");
        return project(variants.filter(row => args.where.id ? args.where.id.in.includes(row.id) : row.sku === args.where.sku), args.select); },
    }, crossSellPromotion: {
      async findFirst(args: { select: Record<string, unknown> }) { calls.push("cross"); return project(promo, args.select); },
      async findMany(args: { select: Record<string, unknown> }) { calls.push("cross"); return project([promo], args.select); },
    }, productPromotion: { async findMany() { calls.push("product-promos"); return []; } },
    couponRedemption: { async findFirst() { calls.push("active-reservation"); return activeReservation ? { id: "legacy-reservation" } : null; } },
    merchantRule: { async findUnique(args: { select: Record<string, unknown> }) { calls.push("policy"); return missingPolicy ? null : project(rules, args.select); } },
    checkoutSetting: { async findUnique() { calls.push("settings"); return null; } },
    };
    try { const result = await work(tx as unknown as Prisma.TransactionClient); stored = working; calls.push("commit"); if (failCommit) throw commitFailure; return result; }
    catch (error) { calls.push("rollback"); throw error; } finally { release(); }
  } } as unknown as PrismaClient;
  return { adapter: new PrismaStorefrontCrossSellCartAdapter(prisma), cart: new PrismaStorefrontCartRepository(prisma),
    stored: () => structuredClone(stored), calls, variants, rules, promo, missingPolicy: () => { missingPolicy = true; },
    failRead: (error: unknown) => { failRead = true; readFailure = error; }, failCommit: (error: unknown) => { failCommit = true; commitFailure = error; },
    reserveCoupon: () => { activeReservation = true; },
    mutateStored: (work: (cart: StorefrontCart) => void) => work(stored), pause: (promise: Promise<void>) => { beforeBegin = promise; } };
}
const scope = { merchantId: "merchant", cartId: "cart" }, request = { variantId: "target", promotionId: "promotion", quantity: 1 };

const optionGroup = (itemId: string, priceModifierInCents: number, required = false) => ({ id: "extras", name: "Extras", required,
  selectionType: "multiple", items: [{ id: itemId, name: itemId, priceModifierInCents }] });
const selectedOption = (itemId: string, priceModifierInCents: number) => ({ groupId: "extras", groupName: "Extras", itemId, itemName: itemId, priceModifierInCents });

for (const [hostType, targetType] of [["digital", "digital"], ["service", "service"], ["physical", "digital"], ["food", "food"]] as const)
  test(`legacy GET cannot adopt ${hostType}/${targetType} from an unpinned BASE intent`, async () => {
    const f = fixture();
    for (const [index, type] of [hostType, targetType].entries()) {
      f.variants[index]!.product.type = type;
      f.variants[index]!.product.metadata = { ...(type === "digital" ? { downloadUrl: "https://example.test/synthetic.pdf" } : {}),
        ...(index === 1 ? { optionGroups: [optionGroup("size", 1500, true)] } : {}) };
      if (type === "digital" || type === "service") f.variants[index]!.stock = [];
    }
    f.mutateStored(cart => {
      cart.items.push({ variantId: "target", productId: "product-target", sku: "TARGET", name: "Target", quantity: 1,
        unitPriceCents: 11500, selectedOptions: [selectedOption("size", 1500)],
        crossSellIntent: { version: 1, promotionId: "promotion", promotionUpdatedAt: f.promo.updatedAt.toISOString(),
          acceptedQuantity: 1, originalUnitPriceCents: 11500, maximumUnitPriceCents: 10350, selectedOptionItemIds: ["size"] } });
      cart.total = 21500;
    });
    const before = f.stored();
    await assert.rejects(f.adapter.project(scope,before),(error:{getStatus():number})=>error.getStatus()===422);
    assert.deepEqual(f.stored(), before); assert.equal(f.calls.includes("write"), false);
  });

test("physical stock admission remains mandatory while virtual catalog readiness is validated separately", async () => {
  assert.equal((await fixture().adapter.quote(scope, request)).maximumUnitPriceCents, 9000);
  const f = fixture(); f.variants[1]!.stock = [];
  const before = f.stored();
  await assert.rejects(f.adapter.quote(scope, request), (error: { getResponse(): unknown; getStatus(): number }) => {
    assert.equal(error.getStatus(), 422);
    const response = error.getResponse(); assert.ok(response && typeof response === "object" && "code" in response);
    assert.equal(response.code, "cross_sell_quote_review_required"); return true;
  });
  assert.deepEqual(f.stored(), before); assert.equal(f.calls.includes("write"), false);
});
for(const type of ["digital","service"]as const)test(`legacy physical acceptance cannot silently become ${type} on GET`,async()=>{
  const f=fixture(),quote=await f.adapter.quote(scope,request);await f.adapter.accept(scope,{expectedQuote:quote});
  assert.equal((await f.adapter.project(scope)).total,19000);
  f.variants[1]!.product.type=type;
  f.variants[1]!.product.metadata=type==="digital"?{downloadUrl:"https://example.test/file.pdf"}:{};
  const before=f.stored(),writes=f.calls.filter(call=>call==="write").length;
  await assert.rejects(f.adapter.project(scope),(error:{getStatus():number})=>error.getStatus()===422);
  assert.deepEqual(f.stored(),before);assert.equal(f.calls.filter(call=>call==="write").length,writes);
});
test("cross-sell discounts canonical target base plus explicitly selected additions and preserves them through accept/project", async () => {
  const f = fixture(); f.variants[1].product.metadata = { optionGroups: [optionGroup("size", 1500, true)] };
  const selection = { ...request, selectedOptionItemIds: ["size"] };
  const quote = await f.adapter.quote(scope, selection);
  assert.equal(quote.originalUnitPriceCents, 11500); assert.equal(quote.maximumUnitPriceCents, 10350);
  assert.deepEqual((quote as any).selectedOptions, [selectedOption("size", 1500)]);
  await f.adapter.accept(scope, { expectedQuote: quote });
  const saved = f.stored(); assert.equal(saved.items[1].unitPriceCents, 11500);
  assert.deepEqual(saved.items[1].selectedOptions, [selectedOption("size", 1500)]);
  assert.deepEqual((saved.items[1].crossSellIntent as any).selectedOptionItemIds, ["size"]);
  const projected = await f.adapter.project(scope);
  assert.equal(projected.items[1].unitPriceCents, 10350); assert.equal(projected.total, 20350);
});
test("optioned existing lines of the same variant keep distinct identities in the complete quote", async () => {
  const f = fixture(); f.variants[0].product.metadata = { optionGroups: [{ ...optionGroup("size", 500), items: [
    { id: "size", name: "size", priceModifierInCents: 500 }, { id: "color", name: "color", priceModifierInCents: 1000 }] }] };
  f.mutateStored(cart => { cart.items[0].selectedOptions = [selectedOption("size", 500)]; cart.items[0].unitPriceCents = 10500;
    cart.items.push({ ...cart.items[0], quantity: 2, selectedOptions: [selectedOption("color", 1000)], unitPriceCents: 11000 }); cart.total = 32500; });
  const quote = await f.adapter.quote(scope, request);
  assert.equal(quote.quote.originalSubtotalCents, 42500); assert.equal(quote.quote.subtotalCents, 41500);
  assert.deepEqual(quote.quote.items.slice(0, 2).map(line => (line as any).selectedOptionItemIds), [["size"], ["color"]]);
  await f.adapter.accept(scope, { expectedQuote: quote });
  const projected = await f.adapter.project(scope); assert.equal(projected.items.length, 3); assert.equal(projected.total, 41500);
});
for (const changed of ["price", "name", "required", "foreign-id", "stock", "same-price-selection", "cap"] as const)
  test(`selected-option financial offer fails closed without writes when ${changed} changes`, async () => {
    const f = fixture(); const group = optionGroup("size", 1500, true);
    group.items.push({ id: "color", name: "color", priceModifierInCents: 1500 });
    f.variants[1].product.metadata = { optionGroups: [group] };
    const quote = await f.adapter.quote(scope, { ...request, selectedOptionItemIds: ["size"] });
    if (changed === "price") group.items[0].priceModifierInCents++;
    if (changed === "name") group.items[0].name = "Changed";
    if (changed === "required") f.variants[1].product.metadata = { optionGroups: [group, { ...optionGroup("required-new", 100, true), id: "new-group" }] };
    if (changed === "foreign-id") group.items[0].id = "removed";
    if (changed === "stock") f.variants[1].stock[0].quantity = 0;
    if (changed === "same-price-selection") (quote as any).selectedOptions = [selectedOption("color", 1500)];
    if (changed === "cap") f.rules.maxDiscountPercent = new Prisma.Decimal(0);
    const before = f.stored(); await assert.rejects(f.adapter.accept(scope, { expectedQuote: quote }));
    assert.deepEqual(f.stored(), before); assert.equal(f.calls.includes("write"), false);
  });
test("required options and repeated requested IDs are never guessed or silently normalized", async () => {
  const f = fixture(); f.variants[1].product.metadata = { optionGroups: [optionGroup("size", 1500, true)] };
  for (const selection of [request, { ...request, selectedOptionItemIds: ["size", "size"] }, { ...request, selectedOptionItemIds: ["foreign"] }])
    await assert.rejects(f.adapter.quote(scope, selection));
  assert.equal(f.calls.includes("write"), false);
});
test("quote and accept fence merchant/config before cart, then exact authority rows before rereading prices", async () => {
  const f = fixture(), quote = await f.adapter.quote(scope, request);
  for (const phase of [f.calls.slice(), (await f.adapter.accept(scope, { expectedQuote: quote }), f.calls.slice(f.calls.indexOf("commit") + 1))]) {
    assert.ok(phase.indexOf("merchant-fence") >= 0);
    assert.ok(phase.indexOf("merchant-fence") < phase.indexOf("rules-fence"));
    assert.ok(phase.indexOf("rules-fence") < phase.indexOf("lock"));
    assert.ok(phase.indexOf("settings-fence") < phase.indexOf("lock"));
    assert.ok(phase.indexOf("lock") < phase.indexOf("authority-row-fence"));
    assert.ok(phase.indexOf("authority-row-fence") < phase.indexOf("catalog"));
  }
});
test("real quote reader simulates post-add with no persistence or TTL refresh; acceptance persists base/intent/D after lock", async () => {
  const f = fixture(), before = f.stored(), quote = await f.adapter.quote(scope, request);
  assert.equal(quote.maximumUnitPriceCents, 9000); assert.equal(quote.quote.promotionDiscountCents, 1000);
  assert.deepEqual(f.stored(), before); assert.equal(f.calls.includes("write"), false); assert.equal(f.calls.includes("upsert"), false);
  const result = await f.adapter.accept(scope, { expectedQuote: quote });
  assert.deepEqual(result, { version: 1, status: "accepted", ...scope });
  const saved = f.stored(); assert.equal(saved.items[1].unitPriceCents, 10000); assert.equal(saved.items[1].crossSellIntent?.maximumUnitPriceCents, 9000);
  assert.equal(saved.discount, 0); assert.equal(saved.total, 20000); assert.equal(saved.freeShipping, false);
});
for (const kind of ["cost", "policy", "cap", "scope", "version", "price", "coupon", "shipping"])
  test(kind === "cost" ? "quote/accept preserve the agreed price when optional product cost disappears" : `quote/accept fail closed without writes or TTL on ${kind}`, async () => {
    const f = fixture(), quote = await f.adapter.quote(scope, request);
    if (kind === "cost") f.variants[1].price.costInCents = null;
    if (kind === "policy") f.missingPolicy();
    if (kind === "cap") f.rules.maxDiscountPercent = new Prisma.Decimal(0);
    if (kind === "version") f.promo.updatedAt = new Date(1);
    if (kind === "price") f.variants[1].price.basePriceInCents = 10001;
    if (kind === "coupon") f.mutateStored(cart => { cart.couponCode = "EXISTING"; });
    if (kind === "shipping") f.mutateStored(cart => { cart.freeShipping = true; });
    const before = f.stored(), writes = f.calls.filter(step => step === "write").length;
    if (kind === "cost") {
      await f.adapter.accept(scope, { expectedQuote: quote });
      assert.equal(f.stored().items[1].crossSellIntent?.maximumUnitPriceCents, 9000);
      assert.equal(f.stored().items[1].unitPriceCents, 10000, "base price is not rewritten by acceptance");
      assert.equal(f.calls.filter(step => step === "write").length, writes + 1);
    } else {
      await assert.rejects(f.adapter.accept(kind === "scope" ? { ...scope, merchantId: "other" } : scope, { expectedQuote: quote }));
      assert.deepEqual(f.stored(), before); assert.equal(f.calls.filter(step => step === "write").length, writes);
    }
  });
test("late acceptance CAS rejects a concurrent commercial cart change without replay or overwriting it", async () => {
  const f = fixture(), quote = await f.adapter.quote(scope, request); f.mutateStored(cart => { cart.items[0].quantity = 2; cart.total = 20000; });
  const before = f.stored(); await assert.rejects(f.adapter.accept(scope, { expectedQuote: quote }));
  assert.deepEqual(f.stored(), before); assert.equal(f.calls.includes("write"), false);
});
test("two same quote acceptances cannot merge or repeat a benefit", async () => {
  const f = fixture(), quote = await f.adapter.quote(scope, request);
  const results = await Promise.allSettled([f.adapter.accept(scope, { expectedQuote: quote }), f.adapter.accept(scope, { expectedQuote: quote })]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  assert.equal(f.stored().items[1].quantity, 1); assert.equal(f.calls.filter(step => step === "write").length, 1);
});

for (const kind of ["stock", "food", "service", "options", "foreign", "ambiguous-sku"] as const)
  test(`displayed cross-sell revalidates ${kind} before acceptance without a partial cart write`, async () => {
    const f = fixture(), quote = await f.adapter.quote(scope, request);
    if (kind === "stock") f.variants[1].stock[0].quantity = 0;
    if (kind === "food") f.variants[1].product.type = "food";
    if (kind === "service") f.variants[1].product.type = "service";
    if (kind === "options") f.mutateStored(cart => { cart.items[0].selectedOptions = [{ itemId: "extra" }] as never; });
    if (kind === "foreign") f.variants[1].product.merchantId = "foreign";
    if (kind === "ambiguous-sku") {
      const duplicate = variant("another"); duplicate.sku = "TARGET"; f.variants.push(duplicate);
    }
    const before = f.stored();
    await assert.rejects(f.adapter.accept(scope, { expectedQuote: quote }));
    assert.deepEqual(f.stored(), before);
    assert.equal(f.calls.filter(step => step === "write").length, 0);
  });
test("acceptance snapshots caller expectations before awaiting; mutation cannot repair stale quote", async () => {
  const f = fixture(), quote = await f.adapter.quote(scope, request); let resume!: () => void;
  f.pause(new Promise<void>(resolve => { resume = resolve; }));
  const pending = f.adapter.accept(scope, { expectedQuote: quote });
  quote.maximumUnitPriceCents = 1; quote.cartBasis.items[0].quantity = 99; resume();
  await pending; assert.equal(f.stored().items[1].crossSellIntent?.maximumUnitPriceCents, 9000);
});
test("common cart writer blocks plain/benefit merge and excess quantity; can remove expired intent to repair cart", async () => {
  const f = fixture(), quote = await f.adapter.quote(scope, request); await f.adapter.accept(scope, { expectedQuote: quote }); const before = f.stored();
  await assert.rejects(f.cart.addItem("merchant", "cart", { ...before.items[1], crossSellIntent: undefined, quantity: 1 }));
  await assert.rejects(f.cart.updateItemQuantity("merchant", "cart", "target", 2)); assert.deepEqual(f.stored(), before);
  f.promo.endsAt = new Date(1); await assert.rejects(f.cart.getOrCreate("merchant", "cart")); assert.deepEqual(f.stored(), before);
  await f.cart.removeItem("merchant", "cart", "target"); assert.equal(f.stored().items.length, 1); assert.equal(f.stored().discount, 0);
});
test("removing trigger cannot leave accepted target at full price; failed mutation preserves complete cart/TTL", async () => {
  const f = fixture(), quote = await f.adapter.quote(scope, request); await f.adapter.accept(scope, { expectedQuote: quote }); const before = f.stored();
  await assert.rejects(f.cart.removeItem("merchant", "cart", "host")); assert.deepEqual(f.stored(), before);
});
test("read projector reconstructs current authorized P/D without writing base or renewing TTL", async () => {
  const f = fixture(), quote = await f.adapter.quote(scope, request); await f.adapter.accept(scope, { expectedQuote: quote });
  const before = f.stored(), writes = f.calls.filter(step => step === "write").length;
  const result = await f.adapter.project(scope, before);
  assert.equal(result.items[1].unitPriceCents, 9000); assert.equal(result.items[1].pricingOriginalUnitPriceCents, 10000);
  assert.equal(result.total, 19000); assert.deepEqual(result.discountBudget, { version: 1, originalSubtotalCents: 20000, promotionDiscountCents: 1000 });
  assert.deepEqual(f.stored(), before); assert.equal(f.calls.filter(step => step === "write").length, writes);
});
for (const invalid of ["expired", "cost", "policy", "cap", "merchant"])
  test(invalid === "cost" ? "read projector preserves agreed price without cost or persistence effects" : `read projector refuses ${invalid} without base fallback, writes or TTL`, async () => {
    const f = fixture(), quote = await f.adapter.quote(scope, request); await f.adapter.accept(scope, { expectedQuote: quote });
    if (invalid === "expired") f.promo.endsAt = new Date(1);
    if (invalid === "cost") f.variants[1].price.costInCents = null;
    if (invalid === "policy") f.missingPolicy();
    if (invalid === "cap") f.rules.maxDiscountPercent = new Prisma.Decimal(1);
    const before = f.stored(), writes = f.calls.filter(step => step === "write").length;
    if (invalid === "cost") {
      const result = await f.adapter.project(scope, before);
      assert.equal(result.items[1].unitPriceCents, 9000); assert.equal(result.total, 19000);
    } else await assert.rejects(f.adapter.project(invalid === "merchant" ? { ...scope, merchantId: "foreign" } : scope, before));
    assert.deepEqual(f.stored(), before); assert.equal(f.calls.filter(step => step === "write").length, writes);
  });
test("expired persisted cart cannot be quoted or projected despite a live promotion", async () => {
  const f = fixture(); f.mutateStored(cart => Object.assign(cart, { expiresAt: new Date(1) }));
  await assert.rejects(f.adapter.quote(scope, request)); await assert.rejects(f.adapter.project(scope)); assert.equal(f.calls.includes("write"), false);
});
for (const kind of ["window", "trigger", "base", "version"]) test(`accept maps known ${kind} commercial rejection to typed review without a write`, async () => {
  const f = fixture(), quote = await f.adapter.quote(scope, request);
  if (kind === "window") f.promo.endsAt = new Date(1);
  if (kind === "trigger") f.promo.trigger.sku_in_cart = ["MISSING"];
  if (kind === "base") f.variants[1].price.basePriceInCents = 10001;
  if (kind === "version") f.promo.updatedAt = new Date(1);
  const before = f.stored();
  await assert.rejects(f.adapter.accept(scope, { expectedQuote: quote }), error => !!error && typeof error === "object"
    && "getStatus" in error && typeof error.getStatus === "function" && error.getStatus() === 422);
  assert.deepEqual(f.stored(), before); assert.equal(f.calls.includes("write"), false);
});
test("internal checkout projection supplies current costs without contaminating public cart/quote", async () => {
  const f = fixture(), quote = await f.adapter.quote(scope, request); await f.adapter.accept(scope, { expectedQuote: quote });
  f.variants[1].price.costInCents = 4000;
  const internal = await f.adapter.projectForCheckout(scope), publicCart = await f.adapter.project(scope);
  assert.equal(internal.costsByVariant.get("target"), 40); assert.equal(internal.costsByVariant.get("host"), 20);
  assert.equal(Object.hasOwn(publicCart, "costsByVariant"), false); assert.equal(Object.hasOwn(publicCart.items[1], "cost"), false);
  assert.equal(Object.hasOwn(quote, "costsByVariant"), false);
});
for (const stage of ["read", "commit"] as const) for (const failure of [new Error("synthetic_db_timeout_or_ack_lost"), null, 0])
  test(`unknown/falsy ${stage} failure is never recast as definitive commercial refusal or retried (${String(failure)})`, async () => {
    const f = fixture(), quote = await f.adapter.quote(scope, request), priorBegins = f.calls.filter(step => step === "begin").length;
    if (stage === "read") f.failRead(failure); else f.failCommit(failure);
    await assert.rejects(f.adapter.accept(scope, { expectedQuote: quote }), error => error === failure);
    assert.equal(f.calls.filter(step => step === "begin").length, priorBegins + 1);
    if (stage === "commit") assert.equal(f.stored().items.length, 2, "synthetic acknowledgement loss MAY follow commit; never assert rollback/no-effect");
  });
test("legacy active coupon reservation blocks quote/accept/projection under the cart lock even with null couponCode", async () => {
  const f = fixture(), quote = await f.adapter.quote(scope, request); f.reserveCoupon();
  const review = (error: unknown) => !!error && typeof error === "object" && "getStatus" in error && typeof error.getStatus === "function" && error.getStatus() === 422;
  await assert.rejects(f.adapter.quote(scope, request), review); await assert.rejects(f.adapter.accept(scope, { expectedQuote: quote }), review);
  await assert.rejects(f.adapter.project(scope), review); assert.equal(f.calls.includes("write"), false);
});

