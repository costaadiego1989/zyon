import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseArguments,assertSuccessfulRun,selectedSpec,assertBrowserDatabaseContainer,fixtureContext,runSpecSuite} from './run-agentic-cypress.mjs';
test('ACAP-27 selects its administrative approval journey and keeps empty selections invalid',()=>{assert.deepEqual(parseArguments(['--case','ACAP-27']),{case:'ACAP-27'});assert.equal(selectedSpec({case:'ACAP-27'}),'cypress/e2e/agentic/campaign-approval.cy.ts');assert.throws(()=>parseArguments(['--case','ACAP-28']),/agentic_argument_invalid/);assert.throws(()=>assertSuccessfulRun({totalTests:0,totalPassed:0,runs:[]}),/cypress_no_test_ran/);});
test('ADAS-66 segmented-tab witness selects its own case without starting unrelated journeys',()=>{
  assert.deepEqual(parseArguments(['--case','ADAS-66']),{case:'ADAS-66'});
  assert.equal(selectedSpec({case:'ADAS-66'}),'cypress/e2e/agentic/runtime.cy.ts');
});
test('ADAS-70 metrics browser witness has its own nonempty report journey selector',()=>{
  assert.deepEqual(parseArguments(['--case','ADAS-70']),{case:'ADAS-70'});
  assert.equal(selectedSpec({case:'ADAS-70'}),'cypress/e2e/agentic/report-and-recovery.cy.ts');
});
test('ADAS-54 runner selection rejects unknown cases path escape and ambiguous modes before services start',()=>{
  assert.deepEqual(parseArguments([]),{});assert.deepEqual(parseArguments(['--case','ADAS-54']),{case:'ADAS-54'});assert.deepEqual(parseArguments(['--spec','cypress/e2e/agentic/runtime.cy.ts']),{spec:'cypress/e2e/agentic/runtime.cy.ts'});
  for(const args of [['--case','ADAS-99'],['--spec','../production.cy.ts'],['--case'],['--serve','--case','ADAS-54'],['--unknown']])assert.throws(()=>parseArguments(args),/agentic_argument_invalid/);
});
test('ADAS-54 runner requires actual passed cases and rejects zero tests initialization failures skips or spec errors',()=>{
  const success={totalTests:2,totalPassed:2,totalFailed:0,totalSkipped:0,totalPending:0,runs:[{tests:[{state:'passed'},{state:'passed'}]}]};assert.doesNotThrow(()=>assertSuccessfulRun(success));
  assert.throws(()=>assertSuccessfulRun({...success,totalTests:0,totalPassed:0}),/cypress_no_test_ran/);
  for(const result of [{failures:1,message:'cannot start'},{...success,totalFailed:1},{...success,totalSkipped:1},{...success,totalPending:1},{...success,runs:[{error:'broken spec'}]}])assert.throws(()=>assertSuccessfulRun(result),/cypress_failed/);
});

test('ADAS-54 case selection runs the matching real spec and preserves explicit spec or whole-suite mode',()=>{
  for(const [id,file] of Object.entries({'ADAS-54':'runtime','ADAS-55':'funding-and-help','ADAS-56':'campaign','ADAS-57':'automation','ADAS-58':'report-and-recovery'}))assert.equal(selectedSpec({case:id}),`cypress/e2e/agentic/${file}.cy.ts`);
  assert.equal(selectedSpec({}),undefined);assert.equal(selectedSpec({spec:'cypress/e2e/agentic/runtime.cy.ts'}),'cypress/e2e/agentic/runtime.cy.ts');
});

test('CBX-48 browser database refuses another workload, wrong port and public binding before connecting',()=>{
 const owned={Name:'/zyon-cashback-postgres-20261118',Config:{Env:['POSTGRES_USER=cashback','POSTGRES_DB=cashback']},HostConfig:{PortBindings:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'15433'}]}}};
 assert.doesNotThrow(()=>assertBrowserDatabaseContainer(owned));
 assert.throws(()=>assertBrowserDatabaseContainer({...owned,Name:'/curaviva-payment-webhook-20261119-db'}),/agentic_database_owner_mismatch/);
 for(const binding of [{HostIp:'127.0.0.1',HostPort:'15435'},{HostIp:'0.0.0.0',HostPort:'15433'}])assert.throws(()=>assertBrowserDatabaseContainer({...owned,HostConfig:{PortBindings:{'5432/tcp':[binding]}}}),/agentic_database_port_mismatch/);
 assert.throws(()=>assertBrowserDatabaseContainer({...owned,Config:{Env:['POSTGRES_USER=other','POSTGRES_DB=cashback']}}),/agentic_database_owner_mismatch/);
});

test('CBX-48 selects the actual Cashback browser specification without substituting an Ads case',()=>{
 const spec='cypress/e2e/agentic/cashback.cy.ts';assert.deepEqual(parseArguments(['--spec',spec]),{spec});assert.equal(selectedSpec({spec}),spec);
});

test('CBX-48 whole-suite fixture selection keeps Ads dates and admits the current Cashback knowledge',async()=>{
 const specs=['cypress/e2e/agentic/campaign-approval.cy.ts','cypress/e2e/agentic/cashback.cy.ts','cypress/e2e/agentic/runtime.cy.ts'];
 const contexts=[];const code=await runSpecSuite(specs,async spec=>{contexts.push(fixtureContext(spec));return 0;});assert.equal(code,0);assert.deepEqual(contexts,['meta-ads','cashback','meta-ads']);
});

test('CBX-48 whole-suite propagates a failed child and refuses an empty or escaped selection',async()=>{
 const specs=['cypress/e2e/agentic/campaign-approval.cy.ts','cypress/e2e/agentic/cashback.cy.ts'];const reached=[];
 assert.equal(await runSpecSuite(specs,async spec=>{reached.push(spec);return 7;}),7);assert.deepEqual(reached,[specs[0]]);
 await assert.rejects(runSpecSuite([],async()=>0),/agentic_suite_selection_invalid/);await assert.rejects(runSpecSuite(['../production.cy.ts'],async()=>0),/agentic_suite_selection_invalid/);
});
