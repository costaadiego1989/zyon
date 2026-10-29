import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SANDBOX_LLM_APPROVAL, SANDBOX_LLM_EXTENSION_APPROVAL, inspectApprovedSandboxLlmExtension,
  createApprovedExtendedSandboxDeepSeekBudget, SANDBOX_LLM_CONTINUATION_APPROVAL, inspectApprovedSandboxLlmContinuation,
  createApprovedContinuationSandboxDeepSeekBudget, approvedSandboxBudgetDirectory as freshWorkspaceDefault } from "./storefront-sandbox-llm-budget.mjs";

// Exact original sibling only. Never accept a CLI directory, copy a ledger,
// initialize a fresh budget or reset 12 consumed calls during workspace replay.
const originalModuleUrl = new URL("../../../../AACP-integracao/apps/api/tests/storefront-sandbox-llm-budget.mjs", import.meta.url);
const originalDirectoryUrl = new URL("../.sandbox-state/storefront-llm-approved60-20261018/", originalModuleUrl);
const allowedStages = new Set(["turn", "tool", "classifier", "copy", "nudge"]);
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function plainKeys(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("|") === [...fields].sort().join("|");
}
function regular(path, directory = false) {
  const stat = lstatSync(path);
  assert.ok(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()), "journey_original_budget_regular_path_required");
  return stat;
}
/** Read-only budget attestation for a runner that still denies ALL providers.
 * This flag cannot initialize, spend or activate the distinct paid phase. */
export function parseJourneyBudgetAuditFlags(args, requiredFlags) {
  assert.ok(Array.isArray(args) && Array.isArray(requiredFlags));
  const audit = args.filter(value => typeof value === "string" && value.startsWith("--budget-approval-id="));
  assert.ok(audit.length <= 1, "journey_single_unpaid_budget_audit_required");
  if (audit.length) assert.ok([SANDBOX_LLM_EXTENSION_APPROVAL, SANDBOX_LLM_CONTINUATION_APPROVAL].some(approval => audit[0] === `--budget-approval-id=${approval.approvalId}`),
    "journey_explicit_unpaid_budget_audit_required");
  assert.deepEqual([...args].sort(), [...requiredFlags, ...audit].sort(), "explicit_owned_journey_commerce_flags_required");
  return audit.length ? Object.freeze({ approvalId: audit[0].slice('--budget-approval-id='.length) }) : undefined;
}
/** Pure parser for refusal contracts. No mutation, network or budget minting. */
export function parseOriginalJourneyBudgetEvidence(manifest, text) {
  assert.ok(plainKeys(manifest, [...Object.keys(SANDBOX_LLM_APPROVAL), "synthetic", "createdAt"])
    && manifest.synthetic === false && date(manifest.createdAt), "journey_original_budget_manifest_invalid");
  for (const [key, expected] of Object.entries(SANDBOX_LLM_APPROVAL)) assert.equal(manifest[key], expected, "journey_original_approval_mismatch");
  assert.ok(typeof text === "string" && Buffer.byteLength(text) <= 65536 && (!text || text.endsWith("\n")), "journey_original_budget_ledger_invalid");
  const rows = text ? text.slice(0, -1).split("\n").map(line => JSON.parse(line)) : [];
  assert.ok(rows.length <= 60, "journey_original_budget_exhausted");
  const ids = new Set();
  for (const [index, row] of rows.entries()) {
    assert.ok(plainKeys(row, ["version", "callNumber", "stepId", "stage", "maxTokens", "at"]) && row.version === 1
      && row.callNumber === index + 1 && uuid(row.stepId) && !ids.has(row.stepId) && allowedStages.has(row.stage)
      && Number.isInteger(row.maxTokens) && row.maxTokens > 0 && row.maxTokens <= 1024 && date(row.at), "journey_original_budget_ledger_invalid");
    ids.add(row.stepId);
  }
  return Object.freeze({ ...SANDBOX_LLM_APPROVAL, synthetic: false, attemptedCalls: rows.length, remainingCalls: 60 - rows.length });
}
/** Read-only preflight. Does not call status(), acquire locks, initialize or
 * consume a slot. The actual budget's atomic guard still runs at send time. */
export function inspectOriginalJourneyBudget(options) {
  if (options !== undefined) {
    assert.ok(plainKeys(options, ["approvalId"]), "journey_explicit_original_approval_required");
    if (options.approvalId === SANDBOX_LLM_CONTINUATION_APPROVAL.approvalId) return inspectApprovedSandboxLlmContinuation(options);
    if (options.approvalId === SANDBOX_LLM_EXTENSION_APPROVAL.approvalId) return inspectApprovedSandboxLlmExtension(options);
    assert.equal(options.approvalId, SANDBOX_LLM_APPROVAL.approvalId, "journey_explicit_original_approval_required");
  }
  const directory = fileURLToPath(originalDirectoryUrl);
  assert.notEqual(directory.replace(/[\\/]$/, ""), freshWorkspaceDefault.replace(/[\\/]$/, ""), "journey_original_budget_must_not_use_fresh_default");
  regular(directory, true);
  try { lstatSync(new URL("extension90.json", originalDirectoryUrl)); throw Error("journey_extension_explicit_authority_required"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const manifestPath = new URL("manifest.json", originalDirectoryUrl), attemptsPath = new URL("attempts.jsonl", originalDirectoryUrl);
  assert.ok(regular(manifestPath).size <= 4096 && regular(attemptsPath).size <= 65536, "journey_original_budget_ledger_invalid");
  try { lstatSync(new URL("reservation.lock", originalDirectoryUrl)); throw Error("journey_original_budget_locked"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return parseOriginalJourneyBudgetEvidence(JSON.parse(readFileSync(manifestPath, "utf8")), readFileSync(attemptsPath, "utf8"));
}

/** Invoke ONLY after owned-resource preflight and egress installation, with the
 * already granted approval. Loading the old module never consumes a call. Its
 * returned budget writes only the ORIGINAL ledger when fetchForStep sends. */
export async function createOriginalApprovedJourneyBudget(options) {
  assert.ok(plainKeys(options, ["allowRealDeepSeek", "approvalId"]) && options.allowRealDeepSeek === true
    && [SANDBOX_LLM_APPROVAL.approvalId, SANDBOX_LLM_EXTENSION_APPROVAL.approvalId, SANDBOX_LLM_CONTINUATION_APPROVAL.approvalId].includes(options.approvalId), "journey_explicit_original_approval_required");
  if (options.approvalId === SANDBOX_LLM_CONTINUATION_APPROVAL.approvalId) {
    inspectOriginalJourneyBudget({ approvalId: options.approvalId });
    return createApprovedContinuationSandboxDeepSeekBudget(options);
  }
  if (options.approvalId === SANDBOX_LLM_EXTENSION_APPROVAL.approvalId) {
    inspectOriginalJourneyBudget({ approvalId: options.approvalId });
    return createApprovedExtendedSandboxDeepSeekBudget(options);
  }
  inspectOriginalJourneyBudget(); regular(originalModuleUrl);
  const original = await import(originalModuleUrl);
  assert.equal(original.approvedSandboxBudgetDirectory.replace(/[\\/]$/, ""), fileURLToPath(originalDirectoryUrl).replace(/[\\/]$/, ""), "journey_original_budget_module_mismatch");
  assert.deepEqual(original.SANDBOX_LLM_APPROVAL, SANDBOX_LLM_APPROVAL);
  return original.createApprovedSandboxDeepSeekBudget({ ...options });
}
