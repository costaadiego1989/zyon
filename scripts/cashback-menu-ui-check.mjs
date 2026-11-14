import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const evidence = path.resolve(process.env.CASHBACK_MENU_EVIDENCE_DIR || path.join(root, '.specs/features/cashback-menu-ui/evidence'));
const phase = process.argv[2];
assert.ok(['backend','dashboard','storefront','build','release'].includes(phase));
fs.mkdirSync(evidence, { recursive: true });
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(evidence, file), 'utf8'));
const git = (...args) => {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0); return run.stdout.trim();
};
const pnpm = process.platform === 'win32'
  ? [process.execPath, path.join(process.env.APPDATA, 'npm/node_modules/pnpm/bin/pnpm.cjs')]
  : ['pnpm'];
function sourceFiles(component) {
  const files = git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean);
  return Object.fromEntries([...new Set(files)].filter(p => p.startsWith('apps/' + component + '/') || p.startsWith('packages/')
    || ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json'].includes(p)).sort().map(p => [p,hash(path.join(root,p))]));
}
function run(name, executable, args, cwd = root, extraEnv = {}) {
  const result = spawnSync(executable, args, { cwd, env: { ...process.env, ...extraEnv }, encoding:'utf8',
    windowsHide:true, timeout:600000, maxBuffer:32 * 1024 * 1024 });
  fs.writeFileSync(path.join(evidence,name + '.log'), (result.stdout || '') + (result.stderr || ''));
  assert.equal(result.status, 0, name + '_failed'); return result.stdout || '';
}
function tap(text, minimum) {
  const count = key => Number([...text.matchAll(new RegExp('^# ' + key + ' (\\d+)$','gm'))].at(-1)?.[1]);
  const passed = count('pass'); assert.ok(passed >= minimum); assert.equal(count('fail'),0); assert.equal(count('skipped'),0);
  return { passed, failed:0, skipped:0 };
}
function browser(file, minimum) {
  const report = read(file); assert.equal(report.businessMocks, false); assert.equal(report.failed,0);
  assert.ok(report.passed >= minimum); assert.equal(report.pageErrors.length,0); return report;
}
try {
  const before = ['backend','dashboard','storefront'].includes(phase) ? sourceFiles(phase === 'backend' ? 'api' : phase) : null;
  let result;
  if (phase === 'backend') {
    const files = [
      'storefront/application/use-cases/get-store-config.use-case.spec.ts',
      'storefront/application/use-cases/get-store-config.cashback-menu.spec.ts',
      'whatsapp-channel/application/services/whatsapp-buyer-hub.spec.ts',
      'whatsapp-channel/application/services/whatsapp-cashback-menu.spec.ts',
      'whatsapp-channel/application/services/whatsapp-checkout-benefits.spec.ts',
      'whatsapp-channel/application/services/whatsapp-checkout-benefits.cashback-menu.spec.ts',
      'whatsapp-channel/infrastructure/adapters/whatsapp-returning-welcome.spec.ts',
      'whatsapp-channel/application/services/cashback-whatsapp.commands.spec.ts',
      'whatsapp-channel/application/services/cashback.verifier.spec.ts',
      'whatsapp-channel/domain/ui/meta-ui-renderer.spec.ts',
      'cashback/domain/cashback.spec.ts', 'cashback/domain/cashback-combination.spec.ts',
      'cashback/presentation/cashback.controllers.spec.ts',
    ].map(p => './src/modules/' + p);
    const text = run('backend-check',process.execPath,['--import','./tests/test-network-guard.mjs','--loader','./tests/ready-prod-loader.mjs',
      '--test','--test-concurrency=1',...files],path.join(root,'apps/api'));
    result = tap(text,172);
  } else if (phase === 'storefront') {
    result = tap(run('storefront-check', process.execPath, ['--test','tests/storefront-cashback-navigation.test.cjs'],path.join(root,'apps/storefront')),8);
  } else if (phase === 'dashboard') {
    const text = run('dashboard-check',pnpm[0],[...pnpm.slice(1),'--filter','@zyon/dashboard','exec','vitest','run',
      'src/pages/cashback','src/api/endpoints/cashback.spec.ts','src/pages/overview/useOverviewPage.spec.ts']);
    assert.match(text,/25 passed/); result = { passed:25, failed:0 };
  } else if (phase === 'build') {
    for (const name of ['dashboard','storefront']) {
      const report = read(name + '-local-build.json'); assert.equal(report.success,true); assert.equal(report.exitCode,0);
      assert.equal(report.inputsUnchanged,true); assert.deepEqual(report.sourceFiles,sourceFiles(name),'build_source_stale:' + name);
    }
    run('api-build-check',process.execPath,['./node_modules/typescript/bin/tsc','-p','tsconfig.build.json','--pretty','false'],path.join(root,'apps/api'));
    result = { passed:3, failed:0, actualBuilds:true };
  } else {
    const revision = git('rev-parse','HEAD'); assert.equal(git('status','--porcelain'),'');
    const candidate = read('candidate-validation.json'), homolog = read('homolog-validation.json'), production = read('production-validation.json');
    for (const [environment,report] of [['candidate',candidate],['homolog',homolog],['production',production]]) {
      assert.equal(report.status,'passed'); assert.equal(report.environment,environment); assert.equal(report.revision,revision);
      assert.equal(hash(report.sourceManifestFile), report.sourceManifestSha256);
      assert.ok(report.runtime.passed >= 4); assert.equal(report.runtime.failed,0);
      assert.ok(report.browser.passed >= (environment === 'production' ? 4 : 18)); assert.equal(report.browser.failed,0);
      assert.equal(report.independentRuntimePassed,true);
      if (environment !== 'candidate') {
        assert.equal(report.api.status,'SUCCESS'); assert.equal(report.api.runtimeHashes.matched,report.api.runtimeHashes.expected);
        assert.ok(report.api.runtimeHashes.expected > 1000);
        for (const name of ['dashboard','storefront']) {
          assert.equal(report.frontends[name].revision,revision); assert.equal(report.frontends[name].servedBundleVerified,true);
        }
      }
    }
    for (const env of ['local','homolog']) { browser(env+'-dashboard/results.json',10); browser(env+'-storefront/results.json',8); }
    assert.equal(production.seedExecuted,false); assert.equal(production.realMerchantActivation,false);
    const mutations = read('independent-mutations/report.json'); assert.ok(mutations.results.length === 3 && mutations.results.every(r => r.killed));
    result = { passed:7,failed:0,revision,remoteMutations:false };
  }
  if (before) {
    assert.deepEqual(before,sourceFiles(phase === 'backend' ? 'api' : phase),'sources_changed_during_test');
    fs.writeFileSync(path.join(evidence,phase+'-check.json'),JSON.stringify({phase,...result,sourceFiles:before,completedAt:new Date().toISOString()},null,2)+'\n');
  }
  console.log(JSON.stringify({phase,...result}));
} catch (error) { console.error(JSON.stringify({phase,passed:false,reason:error.message})); process.exitCode=1; }
