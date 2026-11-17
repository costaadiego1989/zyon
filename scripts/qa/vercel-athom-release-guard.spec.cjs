const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function decision(branch, target) {
  const env = { ...process.env };
  delete env.VERCEL_GIT_COMMIT_REF;
  delete env.VERCEL_ENV;
  if (branch !== undefined) env.VERCEL_GIT_COMMIT_REF = branch;
  if (target !== undefined) env.VERCEL_ENV = target;
  const result = spawnSync(process.execPath, [path.join(__dirname, '../vercel-deploy-guard.mjs')], { env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result.status;
}

test('named Athom production release is permitted', () => {
  assert.equal(decision('release/athom-uat-20261116', 'production'), 1);
});

test('existing branch decisions remain unchanged', () => {
  for (const branch of ['master', 'homolog']) {
    for (const target of ['production', 'preview', undefined]) assert.equal(decision(branch, target), 1, `${branch}/${target}`);
  }
  assert.equal(decision('fix/checkout-session-edit-20261018', 'production'), 1);
  assert.equal(decision('fix/checkout-session-edit-20261018', 'preview'), 0);
});

test('Athom previews and unrelated or absent sources remain ignored', () => {
  for (const target of ['preview', 'development', '', undefined]) assert.equal(decision('release/athom-uat-20261116', target), 0, `Athom/${target}`);
  for (const branch of ['feat/agentic-assistant-20261116', 'feat/fiscal-invoicing-20261114', 'release/athom-uat-20261116-other', '', undefined]) {
    assert.equal(decision(branch, 'production'), 0, `other/${branch}`);
  }
});
