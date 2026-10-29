import test from "node:test";
import assert from "node:assert/strict";
import { PrismaFederatedProductRepository } from "./prisma-federated-product.repository.js";

test("partner search tokenizes accented requests and enforces seller/stock/currency/budget before LIMIT", async () => {
  let sql: any;
  let hydration: any;
  const repo = new PrismaFederatedProductRepository({ $queryRaw: async (query: any) => { sql = query; return [{ id: "authorized" }]; },
    federatedProduct: { findMany: async (args: any) => { hydration = args; return []; } } } as any);
  await repo.searchByQuery("tênis de corrida verde sem couro", undefined, 3,
    { includeMerchants: ["partner"], excludeMerchants: ["host", "blocked"], maxPriceCents: 20000 });
  assert.match(sql.sql, /stock_available.*currency = 'BRL'/);
  assert.match(sql.sql, /normalize\(/);
  assert.match(sql.sql, /source_merchant_id = ANY/);
  assert.match(sql.sql, /NOT \(f.source_merchant_id = ANY/);
  assert.match(sql.sql, /price_cents <= \?/);
  assert.ok(sql.values.includes("tenis") && sql.values.includes("running") && sql.values.includes("verde") && sql.values.includes("sem couro"));
  assert.ok(sql.sql.indexOf("price_cents") < sql.sql.indexOf("LIMIT"));
  assert.equal(hydration.where.priceCents.lte, 20000);
  assert.deepEqual(hydration.where.id, { in: ["authorized"] });
});

test("no authorized sellers or a browse-only phrase never broadens the federated catalog", async () => {
  const repo = new PrismaFederatedProductRepository({ $queryRaw: async () => assert.fail("no broad cross-merchant reads") } as any);
  assert.deepEqual(await repo.searchByQuery("pele", undefined, 3, { includeMerchants: [], excludeMerchants: [] }), []);
  assert.deepEqual(await repo.searchByQuery("*", undefined, 3, { includeMerchants: ["partner"], excludeMerchants: [] }), []);
});
