import test from "node:test";
import assert from "node:assert/strict";
import { resolveDeterministicShortcut, type DeterministicShortcutDeps } from "./deterministic-shortcuts.service.js";
import type { CartAddResultBlock } from "../../domain/types/conversation-block.js";
import type { StorefrontConversationInput, StorefrontConversationOutput } from "../../domain/ports/conversation.port.js";

const input = (message = "Adicionar produto ao carrinho [variantId:physical]", cartId: string | undefined = "cart_qa"): StorefrontConversationInput => ({
  userMessage: message, merchantId: "merchant_qa", sessionId: "conversation_qa", cartId, history: [], storeCategory: "test",
});
const savedCart = (variantId = "physical", optionIds: string[] = []) => ({
  cartId: "cart_qa", total: 17.43, discount: 0, itemCount: 1,
  addedItem: { variantId, optionItemIds: [...optionIds] },
  items: [{ variantId, name: "Produto QA", quantity: 1, unitPrice: 17.43, lineTotal: 17.43,
    selectedOptions: optionIds.map(itemId => ({ itemId, groupName: "Extras", itemName: itemId, priceModifier: 1.25 })) }],
});
function fixture(result: unknown | (() => Promise<unknown>)) {
  const calls: Array<Parameters<NonNullable<DeterministicShortcutDeps["addItemToCart"]>>[0]> = [];
  const events: string[] = [];
  const deps: DeterministicShortcutDeps = {
    productRepo: { search: async () => { throw Error("catalog_not_expected_on_direct_add"); } } as unknown as DeterministicShortcutDeps["productRepo"],
    copyService: { generateVariantCopy: async () => { throw Error("copy_not_expected_on_direct_add"); } } as unknown as DeterministicShortcutDeps["copyService"],
    emitFunnelEvent: async (_merchantId, _sessionId, event) => { events.push(event); },
    applyCoupon: async () => { throw Error("coupon_not_authorized_by_add"); },
    addItemToCart: async args => { calls.push(args); return typeof result === "function" ? result() : result; },
  };
  return { deps, calls, events };
}
function acknowledgement(output: StorefrontConversationOutput | null): CartAddResultBlock {
  assert.ok(output);
  const results = output.blocks.filter((block): block is CartAddResultBlock => block.type === "cart_add_result");
  assert.equal(results.length, 1, "one outcome for this command, never a second write or unrelated snapshot");
  return results[0]!;
}

test("physical direct add acknowledges only the server admission and preserves server pricing", async () => {
  const run = fixture(savedCart());
  const result = await resolveDeterministicShortcut(run.deps, input("Adicionar produto de R$ 0,01 ao carrinho [variantId:physical]"));
  assert.deepEqual(acknowledgement(result).data, { cartId: "cart_qa", variantId: "physical", optionItemIds: [], status: "succeeded" });
  assert.deepEqual(run.calls, [{ cartId: "cart_qa", variantId: "physical", quantity: 1 }]);
  assert.deepEqual(run.events, ["cart_viewed"]);
  const summary = result!.blocks.find(block => block.type === "cart_summary");
  assert.equal(summary?.data.total, 17.43);
  assert.equal(summary?.data.items[0]?.price, 17.43);
  assert.equal(result!.message, "Produto adicionado ao carrinho.");
});

test("food acknowledgement binds requested options to both addedItem and the saved composition", async () => {
  const run = fixture(savedCart("food", ["drink", "extra"]));
  const result = await resolveDeterministicShortcut(run.deps, input("Adicionar refeição ao carrinho [variantId:food] [optionItemIds:extra,drink]"));
  assert.deepEqual(acknowledgement(result).data, { cartId: "cart_qa", variantId: "food", optionItemIds: ["drink", "extra"], status: "succeeded" });
  assert.deepEqual(run.calls, [{ cartId: "cart_qa", variantId: "food", quantity: 1, selectedOptionItemIds: ["extra", "drink"] }]);
});

test("native Food DTO without public item IDs still acknowledges the server-bound options", async () => {
  const cart = savedCart("food", ["drink", "extra"]);
  const nativeDto = { ...cart, items: cart.items.map(item => ({ ...item,
    selectedOptions: item.selectedOptions.map(({ itemId: _itemId, ...option }) => option) })) };
  const run = fixture(nativeDto);
  const result = await resolveDeterministicShortcut(run.deps, input("Adicionar refeição ao carrinho [variantId:food] [optionItemIds:extra,drink]"));
  assert.deepEqual(acknowledgement(result).data, { cartId: "cart_qa", variantId: "food", optionItemIds: ["drink", "extra"], status: "succeeded" });
  assert.equal(result!.blocks.find(block => block.type === "cart_summary")?.data.total, 17.43);
});

