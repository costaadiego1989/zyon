import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { MODULE_METADATA } from "@nestjs/common/constants.js";
import { CrossSellModule } from "./cross-sell.module.js";
import { NORMAL_CHECKOUT_CROSS_SELL } from "./domain/ports/normal-checkout-cross-sell.port.js";
import { NormalCheckoutCrossSellUseCase } from "./application/use-cases/normal-checkout-cross-sell.use-case.js";
import { PrismaNormalCheckoutCrossSellAdapter } from "./infrastructure/repositories/prisma-normal-checkout-cross-sell.adapter.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";

test("CrossSellModule exposes normal application with the real Prisma port, without querying in factory", () => {
  const providers: unknown[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CrossSellModule);
  const exports: unknown[] = Reflect.getMetadata(MODULE_METADATA.EXPORTS, CrossSellModule);
  assert.ok(providers.includes(NormalCheckoutCrossSellUseCase));
  assert.ok(exports.includes(NormalCheckoutCrossSellUseCase)); assert.ok(exports.includes(NORMAL_CHECKOUT_CROSS_SELL));
  const provider = providers.find(value => typeof value === "object" && value !== null && "provide" in value && value.provide === NORMAL_CHECKOUT_CROSS_SELL);
  assert.ok(provider && typeof provider === "object" && "inject" in provider && "useFactory" in provider);
  assert.deepEqual(provider.inject, [PRISMA_CLIENT]);
  const factory = provider.useFactory as (prisma: PrismaClient) => unknown;
  // No DB/auth proof: constructor must be a pure composition step.
  const prisma = new Proxy({}, { get() { assert.fail("factory must not query Prisma"); } }) as PrismaClient;
  assert.ok(factory(prisma) instanceof PrismaNormalCheckoutCrossSellAdapter);
});
