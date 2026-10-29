import test from "node:test";
import assert from "node:assert/strict";
import { SupportTicketEntity, isSupportTicketStatus } from "./support-ticket.entity.js";

test("SupportTicketEntity.create assigns sup_ id, widget source and open status", () => {
  const entity = SupportTicketEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    buyerMessage: "Preciso de ajuda com meu pedido"
  });
  const snapshot = entity.snapshot();

  assert.match(snapshot.id, /^sup_/);
  assert.equal(snapshot.merchantId, "mrc_1");
  assert.equal(snapshot.sessionId, "chk_1");
  assert.equal(snapshot.buyerMessage, "Preciso de ajuda com meu pedido");
  assert.equal(snapshot.status, "open");
  assert.equal(snapshot.source, "widget");
  assert.equal(snapshot.resolvedAt, undefined);
  assert.equal(typeof snapshot.createdAt, "string");
  assert.equal(typeof snapshot.updatedAt, "string");
  assert.equal(snapshot.createdAt, snapshot.updatedAt);
});

test("SupportTicketEntity.create trims input strings and respects custom source", () => {
  const entity = SupportTicketEntity.create({
    merchantId: "  mrc_1  ",
    sessionId: "  chk_1  ",
    buyerMessage: "   Olá   ",
    source: "dashboard"
  });
  const snapshot = entity.snapshot();

  assert.equal(snapshot.merchantId, "mrc_1");
  assert.equal(snapshot.sessionId, "chk_1");
  assert.equal(snapshot.buyerMessage, "Olá");
  assert.equal(snapshot.source, "dashboard");
});

test("SupportTicketEntity.create omits empty sessionId after trim", () => {
  const entity = SupportTicketEntity.create({
    merchantId: "mrc_1",
    sessionId: "   ",
    buyerMessage: "Sem sessão"
  });
  const snapshot = entity.snapshot();

  assert.equal(snapshot.sessionId, undefined);
});

test("SupportTicketEntity.create rejects empty merchantId", () => {
  assert.throws(
    () =>
      SupportTicketEntity.create({
        merchantId: "   ",
        buyerMessage: "Oi"
      }),
    /support_ticket_merchant_required/
  );
});

test("SupportTicketEntity.create rejects empty buyerMessage", () => {
  assert.throws(
    () =>
      SupportTicketEntity.create({
        merchantId: "mrc_1",
        buyerMessage: "   "
      }),
    /support_ticket_message_required/
  );
});

test("SupportTicketEntity.updateStatus transitions through the state machine", () => {
  const entity = SupportTicketEntity.create({
    merchantId: "mrc_1",
    buyerMessage: "msg"
  });

  const inProgress = entity.updateStatus("in_progress");
  assert.equal(inProgress.snapshot().status, "in_progress");
  assert.equal(inProgress.snapshot().resolvedAt, undefined);

  const resolved = inProgress.updateStatus("resolved");
  assert.equal(resolved.snapshot().status, "resolved");
  assert.ok(resolved.snapshot().resolvedAt);

  const closed = resolved.updateStatus("closed");
  assert.equal(closed.snapshot().status, "closed");
  assert.ok(closed.snapshot().resolvedAt);
});

test("SupportTicketEntity.updateStatus bumps updatedAt on each transition", async () => {
  const entity = SupportTicketEntity.create({
    merchantId: "mrc_1",
    buyerMessage: "msg"
  });
  const original = entity.snapshot().updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  const next = entity.updateStatus("in_progress").snapshot();

  assert.equal(next.status, "in_progress");
  assert.notEqual(next.updatedAt, original);
});

test("SupportTicketEntity.updateStatus clears resolvedAt when reopening from closed", () => {
  const entity = SupportTicketEntity.create({
    merchantId: "mrc_1",
    buyerMessage: "msg"
  });
  const closed = entity.updateStatus("closed");
  assert.ok(closed.snapshot().resolvedAt);

  const reopened = closed.updateStatus("open");
  assert.equal(reopened.snapshot().status, "open");
  assert.equal(reopened.snapshot().resolvedAt, undefined);
});

test("SupportTicketEntity.updateStatus rejects unknown status values", () => {
  const entity = SupportTicketEntity.create({
    merchantId: "mrc_1",
    buyerMessage: "msg"
  });

  // @ts-expect-error - intentionally invalid
  assert.throws(() => entity.updateStatus("waiting"), /support_ticket_invalid_status/);
});

test("SupportTicketEntity.rehydrate validates the stored status", () => {
  const base = SupportTicketEntity.create({
    merchantId: "mrc_1",
    buyerMessage: "msg"
  }).snapshot();

  assert.doesNotThrow(() => SupportTicketEntity.rehydrate({ ...base, status: "open" }));
  assert.doesNotThrow(() => SupportTicketEntity.rehydrate({ ...base, status: "in_progress" }));
  assert.doesNotThrow(() => SupportTicketEntity.rehydrate({ ...base, status: "resolved" }));
  assert.doesNotThrow(() => SupportTicketEntity.rehydrate({ ...base, status: "closed" }));
  assert.throws(
    () => SupportTicketEntity.rehydrate({ ...base, status: "expired" as never }),
    /support_ticket_invalid_status/
  );
});

test("isSupportTicketStatus narrows unknown strings to false", () => {
  assert.equal(isSupportTicketStatus("open"), true);
  assert.equal(isSupportTicketStatus("closed"), true);
  assert.equal(isSupportTicketStatus("expired"), false);
  assert.equal(isSupportTicketStatus(123), false);
  assert.equal(isSupportTicketStatus(null), false);
  assert.equal(isSupportTicketStatus(undefined), false);
});
