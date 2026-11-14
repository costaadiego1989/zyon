import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// Read-only HTTP verification against the fixed canonical production frontend.
const reportPath = path.resolve(process.argv[2] ?? '');
const built = JSON.parse(await fs.readFile(reportPath, 'utf8'));
const origins = { dashboard: 'https://app.zyon-payments.com.br',
  widget: 'https://widget.zyon-payments.com.br', storefront: 'https://storefront.zyon-payments.com.br' };
assert.ok(origins[built.component] && built.success && built.sourceUnchanged && /^[a-f0-9]{40}$/.test(built.revision));
const origin = origins[built.component];
const assets = built.artifacts.filter(item => item.path.startsWith('static/') && /\.(?:js|css)$/.test(item.path));
assert.ok(assets.length > 0);
const localFiles = await Promise.all(assets.map(async item => {
  const bytes = await fs.readFile(path.join(built.output, item.path));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), item.sha256, 'local_built_asset_changed');
  return { ...item, feature: /cashback/i.test(bytes.toString('utf8')) };
}));
assert.ok(localFiles.some(item => item.feature), 'built_cashback_feature_asset_required');
const rows = [];
for (let offset = 0; offset < localFiles.length; offset += 4) {
  const batch = localFiles.slice(offset, offset + 4);
  const replies = await Promise.allSettled(batch.map(async item => {
    const urlPath = '/' + item.path.slice('static/'.length);
    const response = await fetch(origin + urlPath, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    return { path: urlPath, status: response.status, sha256, expectedSha256: item.sha256,
      matched: response.status === 200 && sha256 === item.sha256, cashbackFeature: item.feature };
  }));
  for (let i = 0; i < replies.length; i++) rows.push(replies[i].status === 'fulfilled' ? replies[i].value : {
    path: '/' + batch[i].path.slice('static/'.length), matched: false,
    error: String(replies[i].reason?.message ?? 'asset_request_failed').slice(0, 300) });
}
const report = { component: built.component, revision: built.revision, origin,
  sourceArchiveSha256: built.sourceArchiveSha256, artifactManifestSha256: built.artifactManifestSha256,
  observedAt: new Date().toISOString(), readOnly: true, expected: rows.length,
  matched: rows.filter(row => row.matched).length, cashbackFeatureServed: rows.some(row => row.cashbackFeature && row.matched), rows };
const output = reportPath.replace(/\.json$/, '-served-assets.json');
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ component: report.component, revision: report.revision, expected: report.expected,
  matched: report.matched, cashbackFeatureServed: report.cashbackFeatureServed, output }));
process.exitCode = report.matched === report.expected && report.cashbackFeatureServed ? 0 : 1;
