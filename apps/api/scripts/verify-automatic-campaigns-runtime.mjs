import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const [environment, deployment, commit] = process.argv.slice(2);
if (!['sandbox', 'production'].includes(environment) || !/^[a-f0-9-]{36}$/.test(deployment ?? '') || !/^[a-f0-9]{40}$/.test(commit ?? '')) throw Error('explicit_runtime_identity_required');
const run = (exe, args) => {
  const r = spawnSync(exe, args, { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 55000, maxBuffer: 12 * 1024 * 1024 });
  assert.equal(r.status, 0, 'runtime_operation_failed'); return r.stdout;
};
const source = `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');if(process.env.RAILWAY_ENVIRONMENT_NAME!=='${environment}'||process.env.RAILWAY_DEPLOYMENT_ID!=='${deployment}'||process.env.RAILWAY_GIT_COMMIT_SHA!=='${commit}')throw Error('runtime_identity_changed');const hashes=[];function walk(relative){const full=path.join('/repo',relative),s=fs.lstatSync(full);if(s.isSymbolicLink())return;if(s.isDirectory()){for(const item of fs.readdirSync(full)){if(!['node_modules','dist','.git','coverage','logs','uploads'].includes(item))walk(relative+'/'+item);}}else if(s.isFile()&&!/(?:^|\\/)\\.env(?:\\.|$)/.test(relative)){hashes.push([relative,crypto.createHash('sha256').update(fs.readFileSync(full,'utf8').replace(/\\r\\n/g,'\\n')).digest('hex')]);}}for(const item of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','.dockerignore','apps/api','packages'])if(fs.existsSync(path.join('/repo',item)))walk(item);console.log('RESULT '+JSON.stringify({hashes}));`;
const encoded = Buffer.from(source).toString('base64');
const actual = run(path.join(process.env.APPDATA, 'npm/node_modules/@railway/cli/bin/railway.exe'), ['ssh', '-p', 'b8421237-6557-4677-a08c-c93453b08568', '-s', 'api', '-e', environment, '--', `node -e 'eval(Buffer.from(process.argv[1],process.argv[2]).toString())' ${encoded} base64`]);
const line = actual.split(/\r?\n/).find(x => x.startsWith('RESULT ')); assert.ok(line);
const hashes = new Map(JSON.parse(line.slice(7)).hashes);
const files = run('git', ['ls-tree', '-r', '--name-only', commit, '--', 'apps/api', 'packages', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json']).trim().split(/\r?\n/).filter(file => !/(?:^|\/)(?:node_modules|dist|uploads|logs|\.specs|\.claude)\//.test(file) && !/(?:^|\/)\.env(?:\.|$)/.test(file));
const blobs = spawnSync('git', ['cat-file', '--batch'], { cwd: root, windowsHide: true, input: files.map(file => commit + ':' + file).join('\n') + '\n', maxBuffer: 128 * 1024 * 1024 });
assert.equal(blobs.status, 0); let offset = 0;
const failures = [];
for (const file of files) {
  const end = blobs.stdout.indexOf(10, offset);
  const header = blobs.stdout.subarray(offset, end).toString('utf8');
  const size = Number(header.split(' ')[2]); assert.ok(Number.isSafeInteger(size));
  offset = end + 1;
  const content = blobs.stdout.subarray(offset, offset + size).toString('utf8').replace(/\r\n/g, '\n');
  offset += size + 1;
  if (createHash('sha256').update(content).digest('hex') !== hashes.get(file)) failures.push(file);
}
assert.deepEqual(failures, [], 'running_source_differs_from_exact_release');
const output = path.join(root, '.audit/automatic-campaigns-release-20261016/evidence'); mkdirSync(output, { recursive: true });
const result = { proof: 'running_container_source_vs_exact_git_commit_normalized_line_endings', environment, deployment, commit, checkedFiles: files.length, missingOrDifferent: failures.length, unrelatedWorktreeChangesPublished: false };
writeFileSync(path.join(output, environment + '-runtime.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
