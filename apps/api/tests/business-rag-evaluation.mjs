// Source preparation only. Actual served-consumer observations are integrated after T71 Full.
import {isDeepStrictEqual} from 'node:util';

const businesses=['clinic','salon','consulting'];
const outcomes=['grounded','no_evidence','clarify','professional_referral'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&Boolean(value.trim());
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const normalize=value=>value.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR');
const reference=(value,merchantId)=>object(value)&&value.merchantId===merchantId&&text(value.sourceType)
  &&text(value.sourceId)&&text(value.sourceVersion)&&hash(value.sourceHash)&&text(value.origin);
const sameItems=(left,right)=>left.length===right.length&&left.every((value,index)=>
  left.slice(0,index).filter(previous=>isDeepStrictEqual(previous,value)).length
    <right.filter(expected=>isDeepStrictEqual(expected,value)).length);

function validate(cases,options){
  if(!options||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(options.revision??'')
    ||!hash(options.datasetHash)||!hash(options.contractHash)
    ||!['deterministic_fixture','owned_runtime'].includes(options.mode))throw new TypeError('evaluation_identity_required');
  if(!Array.isArray(cases)||!cases.length)throw new TypeError('invalid_evaluation_cases');
  const ids=new Set();
  for(const item of cases){
    const expected=item?.expected;
    if(!object(item)||!text(item.id)||ids.has(item.id)||!businesses.includes(item.business)||typeof item.critical!=='boolean'
      ||!text(item.merchantId)||!object(expected)||!outcomes.includes(expected.outcome)
      ||!Array.isArray(expected.answerFragments)||expected.answerFragments.some(value=>!text(value))
      ||!Array.isArray(expected.forbiddenFragments)||expected.forbiddenFragments.some(value=>!text(value))
      ||!Array.isArray(expected.references)||expected.references.length>20||expected.references.some(value=>!reference(value,item.merchantId))
      ||!Array.isArray(expected.tools)||expected.tools.some(value=>!object(value)||!text(value.name)||!Object.hasOwn(value,'result'))
      ||expected.outcome==='grounded'&&!expected.references.length&&!expected.tools.length)throw new TypeError('invalid_evaluation_cases');
    ids.add(item.id);
  }
  if(businesses.some(business=>!cases.some(item=>item.business===business)))throw new TypeError('three_businesses_required');
}

/** Ground truth is hydrated from trusted native fixture snapshots before observation.
 * Unknown input properties such as a caller-supplied `passed` are never authoritative.
 * Native adapters retain the original provenance objects; this reporter invents none. */
export function evaluateBusinessRag(cases,observations,options){
  validate(cases,options);
  if(!Array.isArray(observations))throw new TypeError('evaluation_observations_required');
  const byId=new Map(),ids=new Set(cases.map(item=>item.id)),invalidObservations=[];
  for(const observation of observations){
    if(!object(observation)||!text(observation.id)){invalidObservations.push('invalid_observation');continue;}
    if(!ids.has(observation.id)){invalidObservations.push('unknown_observation');continue;}
    if(byId.has(observation.id)){invalidObservations.push('duplicate_observation');continue;}
    byId.set(observation.id,observation);
  }
  const byBusiness=Object.fromEntries(businesses.map(business=>[business,{
    total:0,executed:0,passed:0,groundedAnswers:0,sourceSupported:0,toolChecksPassed:0,
    absenceHandled:0,contradictionsHandled:0,professionalReferrals:0,
  }]));
  const results=[],seenBusinesses=new Set();
  for(const item of cases){
    const actual=byId.get(item.id),expected=item.expected,reasons=[];
    const metrics=byBusiness[item.business];metrics.total++;
    if(!actual)reasons.push('observation_missing');
    else{
      metrics.executed++;if(businesses.includes(actual.business))seenBusinesses.add(actual.business);
      if(actual.observerFailed===true)reasons.push('observer_failed');
      if(actual.business!==item.business)reasons.push('business_mismatch');
      if(actual.merchantId!==item.merchantId)reasons.push('scope_mismatch');
      if(actual.outcome!==expected.outcome)reasons.push('outcome_mismatch');
      const answer=typeof actual.answer==='string'?normalize(actual.answer):'';
      if(!answer)reasons.push('answer_missing');
      if(expected.answerFragments.some(value=>!answer.includes(normalize(value))))reasons.push('required_answer_fact_missing');
      if(expected.forbiddenFragments.some(value=>answer.includes(normalize(value))))reasons.push('forbidden_answer_fact');
      if(!Array.isArray(actual.references))reasons.push('reference_mismatch');
      else{
        if(actual.references.length>20)reasons.push('reference_budget_exceeded');
        if(actual.references.some(value=>!reference(value,item.merchantId))||!sameItems(actual.references,expected.references))reasons.push('reference_mismatch');
      }
      if(!Array.isArray(actual.tools)||!sameItems(actual.tools,expected.tools))reasons.push('canonical_tool_mismatch');
      else metrics.toolChecksPassed++;
      if(actual.outcome==='grounded')metrics.groundedAnswers++;
    }
    const passed=reasons.length===0;
    if(passed){
      metrics.passed++;
      if(actual.outcome==='grounded')metrics.sourceSupported++;
      if(actual.outcome==='no_evidence')metrics.absenceHandled++;
      if(actual.outcome==='clarify')metrics.contradictionsHandled++;
      if(actual.outcome==='professional_referral')metrics.professionalReferrals++;
    }
    results.push({id:item.id,business:item.business,critical:item.critical,passed,reasons});
  }
  const passed=results.filter(item=>item.passed).length,failedCritical=results.filter(item=>item.critical&&!item.passed).length;
  const coverage={requiredBusinesses:[...businesses],observedBusinesses:[...seenBusinesses].sort(),complete:businesses.every(item=>seenBusinesses.has(item))};
  const completeExecution=cases.every(item=>byId.has(item.id));
  return{
    version:1,revision:options.revision,datasetHash:options.datasetHash,contractHash:options.contractHash,
    mode:options.mode,providerAccuracyProven:false,total:cases.length,executed:byId.size,passed,failed:cases.length-passed,
    failedCritical,passRate:passed/cases.length,coverage,byBusiness,invalidObservations:[...new Set(invalidObservations)],
    gate:{completeExecution,allCriticalPassed:failedCritical===0,allCasesPassed:passed===cases.length,
      passed:completeExecution&&coverage.complete&&invalidObservations.length===0&&passed===cases.length&&failedCritical===0},
    results,reviewItems:results.filter(item=>!item.passed).map(item=>({id:item.id,business:item.business,critical:item.critical,reasons:[...item.reasons]})),
  };
}

/** The caller supplies the actual served-consumer observer under the owned runtime.
 * There is no provider client, environment credential discovery or network fallback here. */
export async function runBusinessRagEvaluation(cases,observe,options){
  validate(cases,options);
  if(typeof observe!=='function')throw new TypeError('evaluation_observer_required');
  const observations=[];
  for(const item of cases){
    try{observations.push(await observe(structuredClone(item)));}
    catch{observations.push({id:item.id,business:item.business,merchantId:item.merchantId,observerFailed:true,
      outcome:'error',answer:'',references:[],tools:[]});}
  }
  return evaluateBusinessRag(cases,observations,options);
}
