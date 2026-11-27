import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { FiscalProfileService } from "./fiscal-profile.service.js";
import { PrismaFiscalProfileRepository } from "../infrastructure/prisma-fiscal-profile.repository.js";


let fixture: Awaited<ReturnType<typeof createFiscalFixture>>;
before(async () => { fixture = await createFiscalFixture(); }, { timeout: 120_000 });
after(async () => { await fixture?.close(); });
async function arrange(stage: number) {
  const sale = await seedFiscalSale(fixture);
  const store = new PrismaFiscalProfileRepository(fixture.prisma);
  const support = { find: (provider: string, contract: string) => provider === "focus" && contract === "synthetic-v2" ? {
    operations: ["sale"], currencies: ["BRL"], issuerRegimes: ["simples_nacional"], productTypes: ["physical", "food"],
  } : null };
  const service = new FiscalProfileService(store, support);
  const scope = { merchantId: sale.merchantId, environment: sale.environment };
  const actor = { actorKind: "merchant", actorId: "accountant" };
  const configuration = { currency: "BRL", supportedProductTypes: ["physical"], items: {
    sku_a: { productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { csosn: "102" } },
  } };
  const draft = { ...scope, provider: "focus" as const, operation: "sale", issuerRegime: "simples_nacional", itemRules: configuration,
    recipientRequirements: ["name", "taxId"], sourceContractVersion: "synthetic-v2" };
  let confirmed: Awaited<ReturnType<typeof service.confirm>> = sale.profile;
  if ([1,2,5].includes(stage)) await service.draft({ ...draft, itemRules: {} }, actor);
  if ([2,5].includes(stage)) confirmed = await service.confirm(scope, (await service.draft(draft, actor)).id, actor);
  return { sale, store, service, scope, actor, configuration, draft, confirmed };
}
test("FISCAL-20 incomplete tax rules remain unconfirmed action_required without invented rates", async () => {
  const { store, service, scope, actor, draft } = await arrange(0);
  const profile = await service.draft({ ...draft, itemRules: {} }, actor);
  await assert.rejects(service.confirm(scope, profile.id, actor), /fiscal_profile_unconfirmed/);
  const persisted = (await store.find(scope, profile.id))!;
  assert.equal(persisted.confirmedAt, null); assert.deepEqual(persisted.itemRules, {});
  assert.deepEqual(service.readiness(persisted), { ready: false, state: "action_required", code: "fiscal_profile_unconfirmed" });
});
test("FISCAL-21 confirmation persists version actor timestamp and transactional audit", async () => {
  const { sale, service, scope, actor, configuration, draft, confirmed: originalConfirmed } = await arrange(1);
  let confirmed = originalConfirmed;
  const profile = await service.draft(draft, actor);
  confirmed = await service.confirm(scope, profile.id, actor);
  assert.equal(confirmed.version, 3); assert.equal(confirmed.confirmedBy, "accountant"); assert.ok(confirmed.confirmedAt);
  assert.deepEqual(confirmed.itemRules, configuration);
  const audit = await fixture.prisma.merchantAuditEvent.findFirstOrThrow({ where: { merchantId: sale.merchantId, action: "fiscal.profile_confirm", resourceId: profile.id } });
  assert.equal(audit.actorId, "accountant");
  assert.deepEqual(audit.metadata, { provider: "focus", environment: "homologation", version: 3, result: "confirmed" });
});
test("new versions and repeat confirmations preserve the confirmed historical configuration", async () => {
  const { store, service, scope, actor, configuration, draft, confirmed: originalConfirmed } = await arrange(2);
  let confirmed = originalConfirmed;
  const next = await service.draft({ ...draft, itemRules: { ...configuration, currency: "USD" } }, actor);
  assert.equal(next.version, 4); assert.equal(next.confirmedAt, null);
  const repeated = await service.confirm(scope, confirmed.id, { ...actor, actorId: "different_actor" });
  assert.equal(repeated.confirmedBy, "accountant");
  assert.equal(repeated.confirmedAt?.toISOString(), confirmed.confirmedAt?.toISOString());
  assert.deepEqual((await store.find(scope, confirmed.id))?.itemRules, configuration);
});
test("FISCAL-22 unsupported currency operation regime or contract cannot be confirmed", async () => {
  const { store, service, scope, actor, configuration, draft } = await arrange(3);
  for (const change of [{ operation: "export" }, { issuerRegime: "unsupported" }, { sourceContractVersion: "unknown" }, { itemRules: { ...configuration, currency: "USD" } }]) {
    const profile = await service.draft({ ...draft, ...change }, actor);
    await assert.rejects(service.confirm(scope, profile.id, actor), /fiscal_operation_unsupported/);
    assert.equal((await store.find(scope, profile.id))?.confirmedBy, null);
  }
});
test("digital and service items cannot be confirmed as NF-e goods", async () => {
  const { store, service, scope, actor, configuration, draft } = await arrange(4);
  for (const productType of ["digital", "service"]) {
    const profile = await service.draft({ ...draft, itemRules: { ...configuration, supportedProductTypes: [productType], items: {
      sku_a: { ...configuration.items.sku_a, productType },
    } } }, actor);
    await assert.rejects(service.confirm(scope, profile.id, actor), /fiscal_operation_unsupported/);
    assert.equal((await store.find(scope, profile.id))?.confirmedAt, null);
  }
});
test("tenant environment and actor boundaries prevent confirmation outside the profile scope", async () => {
  const { store, service, scope, actor, confirmed: originalConfirmed } = await arrange(5);
  let confirmed = originalConfirmed;
  await assert.rejects(service.confirm({ ...scope, merchantId: "other" }, confirmed.id, actor), /fiscal_profile_not_found/);
  await assert.rejects(service.confirm({ ...scope, environment: "production" }, confirmed.id, actor), /fiscal_profile_not_found/);
  await assert.rejects(service.confirm(scope, confirmed.id, { ...actor, actorId: "" }), /fiscal_actor_required/);
  assert.equal((await store.find(scope, confirmed.id))?.confirmedBy, "accountant");
});

test("concurrent drafts allocate independent immutable profile versions", async () => {
  const { service, draft, actor, store, scope } = await arrange(0);
  const versions = await Promise.all([service.draft(draft, actor), service.draft(draft, actor)]);
  assert.deepEqual(versions.map(value => value.version).sort(), [2, 3]);
  assert.notEqual(versions[0].id, versions[1].id);
  assert.equal((await store.find(scope, versions[0].id))?.confirmedAt, null);
});
