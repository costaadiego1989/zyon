const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const docker = fs.readFileSync(path.resolve(__dirname, '../Dockerfile'), 'utf8');
test('storefront declares its public CAPTCHA build argument before Next compilation', () => {
  const declaration = docker.indexOf('ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY');
  assert.ok(declaration >= 0);
  assert.ok(declaration < docker.indexOf('pnpm --filter @zyon/storefront build'));
});
test('storefront image fails closed if its public CAPTCHA key is absent', () => {
  assert.match(docker, /test -n "\$NEXT_PUBLIC_TURNSTILE_SITE_KEY"/);
});
test('storefront image never receives the server CAPTCHA secret', () => {
  assert.doesNotMatch(docker, /(?:ARG|ENV)\s+TURNSTILE_SECRET_KEY/);
});
