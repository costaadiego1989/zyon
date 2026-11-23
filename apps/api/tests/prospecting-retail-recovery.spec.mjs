import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RETAIL_SCOPE,eligibleRetail,retailRecordFilter,retailRecoveryManifest,RetailRecoveryStaging,prepareRetailFiles,assertRetailDirectoryBudget} from '../scripts/prospecting-retail-recovery.mjs';
const company={cnpj:'11222333000181',baseCnpj:'11222333',uf:'SP',status:'02',mainCnae:'4781400',secondaryCnaes:[],contacts:[{channel:'phone',originalValue:'11999999999',normalizedValue:null,validationState:'unknown'}]};
test('REC-01 selection includes seven states and the named retail sectors while excluding invalid or unrelated records',()=>{
  assert.deepEqual(RETAIL_SCOPE.ufs,['SP','RJ','MG','ES','PR','SC','RS']);
  for(const uf of RETAIL_SCOPE.ufs)for(const mainCnae of RETAIL_SCOPE.mainCnaes)assert.equal(eligibleRetail({...company,uf,mainCnae}),true);
  for(const patch of [{uf:'BA'},{uf:'DF'},{status:'08'},{status:'03'},{mainCnae:'1412601'},{mainCnae:'6201501'},{contacts:[]},{contacts:[{channel:'email',originalValue:'x@example.test'}]},{contacts:[{channel:'phone',originalValue:'00000000000'}]},{contacts:[{channel:'phone',originalValue:'1199999'}]},{baseCnpj:'00000000'},{cnpj:'invalid'}])assert.equal(eligibleRetail({...company,...patch}),false);
  assert.equal(eligibleRetail({...company,contacts:[{channel:'phone',originalValue:'4833334444'}]}),true);
});
test('REC-01 source integrity failure rolls back local selection and never publishes or reclaims staging',async()=>{
  const staging=new RetailRecoveryStaging(':memory:');let closed=0;
  try{
    const manifest={resources:[{id:'one',family:'estabelecimentos'}]};
    const reader={async prepare(){return {fileHash:'a'.repeat(64),compressedBytes:10,async *rows(){yield {kind:'establishment',value:company};throw Error('archive_corrupt:crc_or_size');},async close(){closed++;}};}};
    await assert.rejects(()=>prepareRetailFiles({staging,manifest,reader}),/archive_corrupt/);
    assert.equal(staging.count('establishments'),0);assert.equal(staging.count('files'),0);assert.equal(closed,1);
  }finally{staging.close();}
});
test('REC-01 selection deduplicates official CNPJs and binds staging to immutable scope',async()=>{
  const staging=new RetailRecoveryStaging(':memory:');
  try{
    const source={id:'original',hash:'source',resources:['empresas','estabelecimentos','simples','cnaes','municipios','naturezas'].map(family=>({id:family,family}))};
    const manifest=retailRecoveryManifest(source);staging.bind(manifest);staging.bind(manifest);
    assert.throws(()=>staging.bind({...manifest,hash:'changed'}),/recovery_staging_manifest_mismatch/);
    assert.equal(manifest.scope.maximumDirectoryBytes,25_000_000_000);assert.deepEqual(manifest.scope.ufs,RETAIL_SCOPE.ufs);assert.equal(manifest.resources.some(r=>r.family==='simples'),false);
    const reader={async prepare(resource){return {fileHash:'a'.repeat(64),compressedBytes:10,async *rows(){if(resource.family==='estabelecimentos'){yield {kind:'establishment',value:company};yield {kind:'establishment',value:company};yield {kind:'establishment',value:{...company,uf:'BA',cnpj:'00000000000191'}};}else if(resource.family==='cnaes'){for(const code of RETAIL_SCOPE.mainCnaes)yield {kind:'domain',value:{kind:'cnaes',code,label:code}};}else yield {kind:'domain',value:{kind:resource.family,code:'x',label:'Official'}};},async close(){}};}};
    await prepareRetailFiles({staging,manifest,reader});assert.equal(staging.count('establishments'),1);assert.equal(staging.count('files'),4);
    await prepareRetailFiles({staging,manifest,reader:{prepare(){throw Error('validated sources must not redownload');}}});
    assert.deepEqual(JSON.parse(staging.db.prepare('SELECT json FROM establishments').get().json),company);
  }finally{staging.close();}
});
test('REC-02 directory cap includes indexes and a batch reserve at the exact 25 GB boundary',async()=>{
  let sql='';const pg={async query(q){sql=q;return {rows:[{bytes:'24999999999'}]};}};
  assert.equal(await assertRetailDirectoryBudget(pg), '24999999999');assert.match(sql,/pg_total_relation_size/);
  await assert.rejects(()=>assertRetailDirectoryBudget(pg,2),/retail_directory_25gb_limit/);
  pg.query=async()=>({rows:[{bytes:'25000000000'}]});assert.equal(await assertRetailDirectoryBudget(pg),'25000000000');
  pg.query=async()=>({rows:[{bytes:'25000000001'}]});await assert.rejects(()=>assertRetailDirectoryBudget(pg),/retail_directory_25gb_limit/);
});
test('REC-01 early CSV selection respects quoted semicolons and escaped quotes without expanding the retail scope',()=>{
  const columns=Array(30).fill('');columns[0]='11222333';columns[4]='Loja; "Moda" Sul';columns[5]='02';columns[11]='4781400';columns[19]='SC';
  const encode=()=>Buffer.from(columns.map(v=>'"'+v.replaceAll('"','""')+'"').join(';'));
  assert.equal(retailRecordFilter(encode(),'estabelecimentos'),true);
  columns[19]='BA';assert.equal(retailRecordFilter(encode(),'estabelecimentos'),false);
  columns[19]='SP';columns[11]='6201501';assert.equal(retailRecordFilter(encode(),'estabelecimentos'),false);
  assert.equal(retailRecordFilter(Buffer.from('"11222333";"Official"'),'empresas',new Set(['11222333'])),true);
  assert.equal(retailRecordFilter(Buffer.from('"11222333";"Official"'),'empresas',new Set(['00000000'])),false);
  assert.equal(retailRecordFilter(Buffer.from('broken-layout'),'empresas',new Set()),true);
});
