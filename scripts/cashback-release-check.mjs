import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// A readonly latch: it never seeds, deploys, changes configuration or bypasses a
// failed test. Reports are produced by the actual environment validation runs.
const root = resolve(import.meta.dirname, '..');
const evidence = resolve(root, '.specs/features/cashback-release/evidence');
const phase = process.argv[2];
assert.ok(['local', 'candidate', 'homolog', 'production'].includes(phase), 'explicit release phase required');
const json = name => JSON.parse(readFileSync(resolve(evidence, name), 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function tests(report, minimum) {
  assert.ok(Number.isSafeInteger(report.passed) && report.passed >= minimum);
  assert.equal(report.failed, 0);
}
function tap(file) {
  const bytes = readFileSync(file);
  const output = bytes[0] === 255 && bytes[1] === 254 ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8');
  const count = name => Number([...output.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))].at(-1)?.[1]);
  return { passed: count('pass'), failed: count('fail'), skipped: count('skipped'),
    failures: [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map(row => row[1]) };
}
function candidateRegression(report) {
  // Keep the complete original suite and its known failure visible. Only a
  // byte-identical test reproduced against the served base may be classified
  // as pre-existing; a new failing name or an incomplete TAP run blocks release.
  const original = tap(report.originalLogFile), baseline = tap(report.baselineControlLogFile);
  assert.equal(hash(report.originalLogFile), report.originalLogSha256);
  assert.equal(hash(report.baselineControlLogFile), report.baselineControlLogSha256);
  assert.ok(original.passed >= 240); assert.equal(original.skipped, 0);
  assert.equal(original.failed, 1); assert.equal(baseline.failed, 1);
  assert.deepEqual(original.failures, baseline.failures);
  assert.deepEqual(original.failures, ["ended experiment continuation cannot force the next experiment's commercial rule"]);
  const source = spawnSync('git', ['show', '7229739c7b0da6bbe8da9a7746090e48ae81a7e7:apps/api/src/modules/checkout/application/services/checkout-offer.service.spec.ts'], { cwd: report.directory });
  assert.equal(source.status, 0);
  assert.equal(createHash('sha256').update(source.stdout).digest('hex'), hash(resolve(report.directory, 'apps/api/src/modules/checkout/application/services/checkout-offer.service.spec.ts')));
  const shipping = JSON.parse(readFileSync(report.shippingComparisonFile, 'utf8'));
  assert.equal(shipping.candidate.tests, shipping.baseline.tests);
  const baseNames = new Set(Object.keys(shipping.baseline.failures));
  assert.ok(Object.keys(shipping.candidate.failures).every(name => baseNames.has(name)));
  assert.ok(shipping.candidate.fail <= shipping.baseline.fail);
  for (const name of ['seed', 'financial', 'shipping', 'template', 'dashboard', 'widget', 'storefront']) {
    assert.ok(report.criticalSuites[name]); tests(report.criticalSuites[name], 1);
  }
}
function validateLocal() {
  const runtime = json('local-runtime-seeds.json');
  assert.equal(runtime.environment, 'local'); tests(runtime, 44);
  const independent = json('verifier-runtime-local.json');
  assert.equal(independent.environment, 'local');
  assert.equal(independent.checks.length, 16);
  assert.ok(independent.checks.every(item => item.pass));
  const mutations = json('verifier-seed-mutations-results.json');
  const rows = Array.isArray(mutations) ? mutations : mutations.results;
  assert.equal(rows.length, 3); assert.ok(rows.every(item => item.killed));
}
async function validateCandidate() {
  const report = json('candidate-validation.json');
  assert.equal(report.environment, 'candidate');
  assert.equal(report.status, 'passed');
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: report.directory, encoding: 'utf8' });
  assert.equal(revision.status, 0); assert.equal(revision.stdout.trim(), report.revision);
  const state = spawnSync('git', ['status', '--porcelain'], { cwd: report.directory, encoding: 'utf8' });
  assert.equal(state.status, 0); assert.equal(state.stdout.trim(), '', 'candidate tree must be clean');
  assert.equal(hash(report.sourceManifestFile), report.sourceManifestSha256);
  for (const name of ['api', 'dashboard', 'widget', 'storefront']) assert.equal(report.builds[name], 'passed');
  candidateRegression(report.regression); tests(report.runtime, 44); tests(report.browser, 14);
  assert.equal(report.independentRuntimePassed, true);
  const response = await fetch(report.healthUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(new URL(report.healthUrl).hostname, '127.0.0.1');
  assert.equal(response.status, 200);
  return report;
}
async function validateRemote(target) {
  const report = json(`${target}-validation.json`);
  assert.equal(report.environment, target); assert.equal(report.status, 'passed');
  const candidate = json('candidate-validation.json');
  assert.equal(report.revision, candidate.revision);
  assert.equal(report.sourceManifestSha256, candidate.sourceManifestSha256);
  assert.equal(report.api.status, 'SUCCESS');
  assert.ok(report.api.deploymentId);
  assert.equal(report.api.runtimeHashes.matched, report.api.runtimeHashes.expected);
  assert.ok(report.api.runtimeHashes.expected > 1000);
  for (const name of ['dashboard', 'widget', 'storefront']) {
    assert.equal(report.frontends[name].status, 'READY');
    assert.equal(report.frontends[name].revision, report.revision);
    assert.equal(report.frontends[name].servedBundleVerified, true);
  }
  if (target === 'homolog') {
    assert.deepEqual(report.seedRuns, [0, 0]);
    assert.equal(report.seedLedgerUnchangedOnRepeat, true);
    tests(report.runtime, 44); tests(report.browser, 14);
    assert.equal(report.independentRuntimePassed, true);
  } else {
    const homolog = json('homolog-validation.json');
    assert.equal(homolog.status, 'passed'); assert.equal(homolog.revision, report.revision);
    assert.equal(report.seedExecuted, false);
    assert.equal(report.realMerchantActivation, false);
    assert.equal(report.safeSmokePassed, true);
  }
  const url = new URL(report.healthUrl);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, target === 'homolog' ? 'api-sandbox-8146.up.railway.app' : 'api.zyon-payments.com.br');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
}
try {
  validateLocal();
  if (phase === 'candidate') await validateCandidate();
  if (phase === 'homolog' || phase === 'production') await validateRemote(phase);
  console.log(JSON.stringify({ phase, passed: true, mutations: false, deployExecuted: false }));
} catch (error) {
  console.error(JSON.stringify({ phase, passed: false, reason: error.message }));
  process.exitCode = 1;
}
