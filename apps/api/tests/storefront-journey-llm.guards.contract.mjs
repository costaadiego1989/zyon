import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseApprovedLlmFlags, parseJourneyKeyReply, journeyLlmDiagnosticSchema } from "./storefront-journey-llm.guards.mjs";
import * as guards from "./storefront-journey-llm.guards.mjs";

const flags = ["--local-disposable", "--prisma-loopback-exec", "--compiled-test-artifact", "--approved-deepseek-http",
  "--allow-real-deepseek", "--approval-id=storefront-sandbox-20261018-approved60", "--expected-consumed-calls=14"];
test("real phase requires exact explicit flags; zero-call flags cannot activate it", () => {
  assert.equal(parseApprovedLlmFlags(flags).approvalId, "storefront-sandbox-20261018-approved60");
  assert.equal(parseApprovedLlmFlags(flags).expectedConsumedCalls, 14);
  for (const invalid of [[], flags.slice(1), [...flags, "--bootstrap-only"], [...flags, "--no-real-provider"], [...flags, flags[0]],
    flags.map(value => value.startsWith("--approval-id=") ? "--approval-id=other" : value)]) assert.throws(() => parseApprovedLlmFlags(invalid));
  for (const count of ["0", "11", "60", "014", "-1", "14.0", "NaN"]) assert.throws(() => parseApprovedLlmFlags(flags.map(value => value.startsWith("--expected-consumed-calls=") ? `--expected-consumed-calls=${count}` : value)));
});
test("failure diagnostics admit only technical codes/counts and explicitly preserve the consumed baseline", () => {
  const diagnostic = { step: "search", code: "journey_search_message_http_failed", attemptedCalls: 2, completedCalls: 2, failedCalls: 0,
    ledgerBefore: 14, ledgerAfter: 16, httpStatus: 500, problemCode: "internal_error", bridgeOutcome: "completed", bridgeCode: "none",
    providerFactoryAttempts: 2, deniedFetches: 0, deniedSockets: 0, traces: [] };
  assert.deepEqual(journeyLlmDiagnosticSchema.parse(diagnostic), diagnostic);
  for (const extra of [{ rawMessage: "private" }, { problemCode: "private-arbitrary" }, { httpStatus: 999 }, { ledgerBefore: 0 }, { deniedFetches: -1 }])
    assert.equal(journeyLlmDiagnosticSchema.safeParse({ ...diagnostic, ...extra }).success, false);
});
test("private key reply binds exact run and nonce and never accepts configuration grants", () => {
  const request = { type: "journey-provider-key-request", runId: randomUUID(), nonce: randomUUID() };
  const reply = { type: "journey-provider-key-reply", runId: request.runId, nonce: request.nonce, apiKey: "synthetic-contract-only-key" };
  assert.equal(parseJourneyKeyReply(request, reply), reply.apiKey);
  for (const change of [{ runId: randomUUID() }, { nonce: randomUUID() }, { apiKey: "" }, { apiKey: "a\nb" },
    { endpoint: "https://foreign.invalid" }, { approved: true }, { type: "journey-provider-key-request" }])
    assert.throws(() => parseJourneyKeyReply(request, { ...reply, ...change }));
  assert.throws(() => parseJourneyKeyReply({ ...request, nonce: "invalid" }, reply));
});

function fullEditFailure() {
  const failure = { failureReason: "structured_output_invalid", httpStatus: 200, finishReason: "stop" };
  return { step: "edit", code: "journey_edit_provider_operation_failed", attemptedCalls: 19, completedCalls: 18, failedCalls: 1,
    ledgerBefore: 30, ledgerAfter: 49, httpStatus: 201, problemCode: "none", bridgeOutcome: "failed", bridgeCode: "journey_http_operation_failed",
    providerFactoryAttempts: 19, deniedFetches: 0, deniedSockets: 0, lastProviderFailure: failure,
    traces: [{ version: 1, runId: randomUUID(), operationId: randomUUID(), stepId: randomUUID(), stage: "turn", ordinal: 19,
      outcome: "failed", code: "journey_provider_failed", ...failure }] };
}
test("early worker diagnostic validates FULL trace-bearing failure before publishing its strict technical projection", () => {
  const full = fullEditFailure(), before = structuredClone(full);
  // Actual regression: strict omit rejects the full valid object solely for
  // its traces key. Do not relax it or strip arbitrary unvalidated input.
  assert.equal(journeyLlmDiagnosticSchema.safeParse(full).success, true);
  assert.equal(journeyLlmDiagnosticSchema.omit({ traces: true }).safeParse(full).success, false);
  const projected = guards.projectJourneyPhaseFailure(full);
  assert.ok(projected); assert.equal(Object.hasOwn(projected, "traces"), false);
  assert.equal(projected.code, "journey_edit_provider_operation_failed");
  assert.deepEqual(projected.lastProviderFailure, { failureReason: "structured_output_invalid", httpStatus: 200, finishReason: "stop" });
  assert.equal(projected.ledgerAfter, 49); assert.equal(projected.failedCalls, 1);
  assert.deepEqual(guards.parseJourneyPhaseFailureLine(`JOURNEY_LLM_PHASE_FAILURE ${JSON.stringify(projected)}`), projected);
  assert.deepEqual(full, before);
});

test("technical cart assertion failure stays distinguishable from a failed provider bridge", () => {
  const full = { ...fullEditFailure(), code: "journey_phase_assertion_failed", completedCalls: 19, failedCalls: 0,
    bridgeOutcome: "completed", bridgeCode: "none", lastProviderFailure: undefined, traces: [] };
  const projected = guards.projectJourneyPhaseFailure(full);
  assert.ok(projected); assert.equal(projected.code, "journey_phase_assertion_failed");
  assert.equal(projected.bridgeOutcome, "completed"); assert.equal(projected.failedCalls, 0);
});

test("early projection rejects private extra fields at any level instead of stripping them into apparently valid evidence", () => {
  const full = fullEditFailure();
  const { traces: _traces, ...alreadyProjected } = full;
  for (const raw of [undefined, alreadyProjected, { ...full, rawMessage: "private-canary" },
    { ...full, traces: [{ ...full.traces[0], messages: "private-canary" }] },
    { ...full, lastProviderFailure: { ...full.lastProviderFailure, responseBody: "private-canary" } },
    { ...full, ledgerAfter: 131 }, { ...full, bridgeCode: "private-canary" }])
    assert.equal(guards.projectJourneyPhaseFailure(raw), undefined);
});

test("actual worker wiring projects a validated diagnostic and emits it before owned cleanup", () => {
  const worker = readFileSync(new URL("./storefront-journey-llm.worker.mjs", import.meta.url), "utf8");
  const checked = worker.indexOf("journeyLlmDiagnosticSchema.safeParse(error?.journeyEvidence)");
  const projected = worker.indexOf("projectJourneyPhaseFailure(diagnostic)");
  const emitted = worker.indexOf('console.log("JOURNEY_LLM_PHASE_FAILURE "');
  const closed = worker.indexOf("await owned.close()");
  assert.ok(checked > 0 && projected > checked && emitted > projected && closed > emitted);
  assert.equal(worker.includes(".omit({ traces: true }).safeParse(diagnostic)"), false);
});
