import assert from "node:assert/strict";
import test from "node:test";
import { classifyHumanReplay } from "./whatsapp-human-message-router.js";
import type { HandoffState } from "../../domain/services/whatsapp-handoff-state.js";

test("T50", async t => {
  const binding: HandoffState = { id: "binding", merchantId: "merchant", configId: "config", whatsappSessionId: "session",
    mode: "waiting_human", epoch: 1, ticketId: "ticket", assignedOperatorId: null };
  const turn = { scope: { merchantId: "merchant", configId: "config", whatsappSessionId: "session" }, inboxId: "inbox" };
  const metadata = { kind: "whatsapp_incoming", schemaVersion: 1, configId: "config", whatsappSessionId: "session", inboxId: "inbox", bindingId: "binding", epoch: 1 };
  const previous = { id: "message", ticketId: "ticket", metadata };
  await t.test("an already captured input remains received after close or a different case without adopting its epoch", () => {
    for (const current of [binding, { ...binding, mode: "human" as const, epoch: 2, assignedOperatorId: "operator" },
      { ...binding, mode: "ai" as const, epoch: 3, ticketId: null }, { ...binding, epoch: 4, ticketId: "other-case" }]) {
      assert.deepEqual(classifyHumanReplay(current, turn, previous), { kind: "received", receipt: {
        inboxId: "inbox", sessionId: "session", bindingId: "binding", ticketId: "ticket", epoch: 1, messageId: "message",
      } });
    }
  });
  await t.test("only the original live intake epoch can resume its confirmation", () => {
    const intake = { ...previous, metadata: { ...metadata, kind: "whatsapp_intake" } };
    const result = classifyHumanReplay(binding, turn, intake);
    assert.equal(result.kind, "notice");
    if (result.kind === "notice") assert.deepEqual({ ...result.notice, reply: "copy" }, { confirmed: true, bindingId: "binding", ticketId: "ticket", epoch: 1, reply: "copy" });
    for (const current of [{ ...binding, mode: "human" as const, epoch: 2, assignedOperatorId: "operator" },
      { ...binding, mode: "ai" as const, epoch: 2, ticketId: null }, { ...binding, ticketId: "other-case", epoch: 3 }]) {
      const replay = classifyHumanReplay(current, turn, intake);
      assert.equal(replay.kind, "received");
      if (replay.kind === "received") assert.equal(replay.receipt.epoch, 1);
    }
  });
  await t.test("no prior receipt leaves the active decision to the canonical transaction", () => {
    assert.equal(classifyHumanReplay(binding, turn, null), undefined);
  });
  await t.test("a record for a different config, session, inbox or invalid epoch cannot authorize a replay", () => {
    for (const patch of [{ configId: "foreign" }, { whatsappSessionId: "foreign" }, { inboxId: "foreign" },
      { epoch: -1 }, { epoch: "1" }, { kind: "text" }, { schemaVersion: 2 }]) {
      assert.throws(() => classifyHumanReplay(binding, turn, { ...previous, metadata: { ...metadata, ...patch } }), /whatsapp_human_receipt_invalid/);
    }
    for (const patch of [{ merchantId: "foreign" }, { configId: "foreign" }, { whatsappSessionId: "foreign" }])
      assert.throws(() => classifyHumanReplay({ ...binding, ...patch }, turn, previous), /whatsapp_human_receipt_invalid/);
  });
});
