import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyAcceptanceReceipt,acceptanceMatrix} from './service-acceptance-report.mjs';

// QA-01: an executed subset cannot establish an unfiltered whole-file proof.
// These are explicit parser fixtures, not actual browser or release evidence.
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const current={root,sourceRevision:'1'.repeat(40),sourceInputSha256:'2'.repeat(64),apiPayloadSha256:'3'.repeat(64)};
const base=['playwright','test','--config','scope.config.ts','e2e/required.spec.ts'];
const raw=JSON.stringify({stats:{expected:1,unexpected:0,skipped:0,flaky:0},errors:[],suites:[{title:'',specs:[{title:'only',tests:[{expectedStatus:'passed',results:[{status:'passed'}]}]}]}]});
function evidence(filtered){
  const receipt={version:1,workspaceRoot:root,cwd:resolve(root,'apps/dashboard'),argv:filtered?[...base,'--grep','^only$']:base,
    sourceRevision:current.sourceRevision,releaseSourceInputSha256:current.sourceInputSha256,releasePayloadSha256:current.apiPayloadSha256,
    completed:true,exitCode:0,signal:null,cleanup:{completed:true,errors:[],ownedResourcesRemaining:0},origin:'served_browser'};
  return verifyAcceptanceReceipt({receipt,raw,current});
}
function criterion(filtered){return{id:'C64',statement:'WHEN a whole proof is required THEN the system SHALL execute its full selection.',
  proof:'pnpm --dir apps/dashboard exec '+base.join(' ')+(filtered?' --grep "^only$"':''),tasks:'T95.'};}
test('QA-01 actual runner scope preservation',async t=>{
  await t.test('refuses a successful filtered browser subset for an unfiltered whole-file requirement',()=>{
    assert.equal(acceptanceMatrix([criterion(false)],[evidence(true)],current).complete,false);
  });
  await t.test('accepts the same named selection when the actual passing case matches',()=>{
    assert.equal(acceptanceMatrix([criterion(true)],[evidence(true)],current).complete,true);
  });
  await t.test('accepts an unfiltered whole-file execution for a contained named criterion',()=>{
    assert.equal(acceptanceMatrix([criterion(true)],[evidence(false)],current).complete,true);
  });
});
