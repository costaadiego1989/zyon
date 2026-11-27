import test from "node:test";
import assert from "node:assert/strict";
import { GetStoreConfigUseCase } from "./get-store-config.use-case.js";
import { CashbackService } from "../../../cashback/application/cashback.service.js";

const snapshot = (merchantId: string): any => ({ merchant: { id: merchantId, name: "Loja", theme: {},
  storeSettings: { cashbackEnabled: true, cashback: { enabled: true } } }, stories: [] });
const published = { terms: "Private program terms must not be returned by the public config" };

function fixture(programs: Record<string, any>) {
  const reads: string[] = [], transactions: string[] = [];
  const service = new CashbackService({ transaction: async (merchantId: string, work: any) => {
    transactions.push(merchantId); return work({});
  }, program: async (_tx: unknown, merchantId: string) => {
    reads.push(merchantId);
    return programs[merchantId] ?? { merchantId, status: "disabled", published: null, draft: null };
  }, wallet: () => assert.fail("public configuration must not load a buyer wallet"),
  saveWallet: () => assert.fail("public configuration must not write a wallet") } as any);
  const useCase = new GetStoreConfigUseCase({ findPublicConfig: async id => snapshot(id), findMerchantConfig: async id => snapshot(id) }, undefined, service);
  return { useCase, service, reads, transactions };
}

for (const [name, status, rules, expected] of [
  ["never configured", "disabled", null, false], ["draft only", "disabled", null, false],
  ["active published", "active", published, true], ["active without publication", "active", null, false],
  ["paused", "paused", published, false], ["ended", "ended", published, false],
] as const) test(`CB-MENU-01 public config reflects persisted ${name} and ignores client settings`, async () => {
  const f = fixture({ shop: { merchantId: "shop", status, published: rules, draft: published } });
  const publicConfig = await f.useCase.execute(" SHOP ");
  const channelConfig = await f.useCase.executeForMerchant("shop");
  assert.equal(publicConfig.cashbackEnabled, expected);
  assert.equal(channelConfig.cashbackEnabled, expected);
  assert.deepEqual(f.reads, ["shop", "shop"]);
  assert.deepEqual(f.transactions, ["shop", "shop"]);
  assert.equal(Object.hasOwn(publicConfig, "published"), false);
  assert.equal(Object.hasOwn(publicConfig, "wallet"), false);
  assert.ok(!JSON.stringify(publicConfig).includes(published.terms));
});

test("CB-MENU-01 enabled read is merchant scoped and refreshes after a pause without caching", async () => {
  const programs = { a: { merchantId: "a", status: "active", published }, b: { merchantId: "b", status: "paused", published } };
  const f = fixture(programs);
  assert.equal((await f.useCase.executeForMerchant("a")).cashbackEnabled, true);
  assert.equal((await f.useCase.executeForMerchant("b")).cashbackEnabled, false);
  programs.a.status = "paused";
  assert.equal((await f.useCase.executeForMerchant("a")).cashbackEnabled, false);
  assert.deepEqual(f.reads, ["a", "b", "a"]);
});

test("CB-MENU-01 configuration fails closed for missing dependency, failed storage or mismatched program scope", async () => {
  assert.equal((await new GetStoreConfigUseCase({ findPublicConfig: async () => snapshot("shop") }).execute("shop")).cashbackEnabled, false);
  const unavailable = new GetStoreConfigUseCase({ findPublicConfig: async () => snapshot("shop") }, undefined,
    { isProgramEnabled: async () => { throw new Error("storage unavailable"); } } as any);
  assert.equal((await unavailable.execute("shop")).cashbackEnabled, false);
  const f = fixture({ shop: { merchantId: "foreign", status: "active", published } });
  assert.equal((await f.useCase.execute("shop")).cashbackEnabled, false);
  assert.equal((await f.useCase.execute("absent")).cashbackEnabled, false);
});

for (const source of ["configured", "legacy"] as const) for (const enabled of [true, false]) {
  test(`CB-MENU-04 ${source} welcome replies advertise cashback only when enabled=${enabled}`, async () => {
    const replies = ["Ver novidades", "Cashback", "Meus dados", "Consultar CASHBACK"], before = [...replies];
    const config = snapshot("shop");
    if (source === "configured") config.quickReplies = { welcome: replies };
    else config.merchant.storeSettings.quick_replies = { stages: [{ stage: "welcome", replies }] };
    const useCase = new GetStoreConfigUseCase({ findPublicConfig: async () => config, findMerchantConfig: async () => config }, undefined,
      { isProgramEnabled: async (merchantId: string) => { assert.equal(merchantId, "shop"); return enabled; } } as any);
    const expected = enabled ? before : ["Ver novidades", "Meus dados"];
    assert.deepEqual((await useCase.execute("shop")).quickReplies, expected);
    assert.deepEqual((await useCase.executeForMerchant("shop")).quickReplies, expected);
    assert.deepEqual(replies, before, "public projection must preserve the configured source array");
  });
}
