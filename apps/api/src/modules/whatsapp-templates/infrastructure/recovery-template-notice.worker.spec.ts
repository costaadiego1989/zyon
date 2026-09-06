import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { SendEmailInput, SendEmailOutput } from "../../notifications/domain/ports/email-sender.port.js";
import { RecoveryTemplateNoticeWorker } from "./recovery-template-notice.worker.js";

function harness(options: { result?: SendEmailOutput; error?: boolean; ownerEmail?: string | null; completionError?: boolean } = {}) {
  const row = {
    id: "notice-1", merchantId: "merchant-1", type: "cart_recovery_template_status",
    title: "Template <approved>\r\nBcc: no", body: '<script>alert("x")</script> & revisão',
    metadata: { revision: 2, status: "approved", contentSid: "HX1", emailStatus: "pending", path: "/cart-recovery" } as Record<string, unknown>,
  };
  const sent: SendEmailInput[] = [];
  let contactReads = 0;
  const prisma = {
    merchantNotification: {
      async findMany({ where }: any) {
        assert.equal(where.type, row.type);
        assert.deepEqual(where.metadata.path, ["emailStatus"]);
        return row.metadata.emailStatus === where.metadata.equals ? [structuredClone(row)] : [];
      },
      async updateMany({ where, data }: any) {
        assert.equal(where.id, row.id);
        assert.equal(where.merchantId, row.merchantId);
        assert.equal(where.type, row.type);
        if (options.completionError && where.metadata.equals === "sending") throw new Error("database down after send");
        if (row.metadata.emailStatus !== where.metadata.equals) return { count: 0 };
        row.metadata = data.metadata;
        return { count: 1 };
      },
    },
    merchantUser: {
      async findFirst({ where, select }: any) {
        contactReads++;
        assert.deepEqual(where, { merchantId: "merchant-1", role: "owner" });
        assert.deepEqual(select, { email: true });
        return options.ownerEmail === null ? null : { email: options.ownerEmail ?? "owner@example.test" };
      },
    },
  } as unknown as PrismaClient;
  const sender = { async send(input: SendEmailInput) {
    sent.push(input);
    if (options.error) throw new Error("timeout");
    return options.result ?? { status: "sent" as const, messageId: "email-1" };
  } };
  return { row, sent, contactReads: () => contactReads, worker: new RecoveryTemplateNoticeWorker(prisma, sender), other: new RecoveryTemplateNoticeWorker(prisma, sender) };
}

test("notice worker claims once across concurrent instances and repeated scans", async () => {
  const h = harness();
  await Promise.all([h.worker.runOnce(), h.worker.runOnce(), h.other.runOnce()]);
  await h.other.runOnce();
  assert.equal(h.sent.length, 1);
  assert.equal(h.contactReads(), 1);
  assert.equal(h.sent[0].to, "owner@example.test");
  assert.equal(h.sent[0].requireDelivery, true);
  assert.equal(h.row.metadata.emailStatus, "sent");
  assert.equal(h.row.metadata.emailMessageId, "email-1");
  assert.equal(h.row.metadata.revision, 2);
});

test("notice worker escapes persisted text and strips subject newlines", async () => {
  const h = harness();
  await h.worker.runOnce();
  assert.match(h.sent[0].html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp;/);
  assert.doesNotMatch(h.sent[0].html, /<script>/);
  assert.doesNotMatch(h.sent[0].subject, /[\r\n]/);
});

for (const [label, options, expected] of [
  ["timeout", { error: true }, "unknown"],
  ["missing provider ID", { result: { status: "sent", messageId: "" } }, "unknown"],
  ["blank provider ID", { result: { status: "queued", messageId: "   " } }, "unknown"],
  ["sender unavailable", { result: { status: "skipped", messageId: "" } }, "unavailable"],
  ["contradictory skipped ID", { result: { status: "skipped", messageId: "email-1" } }, "unknown"],
  ["missing owner", { ownerEmail: null }, "unavailable"],
  ["invalid owner email", { ownerEmail: "bad\r\nrecipient" }, "unavailable"],
] as const) {
  test(`notice worker persists ${label} without resending`, async () => {
    const h = harness(options);
    await h.worker.runOnce();
    assert.equal(h.row.metadata.emailStatus, expected);
    const count = h.sent.length;
    await h.other.runOnce();
    assert.equal(h.sent.length, count);
    if (label === "missing owner" || label === "invalid owner email") assert.equal(count, 0);
  });
}

test("notice completion database failure leaves sending claim and never repeats delivery", async () => {
  const h = harness({ completionError: true });
  await h.worker.runOnce();
  await h.other.runOnce();
  assert.equal(h.row.metadata.emailStatus, "sending");
  assert.equal(h.sent.length, 1);
});

test("worker lifecycle timer is released without dispatching immediately", () => {
  const h = harness();
  h.worker.onModuleInit();
  h.worker.onModuleDestroy();
  assert.equal(h.sent.length, 0);
});
