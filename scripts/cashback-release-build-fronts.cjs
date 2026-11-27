const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const candidate = 'C:/tmp/zyon-cashback-release-20261114';
const phase = process.argv[2], component = process.argv[3];
if (!['homolog', 'production'].includes(phase) || !['dashboard', 'widget', 'storefront'].includes(component)) throw Error('explicit_build_environment_and_component_required');
const currentHomologPath = path.join(root, '.audit/cashback-release-20261114/private', component + '-homolog-current-public.json');
const configPath = phase === 'homolog' && fs.existsSync(currentHomologPath) ? currentHomologPath
  : path.join(root, '.audit/cashback-release-20261114/private', component + '-' + phase + '.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (Object.keys(config).some(key => !key.startsWith(component === 'storefront' ? 'NEXT_PUBLIC_' : 'VITE_'))) throw Error('non_public_build_variable_refused');
const script = {
  dashboard: ['--filter', '@zyon/dashboard', 'build'],
  widget: ['--filter', '@zyon/widget-v2', 'exec', 'vite', 'build', '--mode', 'app', '--outDir', 'dist-app'],
  storefront: ['--filter', '@zyon/storefront', 'build'],
}[component];
const apiOrigin = phase === 'homolog' ? 'https://api-sandbox-8146.up.railway.app' : 'https://api.zyon-payments.com.br';
const env = { ...process.env, ...config, NEXT_TELEMETRY_DISABLED: '1', AACP_API_URL: apiOrigin };
const pnpm = path.join(process.env.APPDATA, 'npm/node_modules/pnpm/bin/pnpm.cjs');
if (!fs.existsSync(pnpm)) throw Error('authenticated_local_pnpm_entrypoint_unavailable');
const run = spawnSync(process.execPath, [pnpm, ...script], { cwd: candidate, env, windowsHide: true,
  encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
const evidence = path.join(root, '.specs/features/cashback-release/evidence');
fs.writeFileSync(path.join(evidence, 'candidate-' + component + '-' + phase + '-build.log'), (run.stdout ?? '') + (run.stderr ?? ''));
const report = { component, environment: phase, buildOnly: true, deployed: false, exitCode: run.status,
  completedAt: new Date().toISOString(), publicEnvironmentKeys: Object.keys(config).sort(), success: run.status === 0 };
fs.writeFileSync(path.join(evidence, 'candidate-' + component + '-' + phase + '-build.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
process.exitCode = run.status === 0 ? 0 : 1;
