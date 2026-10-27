import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { MerchantRules } from "../../domain/merchant.types.js";
import type { MerchantRulesRepository } from "../../domain/ports/merchant-rules.repository.port.js";
import { DEFAULT_RULES } from "../../domain/merchant-rules.defaults.js";
import { PrismaMerchantRepository } from "../../infrastructure/prisma-merchant.repository.js";
import { readExistingMerchantRules } from "./read-existing-merchant-rules.js";

const merchantId = "synthetic-merchant";
const rules = (): MerchantRules => structuredClone(DEFAULT_RULES);
type Reader = Pick<MerchantRulesRepository, "getRules" | "getExistingRules">;
test("uses existing-policy reader and preserves its receiver, never getRules fallback", async () => {
  const repository: Reader = { getRules: () => assert.fail("implicit default read"), async getExistingRules(id) {
    assert.equal(this, repository); assert.equal(id, merchantId); return rules();
  } };
  assert.deepEqual(await readExistingMerchantRules(repository, merchantId), rules());
});
for (const malformed of [null, false, "reader"]) test(`malformed explicit existing-reader never uses provisioning fallback: ${String(malformed)}`, async () => {
  assert.equal(await readExistingMerchantRules({ getRules: () => assert.fail("must not provision"), getExistingRules: malformed as never }, merchantId), undefined);
});
test("returns the validated percentage snapshot rather than reading a mutable getter twice", async () => {
  let reads = 0;
  const input = { ...rules(), get maxDiscountPercent() { return ++reads === 1 ? 20 : 999; } };
  const result = await readExistingMerchantRules({ getRules: () => input }, merchantId);
  assert.equal(result?.maxDiscountPercent, 20);
});
for (const value of [undefined, null, {}, { ...rules(), merchantId: "foreign" }, { ...rules(), merchantId: 123 }]) {
  test(`missing/malformed existing policy cannot fall back: ${JSON.stringify(value)}`, async () => {
    const repository: Reader = { getRules: () => assert.fail("must not create policy"), getExistingRules: async () => value as never };
    assert.equal(await readExistingMerchantRules(repository, merchantId), undefined);
  });
}
for (const method of ["getRules", "getExistingRules"] as const) {
  for (const field of ["maxDiscountPercent", "minimumMarginPercent"] as const) for (const value of [undefined, null, -1, 101, NaN, Infinity, -Infinity, "20", true]) {
    test(`${method} rejects unknown ${field}=${String(value)} without numeric defaults`, async () => {
      const invalid = { ...rules(), [field]: value }, read = async () => invalid as never;
      const repository: Reader = method === "getRules" ? { getRules: read } : { getRules: () => assert.fail("fallback"), getExistingRules: read };
      assert.equal(await readExistingMerchantRules(repository, merchantId), undefined);
      assert.equal(invalid[field], value);
    });
  }
  for (const percent of [0, 100, 12.5]) test(`${method} preserves explicit percentage ${percent}`, async () => {
    const input = { ...rules(), maxDiscountPercent: percent, minimumMarginPercent: percent, merchantId }, read = async () => input;
    const repository: Reader = method === "getRules" ? { getRules: read } : { getRules: () => assert.fail("fallback"), getExistingRules: read };
    const result = await readExistingMerchantRules(repository, merchantId);
    assert.equal(result?.maxDiscountPercent, percent); assert.equal(result?.minimumMarginPercent, percent);
    assert.deepEqual(input, { ...rules(), maxDiscountPercent: percent, minimumMarginPercent: percent, merchantId });
  });
  test(`${method} propagates IO failure once with no fallback/default`, async () => {
    const failure = new Error("synthetic-read-failure"); let calls = 0;
    const read = async (): Promise<MerchantRules> => { calls++; throw failure; };
    const repository: Reader = method === "getRules" ? { getRules: read } : { getRules: () => assert.fail("fallback"), getExistingRules: read };
    await assert.rejects(readExistingMerchantRules(repository, merchantId), error => error === failure); assert.equal(calls, 1);
  });
}
test("legacy explicit synchronous adapters remain supported without mutating their policy", async () => {
  const input = { ...rules(), blockedRegions: ["synthetic-region"], policies: { termsUrl: "https://example.invalid/terms" } };
  const before = structuredClone(input), result = await readExistingMerchantRules({ getRules: () => input }, merchantId);
  assert.deepEqual(result, input); result!.blockedRegions.push("changed"); result!.policies!.termsUrl = "changed";
  assert.deepEqual(input, before);
});
for (const id of ["", " ", "x\0y", "x\ud800", "x\udc00", "x".repeat(192), null, {}]) test(`invalid tenant fails before reader: ${JSON.stringify(id)}`, async () => {
  let calls = 0; assert.equal(await readExistingMerchantRules({ getRules: () => { calls++; return rules(); } }, id as never), undefined); assert.equal(calls, 0);
});

type Call = { operation: string; args: unknown };
function prismaFixture(row: unknown = { ...rules(), merchantId }) {
  const calls: Call[] = [], links = { privacyUrl: "https://example.invalid/privacy" };
  const prisma = {
    merchantRule: { async findUnique(args: unknown) { calls.push({ operation: "rules", args }); return row; },
      upsert: () => assert.fail("read cannot upsert defaults"), update: () => assert.fail("read cannot update") },
    merchant: { async findUnique(args: unknown) { calls.push({ operation: "links", args }); return { storeSettings: { checkoutPolicyLinks: links } }; },
      update: () => assert.fail("read cannot update merchant") },
  };
  return { repository: new PrismaMerchantRepository(prisma as unknown as PrismaClient), calls, row, links };
}
test("actual Prisma reader returns undefined for absent row without upsert or policy-link lookup", async () => {
  const f = prismaFixture(null); assert.equal(await f.repository.getExistingRules(merchantId), undefined);
  assert.deepEqual(f.calls, [{ operation: "rules", args: { where: { merchantId } } }]);
});
test("actual Prisma reader scopes both reads, maps real Decimals, and keeps policy links", async () => {
  const f = prismaFixture({ ...rules(), merchantId, maxDiscountPercent: new Prisma.Decimal(0), minimumMarginPercent: new Prisma.Decimal(38) });
  const result = await readExistingMerchantRules(f.repository, merchantId);
  assert.equal(result?.maxDiscountPercent, 0); assert.equal(result?.minimumMarginPercent, 38); assert.deepEqual(result?.policies, f.links);
  assert.deepEqual(f.calls, [{ operation: "rules", args: { where: { merchantId } } },
    { operation: "links", args: { where: { id: merchantId }, select: { storeSettings: true } } }]);
});
for (const extra of [{ merchantId: "foreign" }, { merchantId: undefined }, { maxDiscountPercent: null },
  { minimumMarginPercent: undefined }, { maxDiscountPercent: new Prisma.Decimal(101) }, { minimumMarginPercent: new Prisma.Decimal(-1) }]) {
  test(`actual Prisma reader refuses invalid row before mapper defaults: ${JSON.stringify(extra)}`, async () => {
    const f = prismaFixture({ ...rules(), merchantId, ...extra });
    assert.equal(await readExistingMerchantRules(f.repository, merchantId), undefined); assert.equal(f.calls.length, 1);
  });
}

