import assert from "node:assert/strict";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { z } from "zod";
import { parseApprovedLlmFlags, parseJourneyKeyReply, journeyLlmDiagnosticSchema } from "./storefront-journey-llm.guards.mjs";
import { selectDeepSeekConfig } from "./storefront-deepseek-probe.mjs";
import { SANDBOX_LLM_APPROVAL } from "./storefront-sandbox-llm-budget.mjs";
import { runApprovedStorefrontJourney } from "./storefront-journey-llm.integration.mjs";
import { journeyLifecycleEventSchema } from "./storefront-journey-lifecycle.mjs";

const approval = parseApprovedLlmFlags(process.argv.slice(2));
const requestSchema = z.strictObject({ type: z.literal("journey-provider-key-request"), runId: z.uuidv4(), nonce: z.uuidv4() });
const sourcePath = resolve("C:/Users/Admin/Desktop/AACP/apps/api/.env");
const outputSchema = z.object({ phase: z.literal("approved-deepseek-http"), status: z.enum(["failed"]).optional(),
  journeyValidated: z.boolean().optional(), outOfScopeRefusalValidated: z.boolean().optional(), publicSearchValidated: z.boolean().optional(),
  publicAddValidated: z.boolean().optional(), selectedOptionsValidated: z.boolean().optional(), quantityEditValidated: z.boolean().optional(),
  removalValidated: z.boolean().optional(), authenticatedRecoveryValidated: z.boolean().optional(), appClosed: z.boolean().optional(),
  cleanupHarnessRequired: z.boolean().optional(), runtimeShutdownValidated: z.literal(false).optional(), cleanupRemaining: z.literal(0).optional(),
  approvedCallsBefore: z.number().int().min(12).max(129).optional(), approvedCallsAfter: z.number().int().min(12).max(130).optional(), remainingCalls: z.number().int().min(0).max(48).optional(),
  manualDisconnects: z.number().int().min(0).max(100).optional(), actualPspValidated: z.literal(false).optional(), deployedSandboxValidated: z.literal(false).optional(),
  workerTimedOut: z.boolean().optional(), ownedResourcesRemoved: z.boolean().optional(), lastLifecycle: journeyLifecycleEventSchema.optional(),
  diagnostic: journeyLlmDiagnosticSchema.omit({ traces: true }).strip().optional() });
let exchanged = false;
try {
  const result = await runApprovedStorefrontJourney({ approvalId: approval.approvalId, expectedConsumedCalls: approval.expectedConsumedCalls, getProviderKey(request) {
      assert.equal(exchanged, false, "journey_launcher_key_exchange_single_use"); exchanged = true;
      const checked = requestSchema.safeParse(request); assert.ok(checked.success, "journey_launcher_typed_child_request_required");
      // First and only config read. The direct child asks only after its worker
      // independently verified live owned markers; no file path comes from IPC.
      const stat = lstatSync(sourcePath); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 1_000_000);
      assert.equal(realpathSync(sourcePath).toLowerCase(), sourcePath.toLowerCase(), "journey_launcher_exact_config_path_required");
      const config = selectDeepSeekConfig(parse(readFileSync(sourcePath, "utf8")));
      assert.equal(config.model, SANDBOX_LLM_APPROVAL.model);
      assert.equal(`${config.baseUrl}/chat/completions`, SANDBOX_LLM_APPROVAL.endpoint);
      const reply = { type: "journey-provider-key-reply", runId: checked.data.runId, nonce: checked.data.nonce, apiKey: config.apiKey };
      return parseJourneyKeyReply(checked.data, reply);
  } });
  assert.equal(exchanged, true, "journey_launcher_single_key_exchange_required");
  console.log(JSON.stringify(outputSchema.parse(result)));
} catch (error) {
  const safe = outputSchema.safeParse(error?.journeyEvidence);
  console.error(JSON.stringify(safe.success ? safe.data : { phase: "approved-deepseek-http", status: "failed", journeyValidated: false }));
  process.exitCode = 1;
}
