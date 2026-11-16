const { spawnSync } = require('node:child_process');

/** Exit0 alone cannot prove that a name filter selected any tests. */
function hasExecutedTests(command, output) {
  const text = output.replace(/\u001b\[[0-9;]*m/g, '');
  if (/\bnode\b[\s\S]*--test(?:\s|$)/.test(command)) {
    const counts = [...text.matchAll(/^# pass (\d+)\s*$/gm)].map(match => Number(match[1]));
    // Node22 reports the test file itself as passed when its filtered plan is
    // empty. The inner 1..0 plan is the evidence that no assertion ran.
    if (!counts.length || counts.some(count => count === 0) || /^1\.\.0(?:\s|$)/m.test(text)
      || /^# fail [1-9]/m.test(text)) return false;
  }
  if (/\bvitest run\b/.test(command) && !/Tests\s+[1-9]\d* passed\b/.test(text)) return false;
  if (/\bplaywright test\b/.test(command)
    && (!/\b[1-9]\d* passed\b/.test(text) || /\b[1-9]\d* failed\b/.test(text))) return false;
  return true;
}

function runProofCommand(command) {
  // Node supplies Windows verbatim shell arguments; manually passing a quoted
  // command as cmd.exe argv changes filters containing spaces into literals.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // A child proof is its own runner, not recursive test registration.
  const result = spawnSync(command, { shell: true, windowsHide: true, env, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
  const output = (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? String(result.error) : '');
  const nonemptyTests = hasExecutedTests(command, output);
  return { output, nonemptyTests, exitCode: nonemptyTests ? result.status ?? 1 : 1 };
}
module.exports = { hasExecutedTests, runProofCommand };
