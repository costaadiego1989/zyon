import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const environment = process.argv[2];
if (!['sandbox', 'production'].includes(environment)) throw Error('explicit_environment_required');
const revision = process.argv[3] ?? '';
if (revision && !/^[a-z0-9-]{1,20}$/.test(revision)) throw Error('invalid_artifact_revision');
const outputRoot = path.join(root, '.audit/automatic-campaigns-release-20261016', environment + (revision ? '-' + revision : ''));
const railway = path.join(process.env.APPDATA, 'npm/node_modules/@railway/cli/bin/railway.exe');
const vercel = path.join(process.env.APPDATA, 'npm/node_modules/vercel/dist/index.js');
const require = createRequire(new URL('../../api/package.json', import.meta.url));
const dotenv = require('dotenv');
const run = (exe, args, options = {}) => {
  const result = spawnSync(exe, args, { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.status !== 0) throw Error(`release_operation_failed:${args[0]}:${(result.stderr || '').slice(-700)}`);
  return result.stdout;
};
mkdirSync(outputRoot, { recursive: true });
let vite;
if (environment === 'sandbox') {
  const config = JSON.parse(run(railway, ['variable', 'list', '-p', 'b8421237-6557-4677-a08c-c93453b08568', '-s', 'dashboard', '-e', 'sandbox', '--json']));
  vite = Object.fromEntries(Object.entries(config).filter(([key]) => key.startsWith('VITE_')));
  vite.VITE_API_BASE_URL = 'https://api-sandbox-8146.up.railway.app';
  vite.VITE_PLATFORM_API_BASE_URL = vite.VITE_API_BASE_URL;
} else {
  const temporary = path.join(outputRoot, 'build-environment.private.env');
  try {
    run(process.execPath, [vercel, 'env', 'pull', temporary, '--environment', 'production', '--yes', '--cwd', path.join(root, '.audit/billing-promotions-production-20261015/dashboard')]);
    vite = Object.fromEntries(Object.entries(dotenv.parse(readFileSync(temporary))).filter(([key]) => key.startsWith('VITE_')));
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  if (vite.VITE_API_BASE_URL !== 'https://api.zyon-payments.com.br') throw Error('production_api_env_mismatch');
  vite.VITE_PLATFORM_API_BASE_URL = 'https://api.zyon-payments.com.br';
}
for (const [app, projectId] of [['control', 'prj_X68tcS3nwLbLemZPPGxut067fWmv'], ['dashboard', 'prj_ExtCipEsyn65zIa2cg6FbUbugR3E']]) {
  if (revision && app !== 'dashboard') continue;
  const target = path.join(outputRoot, app);
  if (existsSync(path.join(target, '.vercel/output'))) throw Error(`artifact_already_exists:${app}`);
  console.log(JSON.stringify({ stage: 'building', app, environment, publicVariableNames: Object.keys(vite) }));
  const build = run('cmd.exe', ['/d', '/s', '/c', `pnpm --filter @zyon/${app} build`], { env: { ...process.env, ...vite } });
  console.log(build.slice(-1800));
  const source = path.join(root, 'apps', app, 'dist');
  const html = readFileSync(path.join(source, 'index.html'), 'utf8');
  const script = html.match(/src="([^"]+\.js)"/)?.[1];
  if (!script) throw Error('bundle_missing');
  const bundle = readFileSync(path.join(source, script.slice(1)), 'utf8');
  if (!bundle.includes(vite.VITE_API_BASE_URL) || /sk_(?:live|test)_/.test(bundle)) throw Error('unsafe_bundle_environment');
  const output = path.join(target, '.vercel/output');
  mkdirSync(output, { recursive: true });
  mkdirSync(path.join(target, 'apps', app), { recursive: true });
  cpSync(source, path.join(output, 'static'), { recursive: true });
  let retainedAssets = 0;
  const previous = path.join(root, '.audit/billing-promotions-production-20261015', app, '.vercel/output/static/assets');
  if (environment === 'production' && existsSync(previous)) for (const name of readdirSync(previous)) {
    const destination = path.join(output, 'static/assets', name);
    if (!existsSync(destination)) { cpSync(path.join(previous, name), destination); retainedAssets++; }
  }
  writeFileSync(path.join(output, 'config.json'), JSON.stringify({ version: 3, routes: [{ handle: 'filesystem' }, { src: '/.*', dest: '/index.html' }] }));
  writeFileSync(path.join(target, '.vercel/project.json'), JSON.stringify({ projectId, orgId: 'team_580RxQPCo0VLxu9vdZdJgb1S' }));
  console.log(JSON.stringify({ app, environment, target, script, retainedAssets, published: false }));
}
if (environment === 'sandbox') {
  const target = path.join(outputRoot, 'railway-dashboard/apps/dashboard');
  mkdirSync(target, { recursive: true });
  cpSync(path.join(root, 'apps/dashboard/dist'), path.join(target, 'dist'), { recursive: true });
  cpSync(path.join(root, 'apps/dashboard/nginx.conf'), path.join(target, 'nginx.conf'));
  writeFileSync(path.join(target, 'Dockerfile'), 'FROM nginxinc/nginx-unprivileged:1.27-alpine\nUSER root\nRUN rm -f /etc/nginx/conf.d/default.conf\nCOPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf\nCOPY --chown=nginx:nginx apps/dashboard/dist /usr/share/nginx/html\nUSER nginx\nEXPOSE 8080\nCMD ["nginx", "-g", "daemon off;"]\n');
}
