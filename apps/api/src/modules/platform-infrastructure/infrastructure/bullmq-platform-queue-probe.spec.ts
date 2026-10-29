import assert from "node:assert/strict";
import test from "node:test";
import { BullMqPlatformQueueProbe } from "./bullmq-platform-queue-probe.js";

test("does not instantiate a BullMQ queue when Redis is not configured", async () => {
  let created = 0;
  const probe = new BullMqPlatformQueueProbe(undefined, () => {
    created += 1;
    throw new Error("must_not_create_queue_without_redis");
  });

  assert.deepEqual(await probe.probe(), {
    status: "not_configured",
    source: "bullmq",
    queues: [],
  });
  assert.equal(created, 0);
});

test("reports an invalid Redis URL as unavailable instead of not configured", async () => {
  const result = await new BullMqPlatformQueueProbe("not a redis url").probe();

  assert.deepEqual(result, {
    status: "unavailable",
    source: "bullmq",
    queues: [],
  });
});

test("reports individual queue failures without hiding available queue counts", async () => {
  const closed: string[] = [];
  const probe = new BullMqPlatformQueueProbe("redis://localhost:6379/0", (queue) => ({
    getJobCounts: async () => {
      if (queue === "payment-reconciliation") throw new Error("denied");
      return { waiting: 2, active: 1, delayed: 3, failed: 4, paused: 5, prioritized: 6 };
    },
    close: async () => { closed.push(queue); },
  }));

  const result = await probe.probe();

  assert.equal(result.status, "degraded");
  assert.equal(result.queues.length, 8);
  assert.deepEqual(result.queues.find((queue) => queue.queue === "domain-event-outbox"), {
    key: "domain_event_outbox",
    queue: "domain-event-outbox",
    description: "Encaminhamento de eventos duráveis do monólito.",
    status: "available",
    counts: { waiting: 2, active: 1, delayed: 3, failed: 4, paused: 5, prioritized: 6 },
  });
  assert.deepEqual(result.queues.find((queue) => queue.queue === "payment-reconciliation"), {
    key: "payment_reconciliation",
    queue: "payment-reconciliation",
    description: "Reconciliação periódica de intenções de pagamento pendentes.",
    status: "unavailable",
  });
  assert.equal(closed.length, 8);
});
