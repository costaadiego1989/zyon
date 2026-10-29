import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import * as nativeGuards from "./native-prisma-admission-guards.mjs";

// Orchestration UNIT doubles only: no real DB/Redis, provider, auth or app proof.
let current, resourceCreates = 0, statusReads = 0;
mock.module("./storefront-journey-owned-resources.mjs", { namedExports: { async createOwnedStorefrontJourneyResources() {
  resourceCreates++; return { runId: current.runId, workerArguments: () => [], close: async () => { current.events.push("resources.close"); } };
} } });
mock.module("./storefront-journey-original-budget.mjs", { namedExports: { inspectOriginalJourneyBudget(options) {
  statusReads++;
  if (current?.continued) { assert.equal(options.approvalId, "storefront-sandbox-20261022-approved130"); return { attemptedCalls: 89, remainingCalls: 41 }; }
  if (current?.extended) { assert.equal(options.approvalId, "storefront-sandbox-20261021-approved90"); return { attemptedCalls: 49, remainingCalls: 41 }; }
  return { attemptedCalls: 14, remainingCalls: 46 };
} } });
mock.module("./native-prisma-admission-guards.mjs", { namedExports: { ...nativeGuards, async terminateOwnedNativeWorker(child) {
  if (child) { current.events.push("terminate.worker"); child.kill(); }
} } });
mock.module("node:child_process", { namedExports: { execFile, spawn(_executable, args) {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), connected: true });
  current.child = child;
  current.workerArgs = args;
  child.kill = () => { if (!child.killed) { child.killed = true; current.events.push("kill.worker"); queueMicrotask(() => child.emit("close", null, "SIGTERM")); } };
  child.send = () => { throw Error("unit_no_credential_send_expected"); };
  current.spawned.resolve();
  if (current.message) queueMicrotask(() => child.emit("message", current.message));
  return child;
} } });
const { runApprovedStorefrontJourney } = await import("./storefront-journey-llm.integration.mjs");
function fixture(message) {
  let resolve;
  const ready = new Promise(done => { resolve = done; });
  current = { runId: randomUUID(), events: [], message, spawned: { ready, resolve } }; return current;
}
test("import is inert and malformed worker key request never reads a key; cleanup still runs", async () => {
  assert.equal(resourceCreates, 0); assert.equal(statusReads, 0);
  const f = fixture({ type: "journey-provider-key-request", runId: "malformed", nonce: randomUUID() }); let keyReads = 0;
  await assert.rejects(runApprovedStorefrontJourney({ expectedConsumedCalls: 14, getProviderKey() { keyReads++; return "unit-never-used-key"; } }), /journey_real_http_or_owned_cleanup_failed/);
  assert.equal(keyReads, 0); assert.equal(f.events.filter(event => event === "resources.close").length, 1);
  assert.ok(f.events.indexOf("terminate.worker") < f.events.indexOf("resources.close"));
});
test("explicit90 authority propagates to the owned worker and retains cleanup on failure", async () => {
  const f = fixture({ type: "journey-provider-key-request", runId: "malformed", nonce: randomUUID() }); f.extended = true;
  let keyReads = 0;
  await assert.rejects(runApprovedStorefrontJourney({ approvalId: "storefront-sandbox-20261021-approved90", expectedConsumedCalls: 49,
    getProviderKey() { keyReads++; throw Error("must-not-read-key"); } }), /journey_real_http_or_owned_cleanup_failed/);
  assert.deepEqual(f.workerArgs.slice(-2), ["49", "storefront-sandbox-20261021-approved90"]);
  assert.equal(keyReads, 0); assert.equal(f.events.filter(event => event === "resources.close").length, 1);
});
test("explicit130 authority propagates to the owned worker without reading a key on invalid child request", async () => {
  const f = fixture({ type: "journey-provider-key-request", runId: "malformed", nonce: randomUUID() }); f.continued = true;
  let keyReads = 0;
  await assert.rejects(runApprovedStorefrontJourney({ approvalId: "storefront-sandbox-20261022-approved130", expectedConsumedCalls: 89,
    getProviderKey() { keyReads++; throw Error("must-not-read-key"); } }), /journey_real_http_or_owned_cleanup_failed/);
  assert.deepEqual(f.workerArgs.slice(-2), ["89", "storefront-sandbox-20261022-approved130"]);
  assert.equal(keyReads, 0); assert.equal(f.events.filter(event => event === "resources.close").length, 1);
});
test("worker deadline terminates only the worker and awaits resource cleanup", async context => {
  const f = fixture(); context.mock.timers.enable({ apis: ["setTimeout"] });
  const execution = runApprovedStorefrontJourney({ expectedConsumedCalls: 14, getProviderKey: () => { throw Error("unit_key_must_not_be_requested"); } });
  await f.spawned.ready; context.mock.timers.tick(420_001);
  await assert.rejects(execution, /journey_real_http_or_owned_cleanup_failed/);
  assert.deepEqual(f.events, ["terminate.worker", "kill.worker", "resources.close"]);
});
test("stale consumed-call expectation fails before creating resources or loading credentials", async () => {
  const before = resourceCreates; let keyReads = 0;
  await assert.rejects(runApprovedStorefrontJourney({ expectedConsumedCalls: 12, getProviderKey() { keyReads++; return "unit-never-used-key"; } }));
  assert.equal(resourceCreates, before); assert.equal(keyReads, 0);
});

test("phase failure and last cleanup stage survive a worker deadline without fabricating success or traces", async context => {
  const f = fixture(); context.mock.timers.enable({ apis: ["setTimeout"] });
  const execution = runApprovedStorefrontJourney({ expectedConsumedCalls: 14, getProviderKey: () => { throw Error("unit_no_key"); } });
  await f.spawned.ready;
  const diagnostic = { step: "edit", code: "journey_edit_provider_operation_failed", attemptedCalls: 16, completedCalls: 15, failedCalls: 1,
    ledgerBefore: 14, ledgerAfter: 30, httpStatus: 201, problemCode: "none", bridgeOutcome: "failed", bridgeCode: "journey_http_operation_failed",
    providerFactoryAttempts: 16, deniedFetches: 0, deniedSockets: 0,
    lastProviderFailure: { failureReason: "truncated", httpStatus: 200, finishReason: "length" } };
  f.child.stdout.emit("data", Buffer.from(`JOURNEY_LLM_PHASE_FAILURE ${JSON.stringify(diagnostic)}\n`));
  f.child.stdout.emit("data", Buffer.from('JOURNEY_LIFECYCLE {"stage":"app_close","event":"start"}\n'));
  f.child.stdout.emit("data", Buffer.from('JOURNEY_LIFECYCLE {"stage":"app_close","event":"completed","token":"private"}\n'));
  context.mock.timers.tick(420_001);
  await assert.rejects(execution, error => {
    assert.equal(error.journeyEvidence.journeyValidated, false); assert.equal(error.journeyEvidence.workerTimedOut, true);
    assert.equal(error.journeyEvidence.ownedResourcesRemoved, true);
    assert.deepEqual(error.journeyEvidence.lastLifecycle, { stage: "app_close", event: "start" });
    assert.deepEqual(error.journeyEvidence.diagnostic, diagnostic);
    assert.equal(Object.hasOwn(error.journeyEvidence.diagnostic, "traces"), false);
    assert.doesNotMatch(JSON.stringify(error.journeyEvidence), /private|token/); return true;
  });
});
