const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const expected = {
  "packages/platform-support-ui/package.json": "c0e29bfe53561ed585ee61a278a9df64ffab42c8bf3f315b4581844f8f9e9588",
  "packages/platform-support-ui/src/client.ts": "f3bdee8da352a7b1bd25250490df8418d2e1957b54b19e9692875047e304de4e",
  "packages/platform-support-ui/src/index.ts": "505cd2bb8888edc38040639c0de0476e5aeb1e4768bd9778417eda8472074baf",
  "packages/platform-support-ui/src/styles.css": "cb20d503383aa199c4ac8cf6ad34983055608820cb3d2031127de92f71003006",
  "packages/platform-support-ui/src/support-desk.tsx": "d4c203c369cd23bf55bb48d194ab61c7d1fa32497bb2bd8ebadebcc48a746a17",
  "packages/shared-types/src/platform-support.ts": "c6a2ba849d5f0926284f4d6e0e58e7442e8e1eaca1214d96b55a492f3f1845bf",
  "apps/dashboard/src/components/PlatformFeedbackFab.tsx": "c734be77c89c6185f4c6befbd60de78f983f7268d1dd064501ac70897f184de2"
};

for (const [file, hash] of Object.entries(expected)) test('preserves reviewed published source: ' + file, () => {
  const actual = crypto.createHash('sha256').update(read(file).replace(/\r\n/g, '\n')).digest('hex');
  assert.equal(actual, hash);
});
test('support is mounted with merchant identity and scoped API client', () => {
  const shell = read('apps/dashboard/src/shell/DashboardShell.tsx');
  assert.match(shell, /<PlatformFeedbackFab key=\{me\.id\} apiBaseUrl=\{API_BASE_URL\} merchantId=\{me\.id\}/);
  assert.match(read('packages/shared-types/src/index.ts'), /export \* from "\.\/platform-support\.js"/);
});
test('support dependency is declared, locked and available in the Docker context', () => {
  const pkg = JSON.parse(read('apps/dashboard/package.json'));
  assert.equal(pkg.dependencies['@zyon/platform-support-ui'], 'workspace:*');
  const lock = read('pnpm-lock.yaml');
  assert.match(lock, /packages\/platform-support-ui:/);
  assert.match(lock.slice(lock.indexOf('  apps/dashboard:'), lock.indexOf('  apps/storefront:')), /link:\.\.\/\.\.\/packages\/platform-support-ui/);
  assert.match(read('apps/dashboard/Dockerfile'), /COPY packages\/platform-support-ui\/\s+packages\/platform-support-ui\//);
});
test('Growth/Scale support entitlement survives without changing Free/Starter', () => {
  const source = read('packages/shared-types/src/billing-plans.ts');
  const config = source.slice(source.indexOf('export const BILLING_PLANS:'));
  for (const [plan, value] of [['starter', false], ['starter179', false], ['growth', true], ['scale', true]]) {
    const section = config.slice(config.indexOf('  ' + plan + ':'));
    assert.match(section.slice(0, section.indexOf('\n  },') + 5), new RegExp('realtimeChatSupport: ' + value));
  }
});
test('auth build gate, navigation, remediation and plan layout stay in the candidate', () => {
  const pkg = JSON.parse(read('apps/dashboard/package.json'));
  assert.ok(pkg.scripts.build.startsWith('node scripts/verify-public-auth-env.mjs &&'));
  const main = read('apps/dashboard/src/main.tsx');
  assert.match(main, /authUrlForMode/);
  assert.match(main, /<MarketplaceRemediationActions visible=\{subscriptionRequired && me\.role === "OWNER"\}/);
  assert.match(read('apps/dashboard/src/pages/onboarding-wizard/steps/signup-plans-modern.css'), /repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(read('apps/dashboard/src/styles.css'), /\.platform-support-unread\s*\{/);
});
test('billing plans and their loading skeleton also use the four-plan responsive grid', () => {
  const css = read('apps/dashboard/src/pages/billing-plans/billing-plans-page.css');
  for (const selector of ['plans-grid', 'skeleton-grid']) {
    assert.match(css, new RegExp('\\.billing-plans__' + selector + '\\s*\\{[^}]*grid-template-columns:\\s*repeat\\(4,\\s*minmax\\(0,\\s*1fr\\)\\)', 's'));
  }
  assert.match(css, /@media\s*\(max-width:\s*1200px\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
});
