import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PrismaStorefrontCartRepository } from "./prisma-storefront-cart.repository.js";
import { executeStorefrontUiAction } from "../agents/storefront-ui-action.executor.js";
import type { StoreToolHandlers } from "../../domain/tools/types.js";
import { STOREFRONT_CONTRACT_FALLBACK } from "../../domain/contracts/storefront-conversation.schemas.js";

// Characterization of CURRENT behavior, not the desired idempotency contract.
// Real repository/executor with explicit sequential Prisma doubles. No database,
// SQL lock, rollback, crash durability or concurrent-transaction proof is claimed.
function fixture() {
  const rows = new Map<string, any>();
  const scopes: string[] = [];
  let saves = 0;
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ isolation: "read committed", candidates: [] }],
    productVariant: { findFirst: async ({ where }: any) => {
      scopes.push(where.product.merchantId);
      return { product: { type: "physical", metadata: {} }, stock: [{ quantity: 100, reserved: 0 }],
        price: { basePriceInCents: 1000 } };
    } },
    storefrontCart: {
      upsert: async ({ create }: any) => {
        const key = JSON.stringify([create.merchantId, create.sessionId]);
        if (!rows.has(key)) rows.set(key, { id: `row-${rows.size}`, ...create, items: [], total: 0,
          discount: 0, freeShipping: false, couponCode: null, createdAt: new Date(), updatedAt: new Date() });
        return structuredClone(rows.get(key));
      },
      update: async ({ where, data }: any) => {
        const pair = [...rows].find(([, row]) => row.id === where.id);
        assert.ok(pair);
        const saved = { ...pair[1], ...structuredClone(data) };
        rows.set(pair[0], saved); saves++;
        return structuredClone(saved);
      },
    },
  };
  const repo = new PrismaStorefrontCartRepository({ $transaction: async (work: (client: unknown) => unknown) => work(tx) } as unknown as PrismaClient);
  const row = (merchantId = "merchant", sessionId = "cart") => rows.get(JSON.stringify([merchantId, sessionId]));
  const item = { variantId: "variant", productId: "product", name: "Produto", sku: "SKU", unitPriceCents: 1000, quantity: 1 };
  const add = () => repo.addItem("merchant", "cart", item);
  const dto = (cart: Awaited<ReturnType<typeof add>>) => ({ cartId: cart.sessionId, total: cart.total / 100,
    itemCount: cart.items.reduce((sum, line) => sum + line.quantity, 0),
    items: cart.items.map(line => ({ variantId: line.variantId, name: line.name, quantity: line.quantity,
      unitPrice: line.unitPriceCents / 100, lineTotal: line.unitPriceCents * line.quantity / 100 })) });
  return { repo, row, item, add, dto, scopes, saves: () => saves };
}
const action = { tool: "add_item_to_cart", args: { variantId: "variant", quantity: 1 } };

test("characterization: sequential identical repository adds increment twice; cart locking is not intent deduplication", async () => {
  const f = fixture();
  await f.add(); await f.add();
  assert.equal(f.row().items[0].quantity, 2);
  assert.equal(f.row().total, 2000);
  assert.equal(f.saves(), 2);
});

test("characterization: duplicate-add evidence remains merchant and conversation scoped", async () => {
  const f = fixture();
  await f.add(); await f.add();
  await f.repo.addItem("other-merchant", "cart", f.item);
  await f.repo.addItem("merchant", "other-cart", f.item);
  assert.equal(f.row().items[0].quantity, 2);
  assert.equal(f.row("other-merchant").items[0].quantity, 1);
  assert.equal(f.row("merchant", "other-cart").items[0].quantity, 1);
  assert.deepEqual(f.scopes, ["merchant", "merchant", "other-merchant", "merchant"]);
});

test("characterization: getOrCreate saves even an existing cart and extends expiry; not a read-only recovery accessor", async () => {
  const f = fixture();
  await f.add();
  const before = f.saves();
  f.row().expiresAt = new Date(0);
  await f.repo.getOrCreate("merchant", "cart");
  assert.equal(f.saves(), before + 1);
  assert.ok(f.row().expiresAt.getTime() > Date.now());
  assert.equal(f.row().items[0].quantity, 1);
});

for (const attempts of [1, 2]) {
  test(`characterization: ${attempts} separate UI delivery/deliveries with invalid post-write output leave ${attempts} applied unit(s)`, async () => {
    const f = fixture(); let writes = 0; let reads = 0;
    const handlers = { addItemToCart: async () => { writes++; await f.add(); return { total: "invalid-private-output" }; },
      getCart: async () => { reads++; throw new Error("unexpected_refresh"); } } as unknown as StoreToolHandlers;
    for (let index = 0; index < attempts; index++) {
      const result = await executeStorefrontUiAction(handlers, action, "merchant", "cart");
      assert.equal(result.message, STOREFRONT_CONTRACT_FALLBACK);
      assert.deepEqual(result.blocks, []);
    }
    assert.equal(writes, attempts); assert.equal(reads, 0);
    assert.equal(f.row().items[0].quantity, attempts);
  });
}

test("characterization: failed refresh after valid add does not undo committed repository work or retry it", async () => {
  const f = fixture(); let writes = 0; let reads = 0;
  const handlers = { addItemToCart: async () => { writes++; return f.dto(await f.add()); },
    getCart: async () => { reads++; throw new Error("synthetic_refresh_failure"); } } as unknown as StoreToolHandlers;
  await assert.rejects(executeStorefrontUiAction(handlers, action, "merchant", "cart"), /synthetic_refresh_failure/);
  assert.equal(writes, 1); assert.equal(reads, 1);
  assert.equal(f.row().items[0].quantity, 1);
});

test("characterization: invalid second batch output leaves the first effect; fallback is not atomic batch rejection", async () => {
  const f = fixture(); const calls: string[] = [];
  const handlers = { addItemToCart: async ({ variantId }: { variantId: string }) => {
    calls.push(variantId);
    return variantId === "variant" ? f.dto(await f.add()) : { total: "invalid-second-output" };
  }, getCart: async () => { throw new Error("unexpected_refresh"); } } as unknown as StoreToolHandlers;
  const result = await executeStorefrontUiAction(handlers, { tool: "add_catalog_items", args: {
    lines: [{ variantId: "variant", quantity: 1 }, { variantId: "second", quantity: 1 }],
  } }, "merchant", "cart");
  assert.equal(result.message, STOREFRONT_CONTRACT_FALLBACK);
  assert.deepEqual(result.blocks, []);
  assert.deepEqual(calls, ["variant", "second"]);
  assert.equal(f.row().items[0].quantity, 1);
});

