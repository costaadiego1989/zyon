import test from "node:test";
import assert from "node:assert/strict";
import { createGetCartTool } from "./get-cart.tool.js";

test("an omitted model cart ID resolves only the authenticated current cart", async () => {
  let calls = 0;
  const tool = createGetCartTool({ merchantId: "merchant", sessionId: "current", handlers: { getCart: async (args: unknown) => {
    calls++; assert.deepEqual(args, { cartId: "current" }); return { cartId: "current", items: [], total: 0, itemCount: 0 };
  } } } as never);
  const result = await tool.execute({});
  assert.equal(result.ok, true); assert.equal(calls, 1);
});

for (const args of [{ cartId: "foreign" }, { cartId: "" }, { merchantId: "foreign" }, { cartId: "current", buyerId: "foreign" }])
  test(`a supplied foreign or malformed reference cannot reach the cart: ${JSON.stringify(args)}`, async () => {
    const tool = createGetCartTool({ merchantId: "merchant", sessionId: "current", handlers: {
      getCart: async () => assert.fail("unauthorized arguments cannot invoke repository delegates"),
    } } as never);
    const result = await tool.execute(args);
    assert.equal(result.ok, false);
  });

test("a mismatched result cannot become confirmed cart evidence", async () => {
  const tool = createGetCartTool({ merchantId: "merchant", sessionId: "current", handlers: {
    getCart: async () => ({ cartId: "foreign", items: [], total: 0, itemCount: 0 }),
  } } as never);
  const result = await tool.execute({});
  assert.equal(result.ok, false);
});
