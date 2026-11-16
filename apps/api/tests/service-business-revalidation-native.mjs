import assert from 'node:assert/strict';
import test from 'node:test';
import {createProfessionalHttpFixture} from './service-professional-http-fixture.mjs';
import {createServiceTestNeo4j} from './service-test-neo4j.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {exerciseBusinessEvidenceRevalidationCases} from './business-rag-revalidation.cases.mjs';

/** Preparation-only executable registrar. Root's actual T68 entry imports this
 * and passes a thin composition of productive T68 reader/use-case classes.
 * It intentionally registers nothing unless called; this helper alone is NOT
 * a proof command and must never be reported as a zero-test passing gate.
 */
export function registerBusinessEvidenceRevalidationNative(makeReader){
  assert.equal(typeof makeReader,'function','actual_T68_reader_factory_required');
  test('T68',{timeout:SERVICE_LOCAL_TEST_MS,concurrency:false},async t=>{
    for(const profile of [undefined,'pgvector16']){
      await t.test('canonical evidence profile '+(profile??'default'),async profileTest=>{
        const f=profile===undefined?await createProfessionalHttpFixture():await createProfessionalHttpFixture({postgresProfile:profile});
        let graph;
        try{
          graph=await createServiceTestNeo4j();
          await exerciseBusinessEvidenceRevalidationCases(profileTest,{f,graph,makeReader});
          assert.equal(f.runtime.evidence().canonicalAppModule,true);
          assert.equal(f.runtime.evidence().repositoryOverrides,false);assert.equal(f.runtime.evidence().authOverrides,false);
          assert.equal(f.runtime.evidence().providerCalls,0);
        }finally{try{if(graph)await graph.dispose();}finally{await f.close();}}
      });
    }
  });
}
