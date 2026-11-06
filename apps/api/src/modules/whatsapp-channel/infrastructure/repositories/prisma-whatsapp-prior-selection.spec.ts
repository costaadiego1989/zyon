import test from "node:test";
import assert from "node:assert/strict";
import { PrismaWhatsAppWebhookInbox } from "./prisma-whatsapp-webhook-inbox.repository.js";

const id = "zyon:" + "a".repeat(32);
for (const kind of ["button", "list"]) for (const delivered of [true, false]) test(`archived ${kind} selection carries its saved checkout scope and exact sent-part evidence: ${delivered}`, async () => {
  const interactive = kind === "button" ? { type: kind, action: { buttons: [{ type: "reply", reply: { id, title: "Pix" } }] } }
    : { type: kind, action: { sections: [{ rows: [{ id, title: "Pix" }] }] } };
  const saved = { state: { checkoutSessionId: "checkout", conversationId: "cart", selections: { [id]: { kind: "tool", tool: "create_payment", args: { method: "pix", fingerprint: "b".repeat(64) } } } },
    presentation: { messages: [{ type: "text", text: { body: "Escolha" } }, { type: "interactive", interactive }] },
    sent: [{ index: delivered ? 1 : 0, messageId: "wamid.accepted" }] };
  const repository = new PrismaWhatsAppWebhookInbox({ $queryRaw: async (query: any) => {
    for (const value of ["merchant", "config", "device", "phone-stream", "session", id]) assert(query.values.includes(value));
    const sql = query.strings.join("?");
    for (const column of ["merchant_id", "config_id", "device_id", "stream_key", "sessionId"]) assert(sql.includes(column));
    return [{ response_state: saved }];
  } } as any);
  const prior = await repository.findPriorSelection({ id: "current", merchantId: "merchant", configId: "config", deviceId: "device", streamKey: "phone-stream" } as any, "session", id);
  assert.equal(prior?.checkoutSessionId, "checkout"); assert.equal(prior?.conversationId, "cart"); assert.equal(prior?.selectionSent, delivered);
});

test("an unrelated sent control does not establish delivery of a stored payment choice", async () => {
  const saved = { state: { selections: { [id]: { kind: "tool", tool: "create_payment", args: {} } } },
    presentation: { messages: [{ type: "interactive", interactive: { type: "button", action: { buttons: [{ reply: { id: "different" } }] } } }] }, sent: [{ index: 0, messageId: "wamid.other" }] };
  const repository = new PrismaWhatsAppWebhookInbox({ $queryRaw: async () => [{ response_state: saved }] } as any);
  assert.equal((await repository.findPriorSelection({} as any, "session", id))?.selectionSent, false);
});
