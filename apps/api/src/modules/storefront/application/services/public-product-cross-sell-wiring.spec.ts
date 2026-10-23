import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CrossSellModule } from "../../../cross-sell/cross-sell.module.js";
import { CROSS_SELL_PREVIEW_STRATEGIES, type CrossSellPreviewStrategiesPort } from "../../../cross-sell/domain/ports/preview-strategies.port.js";

test("public preview module exports a lazy per-call strategy factory using its exact Prisma instance", async () => {
  const providers: unknown[] = Reflect.getMetadata("providers", CrossSellModule);
  const provider = providers.find(item => item && typeof item === "object" && "provide" in item && item.provide === CROSS_SELL_PREVIEW_STRATEGIES);
  assert.ok(provider && typeof provider === "object");
  assert.ok("inject" in provider);
  assert.deepEqual(provider.inject, [PRISMA_CLIENT]);
  assert.ok("useFactory" in provider && typeof provider.useFactory === "function");
  const exports: unknown[] = Reflect.getMetadata("exports", CrossSellModule);
  assert.ok(exports.includes(CROSS_SELL_PREVIEW_STRATEGIES));

  let catalogReads = 0;
  let purchaseReads = 0;
  const prisma = {
    productVariant: { async findMany(query: { where: { product: { merchantId: string } } }) {
      assert.equal(query.where.product.merchantId, "merchant_wiring");
      catalogReads += 1;
      return [];
    } },
    buyerPurchaseRecord: { async findMany(query: { where: { merchantId: string } }) {
      assert.equal(query.where.merchantId, "merchant_wiring");
      purchaseReads += 1;
      return [];
    } },
  } as unknown as PrismaClient;
  const strategies = provider.useFactory(prisma) as CrossSellPreviewStrategiesPort;
  assert.equal(catalogReads, 0);
  assert.equal(purchaseReads, 0);
  const first = strategies.createCatalog();
  const second = strategies.createCatalog();
  assert.notEqual(first, second);
  assert.deepEqual(await first.sameCategory("merchant_wiring", ["VIEWED"], 3), []);
  assert.deepEqual(await first.sameCategory("merchant_wiring", ["VIEWED"], 3), []);
  assert.equal(catalogReads, 1, "Each recommender retains its existing internal cache");
  assert.deepEqual(await second.sameCategory("merchant_wiring", ["VIEWED"], 3), []);
  assert.equal(catalogReads, 2, "A later preview must not share an earlier recommender cache");

  const firstCoOccurrence = strategies.createCoOccurrence();
  const secondCoOccurrence = strategies.createCoOccurrence();
  assert.notEqual(firstCoOccurrence, secondCoOccurrence);
  await firstCoOccurrence.recommend("merchant_wiring", ["VIEWED"], 3);
  await firstCoOccurrence.recommend("merchant_wiring", ["VIEWED"], 3);
  assert.equal(purchaseReads, 1);
  await secondCoOccurrence.recommend("merchant_wiring", ["VIEWED"], 3);
  assert.equal(purchaseReads, 2);
});

