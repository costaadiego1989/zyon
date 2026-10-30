import assert from "node:assert/strict";
import test from "node:test";
import { createCartHandlers } from "../tool-handlers/cart.handlers.js";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { createCartTurnPolicy } from "../../domain/tools/cart-turn-policy.js";
import { explicitCartQuantityCommand, CART_QUANTITY_INSPECTION_UNAVAILABLE, CART_QUANTITY_LINE_REQUIRED,
  CART_QUANTITY_ITEM_NOT_FOUND, FRACTIONAL_CART_QUANTITY_MESSAGE, INSUFFICIENT_CART_STOCK_MESSAGE, INVALID_CART_QUANTITY_MESSAGE } from "../../domain/services/cart-quantity-input.js";
import { buildStoreTools } from "../../domain/tools/store-tools.js";

const text = (quantity: number | string) => `Mude a quantidade do Kit Organizador Essencial no meu carrinho para ${quantity} unidades.`;
const line = { productId: "product", variantId: "essential", sku: "QA-ESSENTIAL", name: "QA Vendas — Kit Organizador Essencial (teste sem envio)", quantity: 1, unitPriceCents: 6000 };
const physical = { ...line, productId: "physical", variantId: "physical", sku: "QA-PHYSICAL", name: "QA Físico R$3", unitPriceCents: 300 };
const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
function fixture(options: { items?: unknown; stock?: { quantity: number; reserved: number }; failCart?: boolean; failStock?: boolean; foreignRow?: boolean } = {}) {
  const calls = { cart: 0, product: 0, stock: 0, writes: 0 };
  const deps = {
    prisma: { storefrontCart: { findUnique: async (args: unknown) => {
      calls.cart++; assert.deepEqual(args, { where: { merchantId_sessionId: { merchantId: "merchant", sessionId: "cart" } }, select: { merchantId: true, sessionId: true, items: true } });
      if (options.failCart) throw Error("PRIVATE_CART_TIMEOUT");
      return { merchantId: options.foreignRow ? "foreign" : "merchant", sessionId: "cart", items: options.items ?? [physical, line] };
    } } },
    cartRepo: new Proxy({}, { get() { return async () => { calls.writes++; assert.fail("inspection cannot create, reprice, remove, reserve or change a cart"); }; } }),
    productRepo: { findById: async (merchant: string, product: string) => { calls.product++; assert.equal(merchant, "merchant"); assert.equal(product, "product");
      return { id: "product", merchantId: "merchant", isActive: true, type: "physical", variants: [{ id: "essential", isActive: true }] }; } },
    stockRepo: { getAvailableStock: async (variant: string) => { calls.stock++; assert.equal(variant, "essential"); if (options.failStock) throw Error("PRIVATE_STOCK_TIMEOUT");
      return options.stock ?? { quantity: 10, reserved: 0 }; } },
  };
  const handlers = createCartHandlers(deps as never, { merchantId: "merchant", sessionId: "cart" });
  return { calls, handlers, inspect: handlers.inspectCartQuantity! };
}
const request = { cartId: "cart", itemReference: "kit organizador essencial", quantity: 20 };
function agentFor(handlers: unknown, provider?: (request: any) => Promise<any>) {
  return createAllowedScopeAgent({ structuredRouting: true, toolHandlers: handlers as never,
    provider: { chat: provider ?? (async () => assert.fail("invalid quantity must finish before the main/retry/review model")) } as never },
  { domain: "STORE_COMMERCE", intent: "ADD_CART", requiresTool: true, needsProductDiscovery: false });
}
const input = { merchantId: "merchant", sessionId: "cart", cartId: "cart", history: [], userMessage: text(20) };

test("real quantity20 is rejected by canonical read before model tool arguments or writes", async () => {
  const f = fixture();
  const result = await agentFor(f.handlers).run(input);
  assert.equal(result.message, INSUFFICIENT_CART_STOCK_MESSAGE); assert.equal(result.safetyValidation.safe, true);
  assert.deepEqual(result.toolsUsed, []); assert.deepEqual(result.blocks, []);
  assert.deepEqual(f.calls, { cart: 1, product: 1, stock: 1, writes: 0 });
  assert.equal(line.quantity, 1); assert.equal(physical.quantity, 1);
});

test("canonical inspection never silently changes target20 to2", async () => {
  const f = fixture(); assert.deepEqual(explicitCartQuantityCommand(text(20)), { itemReference: "kit organizador essencial", quantity: 20 });
  const result = await f.inspect(request); assert.equal(result.quantity, 20);
  assert.equal(result.status, "rejected"); assert.equal(f.calls.writes, 0);
});

test("a zero target is only admitted and bound; the inspection never removes any line", async () => {
  const f = fixture(); const result = await f.inspect({ ...request, quantity: 0 });
  assert.deepEqual(result, { status: "admitted", cartId: "cart", quantity: 0,
    selection: { cartId: "cart", quantity: 0, variantId: "essential", optionItemIds: [], serviceSlotId: null } });
  assert.deepEqual(f.calls, { cart: 1, product: 0, stock: 0, writes: 0 });
});

