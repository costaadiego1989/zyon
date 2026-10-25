const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

// Package this reviewed integration, never the independent dirty IDE checkout.
const root = path.resolve(__dirname, '..');
const revision = process.argv[3] ?? '92';
assert.ok(['92', '93', '94', '95', '96', '98', '99', '100', '101', '102', '104', '105', '107'].includes(revision), 'release_revision_not_reviewed');
const destination = 'C:/tmp/zyon-integrated-release-20261022-' + revision;
const evidence = path.join(root, '.sandbox-state/lote' + revision + '-integrated-source.json');
const rootFiles = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'tsconfig.base.json', '.dockerignore', '.railwayignore']);
const releaseScripts = new Set(['scripts/lib/dashboard-auth-build-policy.cjs',
  'scripts/vercel-deploy-guard.mjs']);
const apps = new Set(['api', 'dashboard', 'storefront', 'widget_v2']);
if (['104','105','107'].includes(revision)) apps.add('web'); // Include the reviewed public plan-copy removal.
const forbiddenDirectories = new Set(['node_modules', '.git', '.sandbox-state', '.audit',
  '.next', '.vercel', '.playwright-mcp', 'dist', 'dist-test', 'coverage', 'test-results',
  'playwright-report', '.impeccable']);
function eligible(file) {
  if (file === 'apps/api/tests/storefront-contracts.md') return false;
  const parts = file.split('/');
  if (parts.some(part => forbiddenDirectories.has(part) || part.startsWith('.env'))) return false;
  if (/\.(log|tsbuildinfo|pem|key)$/i.test(file) || ['104','105','107'].includes(revision) && /\.err$/i.test(file)) return false;
  return rootFiles.has(file) || releaseScripts.has(file) || parts[0] === 'packages' ||
    (parts[0] === 'apps' && apps.has(parts[1]));
}
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const list = () => [...new Set(git(['ls-files', '-c', '-o', '--exclude-standard', '-z'])
  .split('\0').filter(Boolean).filter(eligible))].sort();
const capture = () => list().map(file => {
  const source = path.join(root, file);
  assert.ok(fs.lstatSync(source).isFile(), 'release_regular_file_required:' + file);
  const data = fs.readFileSync(source);
  return { file, sha256: hash(data), bytes: data.length };
});
function verify(manifest) {
  assert.equal(manifest.sourceRoot, root);
  assert.equal(manifest.folder, path.resolve(destination));
  const currentHead = git(['rev-parse', 'HEAD']);
  if (manifest.base !== currentHead) {
    assert.ok(process.argv.includes('--allow-committed-ancestor'), 'release_base_changed');
    // Committing the reviewed snapshot changes HEAD, not the frozen contents.
    // An unrelated history is never accepted; all file hashes are still checked.
    git(['merge-base', '--is-ancestor', manifest.base, currentHead]);
  }
  assert.deepEqual(capture(), manifest.files, 'release_source_changed');
  for (const item of manifest.files) {
    assert.equal(hash(fs.readFileSync(path.join(destination, item.file))), item.sha256,
      'release_package_changed:' + item.file);
  }
}
const action = process.argv[2];
if (action === 'freeze') {
  assert.equal(path.basename(root), 'AACP-sandbox-integracao-20261020');
  assert.equal(fs.existsSync(destination), false, 'release_directory_already_exists');
  assert.equal(fs.existsSync(evidence), false, 'release_evidence_already_exists');
  const files = capture();
  for (const required of ['apps/api/Dockerfile', 'apps/api/src/main.ts',
    'apps/api/prisma/schema.prisma', 'apps/api/scripts/predeploy-migrations.mjs',
    'apps/storefront/Dockerfile', 'apps/widget_v2/Dockerfile',
    'packages/contracts/src/index.ts']) {
    assert.ok(files.some(item => item.file === required), 'release_required_file_missing:' + required);
  }
  for (const item of files) {
    const target = path.join(destination, item.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, item.file), target, fs.constants.COPYFILE_EXCL);
  }
  const manifest = { version: 1, createdAt: new Date().toISOString(),
    sourceRoot: root, folder: path.resolve(destination), base: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
    sourceDigest: hash(JSON.stringify(files)), files,
    generalLocalCompilationWaived: true, providerVariablesCopied: false,
    productionPromoted: false, sandboxSubmitted: false };
  verify(manifest);
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  fs.writeFileSync(evidence, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ folder: manifest.folder, files: files.length,
    bytes: files.reduce((sum, item) => sum + item.bytes, 0), digest: manifest.sourceDigest }));
} else if (action === 'verify') {
  const manifest = JSON.parse(fs.readFileSync(evidence, 'utf8'));
  verify(manifest);
  console.log(JSON.stringify({ verified: true, files: manifest.files.length, digest: manifest.sourceDigest }));
} else throw Error('expected_freeze_or_verify');
