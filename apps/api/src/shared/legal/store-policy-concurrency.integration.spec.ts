import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../persistence/prisma-client.js";
import { PrismaMerchantRepository } from "../../modules/merchant/infrastructure/prisma-merchant.repository.js";
import { PrismaPolicyRepository } from "../../modules/knowledge-base/infrastructure/repositories/prisma-policy.repository.js";

const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => { await db.$disconnect(); });
const fields = ["returns", "shipping", "warranty", "payment", "general"] as const;
const initial: Record<string, string> = { privacy: "Privacy unchanged", terms: "Terms unchanged", ...Object.fromEntries(fields.map(key => [key, "old " + key])) };
async function fixture(t: TestContext) {
  const ids = ["qa_athom_policy_" + randomUUID(), "qa_athom_policy_" + randomUUID()];
  for (const id of ids) {
    await db.merchant.create({ data: { id, name: "Owned policy QA", storeSettings: { policies: initial, company: { razaoSocial: "Owned company" }, marker: "preserved" } } });
    await db.merchantPolicy.create({ data: { merchantId: id, ...Object.fromEntries(fields.map(key => [key, "old " + key])) } });
  }
  t.after(async () => {
    assert.ok(ids.every(id => id.startsWith("qa_athom_policy_")));
    await db.merchantPolicy.deleteMany({ where: { merchantId: { in: ids } } }); await db.merchant.deleteMany({ where: { id: { in: ids } } });
  });
  return { id: ids[0], other: ids[1], settings: new PrismaMerchantRepository(db), policies: new PrismaPolicyRepository(db) };
}
test("knowledge editor publishes all five policies without shadowing or affecting another tenant", async t => {
  const f = await fixture(t), patch = Object.fromEntries(fields.map(key => [key, "new " + key]));
  assert.deepEqual(await f.policies.upsert(f.id, patch), patch);
  const stored: any = (await db.merchant.findUniqueOrThrow({ where: { id: f.id } })).storeSettings;
  assert.deepEqual(stored.policies, { ...initial, ...patch }); assert.equal(stored.marker, "preserved");
  assert.deepEqual((await f.policies.publicSnapshot(f.id)).policy, { ...initial, ...patch });
  assert.deepEqual((await f.policies.publicSnapshot(f.other)).policy, initial);
});
test("store settings synchronize all five policies and explicit clearing preserves omitted fields", async t => {
  const f = await fixture(t), patch = Object.fromEntries(fields.map(key => [key, "settings " + key]));
  await f.settings.updateStoreSettings(f.id, { policies: patch });
  const legacy = await db.merchantPolicy.findUniqueOrThrow({ where: { merchantId: f.id } });
  for (const key of fields) assert.equal(legacy[key], patch[key]);
  await f.policies.upsert(f.id, { warranty: null, payment: "", general: undefined });
  const current = await f.policies.get(f.id);
  assert.deepEqual(current, { returns: patch.returns, shipping: patch.shipping, warranty: null, payment: null, general: patch.general });
  assert.deepEqual((await f.policies.publicSnapshot(f.id)).policy, { privacy: initial.privacy, terms: initial.terms, returns: patch.returns, shipping: patch.shipping, general: patch.general });
});

test("undefined store policy fields preserve both sources while explicit empty text clears only its field", async t => {
  const f = await fixture(t);
  await f.settings.updateStoreSettings(f.id, { policies: { privacy: undefined, terms: undefined, warranty: undefined,
    general: "Latest general", payment: "" } });
  const saved = await f.policies.get(f.id);
  assert.deepEqual(saved, { returns: initial.returns, shipping: initial.shipping, warranty: initial.warranty, payment: null, general: "Latest general" });
  const { payment: _removed, ...preserved } = initial;
  assert.deepEqual((await f.policies.publicSnapshot(f.id)).policy, { ...preserved, general: "Latest general" });
  const settings: any = (await db.merchant.findUniqueOrThrow({ where: { id: f.id } })).storeSettings;
  assert.equal(settings.policies.warranty, initial.warranty); assert.equal(settings.policies.privacy, initial.privacy);
  assert.equal(settings.policies.terms, initial.terms); assert.equal(settings.marker, "preserved");
  assert.deepEqual((await f.policies.publicSnapshot(f.other)).policy, initial);
});
test("concurrent independent policy and company patches preserve every committed field", async t => {
  const f = await fixture(t);
  await Promise.all([
    ...fields.map(key => f.policies.upsert(f.id, { [key]: "concurrent " + key })),
    f.settings.updateStoreSettings(f.id, { company: { razaoSocial: "Updated company" } }),
    f.settings.updateStoreSettings(f.id, { social: { instagram: "https://example.test/owned" } }),
  ]);
  assert.deepEqual((await f.policies.publicSnapshot(f.id)).policy, { ...initial, ...Object.fromEntries(fields.map(key => [key, "concurrent " + key])) });
  const settings: any = (await db.merchant.findUniqueOrThrow({ where: { id: f.id } })).storeSettings;
  assert.equal(settings.company.razaoSocial, "Updated company"); assert.equal(settings.social.instagram, "https://example.test/owned"); assert.equal(settings.marker, "preserved");
  assert.deepEqual((await f.policies.publicSnapshot(f.other)).policy, initial);
});
test("a policy persistence failure rolls back its public setting patch", async t => {
  const f = await fixture(t);
  await assert.rejects(f.policies.upsert(f.id, { payment: 123 as any }));
  assert.deepEqual((await f.policies.publicSnapshot(f.id)).policy, initial);
  assert.deepEqual(await f.policies.get(f.id), Object.fromEntries(fields.map(key => [key, "old " + key])));
});
