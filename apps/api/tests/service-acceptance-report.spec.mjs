import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {activationCriterionInventory} from './service-activation-release-producer.mjs';
import {businessRagEvaluationCorpus} from './business-rag-evaluation-corpus.mjs';
import {acceptanceInvocation,verifyAcceptanceReceipt,acceptanceMatrix,acceptanceBuildCoverage,
  acceptanceRagSummary,classifyAcceptanceCapture,validateAcceptanceInput} from './service-acceptance-report.mjs';

// Contract fixtures only: these strings are NOT actual runner/SQL/provider proof.
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const revision='1'.repeat(40),digest='2'.repeat(64),payload='3'.repeat(64);
const current={root,sourceRevision:revision,sourceInputSha256:digest,apiPayloadSha256:payload};
const tap=(changes={},titles=['sample proof'])=>titles.map((title,index)=>`ok ${index+1} - ${title}`).join('\n')+'\n'+
  Object.entries({tests:titles.length,pass:titles.length,fail:0,cancelled:0,skipped:0,todo:0,...changes}).map(([key,value])=>`# ${key} ${value}`).join('\n')+'\n';
const file='tests/service-acceptance-report.spec.mjs';
const argv=['node','--import','./tests/test-network-guard.mjs','--test','--test-concurrency=1',file];
function receipt(changes={}){return{version:1,workspaceRoot:root,cwd:resolve(root,'apps/api'),argv,
  sourceRevision:revision,releaseSourceInputSha256:digest,releasePayloadSha256:payload,
  completed:true,exitCode:0,signal:null,cleanup:{completed:true,errors:[],ownedResourcesRemaining:0},origin:'component',...changes};}
const proof=(id,command=`pnpm --dir apps/api exec ${argv.join(' ')}`)=>({id,statement:'WHEN checked THEN the system SHALL preserve evidence.',proofs:[command],tasks:'T95.'});
function checked(changes={},raw=tap()){return verifyAcceptanceReceipt({receipt:receipt(changes),raw,current});}
const playwright=()=>({stats:{expected:1,unexpected:0,skipped:0,flaky:0},errors:[],suites:[{title:'Journey',specs:[{title:'actual booking gesture',tests:[{expectedStatus:'passed',results:[{status:'passed',attachments:[]}]}]}]}]});

