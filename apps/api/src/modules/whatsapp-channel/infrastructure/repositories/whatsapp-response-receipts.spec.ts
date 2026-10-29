import test from "node:test";
import assert from "node:assert/strict";
import { PrismaWhatsAppWebhookInbox } from "./prisma-whatsapp-webhook-inbox.repository.js";
import { HandleStatusUpdateUseCase } from "../../application/use-cases/handle-status-update.use-case.js";

test("saving the worker response retains an early delivery receipt and its accepted message ID", async () => {
  let written: any;
  const previous = { phase: "prepared", sent: [{ index: 0, messageId: "wamid.real" }], receipts: { 0: { messageId: "wamid.real", status: "delivered" } } };
  const tx: any = { $queryRaw: async () => [{ response_state: previous }], $executeRaw: async (query: any) => { written = query.values.find((v: unknown) => typeof v === "string" && v.startsWith("{")); return 1; } };
  const inbox = new PrismaWhatsAppWebhookInbox({ $transaction: (fn: any) => fn(tx) } as any);
  assert.equal(await inbox.saveResponse({ id: "turn", merchantId: "merchant", leaseToken: "lease" } as any, { phase: "prepared", presentation: { messages: [{}] }, sent: [] }), true);
  const result = JSON.parse(written);
  assert.deepEqual(result.sent, previous.sent); assert.deepEqual(result.receipts, previous.receipts);
});
test("a signed receipt recovers an uncertain send without repeating commerce, and is fenced by tenant/config", async () => {
  let selected: any, written: any;
  const saved = { phase: "dispatching", dispatchingIndex: 0, presentation: { messages: [{ type: "text" }] }, sent: [] };
  const tx: any = { $queryRaw: async (query: any) => { selected = query; return [{ response_state: saved, status: "dead" }]; },
    $executeRaw: async (query: any) => { written = query.values.find((v: unknown) => typeof v === "string" && v.startsWith("{")); return 1; } };
  const receipts = new HandleStatusUpdateUseCase({ $transaction: (fn: any) => fn(tx) } as any);
  await receipts.receiveMetaReceipt({ merchantId: "merchant", configId: "config", messageId: "wamid.real", status: "delivered", correlationId: "zyon:turn:0" });
  assert.ok(selected.values.includes("merchant")); assert.ok(selected.values.includes("config"));
  const result = JSON.parse(written); assert.equal(result.phase, "prepared"); assert.deepEqual(result.sent, [{ index: 0, messageId: "wamid.real" }]);
});
