import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient, ProductPromotion } from "@prisma/client";
import { PrismaProductPromotionRepository } from "./prisma-product-promotion.repository.js";

// Read-only delegate fakes: prove query/contract decisions, not PostgreSQL ACLs,
// planner behavior or promotion/discount authorization by a pricing engine.
const now = new Date("2026-10-18T12:00:00.000Z");
const variant = () => ({ id: "variant", sku: "SKU", productId: "product", isActive: true,
  product: { id: "product", merchantId: "merchant", categoryId: "category" as string | null, isActive: true, deletedAt: null as Date | null } });
const promotion = (id = "promo"): ProductPromotion => ({ id, merchantId: "merchant", productId: "product", variantId: null, categoryId: null,
  couponId: null, discountType: "percent", discountValue: 10, promoPriceInCents: null, isActive: true,
  startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-11-01T00:00:00.000Z"), createdAt: now, updatedAt: now });
type Call = { step: string; args: Record<string, unknown> };
type Options = { exact?: unknown; matches?: unknown[]; rows?: ReturnType<typeof promotion>[]; failure?: "exact" | "sku" | "promotions"; gate?: Promise<void> };
function project(value: unknown, select: Record<string, unknown>): unknown {
  if (value === null || value === undefined) return value;
  const row = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(select).map(([key, choice]) => [key, choice === true ? row[key]
    : project(row[key], (choice as { select: Record<string, unknown> }).select)]));
}
function fixture(options: Options = {}) {
  const calls: Call[] = [], failure = new Error("synthetic-promotion-read-failure"), current = variant();
  const prisma = {
    productVariant: {
      async findFirst(args: Record<string, unknown>) { calls.push({ step: "exact", args }); await options.gate;
        if (options.failure === "exact") throw failure;
        return project(Object.hasOwn(options, "exact") ? options.exact : current, args.select as Record<string, unknown>); },
      async findMany(args: Record<string, unknown>) { calls.push({ step: "sku", args });
        if (options.failure === "sku") throw failure;
        return (options.matches ?? [current]).map(row => project(row, args.select as Record<string, unknown>)); },
    },
    productPromotion: { async findMany(args: Record<string, unknown>) { calls.push({ step: "promotions", args });
      if (options.failure === "promotions") throw failure;
      const rows = [...(options.rows ?? [promotion()])];
      return args.orderBy ? rows.sort((left, right) => left.id.localeCompare(right.id)) : rows;
    } },
  };
  return { repository: new PrismaProductPromotionRepository(prisma as unknown as PrismaClient), calls, failure, current };
}
test("exact variant identity is resolved first under the current active tenant, never an unscoped ID-or-SKU OR", async () => {
  const f = fixture({ matches: [variant(), { ...variant(), id: "other" }] });
  assert.deepEqual(await f.repository.findActiveBySku("merchant", "variant", now), [promotion()]);
  assert.deepEqual(f.calls[0].args.where, { id: "variant", isActive: true, product: { merchantId: "merchant", isActive: true, deletedAt: null } });
  assert.deepEqual(f.calls.map(call => call.step), ["exact", "promotions"]);
});
test("scoped exact ID takes precedence over ambiguous SKUs sharing that textual value", async () => {
  const f = fixture({ matches: [variant(), { ...variant(), id: "other" }] });
  await f.repository.findActiveBySku("merchant", "variant", now);
  assert.ok(!f.calls.some(call => call.step === "sku"));
});
test("SKU fallback is tenant-scoped, bounded and deterministic when exactly one catalog variant exists", async () => {
  const f = fixture({ exact: null });
  assert.deepEqual(await f.repository.findActiveBySku("merchant", "SKU", now), [promotion()]);
  const lookup = f.calls.find(call => call.step === "sku")!;
  assert.deepEqual(lookup.args.where, { sku: "SKU", isActive: true, product: { merchantId: "merchant", isActive: true, deletedAt: null } });
  assert.equal(lookup.args.take, 2); assert.deepEqual(lookup.args.orderBy, { id: "asc" });
});
for (const matches of [[], [variant(), { ...variant(), id: "second", productId: "second-product", product: { ...variant().product, id: "second-product" } }]]) {
  test(`missing or ambiguous SKU (${matches.length}) refuses promotion lookup rather than picking first product`, async () => {
    const f = fixture({ exact: null, matches }); assert.deepEqual(await f.repository.findActiveBySku("merchant", "SKU", now), []);
    assert.ok(!f.calls.some(call => call.step === "promotions"));
  });
}
test("active promotions cover variant/product/category scopes with exact inclusive-start/exclusive-end window", async () => {
  const f = fixture(); await f.repository.findActiveBySku("merchant", "variant", now);
  const lookup = f.calls.find(call => call.step === "promotions")!.args;
  assert.deepEqual(lookup.where, { merchantId: "merchant", isActive: true, startsAt: { lte: now }, endsAt: { gt: now },
    OR: [{ variantId: "variant" }, { productId: "product" }, { categoryId: "category" }] });
  assert.deepEqual(lookup.orderBy, { id: "asc" });
});
test("categoryless product never broadens promo scope to all null categories", async () => {
  const f = fixture(); f.current.product.categoryId = null; await f.repository.findActiveBySku("merchant", "variant", now);
  const query = f.calls.find(call => call.step === "promotions")!.args.where;
  assert.deepEqual(query, { merchantId: "merchant", isActive: true, startsAt: { lte: now }, endsAt: { gt: now },
    OR: [{ variantId: "variant" }, { productId: "product" }] });
});
test("deterministic promo ordering does not itself choose or authorize a benefit", async () => {
  const a = promotion("a"), b = promotion("b"), f = fixture({ rows: [b, a] });
  assert.deepEqual((await f.repository.findActiveBySku("merchant", "variant", now)).map(row => row.id), ["a", "b"]);
});
test("coupon-linked promotions retain their descriptor instead of turning into inline authorization", async () => {
  const coupon = { ...promotion(), couponId: "coupon", discountType: null, discountValue: null }, f = fixture({ rows: [coupon] });
  const [row] = await f.repository.findActiveBySku("merchant", "variant", now);
  assert.equal(row.couponId, "coupon"); assert.equal(row.discountType, null);
});
for (const [name, mutate] of [
  ["foreign merchant", (row: ReturnType<typeof variant>) => { row.product.merchantId = "foreign"; }],
  ["wrong exact ID", (row: ReturnType<typeof variant>) => { row.id = "foreign"; }],
  ["product binding", (row: ReturnType<typeof variant>) => { row.productId = "foreign"; }],
  ["inactive variant", (row: ReturnType<typeof variant>) => { row.isActive = false; }],
  ["inactive product", (row: ReturnType<typeof variant>) => { row.product.isActive = false; }],
  ["deleted product", (row: ReturnType<typeof variant>) => { row.product.deletedAt = now; }],
] as const) test(`corrupt/out-of-scope returned ${name} fails before promotion lookup`, async () => {
  const f = fixture(); mutate(f.current);
  await assert.rejects(f.repository.findActiveBySku("merchant", "variant", now)); assert.ok(!f.calls.some(call => call.step === "promotions"));
});
test("SKU fallback verifies returned SKU, not merely the number of rows", async () => {
  const f = fixture({ exact: null, matches: [{ ...variant(), sku: "OTHER" }] });
  await assert.rejects(f.repository.findActiveBySku("merchant", "SKU", now)); assert.ok(!f.calls.some(call => call.step === "promotions"));
});
for (const [failure, options, key] of [["exact", {}, "variant"], ["sku", { exact: null }, "SKU"], ["promotions", {}, "variant"]] as const) {
  test(`${failure} read failure propagates once without empty fallback`, async () => {
    const f = fixture({ ...options, failure }); await assert.rejects(f.repository.findActiveBySku("merchant", key, now), error => error === f.failure);
    assert.equal(f.calls.filter(call => call.step === failure).length, 1);
  });
}
for (const [merchant, key, date] of [["", "variant", now], ["merchant", " ", now], ["merchant", "variant", new Date(NaN)]] as const)
  test(`invalid query input is rejected before catalog IO ${merchant}/${key}/${String(date)}`, async () => {
    const f = fixture(); await assert.rejects(f.repository.findActiveBySku(merchant, key, date)); assert.deepEqual(f.calls, []);
  });
test("observation date is detached before awaiting catalog resolution", async () => {
  let release!: () => void; const gate = new Promise<void>(done => { release = done; }), date = new Date(now), f = fixture({ gate });
  const pending = f.repository.findActiveBySku("merchant", "variant", date); date.setTime(0); release(); await pending;
  const where = f.calls.find(call => call.step === "promotions")!.args.where as { startsAt: { lte: Date }; endsAt: { gt: Date } };
  assert.equal(where.startsAt.lte.getTime(), now.getTime()); assert.equal(where.endsAt.gt.getTime(), now.getTime());
});