test("stale cart snapshots, wrong selections and malformed admissions remain unknown", async t => {
  const original = savedCart("food", ["extra"]);
  const cases: Array<[string, unknown]> = [
    ["missing admission marker despite an existing matching item", { ...original, addedItem: undefined }],
    ["another saved cart", { ...original, cartId: "other_cart" }],
    ["another admitted variant", { ...original, addedItem: { variantId: "other", optionItemIds: ["extra"] } }],
    ["missing admitted options", { ...original, addedItem: { variantId: "food" } }],
    ["different admitted options", { ...original, addedItem: { variantId: "food", optionItemIds: ["drink"] } }],
    ["extra admitted options", { ...original, addedItem: { variantId: "food", optionItemIds: ["extra", "drink"] } }],
    ["different stored options", { ...original, items: savedCart("food", ["drink"]).items }],
    ["missing stored composition", { ...original, items: [{ ...original.items[0]!, selectedOptions: [] }] }],
    ["malformed stored composition", { ...original, items: [{ ...original.items[0]!, selectedOptions: [null] }] }],
    ["unrelated stored item", { ...original, items: savedCart("other", ["extra"]).items }],
    ["zero stored quantity", { ...original, items: [{ ...original.items[0]!, quantity: 0 }] }],
    ["fractional stored quantity", { ...original, items: [{ ...original.items[0]!, quantity: 0.5 }] }],
    ["unexpected admitted service slot", { ...original, addedItem: { ...original.addedItem, serviceSlotId: "slot_other" } }],
    ["unexpected stored service slot", { ...original, items: [{ ...original.items[0]!, selectedServiceSlot: { slotId: "slot_other" } }] }],
    ["ambiguous error envelope", { ...original, error: { unavailable: true } }],
    ["null response", null],
  ];
  for (const [name, response] of cases) await t.test(name, async () => {
    const run = fixture(response);
    const result = await resolveDeterministicShortcut(run.deps, input("Adicionar ao carrinho [variantId:food] [optionItemIds:extra]"));
    assert.equal(acknowledgement(result).data.status, "unknown");
    assert.equal(result!.blocks.some(block => block.type === "cart_summary"), false);
    assert.doesNotMatch(result!.message, /^Produto adicionado/);
    assert.equal(run.calls.length, 1);
    assert.deepEqual(run.events, []);
  });
});

test("explicit stock and composition refusals reject even if an old matching snapshot is present", async t => {
  for (const code of ["variant_out_of_stock", "stock_validation_unavailable", "food_option_required", "required_group_missing", "digital_content_unavailable"]) await t.test(code, async () => {
    const run = fixture({ ...savedCart(), error: code, detail: "Escolha indisponível." });
    const result = await resolveDeterministicShortcut(run.deps, input());
    assert.deepEqual(acknowledgement(result).data, { cartId: "cart_qa", variantId: "physical", optionItemIds: [], status: "rejected", code });
    assert.equal(result!.message, "Escolha indisponível.");
    assert.equal(result!.blocks.some(block => block.type === "cart_summary"), false);
    assert.equal(run.calls.length, 1);
    assert.deepEqual(run.events, []);
  });
});

test("a thrown or unrecognized result produces one unknown outcome without retry or checkout", async t => {
  for (const [name, response] of [
    ["throw after uncertain write", async () => { throw Error("transport_lost_after_write"); }],
    ["unrecognized error code", { error: "internal_database_error", detail: "Internal details must not become a success." }],
  ] as const) await t.test(name, async () => {
    const run = fixture(response);
    const result = await resolveDeterministicShortcut(run.deps, input());
    assert.equal(acknowledgement(result).data.status, "unknown");
    assert.match(result!.message, /Confira o carrinho antes de tentar novamente/);
    assert.equal(run.calls.length, 1);
    assert.equal(result!.blocks.some(block => block.type === "checkout_redirect" || block.type === "checkout_prepared"), false);
    assert.deepEqual(run.events, []);
  });
});

test("case-insensitive grammar and the conversation cart fallback remain unchanged", async () => {
  const run = fixture({ ...savedCart(), cartId: "conversation_qa" });
  const result = await resolveDeterministicShortcut(run.deps, { ...input("ADICIONAR PRODUTO AO CARRINHO [VARIANTID:physical]"), cartId: undefined });
  assert.equal(acknowledgement(result).data.status, "succeeded");
  assert.equal(acknowledgement(result).data.cartId, "conversation_qa");
  assert.equal(run.calls[0]?.cartId, "conversation_qa");
});

test("service slot commands and attachment routing still fall through without calling the add shortcut", async () => {
  const run = fixture(savedCart());
  assert.equal(await resolveDeterministicShortcut(run.deps, input("Adicionar serviço ao carrinho [variantId:service] [serviceSlotId:morning]")), null);
  assert.equal(await resolveDeterministicShortcut(run.deps, { ...input(), attachmentContext: "Lista de compras" }), null);
  assert.deepEqual(run.calls, []);
  assert.deepEqual(run.events, []);
});

test("a best-effort funnel failure cannot erase a proven saved admission", async () => {
  const run = fixture(savedCart());
  run.deps.emitFunnelEvent = async () => { throw Error("analytics_unavailable"); };
  const result = await resolveDeterministicShortcut(run.deps, input());
  assert.equal(acknowledgement(result).data.status, "succeeded");
  assert.equal(run.calls.length, 1);
});
