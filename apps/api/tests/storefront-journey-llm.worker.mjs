import assert from "node:assert/strict";
import { z } from "zod";
import { createOwnedStorefrontJourneyApp } from "./storefront-journey-owned-app.mjs";
import { requestJourneyProviderKey, journeyLlmDiagnosticSchema, projectJourneyPhaseFailure } from "./storefront-journey-llm.guards.mjs";
import { runApprovedStorefrontLlmPhase } from "./storefront-journey-llm-phase.mjs";
import { sandboxLlmApprovalForId } from "./storefront-sandbox-llm-budget.mjs";

// Unlike bootstrap/commerce this worker must NOT preload the loopback-only guard:
// the shared owned helper installs its own early fence before AppModule and then
// atomically replaces it with the original-budget-only DeepSeek guard.
const args = z.tuple([z.string(), z.uuidv4(), z.string(), z.uuidv4(), z.literal("dist-test"), z.uuidv4(), z.uuidv4(), z.uuidv4(),
  z.string().regex(/^(?:1[2-9]|[2-9][0-9]|1[01][0-9]|12[0-9])$/), z.enum(["storefront-sandbox-20261018-approved60", "storefront-sandbox-20261021-approved90", "storefront-sandbox-20261022-approved130"])]).safeParse(process.argv.slice(2));
assert.ok(args.success, "journey_llm_worker_exact_arguments_required");
const [databaseUrl, databaseRunId, redisUrl, redisRunId, tree, runId, merchantId, buyerId, expectedConsumed, approvalId] = args.data;
const authority = sandboxLlmApprovalForId(approvalId);
assert.ok(authority && Number(expectedConsumed) >= (authority.originalConsumedCalls ?? 12) && Number(expectedConsumed) < authority.maximumCalls, "journey_worker_approval_count_mismatch");
assert.ok(process.connected && typeof process.send === "function", "journey_llm_private_parent_required");
let owned, result, failure, diagnostic;
try {
  owned = await createOwnedStorefrontJourneyApp({ databaseUrl, databaseRunId, redisUrl, redisRunId, tree, runId, merchantId, buyerId,
    phase: "approved-llm", receiveProviderKey: () => requestJourneyProviderKey(runId) });
  // Only the credential exchange uses IPC. Closing it avoids an artificial
  // process handle; success still requires natural exit and real app cleanup.
  process.disconnect();
  result = await runApprovedStorefrontLlmPhase(owned, { approvalId, expectedConsumedCalls: Number(expectedConsumed) });
} catch (error) {
  failure = error;
  const full = journeyLlmDiagnosticSchema.safeParse(error?.journeyEvidence);
  diagnostic = full.success ? full.data : undefined;
  const safe = projectJourneyPhaseFailure(diagnostic);
  if (safe) console.log("JOURNEY_LLM_PHASE_FAILURE " + JSON.stringify(safe));
}
finally {
  if (owned) try { const cleanup = await owned.close(); if (result) Object.assign(result, owned.evidence(), cleanup); }
  catch (error) { failure = new AggregateError([...(failure ? [failure] : []), error], "journey_llm_cleanup_failed"); }
  if (process.connected) process.disconnect();
}
if (failure) {
  // Do not dump error messages/stacks, runtime objects, headers or model text.
  // Failures may contain private key/JWT/request data from provider libraries.
  console.log("JOURNEY_LLM_FAILURE " + JSON.stringify({ phase: "approved-deepseek-http", errorName: failure.name,
    aggregateCount: failure instanceof AggregateError ? failure.errors.length : 0, journeyValidated: false, ...(diagnostic ? { diagnostic } : {}) }));
  process.exitCode = 1;
} else console.log("JOURNEY_LLM_RESULT " + JSON.stringify(result));
