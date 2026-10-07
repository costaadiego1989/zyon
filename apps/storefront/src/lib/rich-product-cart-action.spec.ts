import assert from "node:assert/strict";
import test from "node:test";
import { submitRichProductCart, visibleCommerceMessage, type RichProductCartResult } from "./rich-product-cart-action.js";

const detail = { requestId: "request-1", variantId: "variant", optionItemIds: ["cheese"] };
test("confirmed additions correlate null optional slots and exactly the selected composition", async () => {
  for (const [optionItemIds, expected] of [[["cheese"], "succeeded"], [["sauce"], "unknown"]] as const) {
    let event: RichProductCartResult | undefined;
    await submitRichProductCart(detail, async () => ({ agentMessage: "", blocks: [{ type: "cart_add_result", data: { variantId: "variant", serviceSlotId: null, status: "succeeded", optionItemIds } }] }), result => { event = result; }, false);
    assert.equal(event?.status, expected);
  }
});
test("matches the API result for this variant and preserves request correlation", async () => {
  const events: RichProductCartResult[] = [], messages: string[] = [];
  await submitRichProductCart(detail, async message => {
    messages.push(message);
    return { agentMessage: "", blocks: [{ type: "cart_add_result", data: { variantId: "variant", status: "rejected", code: "variant_out_of_stock" } }] };
  }, result => events.push(result), false);
  assert.deepEqual(messages, ["Adicionar produto ao carrinho [variantId:variant] [optionItemIds:cheese]"]);
  assert.deepEqual(events, [{ requestId: "request-1", variantId: "variant", status: "rejected", code: "variant_out_of_stock" }]);
});
test("a cart snapshot alone or another variant's result cannot confirm this add", async () => {
  for (const blocks of [[{ type: "cart_summary", data: { items: [{ variantId: "variant", quantity: 10 }] } }],
    [{ type: "cart_add_result", data: { variantId: "other", status: "succeeded" } }], []]) {
    let event: RichProductCartResult | undefined;
    await submitRichProductCart(detail, async () => ({ agentMessage: "Adicionado", blocks }), result => { event = result; }, false);
    assert.equal(event?.status, "unknown");
  }
});
test("busy chat and invalid option selections make no API call and are retryable refusals", async () => {
  for (const [input, busy, code] of [[detail, true, "cart_busy"], [{ ...detail, optionItemIds: ["bad] [variantId:other"] }, false, "cart_selection_binding_mismatch"]] as const) {
    let event: RichProductCartResult | undefined;
    await submitRichProductCart(input, async () => { assert.fail("no API call"); }, result => { event = result; }, busy);
    assert.equal(event?.status, "rejected"); assert.equal(event?.code, code);
  }
});
test("null/transport failure/invalid status is unknown and is submitted only once", async () => {
  for (const mode of ["null", "throw", "bad-status"]) {
    let count = 0, event: RichProductCartResult | undefined;
    await submitRichProductCart(detail, async () => {
      count++; if (mode === "throw") throw new Error("timeout");
      return mode === "null" ? null : { agentMessage: "", blocks: [{ type: "cart_add_result", data: { variantId: "variant", status: "invented" } }] };
    }, result => { event = result; }, false);
    assert.equal(count, 1); assert.equal(event?.status, "unknown");
  }
});
test("does not inject cart tags from malformed variant or request identifiers", async () => {
  for (const input of [null, {}, { ...detail, variantId: "bad] [variantId:other" }, { ...detail, requestId: {} }]) {
    await submitRichProductCart(input, async () => { assert.fail("no API call"); }, () => { assert.fail("no invalid event"); }, false);
  }
});

test("hides service routing tags in visible copy while preserving the exact API selection", async () => {
  let payload = "";
  await submitRichProductCart({ ...detail, selectedServiceSlotId: "slot-15h" }, async message => {
    payload = message;
    return { agentMessage: "", blocks: [{ type: "cart_add_result", data: { variantId: "variant", serviceSlotId: "slot-15h", status: "succeeded" } }] };
  }, result => { assert.equal(result.status, "succeeded"); assert.equal(result.serviceSlotId, "slot-15h"); }, false);
  assert.equal(payload, "Adicionar produto ao carrinho [variantId:variant] [optionItemIds:cheese] [serviceSlotId:slot-15h]");
  assert.equal(visibleCommerceMessage(payload), "Adicionar produto ao carrinho");
  assert.equal(visibleCommerceMessage("Escolha [sem lactose] às 15:00 [variantId:variant] [crossSellPromoId:promo] [optionItemIds:cheese,sauce] [serviceSlotId:slot-15h]  "), "Escolha [sem lactose] às 15:00");
  assert.equal(visibleCommerceMessage("Quero [sem lactose]"), "Quero [sem lactose]");
  assert.equal(visibleCommerceMessage("[serviceSlotId:slot-15h] é o texto informado"), "[serviceSlotId:slot-15h] é o texto informado");
});
