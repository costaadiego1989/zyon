const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const entry = path.join(root, 'apps/dashboard/scripts/verify-public-auth-env.mjs');
const valid = {
  VITE_API_BASE_URL: 'https://api.example.test/v1',
  VITE_GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
  VITE_GITHUB_CLIENT_ID: 'synthetic-github',
  VITE_OAUTH_REDIRECT_URI: 'https://app.example.test/auth/oauth/callback',
  VITE_TURNSTILE_SITE_KEY: 'synthetic-site-key',
};
function preflight(overrides) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zyon-auth-preflight-test-'));
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('VITE_')));
    Object.assign(env, valid, overrides);
    return spawnSync(process.execPath, ['--max-old-space-size=128', entry], { cwd, env, encoding: 'utf8', timeout: 20000 });
  } finally {
    fs.rmdirSync(cwd);
  }
}

test('normal dashboard build runs the preflight before existing compiler and bundler', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'apps/dashboard/package.json'), 'utf8'));
  assert.equal(pkg.scripts.build, 'node scripts/verify-public-auth-env.mjs && tsc -p tsconfig.json && vite build');
});
test('Docker includes the policy dependency before the dashboard build', () => {
  const docker = fs.readFileSync(path.join(root, 'apps/dashboard/Dockerfile'), 'utf8');
  const copy = 'COPY scripts/lib/dashboard-auth-build-policy.cjs scripts/lib/dashboard-auth-build-policy.cjs';
  assert.ok(docker.includes(copy));
  assert.ok(docker.indexOf(copy) < docker.indexOf('RUN pnpm --filter @zyon/shared-types build'));
});
test('build policy, preflight and regression tests are not silently excluded by Git', () => {
  const result = spawnSync('git', ['check-ignore', '--no-index',
    'scripts/lib/dashboard-auth-build-policy.cjs',
    'scripts/tests/dashboard-auth-build-policy.spec.cjs',
    'scripts/tests/dashboard-auth-build-wiring.spec.cjs',
    'scripts/tests/dashboard-production-preservation.spec.cjs',
    'scripts/tests/platform-support-client-preservation.spec.cjs',
    'apps/dashboard/scripts/verify-public-auth-env.mjs',
  ], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, 'Ignored release dependencies: ' + result.stdout + result.stderr);
});
test('actual preflight subprocess accepts synthetic config without printing values', () => {
  const result = preflight({});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /valid/);
  for (const value of Object.values(valid)) assert.equal((result.stdout + result.stderr).includes(value), false);
});
test('actual sandbox preflight permits absent optional GitHub without logging config', () => {
  const result = preflight({ VITE_GITHUB_CLIENT_ID: '' });
  assert.equal(result.status, 0, result.stderr);
  for (const value of Object.values(valid)) assert.equal((result.stdout + result.stderr).includes(value), false);
});
for (const key of Object.keys(valid).filter(key => key !== 'VITE_GITHUB_CLIENT_ID')) test(`actual preflight refuses absent ${key} without compiling`, () => {
  const result = preflight({ [key]: '' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp('public_auth_missing:' + key));
  for (const value of Object.values(valid)) assert.equal((result.stdout + result.stderr).includes(value), false);
});
