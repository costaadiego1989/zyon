import test from "node:test";
import assert from "node:assert/strict";
import { BuyerSupportController } from "./buyer-support.controller.js";

test("support rejects photos outside the opening of an exchange or return", async () => {
  let messages = 0, openings = 0;
  const cases = {
    buyerTicket: async () => ({ merchantId: "merchant_qa", id: "ticket_qa" }),
    sendMessage: async () => { messages++; return { id: "message_qa" }; },
    genericOpen: () => { openings++; return { ticketId: "ticket_qa" }; },
  };
  const controller = new BuyerSupportController(cases as any);
  const request = { user: { globalUserId: "buyer_qa", role: "buyer" } };
  const body = { content: "Preciso de ajuda", clientMessageId: "message_key_qa" };
  for (const images of [["data:image/png;base64,photo"], "invalid", null]) {
    await assert.rejects(() => controller.send(request, "ticket_qa", { ...body, images }), /photos_only_return_opening/);
    assert.throws(() => controller.create(request, { ...body, merchantId: "merchant_qa", images }), /photos_only_return_opening/);
  }
  assert.equal(messages, 0); assert.equal(openings, 0);
  await controller.send(request, "ticket_qa", body);
  await controller.send(request, "ticket_qa", { ...body, images: [] });
  controller.create(request, { ...body, merchantId: "merchant_qa" });
  assert.equal(messages, 2); assert.equal(openings, 1);
});
