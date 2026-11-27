import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const authPath = process.env.CASHBACK_QA_AUTH_FILE;
const manifestPath = process.env.CASHBACK_QA_SEED_MANIFEST;
const outputPath = process.env.CASHBACK_QA_RUNTIME_REPORT;
assert.ok(authPath && manifestPath && outputPath, 'explicit QA auth, seed manifest and report paths required');
const auth = JSON.parse(readFileSync(authPath, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.ok(['local', 'homolog'].includes(auth.environment), 'seed validation refuses production');
assert.equal(manifest.environment, auth.environment);
assert.equal(manifest.version, 'qa-cashback-v1');
const base = new URL(auth.baseUrl);
assert.ok(!base.username && !base.password && !base.search && !base.hash);
assert.ok(auth.environment === 'local' ? base.hostname === '127.0.0.1' : base.protocol === 'https:');
const observations = [];
const request = async check => {
  assert.ok(check.merchantId?.startsWith('qa-cashback-v1-'));
  assert.ok(check.method === 'GET' || (check.method === 'POST' && check.route === '/embed/cashback/quote'));
  const isQuote = check.key.startsWith('quote:');
  const token = isQuote ? auth.caseTokens[check.key.slice(6)]
    : check.route.startsWith('/buyer/') ? auth.buyerTokens[check.merchantId] : auth.ownerTokens[check.merchantId];
  assert.ok(token?.length > 30);
  const response = await fetch(base.href.replace(/\/$/, '') + check.route, {
    method: check.method, headers: { accept: 'application/json', 'content-type': 'application/json',
      ...(isQuote ? { 'x-aacp-embed-token': token, origin: auth.origin } : { authorization: `Bearer ${token}` }) },
    ...(check.body ? { body: JSON.stringify(check.body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  assert.equal(response.status, check.expectedStatus, `HTTP status; response code=${body.code ?? 'none'}`);
  assert.equal(body.merchantId ?? check.merchantId, check.merchantId);
  if (isQuote) {
    assert.equal(body.sessionId, check.body.session_id);
    for (const field of ['reason', 'eligible', 'reservedCents', 'maximumRedeemCents']) {
      if (Object.hasOwn(check.expected ?? {}, field)) assert.deepEqual(body[field], check.expected[field], field);
    }
    if (check.expected?.cashbackCents !== undefined) {
      assert.equal(body.reservedCents, check.expected.cashbackCents, 'persisted selected cashback');
      assert.equal(body.maximumRedeemCents, check.expected.cashbackCents, 'combined headroom');
    }
    if (check.key === 'quote:specific-100-10-5-cash') assert.equal(body.estimatedEarnCents, 350, 'earn on net R$70 at 5%');
    if (check.key === 'quote:general-100-10-5-cash') assert.equal(body.estimatedEarnCents, 400, 'earn on net R$80 at 5%');
    return { eligible: body.eligible, reason: body.reason, maximumRedeemCents: body.maximumRedeemCents,
      reservedCents: body.reservedCents, estimatedEarnCents: body.estimatedEarnCents };
  }
  if (check.key.startsWith('wallet:')) {
    assert.equal(body.buyerId, check.buyerId);
    for (const [field, expected] of Object.entries(check.expected ?? {})) assert.deepEqual(body.balance[field], expected, field);
    return { balance: body.balance, programStatus: body.program.status };
  }
  if (check.key.startsWith('program:')) {
    const key = check.key.slice('program:'.length);
    const expectedStatus = key === 'draft' ? 'disabled' : ['disabled', 'paused', 'ended'].includes(key) ? key : 'active';
    assert.equal(body.status, expectedStatus);
    if (key === 'draft') { assert.ok(body.draft && typeof body.draft === 'object'); assert.equal(body.published, null); }
    if (body.published) {
      assert.equal(typeof body.published.combination?.allowCoupons, 'boolean');
      assert.equal(typeof body.published.combination?.allowAdvancedRules, 'boolean');
    }
    return { status: body.status, version: body.version };
  }
  assert.ok(Array.isArray(body.items));
  assert.ok(body.items.every(item => item.buyerId?.startsWith('qa-cashback-v1-')));
  return { count: body.items.length, total: body.total };
};
for (const check of manifest.httpChecks) {
  try { observations.push({ key: check.key, pass: true, observed: await request(check) }); }
  catch (error) { observations.push({ key: check.key, pass: false, error: String(error.message).slice(0, 250) }); }
}
const report = { environment: auth.environment, source: 'compiled AppModule + actual HTTP guards + persistent QA database',
  fixtureVersion: manifest.version, targetHash: manifest.targetHash, checkedAt: new Date().toISOString(),
  passed: observations.filter(item => item.pass).length, failed: observations.filter(item => !item.pass).length, observations };
writeFileSync(resolve(outputPath), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, output: resolve(outputPath) }));
process.exitCode = report.failed ? 1 : 0;
