const REQUIRED_PUBLIC_AUTH_KEYS = Object.freeze([
  'VITE_API_BASE_URL', 'VITE_GOOGLE_CLIENT_ID',
  'VITE_OAUTH_REDIRECT_URI', 'VITE_TURNSTILE_SITE_KEY',
]);
const OPTIONAL_PUBLIC_AUTH_KEYS = Object.freeze(['VITE_GITHUB_CLIENT_ID']);
const PROJECT_ID = 'prj_ExtCipEsyn65zIa2cg6FbUbugR3E';

function validatePublicAuthConfig(input) {
  const result = {};
  for (const key of REQUIRED_PUBLIC_AUTH_KEYS) {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if (!value || ['undefined', 'null'].includes(value)) throw Error('public_auth_missing:' + key);
    result[key] = value;
  }
  for (const key of OPTIONAL_PUBLIC_AUTH_KEYS) {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if (['undefined', 'null'].includes(value)) throw Error('public_auth_invalid:' + key);
    if (value) result[key] = value;
  }
  for (const key of ['VITE_API_BASE_URL', 'VITE_OAUTH_REDIRECT_URI']) {
    let url;
    try { url = new URL(result[key]); } catch { throw Error('public_auth_invalid_url:' + key); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('public_auth_invalid_url:' + key);
  }
  if (new URL(result.VITE_OAUTH_REDIRECT_URI).pathname !== '/auth/oauth/callback') throw Error('public_auth_invalid_callback:VITE_OAUTH_REDIRECT_URI');
  if (!result.VITE_GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com')) throw Error('public_auth_invalid_client:VITE_GOOGLE_CLIENT_ID');
  return result;
}

function verifyAuthBundle(code, input) {
  const config = validatePublicAuthConfig(input);
  for (const key of Object.keys(config)) {
    if (!code.includes(JSON.stringify(config[key]))) throw Error('public_auth_bundle_missing:' + key);
  }
  return true;
}

async function loadVercelPublicAuthConfig(request, target = 'production') {
  if (!['production', 'preview'].includes(target)) throw Error('public_auth_invalid_target');
  const list = await request('/v9/projects/' + PROJECT_ID + '/env?decrypt=false');
  const config = {};
  for (const key of [...REQUIRED_PUBLIC_AUTH_KEYS, ...OPTIONAL_PUBLIC_AUTH_KEYS]) {
    const matches = (list.envs ?? []).filter(e => e.key === key && !e.gitBranch && e.target?.includes(target));
    if (OPTIONAL_PUBLIC_AUTH_KEYS.includes(key) && matches.length === 0) continue;
    if (matches.length !== 1) throw Error('public_auth_ambiguous_or_missing:' + key);
    const value = await request('/v1/projects/' + PROJECT_ID + '/env/' + encodeURIComponent(matches[0].id));
    if (value.key !== key || typeof value.value !== 'string' || (value.type === 'encrypted' && value.decrypted !== true)) throw Error('public_auth_value_unavailable:' + key);
    config[key] = value.value;
  }
  return validatePublicAuthConfig(config);
}

module.exports = { REQUIRED_PUBLIC_AUTH_KEYS, OPTIONAL_PUBLIC_AUTH_KEYS, PROJECT_ID, validatePublicAuthConfig, verifyAuthBundle, loadVercelPublicAuthConfig };
