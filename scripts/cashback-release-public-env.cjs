const fs = require('node:fs');
const path = require('node:path');
const policy = require('C:/tmp/zyon-cashback-release-20261114/scripts/lib/dashboard-auth-build-policy.cjs');
const teamId = 'team_580RxQPCo0VLxu9vdZdJgb1S';
const credentials = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'xdg.data/com.vercel.cli/auth.json'), 'utf8'));
async function request(endpoint) {
  const response = await fetch('https://api.vercel.com' + endpoint + (endpoint.includes('?') ? '&' : '?') + 'teamId=' + teamId,
    { headers: { authorization: 'Bearer ' + credentials.token }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error('vercel_public_environment_read_failed:' + response.status);
  return response.json();
}
async function main() {
  const production = await policy.loadVercelPublicAuthConfig(request, 'production');
  const homolog = { ...production };
  const api = new URL(production.VITE_API_BASE_URL);
  api.host = 'api-sandbox-8146.up.railway.app';
  homolog.VITE_API_BASE_URL = api.href.replace(/\/$/, '');
  homolog.VITE_OAUTH_REDIRECT_URI = 'https://dashboard-sandbox-59d9.up.railway.app/auth/oauth/callback';
  policy.validatePublicAuthConfig(homolog);
  const output = path.resolve(__dirname, '../.audit/cashback-release-20261114/private');
  fs.mkdirSync(output, { recursive: true });
  for (const [name, data] of Object.entries({ production, homolog })) {
    fs.writeFileSync(path.join(output, 'dashboard-' + name + '.json'), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  }
  const applications = {
    widget: { project: 'prj_0OMJv9DqWDvXx9Yiw6RTxrimQEsH', prefix: 'VITE_' },
    storefront: { project: 'prj_csFg0cpDw5MIgpcAQhkVm1hpzhBX', prefix: 'NEXT_PUBLIC_' },
  };
  for (const [name, application] of Object.entries(applications)) {
    const entries = await request('/v9/projects/' + application.project + '/env?decrypt=false');
    const config = {};
    for (const item of (entries.envs ?? []).filter(item => item.key.startsWith(application.prefix) && !item.gitBranch && item.target?.includes('production'))) {
      if (Object.hasOwn(config, item.key)) throw Error('ambiguous_public_environment:' + name + ':' + item.key);
      const value = await request('/v1/projects/' + application.project + '/env/' + encodeURIComponent(item.id));
      if (value.key !== item.key || typeof value.value !== 'string') throw Error('public_environment_value_unavailable:' + name);
      config[item.key] = value.value;
    }
    const stage = { ...config };
    if (name === 'widget') stage.VITE_API_BASE_URL = 'https://api-sandbox-8146.up.railway.app';
    else {
      stage.NEXT_PUBLIC_WIDGET_BASE_URL = 'https://widget-v2-sandbox.up.railway.app';
      stage.NEXT_PUBLIC_API_WEBSOCKET_ORIGIN = 'wss://api-sandbox-8146.up.railway.app';
    }
    fs.writeFileSync(path.join(output, name + '-production.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    fs.writeFileSync(path.join(output, name + '-homolog.json'), JSON.stringify(stage, null, 2) + '\n', { mode: 0o600 });
  }
  console.log(JSON.stringify({ publicConfigurationRead: true, keys: policy.REQUIRED_PUBLIC_AUTH_KEYS.length,
    environments: ['homolog', 'production'], secretValuesPrinted: false, output }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
