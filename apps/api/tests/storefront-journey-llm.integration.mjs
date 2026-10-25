import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { parseApprovedLlmFlags, parseJourneyKeyReply, requestJourneyProviderKey, journeyLlmDiagnosticSchema, parseJourneyPhaseFailureLine } from "./storefront-journey-llm.guards.mjs";
import { parseJourneyLifecycleLine } from "./storefront-journey-lifecycle.mjs";
import { createOwnedStorefrontJourneyResources } from "./storefront-journey-owned-resources.mjs";
import { constructionOnlyEnvironment } from "./nest-construction-only.guards.mjs";
import { inspectOriginalJourneyBudget } from "./storefront-journey-original-budget.mjs";
import { terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";
import { SANDBOX_LLM_APPROVAL, sandboxLlmApprovalForId } from "./storefront-sandbox-llm-budget.mjs";

/** Import is inert. This same parent owns resources through EVERY worker error;
 * credential callback is invoked only after a typed run-bound worker request. */
export async function runApprovedStorefrontJourney(options) {
assert.ok(options && Object.keys(options).every(key => ["getProviderKey", "expectedConsumedCalls", "approvalId"].includes(key)) && typeof options.getProviderKey === "function", "journey_private_key_loader_required");
const getProviderKey = options.getProviderKey;
const expectedConsumedCalls = options.expectedConsumedCalls;
const approvalId = options.approvalId ?? SANDBOX_LLM_APPROVAL.approvalId;
const authority = sandboxLlmApprovalForId(approvalId) ?? SANDBOX_LLM_APPROVAL;
assert.equal(approvalId, authority.approvalId, "journey_explicit_original_approval_required");
assert.ok(Number.isInteger(expectedConsumedCalls) && expectedConsumedCalls >= (authority.originalConsumedCalls ?? 12) && expectedConsumedCalls < authority.maximumCalls, "journey_expected_consumed_calls_required");
const before = inspectOriginalJourneyBudget({ approvalId }); assert.equal(before.attemptedCalls, expectedConsumedCalls); assert.equal(before.remainingCalls, authority.maximumCalls - expectedConsumedCalls);
let resources, child, result, failure, stdout = "", stderrBytes = 0, exchanged = false, exchangeFailure, active = true;
let stdoutOffset = 0, lastLifecycle, earlyDiagnostic, workerTimedOut = false, ownedResourcesRemoved = false;
try {
  resources = await createOwnedStorefrontJourneyResources();
  child = spawn(process.execPath, [fileURLToPath(new URL("./storefront-journey-llm.worker.mjs", import.meta.url)), ...resources.workerArguments(), String(expectedConsumedCalls), approvalId], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), env: constructionOnlyEnvironment(process.env), windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.on("message", async message => {
    try {
      assert.equal(exchanged, false, "journey_private_key_exchange_single_use"); exchanged = true;
      const request = z.strictObject({ type: z.literal("journey-provider-key-request"), runId: z.uuidv4(), nonce: z.uuidv4() }).safeParse(message);
      assert.ok(request.success && request.data.runId === resources.runId, "journey_owned_child_key_request_required");
      // The worker requests only AFTER its independent live marker checks. The
      // selected key is loaded lazily by this resource-owning parent, never by
      // a grandparent that could kill it before resource cleanup.
      const key = await getProviderKey(Object.freeze({ ...request.data }));
      assert.ok(active && child.connected, "journey_owned_worker_closed_before_key_reply");
      const reply = { type: "journey-provider-key-reply", runId: resources.runId, nonce: request.data.nonce, apiKey: key };
      parseJourneyKeyReply(request.data, reply);
      child.send(reply, error => { if (error) { exchangeFailure = Error("journey_private_key_exchange_failed"); child.kill(); } });
    } catch { exchangeFailure = Error("journey_private_key_exchange_failed"); child.kill(); }
  });
  child.stdout.on("data", chunk => {
    stdout += chunk; if (stdout.length > 4_000_000) { child.kill(); return; }
    const lines = stdout.slice(stdoutOffset).split(/\r?\n/);
    for (const line of lines.slice(0, -1)) {
      const lifecycle = parseJourneyLifecycleLine(line);
      if (lifecycle) { lastLifecycle = lifecycle; console.log("JOURNEY_LIFECYCLE " + JSON.stringify(lifecycle)); }
      const phaseFailure = parseJourneyPhaseFailureLine(line);
      if (phaseFailure && phaseFailure.ledgerBefore === expectedConsumedCalls) {
        earlyDiagnostic = phaseFailure;
        console.log("JOURNEY_LLM_PHASE_FAILURE " + JSON.stringify(phaseFailure));
      }
    }
    stdoutOffset = stdout.length - lines.at(-1).length;
  });
  child.stderr.on("data", chunk => { stderrBytes += chunk.length; if (stderrBytes > 4_000_000) child.kill(); });
  let timer;
  const outcome = await Promise.race([new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); }),
    new Promise((_, reject) => { timer = setTimeout(() => { workerTimedOut = true; reject(Error("journey_real_http_child_deadline")); }, 420_000); })]).finally(() => clearTimeout(timer));
  if (exchangeFailure) throw exchangeFailure;
  assert.equal(outcome.code, 0, "journey_real_http_or_cleanup_failed"); assert.equal(outcome.signal, null);
  const rows = stdout.split(/\r?\n/).filter(line => line.startsWith("JOURNEY_LLM_RESULT "));
  assert.equal(rows.length, 1, "journey_single_llm_result_required"); result = JSON.parse(rows[0].slice("JOURNEY_LLM_RESULT ".length));
  for (const field of ["outOfScopeRefusalValidated", "publicSearchValidated", "publicAddValidated", "selectedOptionsValidated", "quantityEditValidated", "removalValidated", "authenticatedRecoveryValidated", "appClosed"])
    assert.equal(result[field], true, "journey_real_http_evidence_missing");
  assert.equal(result.actualPspValidated, false); assert.equal(result.deployedSandboxValidated, false);
} catch (error) { failure = error; }
finally {
  active = false;
  const errors = [];
  try { await terminateOwnedNativeWorker(child); } catch (error) { errors.push(error); }
  if (resources) try { await resources.close(); ownedResourcesRemoved = true; } catch (error) { errors.push(error); }
  const after = inspectOriginalJourneyBudget({ approvalId });
  assert.ok(after.attemptedCalls >= before.attemptedCalls && after.attemptedCalls <= authority.maximumCalls, "journey_original_ledger_must_never_reset");
  if (result) assert.equal(result.approvedCallsAfter, after.attemptedCalls, "journey_result_original_ledger_mismatch");
  if (errors.length) failure = new AggregateError([...(failure ? [failure] : []), ...errors], "journey_owned_resource_cleanup_failed");
}
if (failure) {
  let diagnostic;
  for (const line of stdout.split(/\r?\n/).filter(line => line.startsWith("JOURNEY_LLM_FAILURE "))) {
    try { const parsed = journeyLlmDiagnosticSchema.safeParse(JSON.parse(line.slice("JOURNEY_LLM_FAILURE ".length)).diagnostic); if (parsed.success && parsed.data.ledgerBefore === expectedConsumedCalls) diagnostic = parsed.data; } catch {}
  }
  diagnostic ??= earlyDiagnostic;
  const safeError = Error("journey_real_http_or_owned_cleanup_failed");
  safeError.journeyEvidence = { phase: "approved-deepseek-http", status: "failed", journeyValidated: false,
    workerTimedOut, ownedResourcesRemoved, ...(lastLifecycle ? { lastLifecycle } : {}), ...(diagnostic ? { diagnostic } : {}) };
  throw safeError;
}
return { ...result, disposablePostgres: true, disposableRedis: true, fullCanonicalSchema: true, cleanupRemaining: 0 };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const approval = parseApprovedLlmFlags(process.argv.slice(2));
    assert.ok(process.connected && typeof process.send === "function", "journey_private_authorized_key_parent_required_no_env_lookup");
    const result = await runApprovedStorefrontJourney({ approvalId: approval.approvalId, expectedConsumedCalls: approval.expectedConsumedCalls, getProviderKey: request => requestJourneyProviderKey(request.runId) });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify(error?.journeyEvidence ?? { phase: "approved-deepseek-http", status: "failed", journeyValidated: false }));
    process.exitCode = 1;
  } finally { if (process.connected) process.disconnect(); }
}
