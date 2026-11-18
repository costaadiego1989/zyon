import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CheckoutPersistenceModule } from "./checkout-persistence.module.js";
import { CHECKOUT_REPOSITORY } from "./domain/ports/checkout-repository.port.js";
import { CHECKOUT_SESSION_REPOSITORY } from "./domain/ports/checkout-session.repository.port.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { FISCAL_ORDER_COMMIT_FACTORY } from "../fiscal/fiscal-runtime.ports.js";

const realProviders = Reflect.getMetadata("providers", CheckoutPersistenceModule).filter(
  (provider: { provide?: unknown }) => [CHECKOUT_REPOSITORY, CHECKOUT_SESSION_REPOSITORY].includes(provider.provide as symbol)
);
test("FISCAL-10 actual standalone checkout reader retains its original Prisma-only Nest factory without fiscal activation", async () => {
  let reads = 0;
  let lookup: unknown;
  @Module({ providers: [{ provide: PRISMA_CLIENT, useValue: { checkoutSession: { findUnique: async (input: unknown) => { reads++; lookup = input; return null; } } } }, ...realProviders] })
  class ReaderFixture {}
  const app = await NestFactory.createApplicationContext(ReaderFixture, { logger: false, abortOnError: false });
  try {
    assert.equal(await app.get(CHECKOUT_SESSION_REPOSITORY).getSession("original-merchant", "original-session"), undefined);
    assert.equal(reads, 1);
    assert.deepEqual(lookup, { where: { merchantId_sessionId: { merchantId: "original-merchant", sessionId: "original-session" } } });
  } finally { await app.close(); }
});
test("FISCAL-38 actual fiscal factory cannot be constructed without the required trusted tenant context", async () => {
  let participants = 0;
  @Module({ providers: [{ provide: PRISMA_CLIENT, useValue: {} }, { provide: FISCAL_ORDER_COMMIT_FACTORY, useValue: () => { participants++; } }, ...realProviders] })
  class MissingFiscalContext {}
  await assert.rejects(NestFactory.createApplicationContext(MissingFiscalContext, { logger: false, abortOnError: false }), /fiscal_tenant_context_required/);
  assert.equal(participants, 0);
});
