import test from "node:test";
import assert from "node:assert/strict";
import { Queue } from "bullmq";
import { StrategyMonitorJob } from "./strategy-monitor.job.js";

test("strategy monitor job stays offline without opt-in or Redis", async () => {
  const original = { ...process.env };
  try {
    const job = new StrategyMonitorJob({ run() { assert.fail("disabled monitor cannot run"); } } as any);
    process.env.REVENUE_STRATEGY_MONITOR_ENABLED = "false";
    await job.onModuleInit(); await job.onModuleDestroy();
    process.env.REVENUE_STRATEGY_MONITOR_ENABLED = "true";
    process.env.REDIS_ENABLED = "false";
    await job.onModuleInit(); await job.onModuleDestroy();
    delete process.env.REDIS_ENABLED; process.env.REDIS_URL = " ";
    await job.onModuleInit(); await job.onModuleDestroy();
  } finally { process.env = original; }
});

const fixtureUrl = "redis://127.0.0.1:6397/14";
test("strategy monitor job boots in Redis and replicas share one repeating schedule", {
  skip: process.env.REVENUE_MONITOR_TEST_REDIS_URL !== fixtureUrl,
}, async () => {
  const original = { ...process.env };
  const queue = new Queue("revenue-strategy-monitor", { connection: { host: "127.0.0.1", port: 6397, db: 14 } });
  let calls = 0, done: () => void = () => {};
  const completed = new Promise<void>(resolve => { done = resolve; });
  const service = { async run() { if (++calls >= 2) done(); return { processed: 0, failed: 0 }; } };
  const first = new StrategyMonitorJob(service as any), second = new StrategyMonitorJob(service as any);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await queue.obliterate({ force: true });
    process.env.REVENUE_STRATEGY_MONITOR_ENABLED = "true";
    process.env.REDIS_ENABLED = "true"; process.env.REDIS_URL = fixtureUrl;
    await first.onModuleInit(); await second.onModuleInit();
    await Promise.race([completed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("MONITOR_QUEUE_TIMEOUT")), 15_000); })]);
    const repeats = await queue.getRepeatableJobs();
    assert.equal(repeats.length, 1); assert.equal(Number(repeats[0].every), 15 * 60_000);
    assert.ok(calls >= 2);
  } finally {
    clearTimeout(timeout);
    await first.onModuleDestroy(); await second.onModuleDestroy();
    await queue.obliterate({ force: true }); await queue.close(); process.env = original;
  }
});
