import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { initializeSyntheticSandboxLlmBudget, createSyntheticSandboxDeepSeekBudget, SANDBOX_LLM_APPROVAL } from "./storefront-sandbox-llm-budget.mjs";
import { verifyJourneyPreflight } from "./storefront-journey-guards.mjs";
import { createStorefrontJourneyTransport, assertJourneyTransportCapability, registerJourneyTransportWrapper } from "./storefront-journey-transport.mjs";
import { summarizeJourneyProviderFailure } from "./storefront-journey-provider-diagnostic.mjs";

// These verifier/fetch doubles are contract fixtures, NOT actual auth, SQL,
// HTTP journey or provider validation. Only a separate synthetic ledger is used.
const manifest = () => ({ version: 1, runId: randomUUID(), apiOrigin: "http://127.0.0.1:19987",
  merchantId: randomUUID(), buyerId: randomUUID(), sessionId: randomUUID(), postgresRunId: randomUUID(), redisRunId: randomUUID(),
  postgresPort: 19985, redisPort: 19986 });
const principal = m => ({ runId: m.runId, merchantId: m.merchantId, buyerId: m.buyerId, sessionId: m.sessionId });
const resources = m => ({ ...principal(m), apiOrigin: m.apiOrigin, postgresRunId: m.postgresRunId, redisRunId: m.redisRunId,
  postgresPort: m.postgresPort, redisPort: m.redisPort });
const preflight = (m, changes = {}) => verifyJourneyPreflight({ manifest: m, principalToken: "synthetic-contract-only",
  verifyPrincipal: async () => principal(m), verifyResources: async () => resources(m), ...changes });
const request = (content = "synthetic") => ({ method: "POST", headers: { authorization: "Bearer synthetic-contract-only", "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-chat", max_tokens: 220, response_format: { type: "json_object" }, messages: [{ role: "user", content }] }) });
const operation = stage => ({ operationId: randomUUID(), stage });
async function fixture(work, fetchFn = async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }), { headers: { "content-type": "application/json" } })) {
  const directory = await mkdtemp(join(tmpdir(), "aacp-journey-contract-"));
  try {
    const ledger = join(directory, "ledger");
    initializeSyntheticSandboxLlmBudget({ directory: ledger });
    const budget = createSyntheticSandboxDeepSeekBudget({ directory: ledger, fetchFn });
    const m = manifest(), capability = await preflight(m), traces = [];
    const transport = createStorefrontJourneyTransport({ capability, budget, record: event => traces.push(event) });
    await work({ budget, m, capability, traces, transport, directory });
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(resolve(directory).startsWith(join(resolve(tmpdir()), "aacp-journey-contract-")));
    await rm(directory, { recursive: true, force: true });
  }
}
test("preflight requires exact principal, resource run markers and loopback destination", async () => {
  const m = manifest();
  await assert.rejects(preflight({ ...m, apiOrigin: "https://production.invalid" }), /journey_manifest_invalid/);
  await assert.rejects(preflight(m, { verifyPrincipal: async () => ({ ...principal(m), buyerId: randomUUID() }) }), /journey_principal_mismatch/);
  await assert.rejects(preflight(m, { verifyResources: async () => ({ ...resources(m), postgresRunId: randomUUID() }) }), /journey_resources_mismatch/);
  await assert.rejects(preflight(m, { verifyResources: undefined }), /journey_verifiers_required/);
  await assert.rejects(preflight(m, { verifyPrincipal: async () => ({ ...principal(m), trusted: true }) }), /journey_principal_invalid/);
});
test("plain objects cannot forge capability and fallback/missing operation cannot reach the budget", async () => {
  assert.throws(() => createStorefrontJourneyTransport({ capability: { trusted: true }, budget: {}, record() {} }), /journey_capability_required/);
  await fixture(async ({ transport, budget }) => {
    await assert.rejects(transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, request()), /journey_operation_required/);
    await assert.rejects(transport.runOperation(operation("turn"), () => transport.fetchFactory("fallback")(SANDBOX_LLM_APPROVAL.endpoint, request())), /journey_fallback_forbidden/);
    assert.equal(budget.status().attemptedCalls, 0);
  });
});
test("transport and egress wrapper retain exact opaque capability identity", async () => {
  await fixture(async ({ transport, capability }) => {
    assert.doesNotThrow(() => assertJourneyTransportCapability(transport, capability));
    const other = await preflight(manifest());
    assert.throws(() => assertJourneyTransportCapability(transport, other), /journey_transport_capability_mismatch/);
    assert.throws(() => assertJourneyTransportCapability({ trusted: true }, capability), /journey_transport_capability_mismatch/);
    assert.throws(() => registerJourneyTransportWrapper({}, { fetchFactory() {}, runOperation() {} }), /journey_transport_wrapper_invalid/);
    const wrapper = registerJourneyTransportWrapper(transport, Object.freeze({ fetchFactory: transport.fetchFactory,
      runOperation: (...args) => transport.runOperation(...args) }));
    assert.doesNotThrow(() => assertJourneyTransportCapability(wrapper, capability));
    assert.throws(() => assertJourneyTransportCapability(wrapper, other), /journey_transport_capability_mismatch/);
  });
});
test("all stages and tool continuations consume distinct durable steps without leaking payloads", async () => {
  await fixture(async ({ transport, budget, traces }) => {
    for (const stage of ["classifier", "turn", "tool", "copy", "nudge"]) {
      await transport.runOperation(operation(stage), async () => {
        const fetch = transport.fetchFactory("primary");
        await fetch(SANDBOX_LLM_APPROVAL.endpoint, request("synthetic buyer@example.invalid token secret"));
        await fetch(SANDBOX_LLM_APPROVAL.endpoint, request("synthetic continuation"));
      });
    }
    assert.equal(budget.status().attemptedCalls, 10);
    assert.equal(new Set(traces.filter(x => x.outcome === "started").map(x => x.stepId)).size, 10);
    assert.doesNotMatch(JSON.stringify(traces), /buyer@|token|secret|messages|headers|choices/);
  });
});
test("caught provider failure poisons the operation and blocks retry/fallback without refund", async () => {
  await fixture(async ({ transport, budget, traces }) => {
    await assert.rejects(transport.runOperation(operation("turn"), async () => {
      await assert.rejects(transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, request()), /journey_provider_failed/);
      await assert.rejects(transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, request("second")), /journey_operation_failed/);
    }), /journey_operation_failed/);
    assert.equal(budget.status().attemptedCalls, 1);
    assert.doesNotMatch(JSON.stringify(traces), /untrusted-provider-error/);
  }, async () => { throw new Error("untrusted-provider-error contains secret payload"); });
});
test("duplicate requests and repeated operations are blocked without automatic retry", async () => {
  await fixture(async ({ transport, budget }) => {
    const op = operation("turn");
    await assert.rejects(transport.runOperation(op, async () => {
      const fetch = transport.fetchFactory("primary");
      await fetch(SANDBOX_LLM_APPROVAL.endpoint, request());
      await fetch(SANDBOX_LLM_APPROVAL.endpoint, request());
    }), /journey_duplicate_request/);
    await assert.rejects(transport.runOperation(op, () => {}), /journey_operation_replayed/);
    assert.equal(budget.status().attemptedCalls, 1);
  });
});
test("recreated transport cannot replay the same deterministic ledger step", async () => {
  await fixture(async ({ transport, capability, budget }) => {
    const op = operation("classifier");
    await transport.runOperation(op, () => transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, request()));
    const recreated = createStorefrontJourneyTransport({ capability, budget, record() {} });
    await assert.rejects(recreated.runOperation(op, () => recreated.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, request())), /journey_provider_failed/);
    assert.equal(budget.status().attemptedCalls, 1);
  });
});

