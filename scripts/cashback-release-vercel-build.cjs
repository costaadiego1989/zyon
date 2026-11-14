// Build only. It cannot create deployments, assign domains, or change projects.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const input = path.resolve(process.argv[2] || '');
const evidence = path.join(root, '.specs/features/cashback-release/evidence');
if (!input.startsWith(evidence + path.sep)) throw Error('explicit_export_manifest_in_release_evidence_required');
const manifest = JSON.parse(fs.readFileSync(input, 'utf8'));
const allowed = {
  dashboard: 'prj_ExtCipEsyn65zIa2cg6FbUbugR3E',
  storefront: 'prj_csFg0cpDw5MIgpcAQhkVm1hpzhBX',
  widget: 'prj_0OMJv9DqWDvXx9Yiw6RTxrimQEsH',
};
if (allowed[manifest.component] !== manifest.projectId || !/^[a-f0-9]{40}$/.test(manifest.revision)) throw Error('unknown_production_project_or_revision');
const target = path.resolve(manifest.target);
if (target !== path.resolve('C:/tmp/zyon-cashback-front-' + manifest.revision.slice(0, 12) + '-' + manifest.component)) throw Error('unexpected_build_workspace');
const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function assertSources() {
  for (const [name, expected] of Object.entries(manifest.sourceFiles)) {
    const file = path.resolve(target, name);
    if (!file.startsWith(target + path.sep) || digest(file) !== expected) throw Error('exported_source_changed:' + name);
  }
}
assertSources();
const env = {};
for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC']) if (process.env[key]) env[key] = process.env[key];
Object.assign(env, { CI: '1', VERCEL_TELEMETRY_DISABLED: '1', NEXT_TELEMETRY_DISABLED: '1',
  VERCEL_ORG_ID: manifest.teamId, VERCEL_PROJECT_ID: manifest.projectId });
const cli = path.join(process.env.APPDATA, 'npm/node_modules/vercel/dist/index.js');
if (!fs.existsSync(cli)) throw Error('authenticated_vercel_cli_unavailable');
const prefix = 'frontend-prebuilt-' + manifest.component + '-' + manifest.revision.slice(0, 12);
const steps = [];
for (const [name, args] of [
  ['pull', ['pull', '--yes', '--environment=production', '--scope', manifest.teamSlug]],
  ['build', ['build', '--prod', '--standalone', '--yes', '--output', path.join(target, '.vercel/output'), '--scope', manifest.teamSlug]],
]) {
  const run = spawnSync(process.execPath, [cli, ...args], { cwd: target, env, windowsHide: true,
    encoding: 'utf8', timeout: 1200000, maxBuffer: 24 * 1024 * 1024 });
  // Logs stay in ignored local evidence. The pulled .env files are never copied
  // into a source manifest, printed, or added to the candidate repository.
  fs.writeFileSync(path.join(evidence, prefix + '-' + name + '.log'), (run.stdout || '') + (run.stderr || ''));
  steps.push({ name, exitCode: run.status, completedAt: new Date().toISOString() });
  if (run.status !== 0) {
    fs.writeFileSync(path.join(evidence, prefix + '.json'), JSON.stringify({ component: manifest.component, revision: manifest.revision, deployed: false, success: false, steps }, null, 2) + '\n');
    throw Error('vercel_build_stage_failed:' + name);
  }
}
assertSources();
const output = path.join(target, '.vercel/output');
const config = JSON.parse(fs.readFileSync(path.join(output, 'config.json'), 'utf8'));
if (config.version !== 3) throw Error('vercel_build_output_api_v3_required');
function walk(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const next = path.join(directory, entry.name), relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) return walk(next, relative);
    if (entry.isSymbolicLink()) throw Error('standalone_output_symlink_requires_review:' + relative);
    return [{ path: relative, sha256: digest(next), bytes: fs.statSync(next).size }];
  });
}
const artifacts = walk(output);
const privateValues = new Set();
for (const file of [path.join(target, '.vercel/.env.production.local'), path.join(target, manifest.appRoot, '.vercel/.env.production.local')]) {
  if (!fs.existsSync(file)) continue;
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
    if (!/^(VITE_|NEXT_PUBLIC_)/.test(key) && /SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY|API_KEY/.test(key) && value.length >= 16) privateValues.add(value);
  }
}
const staticFiles = artifacts.filter(item => item.path.startsWith('static/'));
for (const item of staticFiles) {
  const bytes = fs.readFileSync(path.join(output, item.path));
  if ([...privateValues].some(value => bytes.includes(Buffer.from(value)))) throw Error('private_environment_value_in_static_output_refused');
}
const artifactManifestSha256 = crypto.createHash('sha256').update(JSON.stringify(artifacts)).digest('hex');
const report = { component: manifest.component, revision: manifest.revision, projectId: manifest.projectId,
  sourceManifest: input, sourceArchiveSha256: manifest.sourceArchiveSha256, target, output,
  success: true, deployed: false, sourceUnchanged: true, buildTarget: 'production', steps,
  privateValueLeakScan: { knownPrivateValues: privateValues.size, staticFiles: staticFiles.length, matches: 0 },
  artifactManifestSha256, artifacts };
const reportPath = path.join(evidence, prefix + '.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ component: report.component, revision: report.revision, success: true, deployed: false,
  artifactFiles: artifacts.length, artifactManifestSha256, report: reportPath }));
