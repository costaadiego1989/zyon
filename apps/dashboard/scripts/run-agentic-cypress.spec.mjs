import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseArguments,assertSuccessfulRun,selectedSpec} from './run-agentic-cypress.mjs';
test('ADAS-66 segmented-tab witness selects its own case without starting unrelated journeys',()=>{
  assert.deepEqual(parseArguments(['--case','ADAS-66']),{case:'ADAS-66'});
  assert.equal(selectedSpec({case:'ADAS-66'}),'cypress/e2e/agentic/runtime.cy.ts');
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
