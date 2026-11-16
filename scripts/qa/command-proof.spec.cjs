const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hasExecutedTests, runProofCommand } = require('./command-proof.cjs');

test('rejects successful-looking empty Vitest, Playwright and Node file plans', () => {
  assert.equal(hasExecutedTests('pnpm exec vitest run sample.ts -t absent', 'Test Files 1 skipped\nTests 30 skipped (30)'), false);
  assert.equal(hasExecutedTests('node --test --test-name-pattern=absent sample.test.cjs', '1..0\nok 1 - sample.test.cjs\n# pass 1\n# fail 0\n'), false);
  assert.equal(hasExecutedTests('pnpm exec playwright test --grep absent', '0 passed'), false);
});
test('requires passing cases while allowing deliberately unselected test cases', () => {
  assert.equal(hasExecutedTests('pnpm exec vitest run sample.ts', 'Tests 12 passed | 18 skipped (30)'), true);
  assert.equal(hasExecutedTests('node --test sample.cjs', '# pass 3\n# fail 0\n'), true);
  assert.equal(hasExecutedTests('pnpm exec playwright test', '4 passed (2.1s)'), true);
  assert.equal(hasExecutedTests('node --test sample.cjs', '# pass 3\n# fail 1\n'), false);
});
test('actual shell preserves a filter containing spaces and rejects an empty Node run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athom-command-proof-'));
  const fixture = path.join(dir, 'fixture.test.cjs');
  try {
    fs.writeFileSync(fixture, "const t=require('node:test'),a=require('node:assert/strict');t('with spaces',()=>a.equal(2+2,4));t('other',()=>a.equal(3+3,6));\n");
    const command = '"' + process.execPath + '" --test --test-name-pattern="with spaces" "' + fixture + '"';
    const selected = runProofCommand(command);
    assert.equal(selected.exitCode, 0, selected.output); assert.equal(selected.nonemptyTests, true);
    assert.match(selected.output, /ok 1 - with spaces/); assert.match(selected.output, /# tests 1\b/);
    const empty = runProofCommand(command.replace('with spaces', '__NO_MATCH__'));
    assert.equal(empty.exitCode, 1); assert.equal(empty.nonemptyTests, false);
  } finally { fs.unlinkSync(fixture); fs.rmdirSync(dir); }
});
