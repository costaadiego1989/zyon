import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationFixture } from "../application/__tests__/fixture.js";
import { GenerationWorker } from "./generation.worker.js";
test("generation worker drains persisted reservations and recovers stale running outcomes without blind resend", async () => {
  const f = await applicationFixture(); try {
    await f.repo.mutate("store-a", [], state => { state.generations["reserved-a"] = { id: "reserved-a", campaignId: "campaign-a", requestedImages: 1, mediaIds: [], status: "reserved", error: null, createdAt: f.clock().toISOString(), updatedAt: f.clock().toISOString() }; state.generations["stalled-a"] = { ...state.generations["reserved-a"], id: "stalled-a", status: "running", updatedAt: "2026-11-14T10:00:00Z" }; return { result: null }; });
    const worker = new GenerationWorker(f.repo, { run: async (merchantId, id) => f.repo.mutate(merchantId, [], state => { assert.equal(id, "reserved-a"); state.generations[id].status = "succeeded"; return { result: state.generations[id] }; }), recoverStalled: async (merchantId, id) => f.repo.mutate(merchantId, [], state => { assert.equal(id, "stalled-a"); state.generations[id].status = "unknown"; state.generations[id].error = "image_provider_outcome_unknown"; return { result: state.generations[id] }; }) }, false, f.clock);
    await worker.drain(); const state = await f.repo.read("store-a"); assert.equal(state.generations["reserved-a"].status, "succeeded"); assert.equal(state.generations["stalled-a"].status, "unknown"); await worker.drain(); assert.equal((await f.repo.read("store-a")).generations["stalled-a"].status, "unknown"); await worker.onModuleDestroy();
  } finally { await f.close(); }
});
