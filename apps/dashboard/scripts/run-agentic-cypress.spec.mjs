import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseArguments,assertSuccessfulRun} from './run-agentic-cypress.mjs';
test('ADAS-54 runner selection rejects unknown cases path escape and ambiguous modes before services start',()=>{
  assert.deepEqual(parseArguments([]),{});assert.deepEqual(parseArguments(['--case','ADAS-54']),{case:'ADAS-54'});assert.deepEqual(parseArguments(['--spec','cypress/e2e/agentic/runtime.cy.ts']),{spec:'cypress/e2e/agentic/runtime.cy.ts'});
  for(const args of [['--case','ADAS-99'],['--spec','../production.cy.ts'],['--case'],['--serve','--case','ADAS-54'],['--unknown']])assert.throws(()=>parseArguments(args),/agentic_argument_invalid/);
});
test('ADAS-54 runner requires actual passed cases and rejects zero tests initialization failures skips or spec errors',()=>{
  const success={totalTests:2,totalPassed:2,totalFailed:0,totalSkipped:0,totalPending:0,runs:[{tests:[{state:'passed'},{state:'passed'}]}]};assert.doesNotThrow(()=>assertSuccessfulRun(success));
  assert.throws(()=>assertSuccessfulRun({...success,totalTests:0,totalPassed:0}),/cypress_no_test_ran/);
  for(const result of [{failures:1,message:'cannot start'},{...success,totalFailed:1},{...success,totalSkipped:1},{...success,totalPending:1},{...success,runs:[{error:'broken spec'}]}])assert.throws(()=>assertSuccessfulRun(result),/cypress_failed/);
});
