import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const env = process.argv[2];
if (!['sandbox', 'production'].includes(env)) throw Error('explicit_environment_required');
const source = path.resolve(root, '../AACP-blackfriday-web-20261015/apps/web');
const target = path.join(root, '.audit/automatic-campaigns-release-20261016', env, 'web');
const output = path.join(target, '.vercel/output');
if (existsSync(output)) throw Error('artifact_already_exists');
mkdirSync(path.join(output, 'static'), { recursive: true });
mkdirSync(path.join(target, 'apps/web'), { recursive: true });
for (const item of readdirSync(source)) {
  if (item.startsWith('.') || ['scripts', 'package.json', 'vercel.json', 'logo-b64.txt', 'logo-uri.txt'].includes(item)) continue;
  cpSync(path.join(source, item), path.join(output, 'static', item), { recursive: true });
}
if (env === 'sandbox') for (const item of ['index.html', 'assets/subscription-campaign.js']) {
  const file = path.join(output, 'static', item);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('https://api.zyon-payments.com.br', 'https://api-sandbox-8146.up.railway.app').replaceAll('https://app.zyon-payments.com.br', 'https://dashboard-sandbox-59d9.up.railway.app'));
}
writeFileSync(path.join(output, 'config.json'), JSON.stringify({ version: 3, cleanUrls: true, routes: [{ handle: 'filesystem' }] }));
writeFileSync(path.join(target, '.vercel/project.json'), JSON.stringify({ projectId: 'prj_ax9LIrx648ZAPleYDwKCicTS1rn2', orgId: 'team_580RxQPCo0VLxu9vdZdJgb1S' }));
console.log(JSON.stringify({ env, target, source, published: false }));
