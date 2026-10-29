import test from "node:test";
import assert from "node:assert/strict";
import { SearchFederatedProductsUseCase } from "../search-federated-products.use-case.js";

function fixture(options: { hostPlan?: string; sellerPlan?: string; hostEnabled?: boolean; sellerEnabled?: boolean;
  hostBlocked?: string[]; sellerBlocked?: string[]; connected?: boolean; billingError?: boolean } = {}) {
  const calls = { searches: [] as any[], products: 0, connections: 0, plans: [] as string[] };
  const product = { id: "partner", sourceMerchantId: "seller", sourceProductId: "source", name: "Tênis de corrida preto", priceCents: 15000,
    currency: "BRL", stockAvailable: true };
  const config = { get: async (id: string) => id === "host"
    ? { enabled: options.hostEnabled ?? true, blockedMerchants: options.hostBlocked ?? [] }
    : { enabled: options.sellerEnabled ?? true, blockedMerchants: options.sellerBlocked ?? [] } };
  const useCase = new SearchFederatedProductsUseCase(
    { getById: async () => { calls.products++; return product; } } as any, config as any,
    { search: async (args: any) => { calls.searches.push(args); return [{ id: "partner" }]; } } as any,
    { marketplaceConnection: {
      findMany: async () => { calls.connections++; return options.connected === false ? [] : [{ sellerMerchantId: "seller" }]; },
      findFirst: async () => options.connected === false ? null : { id: "connection" },
    } } as any,
    { getEffectivePlan: async (id: string) => { calls.plans.push(id); if (options.billingError) throw Error("billing_unavailable");
      return id === "host" ? options.hostPlan ?? "scale" : options.sellerPlan ?? "scale"; } } as any,
  );
  return { useCase, calls, product };
}

test("only effective Scale with marketplace enabled can query an active authorized partner", async () => {
  const f = fixture();
  const result = await f.useCase.execute({ hostMerchantId: "host", query: "tênis de corrida", limit: 3, maxPriceCents: 18000 });
  assert.deepEqual(result.products, [f.product]);
  assert.deepEqual(f.calls.searches[0], { hostMerchantId: "host", query: "tênis de corrida", category: undefined, limit: 3,
    excludeMerchants: [], includeMerchants: ["seller"], maxPriceCents: 18000 });
  assert.deepEqual(f.calls.plans, ["host", "seller"]);
  assert.equal((await f.useCase.getAuthorizedById("host", "partner"))?.id, "partner");
});

test("Growth/Starter or a disabled host never query the partner index, even if old settings are enabled", async () => {
  for (const options of [{ hostPlan: "growth" }, { hostPlan: "starter" }, { hostPlan: "starter179" }, { hostEnabled: false }]) {
    const f = fixture(options);
    assert.deepEqual(await f.useCase.execute({ hostMerchantId: "host", query: "pele oleosa" }), { products: [] });
    assert.equal(f.calls.searches.length, 0);
    assert.equal(f.calls.connections, 0);
    if (options.hostPlan) {
      assert.equal(await f.useCase.getAuthorizedById("host", "partner"), undefined);
      assert.equal(f.calls.products, 0, "no direct detail bypass of the plan gate");
    }
  }
});

test("both directions of blocking, disabled sellers, downgraded sellers and missing connections fail closed", async () => {
  for (const options of [{ hostBlocked: ["seller"] }, { sellerBlocked: ["host"] }, { connected: false },
    { sellerEnabled: false }, { sellerPlan: "growth" }]) {
    const f = fixture(options);
    assert.deepEqual(await f.useCase.execute({ hostMerchantId: "host", query: "pele" }), { products: [] });
    assert.equal(await f.useCase.getAuthorizedById("host", "partner"), undefined);
    assert.equal(f.calls.searches.length, 0);
  }
});

test("a billing outage cannot grant marketplace access", async () => {
  const f = fixture({ billingError: true });
  await assert.rejects(f.useCase.execute({ hostMerchantId: "host", query: "pele" }), /billing_unavailable/);
  assert.equal(f.calls.searches.length, 0);
});

test("stale, foreign, unavailable, wrong-currency and over-budget partner snapshots are excluded", async () => {
  for (const patch of [{ sourceMerchantId: "unconnected" }, { stockAvailable: false }, { currency: "USD" }, { priceCents: 18001 }]) {
    const f = fixture();
    Object.assign(f.product, patch);
    assert.deepEqual((await f.useCase.execute({ hostMerchantId: "host", query: "pele", maxPriceCents: 18000 })).products, []);
  }
});
