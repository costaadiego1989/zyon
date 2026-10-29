import { openSync, closeSync, writeFileSync, appendFileSync, fsyncSync, mkdirSync, lstatSync, readFileSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

/** Test-only transport guard, NOT a sandbox journey or production integration.
 * Import performs no I/O. No dotenv, AppModule, database, tools or SDK startup.
 * This approval is separate from the already consumed legacy three-call probe.
 * 1024 bounds OUTPUT per request, not prompt tokens, dollars or all applications.
 * All provider calls in a future driver, including tool continuations/classifiers,
 * must use this transport. Unwrapped clients/remote APIs are NOT controlled here.
 * The local ledger is an accident guard, not protection from filesystem admins.
 * Do not delete/copy/reinitialize it to extend approval. Missing/corrupt/stale-lock
 * state requires investigation; process restart never initializes it implicitly.
 * fsync precedes network. Crash before network may conservatively consume a slot;
 * cancellation/HTTP/parse/timeout/unknown never refund it. No retry or reset API.
 */
export const SANDBOX_LLM_APPROVAL = Object.freeze({ version: 1,
  approvalId: 'storefront-sandbox-20261018-approved60', maximumCalls: 60,
  maximumOutputTokensPerCall: 1024, endpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-chat', retries: false });
export const approvedSandboxBudgetDirectory = fileURLToPath(new URL('../.sandbox-state/storefront-llm-approved60-20261018', import.meta.url));
export const SANDBOX_LLM_EXTENSION_APPROVAL = Object.freeze({ ...SANDBOX_LLM_APPROVAL,
  approvalId: 'storefront-sandbox-20261021-approved90', maximumCalls: 90, originalApprovalId: SANDBOX_LLM_APPROVAL.approvalId,
  originalConsumedCalls: 49 });
export const originalExtendedSandboxBudgetDirectory = fileURLToPath(new URL('../../../../AACP-integracao/apps/api/.sandbox-state/storefront-llm-approved60-20261018', import.meta.url));
export const SANDBOX_LLM_CONTINUATION_APPROVAL = Object.freeze({ ...SANDBOX_LLM_APPROVAL,
  approvalId: 'storefront-sandbox-20261022-approved130', maximumCalls: 130,
  originalApprovalId: SANDBOX_LLM_EXTENSION_APPROVAL.approvalId, originalConsumedCalls: 89 });
export function sandboxLlmApprovalForId(id) {
  return [SANDBOX_LLM_APPROVAL, SANDBOX_LLM_EXTENSION_APPROVAL, SANDBOX_LLM_CONTINUATION_APPROVAL].find(approval => approval.approvalId === id);
}
const maximumRequestBytes = 80_000, maximumResponseBytes = 262144, timeoutMs = 20_000;
const stages = new Set(['turn', 'tool', 'classifier', 'copy', 'nudge']);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
class SandboxBudgetError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new SandboxBudgetError(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value, fields) => plain(value) && Object.keys(value).sort().join('|') === [...fields].sort().join('|');
const canonicalDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const file = (directory, name) => join(directory, name);
function regular(path, kind) {
  let stat;
  try { stat = lstatSync(path); } catch { fail('sandbox_budget_not_initialized'); }
  if (stat.isSymbolicLink() || !(kind === 'directory' ? stat.isDirectory() : stat.isFile())) fail('sandbox_budget_ledger_invalid');
  return stat;
}
function readState(directory, synthetic) {
  regular(directory, 'directory');
  if (regular(file(directory, 'manifest.json')).size > 4096 || regular(file(directory, 'attempts.jsonl')).size > 65536) fail('sandbox_budget_ledger_invalid');
  let manifest, text;
  try { manifest = JSON.parse(readFileSync(file(directory, 'manifest.json'), 'utf8')); text = readFileSync(file(directory, 'attempts.jsonl'), 'utf8'); }
  catch { fail('sandbox_budget_ledger_invalid'); }
  if (!keys(manifest, [...Object.keys(SANDBOX_LLM_APPROVAL), 'synthetic', 'createdAt']) || manifest.synthetic !== synthetic
    || !canonicalDate(manifest.createdAt) || Object.entries(SANDBOX_LLM_APPROVAL).some(([key, value]) => manifest[key] !== value)) fail('sandbox_budget_manifest_invalid');
  if (text && !text.endsWith('\n')) fail('sandbox_budget_ledger_invalid');
  let attempts;
  try { attempts = text ? text.slice(0, -1).split('\n').map(line => JSON.parse(line)) : []; }
  catch { fail('sandbox_budget_ledger_invalid'); }
  if (attempts.length > SANDBOX_LLM_APPROVAL.maximumCalls) fail('sandbox_budget_ledger_invalid');
  const seen = new Set();
  for (const [index, attempt] of attempts.entries()) {
    if (!keys(attempt, ['version', 'callNumber', 'stepId', 'stage', 'maxTokens', 'at']) || attempt.version !== 1 || attempt.callNumber !== index + 1
      || !uuid(attempt.stepId) || seen.has(attempt.stepId) || !stages.has(attempt.stage) || !canonicalDate(attempt.at)
      || !Number.isInteger(attempt.maxTokens) || attempt.maxTokens < 1 || attempt.maxTokens > SANDBOX_LLM_APPROVAL.maximumOutputTokensPerCall) fail('sandbox_budget_ledger_invalid');
    seen.add(attempt.stepId);
  }
  return attempts;
}
function lock(directory, work) {
  regular(directory, 'directory');
  let descriptor;
  try { descriptor = openSync(file(directory, 'reservation.lock'), 'wx', 0o600); }
  catch (error) { if (error?.code === 'EEXIST') fail('sandbox_budget_locked'); throw error; }
  try { return work(); }
  finally { closeSync(descriptor); unlinkSync(file(directory, 'reservation.lock')); }
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
function extensionExists(directory) {
  try { lstatSync(file(directory, 'extension90.json')); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function continuationExists(directory) {
  try { lstatSync(file(directory, 'extension130.json')); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function continuationHashes(directory) {
  return { previousManifestSha256: sha256(readFileSync(file(directory, 'extension90.json'))),
    previousAttemptsSha256: sha256(readFileSync(file(directory, 'extension90-attempts.jsonl'))) };
}
function readContinuation(directory, synthetic) {
  const previous = readExtension(directory, synthetic);
  if (regular(file(directory, 'extension130.json')).size > 4096 || regular(file(directory, 'extension130-attempts.jsonl')).size > 65536) fail('sandbox_budget_ledger_invalid');
  let manifest, text, attempts;
  try {
    manifest = JSON.parse(readFileSync(file(directory, 'extension130.json'), 'utf8'));
    text = readFileSync(file(directory, 'extension130-attempts.jsonl'), 'utf8');
    attempts = text ? text.slice(0, -1).split('\n').map(line => JSON.parse(line)) : [];
  } catch { fail('sandbox_budget_ledger_invalid'); }
  if (!keys(manifest, [...Object.keys(SANDBOX_LLM_CONTINUATION_APPROVAL), 'synthetic', 'createdAt', 'previousManifestSha256', 'previousAttemptsSha256'])
    || manifest.synthetic !== synthetic || !canonicalDate(manifest.createdAt)
    || Object.entries(SANDBOX_LLM_CONTINUATION_APPROVAL).some(([key, value]) => manifest[key] !== value)) fail('sandbox_budget_manifest_invalid');
  if (previous.length !== 89 || Object.entries(continuationHashes(directory)).some(([key, value]) => manifest[key] !== value)) fail('sandbox_budget_continuation_original_drift');
  if (text && !text.endsWith('\n') || previous.length + attempts.length > 130) fail('sandbox_budget_ledger_invalid');
  const seen = new Set(previous.map(row => row.stepId));
  for (const [index, attempt] of attempts.entries()) {
    if (!keys(attempt, ['version', 'callNumber', 'stepId', 'stage', 'maxTokens', 'at']) || attempt.version !== 1 || attempt.callNumber !== 90 + index
      || !uuid(attempt.stepId) || seen.has(attempt.stepId) || !stages.has(attempt.stage) || !canonicalDate(attempt.at)
      || !Number.isInteger(attempt.maxTokens) || attempt.maxTokens < 1 || attempt.maxTokens > 1024) fail('sandbox_budget_ledger_invalid');
    seen.add(attempt.stepId);
  }
  return [...previous, ...attempts];
}
function initializeContinuation(directory, synthetic) {
  return lock(directory, () => {
    if (continuationExists(directory)) fail('sandbox_budget_already_initialized');
    const previous = readExtension(directory, synthetic);
    if (previous.length !== 89) fail('sandbox_budget_continuation_baseline_mismatch');
    try { lstatSync(file(directory, 'extension130-attempts.jsonl')); fail('sandbox_budget_already_initialized'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const manifest = { ...SANDBOX_LLM_CONTINUATION_APPROVAL, synthetic, createdAt: new Date().toISOString(), ...continuationHashes(directory) };
    for (const [name, content] of [['extension130.json', JSON.stringify(manifest) + '\n'], ['extension130-attempts.jsonl', '']]) {
      const descriptor = openSync(file(directory, name), 'wx', 0o600);
      try { writeFileSync(descriptor, content); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    }
    return Object.freeze({ ...SANDBOX_LLM_CONTINUATION_APPROVAL, synthetic, attemptedCalls: 89, remainingCalls: 41 });
  });
}
function originalHashes(directory) {
  return { originalManifestSha256: sha256(readFileSync(file(directory, 'manifest.json'))),
    originalAttemptsSha256: sha256(readFileSync(file(directory, 'attempts.jsonl'))) };
}
function readExtension(directory, synthetic) {
  const original = readState(directory, synthetic);
  if (regular(file(directory, 'extension90.json')).size > 4096 || regular(file(directory, 'extension90-attempts.jsonl')).size > 65536) fail('sandbox_budget_ledger_invalid');
  let manifest, text, attempts;
  try { manifest = JSON.parse(readFileSync(file(directory, 'extension90.json'), 'utf8'));
    text = readFileSync(file(directory, 'extension90-attempts.jsonl'), 'utf8');
    attempts = text ? text.slice(0, -1).split('\n').map(line => JSON.parse(line)) : []; }
  catch { fail('sandbox_budget_ledger_invalid'); }
  if (!keys(manifest, [...Object.keys(SANDBOX_LLM_EXTENSION_APPROVAL), 'synthetic', 'createdAt', 'originalManifestSha256', 'originalAttemptsSha256'])
    || manifest.synthetic !== synthetic || !canonicalDate(manifest.createdAt)
    || Object.entries(SANDBOX_LLM_EXTENSION_APPROVAL).some(([key, value]) => manifest[key] !== value)) fail('sandbox_budget_manifest_invalid');
  const hashes = originalHashes(directory);
  if (original.length !== 49 || Object.entries(hashes).some(([key, value]) => manifest[key] !== value)) fail('sandbox_budget_extension_original_drift');
  if (text && !text.endsWith('\n') || original.length + attempts.length > 90) fail('sandbox_budget_ledger_invalid');
  const seen = new Set(original.map(row => row.stepId));
  for (const [index, attempt] of attempts.entries()) {
    if (!keys(attempt, ['version', 'callNumber', 'stepId', 'stage', 'maxTokens', 'at']) || attempt.version !== 1 || attempt.callNumber !== 50 + index
      || !uuid(attempt.stepId) || seen.has(attempt.stepId) || !stages.has(attempt.stage) || !canonicalDate(attempt.at)
      || !Number.isInteger(attempt.maxTokens) || attempt.maxTokens < 1 || attempt.maxTokens > 1024) fail('sandbox_budget_ledger_invalid');
    seen.add(attempt.stepId);
  }
  return [...original, ...attempts];
}
function initializeExtension(directory, synthetic) {
  return lock(directory, () => {
    const original = readState(directory, synthetic);
    if (original.length !== 49) fail('sandbox_budget_extension_baseline_mismatch');
    if (extensionExists(directory)) fail('sandbox_budget_already_initialized');
    try { lstatSync(file(directory, 'extension90-attempts.jsonl')); fail('sandbox_budget_already_initialized'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const manifest = { ...SANDBOX_LLM_EXTENSION_APPROVAL, synthetic, createdAt: new Date().toISOString(), ...originalHashes(directory) };
    for (const [name, content] of [['extension90.json', JSON.stringify(manifest) + '\n'], ['extension90-attempts.jsonl', '']]) {
      const descriptor = openSync(file(directory, name), 'wx', 0o600);
      try { writeFileSync(descriptor, content); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    }
    return Object.freeze({ ...SANDBOX_LLM_EXTENSION_APPROVAL, synthetic, attemptedCalls: 49, remainingCalls: 41 });
  });
}
function extendedApproval(options) {
  if (!keys(options, ['allowRealDeepSeek', 'approvalId', 'expectedConsumedCalls']) || options.allowRealDeepSeek !== true
    || options.approvalId !== SANDBOX_LLM_EXTENSION_APPROVAL.approvalId || options.expectedConsumedCalls !== 49) fail('sandbox_budget_explicit_extension_approval_required');
}
function canonicalBudgetPath(path) {
  let current = resolve(path); const missing = [];
  for (;;) {
    try { const canonical = join(realpathSync.native(current), ...missing.reverse());
      return process.platform === 'win32' ? canonical.toLowerCase() : canonical; }
    catch (error) { if (error.code !== 'ENOENT') throw error;
      const parent = dirname(current); if (parent === current) throw error;
      missing.push(basename(current)); current = parent; }
  }
}
/** Canonical identity only; no ledger read, lock or initialization. */
export function sameSandboxBudgetDirectory(left, right) { return canonicalBudgetPath(left) === canonicalBudgetPath(right); }
function isRealBudgetDirectory(directory) {
  return [approvedSandboxBudgetDirectory, originalExtendedSandboxBudgetDirectory].some(path => sameSandboxBudgetDirectory(directory, path));
}
export function initializeApprovedSandboxLlmExtension(options) {
  extendedApproval(options); return initializeExtension(originalExtendedSandboxBudgetDirectory, false);
}
export function inspectApprovedSandboxLlmExtension(options) {
  if (!keys(options, ['approvalId']) || options.approvalId !== SANDBOX_LLM_EXTENSION_APPROVAL.approvalId) fail('sandbox_budget_explicit_extension_approval_required');
  const directory = originalExtendedSandboxBudgetDirectory;
  if (continuationExists(directory)) fail('sandbox_budget_continuation_explicit_authority_required');
  try { lstatSync(file(directory, 'reservation.lock')); fail('sandbox_budget_locked'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const attempts = readExtension(directory, false);
  return Object.freeze({ ...SANDBOX_LLM_EXTENSION_APPROVAL, synthetic: false, attemptedCalls: attempts.length, remainingCalls: 90 - attempts.length });
}
export function createApprovedExtendedSandboxDeepSeekBudget(options) {
  if (!keys(options, ['allowRealDeepSeek', 'approvalId']) || options.allowRealDeepSeek !== true
    || options.approvalId !== SANDBOX_LLM_EXTENSION_APPROVAL.approvalId) fail('sandbox_budget_explicit_extension_approval_required');
  return create(originalExtendedSandboxBudgetDirectory, false, globalThis.fetch, timeoutMs, true);
}
function syntheticExtensionDirectory(options, fields) {
  if (!keys(options, fields) || typeof options.directory !== 'string' || !options.directory.length
    || isRealBudgetDirectory(options.directory)
    || options.approvalId !== SANDBOX_LLM_EXTENSION_APPROVAL.approvalId) fail('sandbox_budget_synthetic_configuration_invalid');
  return resolve(options.directory);
}
export function initializeSyntheticSandboxLlmExtension(options) {
  const directory = syntheticExtensionDirectory(options, ['directory', 'approvalId', 'expectedConsumedCalls']);
  if (options.expectedConsumedCalls !== 49) fail('sandbox_budget_extension_baseline_mismatch');
  return initializeExtension(directory, true);
}
export function createSyntheticExtendedSandboxDeepSeekBudget(options) {
  const directory = syntheticExtensionDirectory(options, ['directory', 'approvalId', 'fetchFn']);
  if (typeof options.fetchFn !== 'function' || options.fetchFn === globalThis.fetch) fail('sandbox_budget_synthetic_configuration_invalid');
  return create(directory, true, options.fetchFn, timeoutMs, true);
}
function continuationApproval(options, initialize = false) {
  if (!keys(options, ['allowRealDeepSeek', 'approvalId', ...(initialize ? ['expectedConsumedCalls'] : [])])
    || options.allowRealDeepSeek !== true || options.approvalId !== SANDBOX_LLM_CONTINUATION_APPROVAL.approvalId
    || initialize && options.expectedConsumedCalls !== 89) fail('sandbox_budget_explicit_continuation_approval_required');
}
function syntheticContinuationDirectory(options, fields) {
  if (!keys(options, fields) || typeof options.directory !== 'string' || !options.directory.length || isRealBudgetDirectory(options.directory)
    || options.approvalId !== SANDBOX_LLM_CONTINUATION_APPROVAL.approvalId) fail('sandbox_budget_synthetic_configuration_invalid');
  return resolve(options.directory);
}
export function initializeApprovedSandboxLlmContinuation(options) {
  continuationApproval(options, true); return initializeContinuation(originalExtendedSandboxBudgetDirectory, false);
}
export function initializeSyntheticSandboxLlmContinuation(options) {
  const directory = syntheticContinuationDirectory(options, ['directory', 'approvalId', 'expectedConsumedCalls']);
  if (options.expectedConsumedCalls !== 89) fail('sandbox_budget_continuation_baseline_mismatch');
  return initializeContinuation(directory, true);
}
export function inspectApprovedSandboxLlmContinuation(options) {
  if (!keys(options, ['approvalId']) || options.approvalId !== SANDBOX_LLM_CONTINUATION_APPROVAL.approvalId) fail('sandbox_budget_explicit_continuation_approval_required');
  const directory = originalExtendedSandboxBudgetDirectory;
  try { lstatSync(file(directory, 'reservation.lock')); fail('sandbox_budget_locked'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const attempts = readContinuation(directory, false);
  return Object.freeze({ ...SANDBOX_LLM_CONTINUATION_APPROVAL, synthetic: false, attemptedCalls: attempts.length, remainingCalls: 130 - attempts.length });
}
export function createApprovedContinuationSandboxDeepSeekBudget(options) {
  continuationApproval(options); return create(originalExtendedSandboxBudgetDirectory, false, globalThis.fetch, timeoutMs, true, true);
}
export function createSyntheticContinuationSandboxDeepSeekBudget(options) {
  const directory = syntheticContinuationDirectory(options, ['directory', 'approvalId', 'fetchFn']);
  if (typeof options.fetchFn !== 'function' || options.fetchFn === globalThis.fetch) fail('sandbox_budget_synthetic_configuration_invalid');
  return create(directory, true, options.fetchFn, timeoutMs, true, true);
}
function initialize(directory, synthetic) {
  // This is called only by an explicit initializer, never by creation/status/send.
  mkdirSync(dirname(directory), { recursive: true, mode: 0o700 });
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error?.code === 'EEXIST') fail('sandbox_budget_already_initialized'); throw error; }
  for (const [name, content] of [['manifest.json', JSON.stringify({ ...SANDBOX_LLM_APPROVAL, synthetic, createdAt: new Date().toISOString() }) + '\n'], ['attempts.jsonl', '']]) {
    const descriptor = openSync(file(directory, name), 'wx', 0o600);
    try { writeFileSync(descriptor, content); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }
  return Object.freeze({ ...SANDBOX_LLM_APPROVAL, attemptedCalls: 0, remainingCalls: SANDBOX_LLM_APPROVAL.maximumCalls, synthetic });
}
function approved(options) {
  if (!keys(options, ['allowRealDeepSeek', 'approvalId']) || options.allowRealDeepSeek !== true
    || options.approvalId !== SANDBOX_LLM_APPROVAL.approvalId) fail('sandbox_budget_explicit_approval_required');
}
export function initializeApprovedSandboxLlmBudget(options) { approved(options); return initialize(approvedSandboxBudgetDirectory, false); }
export function initializeSyntheticSandboxLlmBudget(options) {
  if (!keys(options, ['directory']) || typeof options.directory !== 'string' || !options.directory.length
    || isRealBudgetDirectory(options.directory)) fail('sandbox_budget_synthetic_configuration_invalid');
  return initialize(resolve(options.directory), true);
}
function validateRequest(url, options) {
  if (String(url) !== SANDBOX_LLM_APPROVAL.endpoint || !plain(options) || options.method !== 'POST'
    || Object.keys(options).some(key => !['method', 'headers', 'body', 'signal', 'redirect'].includes(key))
    || typeof options.body !== 'string' || Buffer.byteLength(options.body, 'utf8') > maximumRequestBytes
    || options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail('sandbox_provider_request_invalid');
  let body, headers;
  try { body = JSON.parse(options.body); headers = new Headers(options.headers); } catch { fail('sandbox_provider_request_invalid'); }
  if (!plain(body) || body.model !== SANDBOX_LLM_APPROVAL.model || !Number.isInteger(body.max_tokens)
    || body.max_tokens < 1 || body.max_tokens > SANDBOX_LLM_APPROVAL.maximumOutputTokensPerCall || body.stream !== undefined && body.stream !== false
    || Object.keys(body).some(key => !['model', 'max_tokens', 'messages', 'temperature', 'stream', 'response_format', 'tools', 'tool_choice', 'stop'].includes(key))
    || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 200
    || body.messages.some(message => !plain(message) || !['system', 'user', 'assistant', 'tool'].includes(message.role)
      || typeof message.content !== 'string' || Object.keys(message).some(key => !['role', 'content', 'name', 'tool_call_id', 'tool_calls'].includes(key)))
    || !/^Bearer [^\s]+$/.test(headers.get('authorization') ?? '') || headers.get('content-type') !== 'application/json'
    || [...headers.keys()].some(key => !['authorization', 'content-type', 'http-referer', 'x-title'].includes(key))) fail('sandbox_provider_request_invalid');
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > 32)) fail('sandbox_provider_request_invalid');
  if (body.response_format !== undefined && (!plain(body.response_format) || !['json_object', 'json_schema'].includes(body.response_format.type))) fail('sandbox_provider_request_invalid');
  return { body: options.body, maxTokens: body.max_tokens, headers, signal: options.signal };
}
function create(directory, synthetic, fetchFn, maximumMilliseconds, extended = false, continued = false) {
  const approval = continued ? SANDBOX_LLM_CONTINUATION_APPROVAL : extended ? SANDBOX_LLM_EXTENSION_APPROVAL : SANDBOX_LLM_APPROVAL;
  const readAttempts = () => {
    if (!continued && continuationExists(directory)) fail('sandbox_budget_continuation_explicit_authority_required');
    if (continued) return readContinuation(directory, synthetic);
    if (!extended && extensionExists(directory)) fail('sandbox_budget_extension_explicit_authority_required');
    return extended ? readExtension(directory, synthetic) : readState(directory, synthetic);
  };
  return Object.freeze({
    status() {
      return lock(directory, () => { const attempts = readAttempts();
        return Object.freeze({ ...approval, attemptedCalls: attempts.length, remainingCalls: approval.maximumCalls - attempts.length, synthetic }); });
    },
    fetchForStep(rawMetadata) {
      if (!keys(rawMetadata, ['stepId', 'stage']) || !uuid(rawMetadata.stepId) || !stages.has(rawMetadata.stage)) fail('sandbox_budget_step_invalid');
      const metadata = { ...rawMetadata }; // Do not reread mutable caller metadata after awaiting transport.
      return async (url, options) => {
        const request = validateRequest(url, options);
        lock(directory, () => {
          const attempts = readAttempts();
          if (attempts.some(attempt => attempt.stepId === metadata.stepId)) fail('sandbox_budget_step_already_attempted');
          if (attempts.length >= approval.maximumCalls) fail('sandbox_budget_exhausted');
          const record = { version: 1, callNumber: attempts.length + 1, ...metadata, maxTokens: request.maxTokens, at: new Date().toISOString() };
          const descriptor = openSync(file(directory, continued ? 'extension130-attempts.jsonl' : extended ? 'extension90-attempts.jsonl' : 'attempts.jsonl'), 'a');
          try { appendFileSync(descriptor, JSON.stringify(record) + '\n'); fsyncSync(descriptor); } finally { closeSync(descriptor); }
        });
        const controller = new AbortController();
        const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
        let timer, onAbort;
        const aborted = new Promise((_, reject) => {
          onAbort = () => reject(new SandboxBudgetError(controller.signal.aborted ? 'sandbox_provider_timeout' : 'sandbox_provider_aborted'));
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        timer = setTimeout(() => controller.abort(), maximumMilliseconds);
        let reader;
        try {
          const response = await Promise.race([aborted, Promise.resolve().then(() => {
            if (signal.aborted) return aborted;
            return fetchFn(SANDBOX_LLM_APPROVAL.endpoint, { method: 'POST', headers: request.headers, body: request.body, redirect: 'error', signal });
          })]);
          if (!(response instanceof Response) || response.redirected || response.url && response.url !== SANDBOX_LLM_APPROVAL.endpoint) fail('sandbox_provider_response_invalid');
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            const error = new SandboxBudgetError('sandbox_provider_http_failed'); error.httpStatus = response.status; throw error;
          }
          const chunks = []; let bytes = 0;
          if (response.body) {
            reader = response.body.getReader();
            while (true) {
              const next = await Promise.race([aborted, reader.read()]); if (next.done) break;
              bytes += next.value.byteLength; if (bytes > maximumResponseBytes) fail('sandbox_provider_response_too_large');
              chunks.push(Buffer.from(next.value));
            }
          }
          return new Response(Buffer.concat(chunks), { status: response.status, headers: { 'content-type': 'application/json' } });
        } catch (error) {
          if (error instanceof SandboxBudgetError) throw error;
          fail('sandbox_provider_network_failed');
        } finally {
          clearTimeout(timer); signal.removeEventListener('abort', onAbort);
          if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
      };
    },
  });
}
export function createApprovedSandboxDeepSeekBudget(options) {
  approved(options); return create(approvedSandboxBudgetDirectory, false, globalThis.fetch, timeoutMs);
}
/** Synthetic test escape hatch cannot read or initialize the real approval path. */
export function createSyntheticSandboxDeepSeekBudget(options) {
  if (!plain(options) || Object.keys(options).some(key => !['directory', 'fetchFn', 'timeoutMs'].includes(key))
    || typeof options.directory !== 'string' || !options.directory.length || isRealBudgetDirectory(options.directory)
    || typeof options.fetchFn !== 'function' || options.fetchFn === globalThis.fetch
    || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > timeoutMs)) fail('sandbox_budget_synthetic_configuration_invalid');
  return create(resolve(options.directory), true, options.fetchFn, options.timeoutMs ?? timeoutMs);
}
function main(args) {
  if (args.length === 4 && args[0] === '--extend-original-budget-to=130' && args[1] === '--allow-real-deepseek'
    && args[2] === '--approval-id=' + SANDBOX_LLM_CONTINUATION_APPROVAL.approvalId && args[3] === '--expected-consumed-calls=89') {
    console.log(JSON.stringify(initializeApprovedSandboxLlmContinuation({ allowRealDeepSeek: true,
      approvalId: SANDBOX_LLM_CONTINUATION_APPROVAL.approvalId, expectedConsumedCalls: 89 }))); return;
  }
  if (args.length === 4 && args[0] === '--extend-original-budget-to=90' && args[1] === '--allow-real-deepseek'
    && args[2] === '--approval-id=' + SANDBOX_LLM_EXTENSION_APPROVAL.approvalId && args[3] === '--expected-consumed-calls=49') {
    console.log(JSON.stringify(initializeApprovedSandboxLlmExtension({ allowRealDeepSeek: true,
      approvalId: SANDBOX_LLM_EXTENSION_APPROVAL.approvalId, expectedConsumedCalls: 49 }))); return;
  }
  if (args.length === 1 && args[0] === '--help') {
    console.log(JSON.stringify({ approval: SANDBOX_LLM_APPROVAL, commands: ['--status', '--initialize-approved-budget --allow-real-deepseek --approval-id=' + SANDBOX_LLM_APPROVAL.approvalId],
      providerCalls: 0, applicationStarted: false, note: 'CLI never calls a provider. Future explicit driver must wrap every HTTP/tool step. No reset; output limit is not a prompt-token or dollar cap.' })); return;
  }
  if (args.length === 1 && args[0] === '--status') {
    console.log(JSON.stringify(create(approvedSandboxBudgetDirectory, false, globalThis.fetch, timeoutMs).status())); return;
  }
  if (args.length === 3 && args[0] === '--initialize-approved-budget' && args[1] === '--allow-real-deepseek'
    && args[2] === '--approval-id=' + SANDBOX_LLM_APPROVAL.approvalId) {
    console.log(JSON.stringify(initializeApprovedSandboxLlmBudget({ allowRealDeepSeek: true, approvalId: SANDBOX_LLM_APPROVAL.approvalId }))); return;
  }
  fail('sandbox_budget_cli_invalid');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) {
    const reason = ['sandbox_budget_cli_invalid', 'sandbox_budget_not_initialized', 'sandbox_budget_locked', 'sandbox_budget_already_initialized',
      'sandbox_budget_manifest_invalid', 'sandbox_budget_ledger_invalid'].includes(error?.message) ? error.message : 'sandbox_budget_failed_closed';
    console.error(JSON.stringify({ status: 'failed', reason, providerCalls: 0, credentialsLogged: false })); process.exitCode = 1;
  }
}
