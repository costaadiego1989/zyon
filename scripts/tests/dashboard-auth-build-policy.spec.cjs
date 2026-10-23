const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePublicAuthConfig, verifyAuthBundle, loadVercelPublicAuthConfig, REQUIRED_PUBLIC_AUTH_KEYS, OPTIONAL_PUBLIC_AUTH_KEYS } = require('../lib/dashboard-auth-build-policy.cjs');
const valid = { VITE_GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com', VITE_GITHUB_CLIENT_ID: 'synthetic-github', VITE_TURNSTILE_SITE_KEY: 'synthetic-site-key', VITE_OAUTH_REDIRECT_URI: 'https://app.example.test/auth/oauth/callback', VITE_API_BASE_URL: 'https://api.example.test/v1' };

test('all required public auth values survive validation without exposing extra values', () => {
  const result = validatePublicAuthConfig({ ...valid, DATABASE_URL: 'never-export-this' });
  assert.deepEqual(Object.keys(result).sort(), [...REQUIRED_PUBLIC_AUTH_KEYS, ...OPTIONAL_PUBLIC_AUTH_KEYS].sort());
  assert.equal(result.DATABASE_URL, undefined);
});
for (const key of Object.keys(valid).filter(key => key !== 'VITE_GITHUB_CLIENT_ID')) test(`missing ${key} fails closed`, () => {
  assert.throws(() => validatePublicAuthConfig({ ...valid, [key]: '  ' }), error => error.message.includes(key) && !error.message.includes('never-export-this'));
});

test('sandbox can omit GitHub without omitting Google or CAPTCHA verification', () => {
  const config = validatePublicAuthConfig({ ...valid, VITE_GITHUB_CLIENT_ID: '' });
  assert.equal(config.VITE_GITHUB_CLIENT_ID, undefined);
  assert.equal(verifyAuthBundle(Object.values(config).map(JSON.stringify).join(';'), config), true);
  for (const key of ['VITE_GOOGLE_CLIENT_ID', 'VITE_TURNSTILE_SITE_KEY']) assert.throws(() => validatePublicAuthConfig({ ...config, [key]: '' }));
});

test('a configured optional provider cannot disappear from the emitted bundle', () => {
  assert.throws(() => verifyAuthBundle(Object.values(valid).filter(value => value !== valid.VITE_GITHUB_CLIENT_ID).map(JSON.stringify).join(';'), valid), /VITE_GITHUB_CLIENT_ID/);
});

test('an absent optional remote provider is not decrypted or fabricated', async () => {
  const entries = Object.keys(valid).filter(key => key !== 'VITE_GITHUB_CLIENT_ID').map((key, index) => ({ key, id: String(index), target: ['preview'] }));
  const result = await loadVercelPublicAuthConfig(async url => {
    if (url.includes('?decrypt=false')) return { envs: entries };
    const entry = entries.find(e => url.endsWith('/' + e.id));
    return { key: entry.key, value: valid[entry.key], type: 'encrypted', decrypted: true };
  }, 'preview');
  assert.equal(result.VITE_GITHUB_CLIENT_ID, undefined);
});
test('invalid HTTPS destinations fail without echoing the submitted value', () => {
  for (const key of ['VITE_API_BASE_URL', 'VITE_OAUTH_REDIRECT_URI']) {
    assert.throws(() => validatePublicAuthConfig({ ...valid, [key]: 'http://unsafe.example.test/private' }), error => error.message.includes(key) && !error.message.includes('unsafe.example'));
  }
});
test('the emitted bundle must contain every expected public value', () => {
  const bundle = Object.values(valid).map(JSON.stringify).join(';');
  assert.equal(verifyAuthBundle(bundle, valid), true);
  for (const [key, value] of Object.entries(valid)) assert.throws(() => verifyAuthBundle(bundle.replace(JSON.stringify(value), '\"\"'), valid), error => error.message.includes(key) && !error.message.includes(value));
});
test('the original empty-environment regression is rejected before upload', () => {
  assert.throws(() => verifyAuthBundle('const env={};const siteKey="";', valid));
});
test('remote loading decrypts only the five explicitly public keys', async () => {
  const calls = [];
  const envs = Object.keys(valid).map((key, i) => ({ key, id: String(i), target: ['production', 'preview'], type: 'encrypted' }));
  envs.push({ key: 'DATABASE_URL', id: 'never-read', target: ['production'] });
  const result = await loadVercelPublicAuthConfig(async url => {
    calls.push(url);
    if (url.includes('?decrypt=false')) return { envs };
    const entry = envs.find(e => url.endsWith('/' + e.id));
    assert.notEqual(entry.key, 'DATABASE_URL');
    return { key: entry.key, type: 'encrypted', decrypted: true, value: valid[entry.key] };
  });
  assert.deepEqual(result, valid);
  assert.equal(calls.length, 6);
  assert.equal(calls.some(c => c.includes('decrypt=true') || c.includes('never-read')), false);
});
test('remote ambiguity refuses to guess a production value', async () => {
  await assert.rejects(() => loadVercelPublicAuthConfig(async () => ({ envs: [] })), /missing/);
});
test('the encrypted response must actually be decrypted', async () => {
  await assert.rejects(() => loadVercelPublicAuthConfig(async url => url.includes('?') ? { envs: [{ key: 'VITE_API_BASE_URL', id: '1', target: ['production'] }] } : { key: 'VITE_API_BASE_URL', type: 'encrypted', decrypted: false, value: 'unusable' }), /unavailable/);
});
