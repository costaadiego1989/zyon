import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { PrismaProductRepository } from "./prisma-product.repository.js";

function readOnlyRepository(rows: any[] = []) {
  const queries: any[] = [], findCalls: any[] = [];
  const tx = {
    $executeRaw: async () => { throw Error("search_must_not_write"); },
    $queryRaw: async (query: any) => {
      queries.push(query);
      return queries.length % 2 ? rows.map(row => ({ id: row.id })) : [{ total: BigInt(rows.length) }];
    },
    product: { findMany: async (args: any) => { findCalls.push(args); return args.select ? [] : rows; } },
  };
  const repo = new PrismaProductRepository({ $queryRaw: async () => [], $transaction: async (run: any, options: any) => {
    assert.equal(options.isolationLevel, "RepeatableRead");
    return run(tx);
  } } as never);
  return { repo, queries, findCalls };
}

test("SQL binds tenant and arbitrary attribute data, conjunctively filters one variant, and ranks before page slicing", async () => {
  const { repo, queries } = readOnlyRepository();
  const hostileAttribute = "cor' OR TRUE --";
  await repo.search({ merchantId: "merchant-a", query: "*", minPriceCents: 5000, maxPriceCents: 10000, minRating: 4,
    currency: "BRL", inStockOnly: true, sortBy: "price_asc", cursor: "same-tenant-cursor", limit: 3,
    attributes: [{ name: hostileAttribute, value: "verde", operator: "equals" }] });
  assert.equal(queries.length, 2);
  const sql = queries[0].sql as string;
  assert.match(sql, /WITH public_reviews AS[\s\S]*candidates AS/);
  assert.ok(sql.includes("p.merchant_id = ?"));
  assert.ok(sql.includes("v.product_id = p.id AND v.is_active"));
  assert.ok(sql.includes("pr.variant_id = v.id AND pr.base_price_in_cents >= ?"));
  assert.ok(sql.includes("pr.variant_id = v.id AND pr.base_price_in_cents <= ?"));
  assert.ok(sql.includes("s.variant_id = v.id"));
  assert.match(sql, /jsonb_each_text\(CASE WHEN jsonb_typeof\(v.attributes\)/);
  assert.ok(!sql.includes(hostileAttribute));
  assert.ok(queries[0].values.includes(hostileAttribute.toLowerCase()));
  assert.ok(queries[0].values.includes("merchant-a"));
  assert.ok(queries[0].values.includes("same-tenant-cursor"));
  assert.ok(sql.indexOf("row_number() OVER") > sql.indexOf("FROM products p WHERE"));
  assert.match(sql, /ORDER BY sort_price ASC, created_at DESC, id DESC/);
  assert.match(sql, /SELECT position FROM ranked WHERE id = \?/);
  assert.ok(!/INSERT|UPDATE|DELETE|FOR UPDATE/.test(sql));
});

test("rating filter and result projection require approved public reviews in this tenant or legacy-null scope", async () => {
  const { repo, queries, findCalls } = readOnlyRepository([{ id: "p", merchantId: "a", name: "Produto", type: "physical", isActive: true,
    createdAt: new Date(), updatedAt: new Date(), variants: [], reviews: [] }]);
  await repo.search({ merchantId: "a", minRating: 4.5, sortBy: "rating" });
  const sql = queries[0].sql as string;
  assert.match(sql, /avg\(r.rating\)/);
  assert.match(sql, /r.merchant_id = \? OR r.merchant_id IS NULL/);
  assert.match(sql, /r.approved = true/);
  assert.match(sql, /r.moderation_status = 'approved' OR r.moderation_status IS NULL/);
  assert.match(sql, /UNION ALL/);
  assert.match(sql, /FROM product_testimonials t/);
  assert.match(sql, /t.is_published = true AND t.moderation_status = 'approved'/);
  assert.match(sql, /sort_rating DESC NULLS LAST/);
  const review = findCalls.find(call => call.include)?.include.reviews;
  assert.equal(review.where.approved, true);
  assert.deepEqual(review.where.OR, [{ moderationStatus: null }, { moderationStatus: "approved" }]);
  assert.deepEqual(review.where.AND, [{ OR: [{ merchantId: "a" }, { merchantId: null }] }]);
});

test("projection cannot advertise a cheaper unavailable variant or an attribute from another variant", async () => {
  const v = (id: string, price: number, color: string, quantity: number) => ({ id, sku: id, isActive: true,
    attributes: { color }, price: { basePriceInCents: price, currency: "BRL" }, stock: [{ quantity, reserved: 0 }], media: [] });
  const { repo } = readOnlyRepository([{ id: "p", merchantId: "a", name: "Produto", isActive: true,
    createdAt: new Date(), updatedAt: new Date(), type: "physical", reviews: [],
    variants: [v("cheap-blue", 1000, "blue", 2), v("green-expensive", 20000, "green", 2),
      v("green-empty", 8000, "green", 0), v("eligible", 9000, "green", 2)] }]);
  const result = await repo.search({ merchantId: "a", minPriceCents: 5000, maxPriceCents: 10000, inStockOnly: true,
    attributes: [{ name: "color", value: "green", operator: "equals" }] });
  assert.deepEqual(result.products[0].variants.map(item => item.id), ["eligible"]);
  assert.equal(result.products[0].defaultVariant?.basePriceInCents, 9000);
  assert.equal(result.products[0].reviewCount, 0);
  assert.equal(result.products[0].averageRating, undefined);
});

test("the displayed default is the cheapest eligible variant used by price ordering, including two eligible variants", async () => {
  const v = (id: string, price: number) => ({ id, sku: id, isActive: true,
    attributes: {}, price: { basePriceInCents: price, currency: "BRL" }, stock: [{ quantity: 2, reserved: 0 }], media: [] });
  const { repo } = readOnlyRepository([{ id: "p", merchantId: "a", name: "Produto", isActive: true,
    createdAt: new Date(), updatedAt: new Date(), type: "physical", reviews: [],
    variants: [v("first-but-expensive", 8000), v("cheapest-eligible", 5000)] }]);
  for (const sortBy of ["price_asc", "price_desc"] as const) {
    const result = await repo.search({ merchantId: "a", minPriceCents: 5000, maxPriceCents: 10000, inStockOnly: true, sortBy });
    assert.deepEqual(result.products[0].variants.map(item => item.id), ["cheapest-eligible", "first-but-expensive"]);
    assert.equal(result.products[0].defaultVariant?.basePriceInCents, 5000);
  }
});