test('QA-01',async t=>{
  await t.test('derives every current ID and command, including nonconsecutive IDs and multiple Proof lines',()=>{
    const source='## Checks\n**C1** - WHEN first THEN the system SHALL preserve it.\n  Proof: `node --test one.spec.mjs`\nNotes: retained\nProof: `node --test two.spec.mjs`\nTasks: T95.\n\n**C42** - WHEN second THEN the system SHALL preserve it.\nProof: `node --test three.spec.mjs` and `node --test four.spec.mjs`\nTasks: T95.\n\n## Handoff\n**C999** - not a criterion\n';
    const items=activationCriterionInventory(source);assert.deepEqual(items.map(value=>value.id),['C1','C42']);
    assert.equal(acceptanceMatrix(items,[],current).rows.flatMap(value=>value.proofs).length,4);
  });
  await t.test('reports a missing proof instead of inventing coverage or accepting caller counts',()=>{
    const result=acceptanceMatrix([proof('C1'),proof('C42','pnpm --dir apps/api exec node --test different.spec.mjs')],[checked()],current);
    assert.equal(result.rows[0].status,'covered');assert.equal(result.rows[1].status,'blocked');assert.equal(result.complete,false);
  });
  await t.test('rejects duplicate criterion IDs and ambiguous duplicate matching receipts',()=>{
    assert.throws(()=>acceptanceMatrix([proof('C1'),proof('C1')],[checked()],current));
    const result=acceptanceMatrix([proof('C1')],[checked(),checked()],current);assert.equal(result.complete,false);
    assert.equal(result.rows[0].proofs[0].reason,'ambiguous_evidence');
  });
  await t.test('rejects zero selection, skips, failure, cancellation and fake JSON pass counters',()=>{
    for(const raw of [tap({tests:0,pass:0},[]),tap({skipped:1}),tap({fail:1}),tap({cancelled:1}),'{"passed":9000}'])assert.throws(()=>checked({},raw));
  });
  await t.test('requires the named selector to match an actually passed case',()=>{
    const target=proof('C1','pnpm --dir apps/api exec node --test --test-name-pattern "^required$" '+file);
    assert.equal(acceptanceMatrix([target],[checked()],current).complete,false);
    assert.equal(acceptanceMatrix([target],[checked({},tap({},['required']))],current).complete,true);
  });
  await t.test('cannot borrow a revision, source input, API payload or workspace',()=>{
    for(const changes of [{sourceRevision:'4'.repeat(40)},{releaseSourceInputSha256:'4'.repeat(64)},
      {releasePayloadSha256:'4'.repeat(64)},{workspaceRoot:resolve(root,'../other-worktree')},{cwd:resolve(root,'../other-worktree/apps/api')}])assert.throws(()=>checked(changes));
    assert.throws(()=>acceptanceMatrix([proof('C1')],[checked()],{...current,sourceRevision:'4'.repeat(40)}));
  });
  await t.test('keeps actual runner cwd and files distinct from a string claiming the expected command',()=>{
    const same=acceptanceInvocation('pnpm --dir apps/api exec node --test '+file,root);
    assert.equal(same.files[0],'apps/api/'+file);assert.equal(same.runner,'tap');
    assert.equal(acceptanceMatrix([proof('C1')],[checked({argv:['node','--test','another.spec.mjs']})],current).complete,false);
  });
  await t.test('does not borrow a same-named case from an extra file or omit the required original guard',()=>{
    assert.equal(acceptanceMatrix([proof('C1')],[checked({argv:[...argv,'another.spec.mjs']})],current).complete,false);
    assert.equal(acceptanceMatrix([proof('C1')],[checked({argv:['node','--test','--test-concurrency=1',file]})],current).complete,false);
  });
});

test('QA-02',async t=>{
  await t.test('browser cases require actual passing non-retried machine output and zero report errors',()=>{
    const browser=receipt({argv:['playwright','test','--config','playwright.service-local.config.ts','e2e/journey.spec.ts'],cwd:resolve(root,'apps/dashboard'),origin:'served_browser'});
    const raw=playwright();assert.equal(verifyAcceptanceReceipt({receipt:browser,raw:JSON.stringify(raw),current}).counts.executed,1);
    for(const changed of [{...raw,errors:[{message:'server failure'}]},{...raw,stats:{...raw.stats,skipped:1}},
      {...raw,suites:[{specs:[{title:'x',tests:[{results:[{status:'passed'},{status:'passed'}]}]}]}]}])assert.throws(()=>verifyAcceptanceReceipt({receipt:browser,raw:JSON.stringify(changed),current}));
  });
  await t.test('preview scope and raw titles cannot be promoted to served browser evidence',()=>{
    const browser=receipt({argv:['playwright','test','e2e/journey.spec.ts'],cwd:resolve(root,'apps/dashboard'),origin:'served_browser'});
    assert.throws(()=>verifyAcceptanceReceipt({receipt:{...browser,scope:'VISUAL_PREVIEW_ONLY'},raw:JSON.stringify(playwright()),current}));
    const raw=playwright();raw.suites[0].specs[0].title='VISUAL_PREVIEW_ONLY booking';assert.throws(()=>verifyAcceptanceReceipt({receipt:browser,raw:JSON.stringify(raw),current}));
  });
  await t.test('capture classification preserves preview versus actual PNG metadata and rejects dimension mismatch',()=>{
    const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(390,16);png.writeUInt32BE(844,20);
    assert.equal(classifyAcceptanceCapture(png,{width:390,height:844,scope:'VISUAL_PREVIEW_ONLY'}).origin,'visual_preview');
    assert.equal(classifyAcceptanceCapture(png,{width:390,height:844,origin:'served_browser'}).origin,'local_application_capture');
    assert.throws(()=>classifyAcceptanceCapture(png,{width:1440,height:1000,origin:'served_browser'}));
    assert.throws(()=>classifyAcceptanceCapture(Buffer.from('fake'),{width:390,height:844,origin:'served_browser'}));
  });
  await t.test('different browser config and zero grep matches do not satisfy a proof',()=>{
    const browser=receipt({argv:['playwright','test','--config','actual.config.ts','e2e/journey.spec.ts'],cwd:resolve(root,'apps/dashboard'),origin:'served_browser'});
    const observed=verifyAcceptanceReceipt({receipt:browser,raw:JSON.stringify(playwright()),current});
    for(const command of ['pnpm --dir apps/dashboard exec playwright test --config different.config.ts e2e/journey.spec.ts',
      'pnpm --dir apps/dashboard exec playwright test --config actual.config.ts e2e/journey.spec.ts --grep "missing gesture"'])assert.equal(acceptanceMatrix([proof('C1',command)],[observed],current).complete,false);
  });
});

