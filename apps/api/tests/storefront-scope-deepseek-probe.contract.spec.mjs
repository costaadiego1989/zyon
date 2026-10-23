import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SANDBOX_LLM_APPROVAL } from './storefront-sandbox-llm-budget.mjs';
import { scopeProbeCases, validateScopeProbeArguments } from './storefront-scope-deepseek-probe.mjs';

for (const args of [[], ['--allow-real-deepseek'], ['--allow-real-deepseek', '--approval-id=wrong', '--config-path=private'],
  ['--allow-real-deepseek', `--approval-id=${SANDBOX_LLM_APPROVAL.approvalId}`, '--config-path='],
  ['--allow-real-deepseek', `--approval-id=${SANDBOX_LLM_APPROVAL.approvalId}`, '--config-path=private', '--retry']]) {
  test(`scope probe refuses implicit/invalid approval (${args.length}) without config reads or sends`, () => {
    const child = spawnSync(process.execPath, ['--import', new URL('./test-network-guard.mjs', import.meta.url).href,
      fileURLToPath(new URL('./storefront-scope-deepseek-probe.mjs', import.meta.url)), ...args], {
      encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.equal(child.error, undefined); assert.equal(child.status, 1); assert.equal(child.stdout, '');
    assert.equal(JSON.parse(child.stderr.trim()).reason, 'scope_probe_explicit_opt_in_required');
  });
}
test('scope probe has twelve fixed synthetic cases and unique durable steps, without a production endpoint', () => {
  assert.equal(scopeProbeCases.length, 12);
  assert.equal(new Set(scopeProbeCases.map(entry => entry.id)).size, 12);
  assert.ok(scopeProbeCases.some(entry => entry.domain === 'OUT_OF_SCOPE'));
  assert.ok(scopeProbeCases.some(entry => entry.domain === 'UNCLEAR'));
  assert.ok(scopeProbeCases.some(entry => entry.domain === 'STORE_COMMERCE'));
  assert.ok(scopeProbeCases.some(entry => entry.domain === 'STORE_SUPPORT'));
  assert.throws(() => validateScopeProbeArguments(['--config-path=production']), /explicit_opt_in/);
});
