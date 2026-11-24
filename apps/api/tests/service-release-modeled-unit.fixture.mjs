import assert from 'node:assert/strict';
import {composeOwnedSourceServiceRelease} from './service-release-source-process.fixture.js';
const ledgerRead='SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL';
const cases=new WeakMap();

/** Component read facts only. No native SQL ledger is created or replaced. */
export function createModeledServiceReleaseLedger(scope){
  const result=scope?.owner?.read();
  assert.ok(scope?.evidence?.kind==='synthetic_verifier_precondition'&&scope.evidence.variant==='matching'&&result?.kind==='verified','modeled_unit_verified_source_required');
  const measuredSchema=Object.freeze(result.manifest.managedSchema.map(row=>Object.freeze({...row}))),observed=[];
  const evidence=Object.freeze({...scope.evidence,kind:'modeled_unit_precondition',ledgerApplied:false,ledgerOrigin:'modeled_schema_rows_from_owned_runtime_measurement',releaseProof:'not_proven',frontendServing:'not_proven'});
  return{measuredSchema,evidence,observations:()=>observed.map(value=>({...value})),wrapQueryRaw(original){
    assert.equal(typeof original,'function','modeled_unit_query_reader_required');
    return function(query,...values){
      const strings=Array.isArray(query)?query:query?.strings,parameters=Array.isArray(query)?values:query?.values;
      const text=Array.isArray(strings)&&strings.every(value=>typeof value==='string')?strings.join(' ').replace(/\s+/g,' ').trim():'';
      const exact=text===ledgerRead&&Array.isArray(parameters)&&parameters.length===0;
      const kind=exact?'modeled_ledger_read':text.includes('_prisma_migrations')?'refused':'delegated';observed.push(Object.freeze({ordinal:observed.length+1,kind}));
      if(kind==='refused')throw Error('modeled_unit_ledger_query_invalid');
      if(exact)return Promise.resolve(measuredSchema.map(row=>({migration_name:row.migrationId,checksum:row.checksum})));
      return Reflect.apply(original,this,[query,...values]);
    };
  }};
}

/** Call explicitly inside an actual Node test case. Omission composes nothing. */
export function modeledUnitServiceRelease(context){
  assert.ok(context&&typeof context==='object'&&typeof context.after==='function','modeled_unit_context_required');
  const previous=cases.get(context);if(previous)return previous;
  const scope=composeOwnedSourceServiceRelease('matching');
  try{
    const fixture=createModeledServiceReleaseLedger(scope);
    context.after(()=>{scope.close();cases.delete(context);});cases.set(context,fixture);return fixture;
  }catch(error){scope.close();throw error;}
}
