import "reflect-metadata";
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { WhatsAppWebhookWorker } from "./whatsapp-webhook-worker.service.js";

/**
 * Regression coverage for the worker's log-back-off policy.
 *
 * The original worker logged `whatsapp_inbox_poll_failed` on every poll —
 * which becomes a flood (3×/s by default) when the underlying error is
 * persistent (missing migration, DB outage). The fix throttles repeated
 * identical errors with an exponential back-off and only logs them again
 * after the back-off window elapses, while still surfacing every distinct
 * error message immediately. A successful poll resets the failure streak.
 */
describe("WhatsAppWebhookWorker log back-off", () => {
  function buildWorker(inbox: { claimNext: () => Promise<unknown> }) {
    const handleMessage = { execute: mock.fn(async () => undefined) } as never;
    const handleStatus = { execute: mock.fn(async () => undefined) } as never;
    const configRepo = { findById: async () => null } as never;
    return new WhatsAppWebhookWorker(inbox as never, configRepo, handleMessage, handleStatus);
  }

  // The worker's drain() de-duplicates concurrent calls (only one batch runs
  // at a time). To simulate distinct polling cycles we explicitly wait for
  // the previous batch to finish before invoking drain() again.
  async function waitUntilIdle(worker: WhatsAppWebhookWorker) {
    for (let i = 0; i < 50; i += 1) {
      if (!worker.isDraining()) return;
      await new Promise((r) => setImmediate(r));
    }
    throw new Error("worker never became idle");
  }

  it("surfaces the first error message and tracks it for back-off", async () => {
    const inbox = { claimNext: async () => { throw new Error("table whatsapp_webhook_inbox does not exist"); } };
    const worker = buildWorker(inbox);
    await worker.drain();
    await waitUntilIdle(worker);
    const tracker = worker as unknown as { consecutiveFailures: number; lastFailureMsg: string };
    assert.equal(tracker.consecutiveFailures, 1);
    assert.equal(tracker.lastFailureMsg, "table whatsapp_webhook_inbox does not exist");
  });

  it("tracks consecutive identical errors so the back-off window grows", async () => {
    const inbox = { claimNext: async () => { throw new Error("boom"); } };
    const worker = buildWorker(inbox);
    for (let i = 0; i < 3; i += 1) {
      await worker.drain();
      await waitUntilIdle(worker);
    }
    const tracker = worker as unknown as { consecutiveFailures: number; lastFailureMsg: string };
    assert.equal(tracker.consecutiveFailures, 3);
    assert.equal(tracker.lastFailureMsg, "boom");
  });

  it("resets the failure counter after a successful poll", async () => {
    let n = 0;
    const inbox = {
      claimNext: async () => {
        n += 1;
        if (n === 1) throw new Error("boom");
        return null;
      },
    };
    const worker = buildWorker(inbox);
    await worker.drain();
    await waitUntilIdle(worker);
    const tracker = worker as unknown as { consecutiveFailures: number; lastFailureMsg: string };
    assert.equal(tracker.consecutiveFailures, 1);
    await worker.drain();
    await waitUntilIdle(worker);
    assert.equal(tracker.consecutiveFailures, 0);
  });

  it("surfaces distinct error messages separately (counter increments regardless)", async () => {
    let n = 0;
    const inbox = {
      claimNext: async () => {
        n += 1;
        if (n === 1) throw new Error("error-a");
        if (n === 2) throw new Error("error-b");
        return null;
      },
    };
    const worker = buildWorker(inbox);
    await worker.drain();
    await waitUntilIdle(worker);
    inbox.claimNext = async () => { throw new Error("error-b"); };
    await worker.drain();
    await waitUntilIdle(worker);
    const tracker = worker as unknown as { consecutiveFailures: number; lastFailureMsg: string };
    assert.equal(tracker.consecutiveFailures, 2);
    assert.equal(tracker.lastFailureMsg, "error-b");
  });
});