test("principal and owned markers are revalidated before every operation without trusting the manifest", async () => {
  const m = manifest(); let changed = false;
  const capability = await preflight(m, { verifyPrincipal: async () => ({ ...principal(m), ...(changed ? { buyerId: randomUUID() } : {}) }) });
  changed = true;
  const transport = createStorefrontJourneyTransport({ capability, budget: { status: () => ({ ...SANDBOX_LLM_APPROVAL }),
    fetchForStep() { throw new Error("must_not_reach_budget"); } }, record() {} });
  await assert.rejects(transport.runOperation(operation("turn"), () => { throw new Error("must_not_execute_work"); }), /journey_principal_mismatch/);
});
test("structured JSON output is mandatory and malformed wire/output poisons the operation", async () => {
  await fixture(async ({ transport, budget }) => {
    const unstructured = request(); const body = JSON.parse(unstructured.body); delete body.response_format; unstructured.body = JSON.stringify(body);
    await assert.rejects(transport.runOperation(operation("turn"), () => transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, unstructured)), /journey_structured_output_required/);
    assert.equal(budget.status().attemptedCalls, 0);
  });
  await fixture(async ({ transport, budget }) => {
    await assert.rejects(transport.runOperation(operation("turn"), async () => {
      await assert.rejects(transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, request()), /journey_provider_failed/);
    }), /journey_operation_failed/);
    assert.equal(budget.status().attemptedCalls, 1);
  }, async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "unstructured secret text" } }] })));
});

