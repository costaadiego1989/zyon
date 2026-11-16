import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { SpreadsheetImportScheduler, SPREADSHEET_IMPORT_QUEUE } from "./spreadsheet-import.job.js";

test("actual queue accepts a stable import job and deduplicates replay", async t => {
  const previous = process.env.REDIS_URL;
  // Dedicated disposable test broker; never consume production environment URLs.
  process.env.REDIS_URL = "redis://127.0.0.1:16385";
  const scheduler = new SpreadsheetImportScheduler();
  const reader = new Queue(SPREADSHEET_IMPORT_QUEUE, { connection: { host: "127.0.0.1", port: 16385 } });
  const jobId = "athom-qa-" + randomUUID(), queueId = "import-" + jobId;
  t.after(async () => { await (await reader.getJob(queueId))?.remove(); await scheduler.onModuleDestroy(); await reader.close();
    if (previous === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous; });
  await scheduler.enqueue(jobId, "athom-qa-merchant");
  await scheduler.enqueue(jobId, "athom-qa-merchant");
  const actual = await reader.getJob(queueId);
  assert.ok(actual);
  assert.deepEqual(actual.data, { jobId, merchantId: "athom-qa-merchant" });
  assert.equal(await actual.getState(), "waiting");
  assert.equal((await reader.getJobs(["waiting"])).filter(job => job.id === queueId).length, 1);
});
