import assert from "node:assert/strict";
import { test } from "node:test";
import { ProductEntity } from "../../catalog/domain/entities/product.entity.js";
import type { ProductProps } from "../../catalog/domain/entities/product.entity.js";
import type { BillingSubscriptionSnapshot } from "../../payment/domain/payment-platform.types.js";
import { testDatabase } from "./__tests__/database.js";
import { CommerceContextAdapter } from "./commerce-context.adapter.js";
import { PrismaProductRepository } from "../../catalog/infrastructure/repositories/prisma-product.repository.js";

const productProps: ProductProps = { id: "product-a", merchantId: "store-a", name: "Produto", description: "Dados canonicos", type: "physical", isActive: true, createdAt: new Date("2026-11-01"), updatedAt: new Date("2026-11-01"), variants: [{ id: "variant-a", sku: "A", attributes: {}, isActive: true, basePriceInCents: 12500, costInCents: 4000, taxPercent: 0, currency: "BRL", stockQuantity: 8, stockReserved: 2, media: [{ id: "image-a", url: "https://media.example.test/source.png", type: "IMAGE", order: 0 }] }] };
async function fixture() {
  const db = await testDatabase(); let product = new ProductEntity(productProps);
  let billing = { merchantId: "store-a", status: "active", planKey: "growth", cancelAtPeriodEnd: false, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" } as BillingSubscriptionSnapshot;
  const scopes: string[] = [];
  const catalog = { search: async (input: { merchantId: string }) => { scopes.push(input.merchantId); return { products: [product], total: 1 }; }, findByVariantIds: async (merchantId: string, ids: string[]) => { scopes.push(merchantId); assert.deepEqual(ids, ["variant-a"]); return [product]; } };
  const merchants = { getProfile: async (merchantId: string) => ({ id: merchantId, name: "Loja", slug: "loja-a", storeSettings: { company: { email: "owner@example.test" } } }) };
  const plans = { getBilling: async (merchantId: string) => { scopes.push(merchantId); return billing; } };
  const adapter = new CommerceContextAdapter(db.prisma, catalog, merchants, plans, { STOREFRONT_PUBLIC_URL: "https://store.example.test" }, () => new Date("2026-11-14T12:00:00Z"));
  return { ...db, adapter, scopes, changeProduct: (value: ProductProps) => { product = new ProductEntity(value); }, changeBilling: (value: Partial<BillingSubscriptionSnapshot>) => { billing = { ...billing, ...value }; } };
}
test("commerce gateway keeps canonical product selection, availability and commercial versions store scoped", async () => {
  const f = await fixture(); try {
    const [first] = await f.adapter.products("store-a", { variantIds: ["variant-a"] });
    assert.equal(first.variantId, "variant-a"); assert.equal(first.priceCents, 12500); assert.equal(first.stockQuantity, 6); assert.equal(first.active, true); assert.equal(first.imageUrl, "https://media.example.test/source.png");
    assert.equal(first.storefrontUrl, "https://store.example.test/store/loja-a?show=content&product=product-a");
    f.changeProduct({ ...productProps, variants: [{ ...productProps.variants[0], basePriceInCents: 13000 }] });
    assert.notEqual((await f.adapter.products("store-a", { variantIds: ["variant-a"] }))[0].commercialVersion, first.commercialVersion);
    f.changeProduct({ ...productProps, merchantId: "store-b" });
    await assert.rejects(f.adapter.products("store-a"), { code: "catalog_tenant_mismatch", status: 403 });
    assert.equal(f.scopes.every(scope => scope === "store-a"), true);
  } finally { await f.close(); }
});
test("commerce gateway resolves the actual base billing entitlement and separates the billing customer", async () => {
  const f = await fixture(); try {
    assert.equal(await f.adapter.getPlan("store-a"), "growth");
    f.changeBilling({ status: "trialing", planKey: "scale", trialEndsAt: "2026-12-01T00:00:00Z" }); assert.equal(await f.adapter.getPlan("store-a"), "starter");
    f.changeBilling({ status: "active", planKey: "scale", stripeCustomerId: "cus_platform" });
    const profile = await f.adapter.getProfile("store-a"); assert.equal(profile.stripeCustomerId, "cus_platform"); assert.equal(profile.email, "owner@example.test"); assert.equal(profile.storefrontUrl, "https://store.example.test/store/loja-a");
  } finally { await f.close(); }
});

test("stock changes do not invalidate an unchanged product image commercial version", async () => {
  const f = await fixture(); try {
    const before = (await f.adapter.products("store-a", { variantIds: ["variant-a"] }))[0];
    f.changeProduct({ ...productProps, variants: [{ ...productProps.variants[0], stockQuantity: 7 }] });
    const after = (await f.adapter.products("store-a", { variantIds: ["variant-a"] }))[0];
    assert.equal(after.stockQuantity, 5); assert.equal(after.commercialVersion, before.commercialVersion);
  } finally { await f.close(); }
});
test("commerce gateway confirms payments and refunds in PostgreSQL without treating current catalog cost as historical", async () => {
  const f = await fixture(); try {
    await f.sql.query(`CREATE TABLE completed_orders(id TEXT PRIMARY KEY, merchant_id TEXT, session_id TEXT, external_order_id TEXT, order_total NUMERIC, currency TEXT, completed_at TIMESTAMP);
      CREATE TABLE payment_intents(id TEXT PRIMARY KEY, merchant_id TEXT, session_id TEXT, status TEXT, amount_cents INT, approved_amount_cents INT, currency TEXT, amount_breakdown JSONB, status_history JSONB, updated_at TIMESTAMP);
      CREATE TABLE returns(id TEXT PRIMARY KEY,merchant_id TEXT,order_id TEXT);
      CREATE TABLE return_refunds(return_id TEXT,amount_in_cents INT,status TEXT);`);
    await f.sql.query("INSERT INTO completed_orders VALUES('order-a','store-a','session-a','external-a',100,'BRL','2026-11-14'),('order-b','store-b','session-b','external-b',900,'BRL','2026-11-14'),('unpaid','store-a','pending','external-pending',50,'BRL','2026-11-14')");
    await f.sql.query("INSERT INTO payment_intents VALUES('intent-a','store-a','session-a','approved',10099,10099,'BRL',$1,$2,'2026-11-14')", [{ version: 1, currency: "BRL", itemsSubtotalCents: 10000, discountCents: 0, shippingCents: 0, platformFeeCents: 99, totalCents: 10099 }, JSON.stringify([{ status: "approved", occurredAt: "2026-11-14T10:00:00Z" }])]);
    await f.sql.query("INSERT INTO returns VALUES('return-a','store-a','order-a'); INSERT INTO return_refunds VALUES('return-a',2000,'COMPLETED')");
    const fact = await f.adapter.paidOrder("store-a", "order-a");
    assert.deepEqual(fact, { orderId: "order-a", merchantId: "store-a", sessionId: "session-a", paid: true, paidAt: "2026-11-14T10:00:00.000Z", currency: "BRL", paidCents: 10000, refundedCents: 2000, costCents: null, costCoverage: "unavailable" });
    assert.equal(await f.adapter.paidOrder("store-a", "order-b"), null); assert.equal((await f.adapter.paidOrder("store-a", "unpaid"))!.paid, false);
    assert.deepEqual((await f.adapter.paidOrders("store-a", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).map(order => order.orderId), ["order-a"]);
    await f.sql.query("UPDATE payment_intents SET status='refunded' WHERE id='intent-a'");
    assert.equal((await f.adapter.paidOrder("store-a", "order-a"))!.refundedCents, 10000);
  } finally { await f.close(); }
});

test("canonical catalog variant lookup uses PostgreSQL tenant filters and excludes deleted products", async () => {
  const db = await testDatabase(); try {
    await db.sql.query(`CREATE TABLE products(id TEXT PRIMARY KEY,merchant_id TEXT,name TEXT,description TEXT,type TEXT DEFAULT 'physical',metadata JSONB,category_id TEXT,is_active BOOLEAN DEFAULT true,deleted_at TIMESTAMP,seo_title TEXT,meta_description TEXT,slug TEXT,og_title TEXT,og_description TEXT,twitter_card TEXT,keywords TEXT[] DEFAULT '{}',seo_generated_at TIMESTAMP,created_at TIMESTAMP DEFAULT now(),updated_at TIMESTAMP DEFAULT now());
      CREATE TABLE product_variants(id TEXT PRIMARY KEY,product_id TEXT,sku TEXT,attributes JSONB DEFAULT '{}',barcode TEXT,weight_grams INT,length_cm FLOAT,height_cm FLOAT,width_cm FLOAT,is_active BOOLEAN DEFAULT true,created_at TIMESTAMP DEFAULT now(),updated_at TIMESTAMP DEFAULT now());
      CREATE TABLE product_prices(id TEXT PRIMARY KEY,variant_id TEXT,base_price_in_cents INT,cost_in_cents INT,tax_percent FLOAT DEFAULT 0,currency TEXT DEFAULT 'BRL',created_at TIMESTAMP DEFAULT now(),updated_at TIMESTAMP DEFAULT now());
      CREATE TABLE product_stock(id TEXT PRIMARY KEY,variant_id TEXT,warehouse_id TEXT,quantity INT,reserved INT,created_at TIMESTAMP DEFAULT now(),updated_at TIMESTAMP DEFAULT now());
      CREATE TABLE product_media(id TEXT PRIMARY KEY,variant_id TEXT,url TEXT,type TEXT,alt TEXT,"order" INT,created_at TIMESTAMP DEFAULT now());
      CREATE TABLE product_reviews(id TEXT PRIMARY KEY,product_id TEXT,rating INT,approved BOOLEAN);
      INSERT INTO products(id,merchant_id,name) VALUES('product-a','store-a','Produto A'),('product-b','store-b','Produto B');
      INSERT INTO product_variants(id,product_id,sku) VALUES('variant-a','product-a','A'),('variant-b','product-b','B');
      INSERT INTO product_prices(id,variant_id,base_price_in_cents) VALUES('price-a','variant-a',12500),('price-b','variant-b',1000);
      INSERT INTO product_stock(id,variant_id,warehouse_id,quantity,reserved) VALUES('stock-a','variant-a','warehouse',8,2);`);
    const repository = new PrismaProductRepository(db.prisma);
    assert.deepEqual(await repository.findByVariantIds("store-a", ["variant-b"]), []);
    const selected = await repository.findByVariantIds("store-a", ["variant-a"]);
    assert.equal(selected.length, 1); assert.equal(selected[0].merchantId, "store-a"); assert.equal(selected[0].variants[0].basePriceInCents, 12500); assert.equal(selected[0].totalStock, 6);
    await db.sql.query("UPDATE products SET deleted_at=now() WHERE id='product-a'");
    assert.deepEqual(await repository.findByVariantIds("store-a", ["variant-a"]), []);
  } finally { await db.close(); }
});
