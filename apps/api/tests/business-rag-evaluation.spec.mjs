import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateBusinessRag,runBusinessRagEvaluation} from './business-rag-evaluation.mjs';
import {businessRagEvaluationCorpus} from './business-rag-evaluation-corpus.mjs';

const revision='a'.repeat(40),datasetHash='b'.repeat(64),contractHash='c'.repeat(64);
const options={revision,datasetHash,contractHash,mode:'deterministic_fixture'};
const clone=value=>structuredClone(value);
function fixtures(){
  const cases=['clinic','salon','consulting'].map(business=>({id:business+'-company',business,critical:true,
    merchantId:'public-'+business,expected:{outcome:'grounded',answerFragments:['Public '+business+' introduction'],
      forbiddenFragments:['PRIVATE-EVALUATION-CANARY'],references:[{merchantId:'public-'+business,sourceType:'company',sourceId:'public-'+business,
        sourceVersion:'fixture-current',sourceHash:'d'.repeat(64),origin:'canonical'}],tools:[]}}));
  const observations=cases.map(item=>({id:item.id,business:item.business,merchantId:item.merchantId,outcome:'grounded',
    answer:'Public '+item.business+' introduction',references:clone(item.expected.references),tools:[]}));
  return{cases,observations};
}

test('T72',async t=>{
  await t.test('complete grounded observations yield per-business source and tool metrics without raw answers',()=>{
    const f=fixtures(),report=evaluateBusinessRag(f.cases,f.observations,options);
    assert.equal(report.gate.passed,true);assert.equal(report.total,3);assert.equal(report.passed,3);
    assert.deepEqual(report.coverage,{requiredBusinesses:['clinic','salon','consulting'],observedBusinesses:['clinic','consulting','salon'],complete:true});
    assert.equal(report.byBusiness.clinic.groundedAnswers,1);assert.equal(report.byBusiness.clinic.sourceSupported,1);
    assert.equal(report.byBusiness.clinic.toolChecksPassed,1);assert.equal(report.byBusiness.clinic.total,1);
    assert.equal(JSON.stringify(report).includes('Public clinic introduction'),false);
    assert.deepEqual(report.reviewItems,[]);assert.equal(report.providerAccuracyProven,false);
    assert.equal(report.revision,revision);assert.equal(report.datasetHash,datasetHash);assert.equal(report.contractHash,contractHash);
  });
  await t.test('one failed critical case blocks an otherwise high average',()=>{
    const f=fixtures();
    for(let index=0;index<100;index++){
      const item=clone(f.cases[index%3]);item.id='extra-'+index;item.critical=false;
      f.cases.push(item);f.observations.push({...clone(f.observations[index%3]),id:item.id});
    }
    f.observations[0].answer='An unsupported claim';
    const report=evaluateBusinessRag(f.cases,f.observations,options);
    assert.ok(report.passRate>0.99);assert.equal(report.failedCritical,1);assert.equal(report.gate.passed,false);
    assert.ok(report.reviewItems.some(item=>item.id==='clinic-company'&&item.reasons.includes('required_answer_fact_missing')));
  });
  await t.test('an unexecuted case is a failed case rather than a skipped success',()=>{
    const f=fixtures();f.observations.pop();const report=evaluateBusinessRag(f.cases,f.observations,options);
    assert.equal(report.gate.completeExecution,false);assert.equal(report.executed,2);assert.equal(report.total,3);
    assert.equal(report.gate.passed,false);assert.ok(report.reviewItems.some(item=>item.reasons.includes('observation_missing')));
  });
  await t.test('duplicate case IDs and incomplete business corpus are rejected',()=>{
    const f=fixtures();
    assert.throws(()=>evaluateBusinessRag([...f.cases,clone(f.cases[0])],f.observations,options),/invalid_evaluation_cases/);
    assert.throws(()=>evaluateBusinessRag(f.cases.slice(0,2),f.observations.slice(0,2),options),/three_businesses_required/);
  });
  await t.test('unknown or duplicate observations cannot be ignored to improve the result',()=>{
    const f=fixtures();const duplicated=evaluateBusinessRag(f.cases,[...f.observations,clone(f.observations[0])],options);
    assert.equal(duplicated.gate.passed,false);assert.ok(duplicated.invalidObservations.includes('duplicate_observation'));
    const unknown=evaluateBusinessRag(f.cases,[...f.observations,{...clone(f.observations[0]),id:'not-in-corpus'}],options);
    assert.equal(unknown.gate.passed,false);assert.ok(unknown.invalidObservations.includes('unknown_observation'));
  });
  await t.test('a response or reference belonging to another merchant is rejected even with the expected text',()=>{
    for(const target of ['response','reference']){
      const f=fixtures();if(target==='response')f.observations[0].merchantId='another-merchant';
      else f.observations[0].references[0].merchantId='another-merchant';
      const report=evaluateBusinessRag(f.cases,f.observations,options);
      assert.equal(report.gate.passed,false);assert.ok(report.reviewItems[0].reasons.includes(target==='response'?'scope_mismatch':'reference_mismatch'));
    }
  });
  await t.test('old hash, version or fabricated indexed origin cannot match current canonical ground truth',()=>{
    for(const [field,value]of [['sourceHash','e'.repeat(64)],['sourceVersion','older'],['origin','indexed']]){
      const f=fixtures();f.observations[0].references[0][field]=value;
      const report=evaluateBusinessRag(f.cases,f.observations,options);
      assert.equal(report.gate.passed,false);assert.ok(report.reviewItems[0].reasons.includes('reference_mismatch'));
    }
  });
  await t.test('a result missing one required source pair fails the pair-complete check',()=>{
    const f=fixtures();f.cases[0].expected.references.push({...clone(f.cases[0].expected.references[0]),sourceType:'business_hours'});
    const report=evaluateBusinessRag(f.cases,f.observations,options);
    assert.equal(report.gate.passed,false);assert.ok(report.reviewItems[0].reasons.includes('reference_mismatch'));
  });
  await t.test('an unexpected write or source-instructed tool call cannot pass as grounded text',()=>{
    const f=fixtures();f.observations[0].tools=[{name:'createCheckoutSession',result:{id:'not-authorized'}}];
    const report=evaluateBusinessRag(f.cases,f.observations,options);
    assert.equal(report.gate.passed,false);assert.ok(report.reviewItems[0].reasons.includes('canonical_tool_mismatch'));
  });
  await t.test('live tool output must match current canonical truth rather than an older available slot',()=>{
    const f=fixtures(),expected={name:'getAvailableSlots',result:{slots:[],timeZone:'America/Sao_Paulo'}};
    f.cases[0].expected.tools=[expected];f.observations[0].tools=[{...clone(expected),result:{slots:['2030-01-02T10:00'],timeZone:'America/Sao_Paulo'}}];
    const bad=evaluateBusinessRag(f.cases,f.observations,options);assert.equal(bad.gate.passed,false);
    assert.ok(bad.reviewItems[0].reasons.includes('canonical_tool_mismatch'));
    f.observations[0].tools=[clone(expected)];assert.equal(evaluateBusinessRag(f.cases,f.observations,options).gate.passed,true);
  });
  await t.test('missing and contradictory information have explicit outcomes and never inherit an invented fact',()=>{
    for(const outcome of ['no_evidence','clarify']){
      const f=fixtures();f.cases[0].expected={outcome,answerFragments:['Não confirmado'],forbiddenFragments:['Retirado'],references:[],tools:[]};
      f.observations[0]={...f.observations[0],outcome,answer:'Não confirmado',references:[]};
      assert.equal(evaluateBusinessRag(f.cases,f.observations,options).gate.passed,true);
      f.observations[0].answer='Não confirmado. Retirado continua disponível';
      assert.equal(evaluateBusinessRag(f.cases,f.observations,options).gate.passed,false);
    }
  });
  await t.test('an individual professional decision requires the referral outcome rather than an invented decision',()=>{
    const f=fixtures();f.cases[0].expected={outcome:'professional_referral',answerFragments:['profissional'],forbiddenFragments:[],references:[],tools:[]};
    f.observations[0]={...f.observations[0],outcome:'professional_referral',answer:'Converse com o profissional da empresa.',references:[]};
    assert.equal(evaluateBusinessRag(f.cases,f.observations,options).gate.passed,true);
    f.observations[0].outcome='grounded';assert.equal(evaluateBusinessRag(f.cases,f.observations,options).gate.passed,false);
  });
  await t.test('the global twenty-reference boundary rejects overflow rather than truncating a failed response',()=>{
    const f=fixtures();f.observations[0].references=Array.from({length:21},()=>clone(f.observations[0].references[0]));
    const report=evaluateBusinessRag(f.cases,f.observations,options);
    assert.equal(report.gate.passed,false);assert.ok(report.reviewItems[0].reasons.includes('reference_budget_exceeded'));
  });
  await t.test('private values are rejected without persisting the raw answer in the report',()=>{
    const f=fixtures();f.observations[0].answer+=' PRIVATE-EVALUATION-CANARY';
    const report=evaluateBusinessRag(f.cases,f.observations,options);
    assert.equal(report.gate.passed,false);assert.ok(report.reviewItems[0].reasons.includes('forbidden_answer_fact'));
    assert.equal(JSON.stringify(report).includes('PRIVATE-EVALUATION-CANARY'),false);
  });
  await t.test('revision, dataset and contract identity cannot be silently unknown',()=>{
    const f=fixtures();
    for(const change of [{revision:'unknown'},{datasetHash:''},{contractHash:'invalid'}])
      assert.throws(()=>evaluateBusinessRag(f.cases,f.observations,{...options,...change}),/evaluation_identity_required/);
  });
  await t.test('the observer is actually called for every case and errors fail without leaking its message',async()=>{
    const f=fixtures(),seen=[];
    const report=await runBusinessRagEvaluation(f.cases,async item=>{
      seen.push(item.id);if(item.business==='clinic')throw new Error('PRIVATE-OBSERVER-ERROR');
      return clone(f.observations.find(value=>value.id===item.id));
    },options);
    assert.deepEqual(seen,f.cases.map(item=>item.id));assert.equal(report.gate.passed,false);
    assert.ok(report.reviewItems.some(item=>item.reasons.includes('observer_failed')));
    assert.equal(JSON.stringify(report).includes('PRIVATE-OBSERVER-ERROR'),false);
  });
  await t.test('the declared corpus covers all seven positive negative and contradictory scenarios per business',()=>{
    const corpus=businessRagEvaluationCorpus();assert.equal(corpus.length,21);
    for(const business of ['clinic','salon','consulting']){
      const rows=corpus.filter(item=>item.business===business);assert.equal(rows.length,7);
      assert.equal(new Set(rows.map(item=>item.scenario)).size,7);assert.ok(rows.every(item=>item.critical===true));
      assert.ok(rows.some(item=>item.scenario==='source_injection'));assert.ok(rows.some(item=>item.scenario==='individual_decision'));
    }
    assert.equal(new Set(corpus.map(item=>item.id)).size,21);
  });
});
