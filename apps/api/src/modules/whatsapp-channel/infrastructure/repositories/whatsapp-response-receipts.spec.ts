import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { INBOX_LEASE_MS, type WhatsAppInboxClaim } from "../../domain/ports/whatsapp-webhook-inbox.port.js";
import { PrismaWhatsAppWebhookInbox } from "./prisma-whatsapp-webhook-inbox.repository.js";
import { HandleStatusUpdateUseCase } from "../../application/use-cases/handle-status-update.use-case.js";

test("saving the worker response retains an early delivery receipt and its accepted message ID", async () => {
  let written: any;
  const previous = { phase: "prepared", sent: [{ index: 0, messageId: "wamid.real" }], receipts: { 0: { messageId: "wamid.real", status: "delivered" } } };
  const now = new Date("2026-11-16T00:00:00.000Z");
  const payload = { merchantId: "merchant", deviceId: "device", provider: "BUBBLEWHATS", fromNumber: "5511999999999", body: "Synthetic receipt context", messageType: "text", timestamp: now.getTime() };
  const claim: WhatsAppInboxClaim = { id: "turn", merchantId: "merchant", configId: "config", deviceId: "device", leaseToken: "lease", attempts: 1,
    dedupKey: "synthetic-dedup", eventId: "synthetic-inbound-event", kind: "message", payload,
    payloadHash: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
    streamKey: createHash("sha256").update(JSON.stringify(["merchant", "config", "message", payload.fromNumber])).digest("hex") };
  const row = { ...claim, status: "processing", leaseExpiresAt: new Date(now.getTime() + INBOX_LEASE_MS), responseState: previous };
  const expectedWhere = { id: claim.id, merchantId: claim.merchantId, configId: claim.configId, deviceId: claim.deviceId, kind: "message", status: "processing", leaseToken: claim.leaseToken };
  const tx: any = {
    $queryRaw: async (query: any) => {
      const sql = query.strings.join("");
      if (sql.includes("SELECT clock_timestamp() AS now")) return [{ now }];
      const scope = [claim.id, claim.merchantId, claim.configId, claim.deviceId];
      return sql.includes("FOR UPDATE") && query.values.length === scope.length && scope.every((value, index) => query.values[index] === value) ? [{ id: claim.id }] : [];
    },
    whatsAppWebhookInbox: { findFirst: async ({ where }: any) => Object.keys(where).length === Object.keys(expectedWhere).length
      && Object.entries(expectedWhere).every(([key, value]) => where[key] === value) ? row : null },
    $executeRaw: async (query: any) => {
      const scope = [claim.id, claim.merchantId, claim.configId, claim.leaseToken];
      if (!query.strings.join("").includes("UPDATE whatsapp_webhook_inbox") || query.values.length !== scope.length + 1
        || !scope.every((value, index) => query.values[index + 1] === value) || row.leaseExpiresAt <= now) return 0;
      written = query.values[0]; return 1;
    },
  };
  const inbox = new PrismaWhatsAppWebhookInbox({ $transaction: (fn: any) => fn(tx) } as any);
  assert.equal(await inbox.saveResponse({ ...claim, id: "turn", merchantId: "merchant", leaseToken: "lease" } as any, { phase: "prepared", presentation: { messages: [{}] }, sent: [] }), true);
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
