import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {evaluateExactLintDebt} from './exact-lint-debt.mjs';

const api=process.env.EXACT_LINT_TEST_API_ROOT??fileURLToPath(new URL('../',import.meta.url));
process.chdir(api);
const {ESLint}=createRequire(resolve(api,'package.json'))('eslint');
const engine=new ESLint({cwd:api});
const existing='src/modules/catalog/application/services/catalog-variant.service.ts';
const statement='import { RecoveryMessageJournal } from "../../../cart-recovery/infrastructure/recovery-message-journal.js";';
const source=statement+'\nexport const dependency = RecoveryMessageJournal;\n';
const fixture=async(file=existing,text=source)=>engine.lintText(text,{filePath:resolve(api,file)});
const initial=await fixture();
const architecture=initial.flatMap(result=>result.messages).filter(message=>message.severity===2);
assert.ok(architecture.length>0,'negative input must violate the actual unchanged architecture rules');
const ledger={version:1,scope:'EXACT_PINNED_HISTORICAL_ARCHITECTURE_IMPORTS_ONLY',occurrences:architecture.length,
  entries:architecture.map(message=>({file:existing,ruleId:message.ruleId,statement,
    statementSha256:createHash('sha256').update(statement).digest('hex'),count:1}))};

test('exact historical import and rule are accepted without claiming full ESLint clean',()=>{
  const result=evaluateExactLintDebt(initial,ledger,api);assert.equal(result.policyAccepted,true);
  assert.equal(result.acceptedHistoricalOccurrences,architecture.length);assert.equal(result.fullEslintClean,false);
});
test('the real same violating import in a new source file is blocked',async()=>{
  const actual=await fixture('src/modules/catalog/application/services/new-file-negative.ts');
  assert.ok(actual.some(result=>result.errorCount>0));const result=evaluateExactLintDebt(actual,ledger,api);
  assert.equal(result.policyAccepted,false);assert.ok(result.blocking.some(message=>message.reason==='NEW_FILE_OR_CHANGED_IMPORT'));
});
test('a new infrastructure edge in the existing source file is blocked',async()=>{
  const changed=source.replace('cart-recovery/infrastructure/recovery-message-journal.js','merchant/infrastructure/prisma-merchant.repository.js')
    .replaceAll('RecoveryMessageJournal','PrismaMerchantRepository');
  const actual=await fixture(existing,changed);assert.ok(actual.some(result=>result.errorCount>0));
  assert.equal(evaluateExactLintDebt(actual,ledger,api).policyAccepted,false);
});
test('a different real lint rule is never grandfathered',async()=>{
  const actual=await fixture(existing,'export function negative() { return 1; return 2; }');
  assert.ok(actual.some(result=>result.messages.some(message=>message.ruleId==='no-unreachable'&&message.severity===2)));
  const result=evaluateExactLintDebt(actual,ledger,api);assert.equal(result.policyAccepted,false);
  assert.ok(result.blocking.some(message=>message.reason==='OTHER_RULE_OR_FATAL'));
});

test('the real runner refuses a changed ESLint configuration before loading rules or authority',()=>{
  const temporary=mkdtempSync(resolve(tmpdir(),'zyon-exact-lint-config-negative-'));
  const scripts=resolve(temporary,'scripts');mkdirSync(scripts);
  try{
    for(const name of ['exact-lint-debt.mjs','lint-exact-historical-debt.mjs'])
      writeFileSync(resolve(scripts,name),readFileSync(new URL('./'+name,import.meta.url)));
    const config='export default [];\n';
    writeFileSync(resolve(temporary,'eslint.config.mjs'),config);
    writeFileSync(resolve(temporary,'eslint-historical-debt.json'),JSON.stringify({eslintConfigSha256:createHash('sha256').update(config).digest('hex')}));
    const run=()=>spawnSync(process.execPath,[resolve(scripts,'lint-exact-historical-debt.mjs')],{cwd:temporary,encoding:'utf8',windowsHide:true});
    const unchanged=run();assert.equal(unchanged.status,1);assert.match(unchanged.stderr,/eslint-historical-debt\.approval\.json/);
    assert.doesNotMatch(unchanged.stderr,/AssertionError/);
    writeFileSync(resolve(temporary,'eslint.config.mjs'),'export default [{rules:{"boundaries/element-types":"off"}}];\n');
    const changed=run();assert.equal(changed.status,1);assert.match(changed.stderr,/reviewed_eslint_rules_must_remain_byte_exact/);
    assert.doesNotMatch(changed.stderr,/ENOENT/);
  }finally{
    assert.ok(temporary.startsWith(resolve(tmpdir())+'\\zyon-exact-lint-config-negative-')||temporary.startsWith(resolve(tmpdir())+'/zyon-exact-lint-config-negative-'));
    rmSync(temporary,{recursive:true,force:true});
  }
});