test('QA-03',async t=>{
  await t.test('passed prose cannot replace an actual owned native receipt and complete cleanup',()=>{
    for(const changes of [{completed:false},{exitCode:1},{signal:'SIGTERM'},{cleanup:undefined},
      {cleanup:{completed:true,errors:['database remains'],ownedResourcesRemaining:1}},
      {cleanup:{completed:false,errors:[],ownedResourcesRemaining:0}}])assert.throws(()=>checked(changes));
  });
  await t.test('an integration criterion cannot receive component-only proof',()=>{
    const command='pnpm --dir apps/api exec node --test tests/owned.integration.spec.ts',target=proof('C65',command);
    const args=['node','--test','tests/owned.integration.spec.ts'];
    assert.equal(acceptanceMatrix([target],[checked({argv:args})],current).complete,false);
    assert.equal(acceptanceMatrix([target],[checked({argv:args,origin:'local_http_sql_redis'})],current).complete,true);
  });
  await t.test('local proofs cannot claim provider acceptance without a separate provider gate',()=>{
    assert.throws(()=>checked({origin:'provider'}));assert.throws(()=>checked({providerAccepted:true}));
  });
  await t.test('build commands require exact actual selection, clean natural close and the same payload',()=>{
    const command='pnpm --dir apps/api build';
    const build=verifyAcceptanceReceipt({receipt:receipt({argv:['pnpm','--dir','apps/api','build'],cwd:root,kind:'build'}),raw:'Build completed\n',current});
    assert.equal(acceptanceBuildCoverage([command],[build]).complete,true);
    assert.equal(acceptanceBuildCoverage([command],[]).complete,false);
    assert.equal(acceptanceBuildCoverage([command],[build,build]).complete,false);
    assert.equal(acceptanceBuildCoverage(['pnpm --dir apps/widget_v2 build'],[build]).complete,false);
    assert.throws(()=>verifyAcceptanceReceipt({receipt:receipt({argv:['pnpm','--dir','apps/api','build'],cwd:root,kind:'build',cleanup:undefined}),raw:'Build completed',current}));
  });
  await t.test('an actual Node build script is normalized within this workspace without borrowing another tree',()=>{
    const command='node scripts/service-local-build.mjs dashboard';
    const item=verifyAcceptanceReceipt({receipt:receipt({argv:[resolve(root,'scripts/service-local-build.mjs'),'dashboard'],cwd:root,kind:'build'}),raw:'Build completed',current});
    assert.equal(acceptanceBuildCoverage([command],[item]).complete,true);
    assert.throws(()=>verifyAcceptanceReceipt({receipt:receipt({argv:[resolve(root,'../borrowed/scripts/service-local-build.mjs'),'dashboard'],cwd:root,kind:'build'}),raw:'Build completed',current}));
  });
});