for (const [name, fetchFn, reason, status, finishReason, contentShape, contentSource] of [
  ["HTTP refusal", async () => new Response("private provider error", { status: 429 }), "http_failed", 429, "unavailable"],
  ["network failure", async () => { throw Error("private payload and credential"); }, "network_failed", undefined, "unavailable"],
  ["truncated completion", async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "private partial JSON" } }] })), "truncated", 200, "length"],
  ["filtered completion", async () => new Response(JSON.stringify({ choices: [{ finish_reason: "content_filter", message: { content: "private refusal" } }] })), "content_filtered", 200, "content_filter"],
  ["invalid envelope", async () => new Response("{}"), "wire_invalid", 200, "unavailable"],
  ["invalid envelope JSON", async () => new Response("private non-JSON envelope"), "wire_invalid", 200, "unavailable"],
  ["invalid structured content", async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "private non-JSON content" } }] })), "structured_output_invalid", 200, "stop", "invalid_json", "assistant_content"],
  ["non-object arguments", async () => new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "call", type: "function", function: { name: "tool", arguments: "[]" } }] } }] })), "structured_output_invalid", 200, "tool_calls", "json_array", "tool_arguments"],
]) test(`provider diagnostics distinguish ${name} without leaking response, prompts or credentials`, async () => {
  await fixture(async ({ transport, budget, traces }) => {
    await assert.rejects(transport.runOperation(operation("turn"), () => transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, request())), /journey_provider_failed/);
    assert.equal(budget.status().attemptedCalls, 1);
    const failed = traces.filter(trace => trace.outcome === "failed");
    assert.equal(failed.length, 1); assert.equal(failed[0].failureReason, reason);
    assert.equal(failed[0].httpStatus, status); assert.equal(failed[0].finishReason, finishReason);
    assert.deepEqual(summarizeJourneyProviderFailure(traces), { failureReason: reason,
      ...(status === undefined ? {} : { httpStatus: status }), finishReason,
      ...(contentShape === undefined ? {} : { contentShape, contentSource }) });
    assert.doesNotMatch(JSON.stringify(traces), /private|payload|credential|"(?:choices|arguments|headers|messages)"\s*:/);
  }, fetchFn);
});

for (const [name, value, source, shape] of [
  ["absent assistant value", undefined, "assistant_content", "missing"],
  ["null assistant field", null, "assistant_content", "missing"],
  ["empty assistant value", "", "assistant_content", "empty"],
  ["whitespace assistant value", " \n\t", "assistant_content", "whitespace"],
  ["fenced assistant text", '```json\n{"private-canary":"secret-canary"}\n```', "assistant_content", "fenced_text"],
  ["non-JSON prose", "private-canary secret-canary", "assistant_content", "invalid_json"],
  ["JSON array", '["private-canary"]', "assistant_content", "json_array"],
  ["JSON string scalar", '"private-canary"', "assistant_content", "json_scalar"],
  ["JSON numeric scalar", "42", "assistant_content", "json_scalar"],
  ["JSON boolean scalar", "true", "assistant_content", "json_scalar"],
  ["JSON null", "null", "assistant_content", "json_null"],
  ["array tool arguments", '["private-canary"]', "tool_arguments", "json_array"],
]) test(`content diagnostics classify ${name} without repairing it, exposing bytes or retrying`, async () => {
  const message = source === "tool_arguments" ? { tool_calls: [{ id: "call", type: "function", function: { name: "synthetic", arguments: value } }] }
    : { ...(value === undefined ? {} : { content: value }) };
  await fixture(async ({ transport, budget, traces }) => {
    await assert.rejects(transport.runOperation(operation("turn"), async () => {
      await assert.rejects(transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, request()), /journey_provider_failed/);
      await assert.rejects(transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, request("different retry")), /journey_operation_failed/);
    }), /journey_operation_failed/);
    assert.equal(budget.status().attemptedCalls, 1);
    const failed = traces.filter(trace => trace.outcome === "failed"); assert.equal(failed.length, 1);
    assert.equal(failed[0].contentShape, shape); assert.equal(failed[0].contentSource, source);
    assert.deepEqual(summarizeJourneyProviderFailure(traces), { failureReason: "structured_output_invalid", httpStatus: 200,
      finishReason: source === "tool_arguments" ? "tool_calls" : "stop", contentShape: shape, contentSource: source });
    assert.doesNotMatch(JSON.stringify(traces), /private-canary|secret-canary|"(?:messages|headers|content|arguments|choices|body)"\s*:/);
  }, async () => new Response(JSON.stringify({ choices: [{ finish_reason: source === "tool_arguments" ? "tool_calls" : "stop", message }] })));
});

test("valid JSON object remains accepted once and creates no content-failure metadata", async () => {
  await fixture(async ({ transport, budget, traces }) => {
    await transport.runOperation(operation("turn"), () => transport.fetchFactory("primary")(SANDBOX_LLM_APPROVAL.endpoint, request()));
    assert.equal(budget.status().attemptedCalls, 1); assert.equal(summarizeJourneyProviderFailure(traces), undefined);
    assert.equal(traces.filter(trace => trace.outcome === "completed").length, 1);
    assert.ok(traces.every(trace => !Object.hasOwn(trace, "contentShape") && !Object.hasOwn(trace, "contentSource")));
  });
});