test("an explicit zero reaches only the inspected writer line and preserves the R3 sibling", async () => {
  const f = fixture(); let updates = 0;
  const agent = agentFor({ ...f.handlers, updateCartItem: async (args: unknown) => {
    updates++; assert.deepEqual(args, { cartId: "cart", variantId: "essential", quantity: 0, optionItemIds: [], serviceSlotId: null });
    return { cartId: "cart", items: [{ variantId: "physical", name: "QA Físico R$3", quantity: 1, unitPrice: 3, lineTotal: 3 }], total: 3, itemCount: 1 };
  } }, async request => {
    const system = JSON.parse(request.messages[0].content);
    assert.equal(system.cartQuantityAdmission.selection.cartId, "cart");
    assert.equal(system.cartQuantityAdmission.selection.variantId, "essential");
    assert.equal(system.cartQuantityAdmission.selection.quantity, 0);
    return { content: "", toolCalls: [{ id: "update", name: "update_cart_item", args: { cartId: "cart", variantId: "essential", quantity: 0 } }], usage };
  });
  const result = await agent.run({ ...input, userMessage: text(0) });
  assert.equal(updates, 1); assert.equal(result.safetyValidation.safe, true);
  const summary = result.blocks.find(block => block.type === "cart_summary") as any;
  assert.deepEqual(summary?.data.items.map((item: any) => item.variantId), ["physical"]);
});

for (const value of [-1, 100]) test(`invalid target ${value} ends without even reading the cart`, async () => {
  const f = fixture(); const result = await agentFor(f.handlers).run({ ...input, userMessage: text(value) });
  assert.equal(result.message, INVALID_CART_QUANTITY_MESSAGE); assert.deepEqual(f.calls, { cart: 0, product: 0, stock: 0, writes: 0 });
});
test("fractional input retains its pre-context rejection", async () => {
  const f = fixture(); const result = await agentFor(f.handlers).run({ ...input, userMessage: text("1,5") });
  assert.equal(result.message, FRACTIONAL_CART_QUANTITY_MESSAGE); assert.equal(f.calls.cart, 0); assert.equal(f.calls.writes, 0);
});

test("duplicate product or option lines demand a reviewed line instead of choosing one", async () => {
  const f = fixture({ items: [physical, { ...line, selectedOptions: [{ itemId: "red" }] }, { ...line, selectedOptions: [{ itemId: "blue" }] }] });
  const result = await agentFor(f.handlers).run(input);
  assert.equal(result.message, CART_QUANTITY_LINE_REQUIRED); assert.equal(f.calls.stock, 0); assert.equal(f.calls.writes, 0);
});
test("an absent named item does not fall back to the R3 item", async () => {
  const f = fixture({ items: [physical] }); const result = await agentFor(f.handlers).run(input);
  assert.equal(result.message, CART_QUANTITY_ITEM_NOT_FOUND); assert.equal(f.calls.product, 0); assert.equal(f.calls.writes, 0);
});

for (const options of [{ failCart: true }, { failStock: true }, { foreignRow: true },
  { stock: { quantity: NaN, reserved: 0 } }, { stock: { quantity: Infinity, reserved: 0 } },
  { stock: { quantity: 10, reserved: NaN } }, { stock: { quantity: 10, reserved: -1 } }, { stock: { quantity: 10, reserved: 11 } }]) {
  test(`failed or invalid canonical read never becomes a stock claim: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); const result = await agentFor(f.handlers).run(input);
    assert.equal(result.message, CART_QUANTITY_INSPECTION_UNAVAILABLE); assert.doesNotMatch(result.message, /PRIVATE_/);
    assert.equal(f.calls.writes, 0); assert.ok(f.calls.cart <= 1); assert.ok(f.calls.stock <= 1);
  });
}
test("sibling option quantities consume the same stock without being changed", async () => {
  const f = fixture({ items: [physical, line, { ...line, name: "Outra apresentação", quantity: 8, selectedOptions: [{ itemId: "blue" }] }] });
  const result = await f.inspect({ ...request, quantity: 3 }); assert.equal(result.status, "rejected");
  assert.equal(result.status === "rejected" && result.code, "variant_out_of_stock"); assert.equal(f.calls.writes, 0);
});
test("foreign cart IDs cannot be normalized or silently replaced", async () => {
  const f = fixture(); const result = await f.inspect({ ...request, cartId: "foreign" });
  assert.equal(result.status, "unavailable"); assert.equal(f.calls.cart, 0); assert.equal(f.calls.writes, 0);
});

for (const message of [`Não ${text(0).toLowerCase()}`, `Se possível, ${text(0).toLowerCase()}`, `Exemplo: "${text(0)}"`,
  `Mude a quantidade do Kit Organizador Essencial no meu carrinho para 0 unidades se houver desconto.`]) {
  test(`negation/quotation/condition grants no inspected binding: ${message}`, () => {
    assert.equal(explicitCartQuantityCommand(message), undefined);
  });
}
test("inspection is internal and cannot be selected as a model tool", () => {
  assert.equal(buildStoreTools().some(tool => /inspect/i.test(tool.name)), false);
});
test("an inspected binding cannot target the R3 line or substitute20 by2", async () => {
  for (const args of [{ cartId: "cart", variantId: "physical", quantity: 0 }, { cartId: "cart", variantId: "essential", quantity: 2 }]) {
    const policy = createCartTurnPolicy(text(0), undefined, "cart", { cartId: "cart", variantId: "essential", quantity: 0, optionItemIds: [], serviceSlotId: null });
    const [tool] = policy.wrap([{ name: "update_cart_item", execute: async () => assert.fail("a mismatched line or target cannot reach the writer") }]);
    assert.equal((await tool!.execute(args)).ok, false);
  }
});