test('QA-04',async t=>{
  const cases=businessRagEvaluationCorpus();
  const valid=()=>({revision,mode:'owned_runtime',providerAccuracyProven:false,total:cases.length,executed:cases.length,passed:cases.length,
    failedCritical:0,invalidObservations:[],reviewItems:[],gate:{completeExecution:true,passed:true},
    results:cases.map(value=>({id:value.id,business:value.business,critical:value.critical,passed:true,reasons:[]}))});
  await t.test('uses the canonical three-business critical corpus rather than a caller expected count',()=>{
    const summary=acceptanceRagSummary(valid(),revision);assert.deepEqual(summary.businesses,['clinic','consulting','salon']);
    assert.equal(summary.criticalCaseIds.length,cases.filter(value=>value.critical).length);assert.equal(summary.providerAccuracyProven,false);
  });
  await t.test('one critical failure, missing/duplicate observation or unsupported provider claim blocks readiness',()=>{
    const failed=valid();failed.results[0]={...failed.results[0],passed:false,reasons:['missing source']};
    const duplicate=valid();duplicate.results.push(duplicate.results[0]);
    const missing=valid();missing.results.pop();
    for(const item of [failed,duplicate,missing,{...valid(),failedCritical:1},{...valid(),revision:'4'.repeat(40)},
      {...valid(),providerAccuracyProven:true},{...valid(),mode:'deterministic_fixture'},
      {...valid(),invalidObservations:['foreign source']},{...valid(),gate:{completeExecution:false,passed:false}}])assert.throws(()=>acceptanceRagSummary(item,revision));
  });
});

test('T95',async t=>{
  await t.test('public input accepts paths and rejects ready counts, arbitrary criteria, provider/final flags and sealing',()=>{
    const input={version:1,reportRoot:'.cache/acceptance',activationDescriptor:'activation-input.json',evidence:[],builds:[],previews:[],output:'report'};
    assert.deepEqual(validateAcceptanceInput(input),input);
    for(const change of [{passed:84},{criteria:['C1']},{featureComplete:true},{providerAccepted:true},{ready:true},{expectedCount:84},{seal:true}])assert.throws(()=>validateAcceptanceInput({...input,...change}));
    assert.throws(()=>validateAcceptanceInput({...input,evidence:[{receipt:'receipt.json',raw:'raw.log',passed:true}]}));
  });
  await t.test('new criterion additions cannot be silently dropped from a previously complete matrix',()=>{
    const first=acceptanceMatrix([proof('C1')],[checked()],current);assert.equal(first.complete,true);
    const next=acceptanceMatrix([proof('C1'),proof('C999','pnpm --dir apps/api exec node --test missing.spec.mjs')],[checked()],current);
    assert.deepEqual(next.rows.map(value=>value.id),['C1','C999']);assert.equal(next.complete,false);
  });
  await t.test('machine-readable Vitest cases are checked individually, not from a passing headline',()=>{
    const valid={success:true,numTotalTests:1,numPassedTests:1,numFailedTests:0,numPendingTests:0,numTodoTests:0,numFailedTestSuites:0,numPendingTestSuites:0,
      testResults:[{name:resolve(root,'apps/dashboard/src/example.spec.tsx'),status:'passed',assertionResults:[{fullName:'meaningful UI gesture',status:'passed'}]}]};
    const ui=receipt({cwd:resolve(root,'apps/dashboard'),argv:['vitest','run','src/example.spec.tsx'],origin:'component'});
    assert.equal(verifyAcceptanceReceipt({receipt:ui,raw:JSON.stringify(valid),current}).counts.executed,1);
    for(const changed of [{...valid,numPendingTests:1},{...valid,numFailedTestSuites:1},{...valid,testResults:[]},
      {...valid,testResults:[{...valid.testResults[0],name:resolve(root,'../other-worktree/apps/dashboard/src/example.spec.tsx')}]},
      {...valid,testResults:[{status:'failed',assertionResults:[{fullName:'meaningful UI gesture',status:'failed'}]}]}])assert.throws(()=>verifyAcceptanceReceipt({receipt:ui,raw:JSON.stringify(changed),current}));
  });
});
