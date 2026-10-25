import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import net from "node:net";
import * as budget from "./storefront-sandbox-llm-budget.mjs";
import { parseApprovedLlmFlags } from "./storefront-journey-llm.guards.mjs";
import { verifyJourneyPreflight } from "./storefront-journey-guards.mjs";
import { installStorefrontJourneyEgress } from "./storefront-journey-egress.mjs";

const approvalId = "storefront-sandbox-20261021-approved90";
const endpoint = "https://api.deepseek.com/v1/chat/completions";
const metadata = () => ({ stepId: randomUUID(), stage: "turn" });
const request = max_tokens => ({ method: "POST", headers: { authorization: "Bearer synthetic-only", "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-chat", max_tokens, messages: [{ role: "user", content: "synthetic" }] }) });
const send = (client, step = metadata(), tokens = 1024) => client.fetchForStep(step)(endpoint, request(tokens));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "aacp-budget90-contract-")), directory = join(root, "budget");
  t.after(() => { const path = realpathSync(root); assert.equal(dirname(path), realpathSync(tmpdir()));
    assert.ok(basename(path).startsWith("aacp-budget90-contract-")); rmSync(path, { recursive: true }); });
  budget.initializeSyntheticSandboxLlmBudget({ directory });
  const rows = Array.from({ length: 49 }, (_, index) => ({ version: 1, callNumber: index + 1, ...metadata(), maxTokens: 1024, at: "2026-10-21T12:00:00.000Z" }));
  writeFileSync(join(directory, "attempts.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  const original = ["manifest.json", "attempts.jsonl"].map(name => readFileSync(join(directory, name)));
  const unchanged = () => ["manifest.json", "attempts.jsonl"].forEach((name, i) => assert.deepEqual(readFileSync(join(directory, name)), original[i]));
  const options = { directory, approvalId, expectedConsumedCalls: 49 };
  return { directory, rows, unchanged, options };
}
const client = (directory, fetchFn = async () => new Response("{}")) => budget.createSyntheticExtendedSandboxDeepSeekBudget({ directory, approvalId, fetchFn });

test("distinct approval requires explicit extension flag, old60 remains unchanged", () => {
  assert.equal(budget.SANDBOX_LLM_APPROVAL.maximumCalls, 60);
  const flags = ["--local-disposable", "--prisma-loopback-exec", "--compiled-test-artifact", "--approved-deepseek-http", "--allow-real-deepseek",
    `--approval-id=${approvalId}`, "--expected-consumed-calls=49", "--extend-original-budget-to=90"];
  assert.deepEqual(parseApprovedLlmFlags(flags), { approvalId, expectedConsumedCalls: 49, extensionMaximumCalls: 90 });
  for (const invalid of [flags.filter(x => !x.startsWith("--extend")), [...flags, "--extend-original-budget-to=90"],
    flags.map(x => x.startsWith("--extend") ? "--extend-original-budget-to=91" : x),
    flags.map(x => x.startsWith("--approval-id") ? `--approval-id=${budget.SANDBOX_LLM_APPROVAL.approvalId}` : x)])
    assert.throws(() => parseApprovedLlmFlags(invalid));
});
test("exclusive extension preserves49 original bytes and resumes cumulative50..90", async t => {
  const f = fixture(t); budget.initializeSyntheticSandboxLlmExtension(f.options);
  assert.throws(() => budget.initializeSyntheticSandboxLlmExtension(f.options));
  assert.equal(client(f.directory).status().remainingCalls, 41);
  await send(client(f.directory));
  const resumed = client(f.directory); assert.equal(resumed.status().attemptedCalls, 50);
  assert.equal(resumed.status().remainingCalls, 40); assert.equal(resumed.status().maximumCalls, 90);
  const row = JSON.parse(readFileSync(join(f.directory, "extension90-attempts.jsonl"), "utf8"));
  assert.equal(row.callNumber, 50); f.unchanged();
  await assert.rejects(send(budget.createSyntheticSandboxDeepSeekBudget({ directory: f.directory,
    fetchFn: async () => { assert.fail("old60 must never dispatch after extension"); } })), /sandbox_budget_extension_explicit_authority_required/);
});
test("41 concurrent extension calls exhaust total90 and no91st transport", async t => {
  const f = fixture(t); budget.initializeSyntheticSandboxLlmExtension(f.options); let calls = 0;
  const c = client(f.directory, async () => { calls++; return new Response("{}"); });
  const result = await Promise.allSettled(Array.from({ length: 44 }, () => send(c)));
  assert.equal(result.filter(x => x.status === "fulfilled").length, 41); assert.equal(calls, 41);
  assert.equal(result.filter(x => x.status === "rejected" && x.reason.message === "sandbox_budget_exhausted").length, 3);
  assert.equal(c.status().attemptedCalls, 90); assert.equal(c.status().remainingCalls, 0); f.unchanged();
});
test("uncertain failure consumes once; replay from either journal and1025 tokens never dispatch", async t => {
  const f = fixture(t); budget.initializeSyntheticSandboxLlmExtension(f.options); let calls = 0;
  const c = client(f.directory, async () => { calls++; throw Error("private-canary"); }), step = metadata();
  await assert.rejects(send(c, step), /sandbox_provider_network_failed/);
  await assert.rejects(send(c, step), /sandbox_budget_step_already_attempted/);
  await assert.rejects(send(c, { stepId: f.rows[0].stepId, stage: "turn" }), /sandbox_budget_step_already_attempted/);
  await assert.rejects(send(c, metadata(), 1025), /sandbox_provider_request_invalid/);
  assert.equal(calls, 1); assert.equal(c.status().attemptedCalls, 50); f.unchanged();
});
test("missing authorization, wrong baseline, missing init and original drift refuse before network", t => {
  const f = fixture(t);
  assert.throws(() => client(f.directory).status());
  for (const patch of [{ approvalId: "other" }, { expectedConsumedCalls: 48 }, { maximumCalls: 91 }])
    assert.throws(() => budget.initializeSyntheticSandboxLlmExtension({ ...f.options, ...patch }));
  budget.initializeSyntheticSandboxLlmExtension(f.options);
  writeFileSync(join(f.directory, "attempts.jsonl"), readFileSync(join(f.directory, "attempts.jsonl"), "utf8").replace('"maxTokens":1024', '"maxTokens":1023'));
  assert.throws(() => client(f.directory).status(), /sandbox_budget_extension_original_drift/);
});
test("corrupt, reordered, duplicate and truncated extension rows fail closed", async t => {
  const f = fixture(t); budget.initializeSyntheticSandboxLlmExtension(f.options); await send(client(f.directory));
  const path = join(f.directory, "extension90-attempts.jsonl"), text = readFileSync(path, "utf8"), row = JSON.parse(text);
  for (const changed of ["{broken}\n", text.trim(), JSON.stringify({ ...row, callNumber: 51 }) + "\n",
    text + JSON.stringify({ ...row, callNumber: 51 }) + "\n", JSON.stringify({ ...row, maxTokens: 1025 }) + "\n"]) {
    writeFileSync(path, changed); assert.throws(() => client(f.directory).status());
  }
  f.unchanged();
});
test("real extension factories reject authority widening BEFORE touching original files", () => {
  for (const options of [{}, { allowRealDeepSeek: true, approvalId, expectedConsumedCalls: 48 },
    { allowRealDeepSeek: true, approvalId, expectedConsumedCalls: 49, directory: "copied" }])
    assert.throws(() => budget.initializeApprovedSandboxLlmExtension(options));
});
test("partial initialization and same mutex refuse without touching original or dispatching", async t => {
  const f = fixture(t), path = join(f.directory, "extension90-attempts.jsonl");
  writeFileSync(path, ""); assert.throws(() => budget.initializeSyntheticSandboxLlmExtension(f.options), /sandbox_budget_already_initialized/);
  rmSync(path); budget.initializeSyntheticSandboxLlmExtension(f.options);
  writeFileSync(join(f.directory, "reservation.lock"), "owned-contract");
  await assert.rejects(send(client(f.directory, async () => { assert.fail("locked must not dispatch"); })), /sandbox_budget_locked/);
  assert.equal(readFileSync(join(f.directory, "reservation.lock"), "utf8"), "owned-contract"); f.unchanged();
});
test("extension90 flag still admits49..89 only; diagnostics use the current global ceiling130", async () => {
  const { journeyLlmDiagnosticSchema } = await import("./storefront-journey-llm.guards.mjs");
  const diagnostic = { step: "edit", code: "journey_edit_provider_operation_failed", attemptedCalls: 41, completedCalls: 40, failedCalls: 1,
    ledgerBefore: 49, ledgerAfter: 90, httpStatus: 201, problemCode: "none", bridgeOutcome: "failed", bridgeCode: "journey_http_operation_failed",
    providerFactoryAttempts: 41, deniedFetches: 0, deniedSockets: 0, traces: [] };
  assert.equal(journeyLlmDiagnosticSchema.safeParse(diagnostic).success, true);
  // Diagnostic parsing reports counts; only explicit flags and the durable
  // ledger grant spending. The newly approved continuation can reach130.
  assert.equal(journeyLlmDiagnosticSchema.safeParse({ ...diagnostic, ledgerAfter: 130 }).success, true);
  assert.equal(journeyLlmDiagnosticSchema.safeParse({ ...diagnostic, ledgerAfter: 131 }).success, false);
  const flags = ["--local-disposable", "--prisma-loopback-exec", "--compiled-test-artifact", "--approved-deepseek-http", "--allow-real-deepseek",
    `--approval-id=${approvalId}`, "--extend-original-budget-to=90"];
  for (const count of [49, 60, 89]) assert.equal(parseApprovedLlmFlags([...flags, `--expected-consumed-calls=${count}`]).expectedConsumedCalls, count);
  for (const count of ["48", "90", "049", "49.0", "-1"]) assert.throws(() => parseApprovedLlmFlags([...flags, `--expected-consumed-calls=${count}`]));
});
test("explicit90 budget composes through actual egress/transport to cumulative call50", async t => {
  const f = fixture(t); budget.initializeSyntheticSandboxLlmExtension(f.options);
  const manifest = { version: 1, runId: randomUUID(), merchantId: randomUUID(), buyerId: randomUUID(), sessionId: randomUUID(),
    apiOrigin: "http://127.0.0.1:19987", postgresRunId: randomUUID(), redisRunId: randomUUID(), postgresPort: 19985, redisPort: 19986 };
  const principal = { runId: manifest.runId, merchantId: manifest.merchantId, buyerId: manifest.buyerId, sessionId: manifest.sessionId };
  const capability = await verifyJourneyPreflight({ manifest, principalToken: "synthetic-only", verifyPrincipal: async () => principal,
    verifyResources: async () => ({ ...principal, apiOrigin: manifest.apiOrigin, postgresRunId: manifest.postgresRunId,
      redisRunId: manifest.redisRunId, postgresPort: manifest.postgresPort, redisPort: manifest.redisPort }) });
  const originalFetch = globalThis.fetch, originalConnect = net.Socket.prototype.connect;
  let egress, calls = 0;
  const earlyFetch = async () => { throw Error("early-denied"); }, earlyConnect = () => { throw Error("early-denied"); };
  globalThis.fetch = earlyFetch; net.Socket.prototype.connect = earlyConnect;
  try {
    egress = await installStorefrontJourneyEgress({ capability, previousFence: { fetch: earlyFetch, connect: earlyConnect,
      underlyingConnect: originalConnect, underlyingFetch: async () => { calls++; return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] })); } } });
    const c = client(f.directory, (url, options) => globalThis.fetch(url, options)), traces = [];
    assert.throws(() => egress.createTransport({ budget: c, record() {} }), /journey_budget_invalid/);
    const transport = egress.createTransport({ budget: c, record: value => traces.push(value), approvalId });
    const options = request(1024); options.body = JSON.stringify({ ...JSON.parse(options.body), response_format: { type: "json_object" } });
    await transport.runOperation({ operationId: randomUUID(), stage: "turn" }, () => transport.fetchFactory("primary")(endpoint, options));
    assert.equal(calls, 1); assert.equal(c.status().attemptedCalls, 50); assert.equal(traces.length, 2);
    assert.equal(egress.evidence().budgetedFetches, 1); f.unchanged();
  } finally { if (egress) egress.dispose(); globalThis.fetch = originalFetch; net.Socket.prototype.connect = originalConnect; }
});
test("directory identity resolves Windows casing and ancestor junctions before synthetic locking", t => {
  const f = fixture(t), alias = join(dirname(f.directory), "alias");
  symlinkSync(f.directory, alias, process.platform === "win32" ? "junction" : "dir");
  assert.equal(budget.sameSandboxBudgetDirectory(alias, f.directory), true);
  assert.equal(budget.sameSandboxBudgetDirectory(join(alias, "not-created"), join(f.directory, "not-created")), true);
  if (process.platform === "win32") assert.equal(budget.sameSandboxBudgetDirectory(f.directory.toUpperCase(), f.directory), true);
  assert.equal(budget.sameSandboxBudgetDirectory(f.directory, join(f.directory, "different")), false);
  const source = readFileSync(new URL("./storefront-sandbox-llm-budget.mjs", import.meta.url), "utf8");
  for (const start of ["function syntheticExtensionDirectory", "export function initializeSyntheticSandboxLlmBudget", "export function createSyntheticSandboxDeepSeekBudget"]) {
    const body = source.slice(source.indexOf(start), source.indexOf("\n}", source.indexOf(start)));
    assert.ok(body.includes("isRealBudgetDirectory(options.directory)"));
  }
  f.unchanged();
});
