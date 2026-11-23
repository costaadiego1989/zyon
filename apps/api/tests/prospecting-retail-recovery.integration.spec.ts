import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCompanyDirectoryFixture,fixtureManifest} from './company-directory-fixture.js';
import {PrismaDirectoryRepository} from '../src/modules/platform-prospecting/infrastructure/company-directory/prisma-directory.repository.js';
import {RETAIL_SCOPE,RetailRecoveryStaging,retailRecoveryManifest,reclaimFailedDirectory,persistRetailDirectory,publishRetailDirectory} from '../scripts/prospecting-retail-recovery.mjs';
const entity={baseCnpj:'11222333',legalName:'Loja Açúcar',legalNature:'2062',size:'01',capitalCents:'12345',simples:null,mei:null};
const company={cnpj:'11222333000181',baseCnpj:'11222333',tradeName:'Moda Sul',mainCnae:'4781400',secondaryCnaes:['4782201'],cityCode:'8105',uf:'SC',district:'Centro',openingDate:'2020-01-01',status:'02',matrixBranch:'matrix',contacts:[{channel:'phone',originalValue:'48999999999',normalizedValue:null,validationState:'unknown'},{channel:'email',originalValue:'contato@example.test',normalizedValue:null,validationState:'unknown'}]};
async function setup(){
 const f=await createCompanyDirectoryFixture(),repo=new PrismaDirectoryRepository(f.client,'a'.repeat(64)),source=fixtureManifest(),manifest=retailRecoveryManifest(source),staging=new RetailRecoveryStaging(':memory:');
 await repo.saveManifest(source);await repo.saveManifest(manifest);await f.client.companySnapshot.update({where:{id:source.id},data:{state:'failed',errorCode:'production_directory_storage_limit'}});
 await f.client.companyEntity.create({data:{snapshotId:source.id,...entity,normalizedLegalName:'LOJA ACUCAR'}});
 await f.pg.query("INSERT INTO platform_operators(id) VALUES ('operator')");
 await f.pg.query("INSERT INTO platform_prospects(id,cnpj,source_snapshot_id,stage) VALUES ('real-crm','00000000000191','unrelated-preserved-source','responded')");
 await f.pg.query("INSERT INTO prospect_audit_events(id,actor_operator_id,action,resource_type,resource_id,resource_version,correlation_id,outcome) VALUES ('old-audit','operator','preserve','prospect','real-crm',1,'corr-old','ok')");
 staging.bind(manifest);staging.entity(entity);staging.db.prepare('INSERT INTO establishments VALUES (?,?,?)').run(company.cnpj,company.baseCnpj,JSON.stringify(company));
 staging.db.prepare('INSERT INTO domains VALUES (?,?,?)').run('cnaes','4781400',JSON.stringify({kind:'cnaes',code:'4781400',label:'Vestuário'}));
 for(const resource of manifest.resources)staging.putFile(resource.id,{hash:'a'.repeat(64),compressedBytes:100,state:'validated',scanned:1});
 const connection=await f.pg.connect(),actor={operatorId:'operator',correlationId:'corr-recovery'};
 return {...f,repo,source,manifest,staging,connection,actor,async finish(){connection.release();staging.close();await f.close();}};
}
test('REC-01 REC-02 real replacement retains official values and regional provenance while reclaiming only unpublished raw directory',async()=>{
 const f=await setup();
 try{
  await reclaimFailedDirectory(f.connection,{sourceSnapshotId:f.source.id,snapshotId:f.manifest.id,actor:f.actor,staging:f.staging,manifest:f.manifest});
  assert.equal(await f.client.companyEntity.count(),0);
  assert.equal((await f.client.companySnapshot.findUniqueOrThrow({where:{id:f.source.id}})).errorCode,'import_superseded');
  assert.equal((await f.connection.query("SELECT stage FROM platform_prospects WHERE id='real-crm'")).rows[0].stage,'responded');
  assert.equal((await f.connection.query("SELECT id FROM prospect_audit_events WHERE id='old-audit'")).rowCount,1);
  const guard=async(_pg:unknown,callback:()=>Promise<unknown>)=>({result:await callback()});
  await persistRetailDirectory({pg:f.connection,staging:f.staging,manifest:f.manifest,guard});
  await persistRetailDirectory({pg:f.connection,staging:f.staging,manifest:f.manifest,guard});
  const coverage=await publishRetailDirectory(f.connection,f.staging,f.manifest,f.actor);
  assert.deepEqual(coverage.ufs,RETAIL_SCOPE.ufs);assert.equal(coverage.companyCount,1);assert.equal(coverage.maximumDirectoryBytes,25_000_000_000);assert.equal(coverage.scopeComplete,true);
  assert.equal(await f.repo.activeSnapshotId(),f.manifest.id);
  const actual=await f.repo.find(company.cnpj);assert.equal(actual?.legalName,entity.legalName);assert.equal(actual?.capitalCents,entity.capitalCents);assert.equal(actual?.uf,'SC');assert.equal(actual?.simples,null);
  assert.deepEqual(actual?.secondaryCnaes,company.secondaryCnaes);assert.deepEqual(actual?.contacts,[company.contacts[1],company.contacts[0]]);
  assert.equal(await f.client.companyPublicContact.count(),2);assert.equal(await f.client.establishmentSecondaryCnae.count(),1);
  assert.equal((await f.repo.search({filters:{ufs:['SC'],mainCnaes:['4781400']}})).items[0].cnpj,company.cnpj);
  assert.equal((await f.repo.search({filters:{ufs:['SP']}})).items.length,0);
  await publishRetailDirectory(f.connection,f.staging,f.manifest,f.actor);
  assert.equal((await f.connection.query("SELECT id FROM prospect_audit_events WHERE action='company_import_publish'")).rowCount,1);
 }finally{await f.finish();}
});
test('REC-02 source ownership and CRM reference preconditions abort without removing persisted data',async()=>{
 const f=await setup();
 try{
  await f.connection.query('UPDATE platform_prospects SET source_snapshot_id=$1 WHERE id=$2',[f.source.id,'real-crm']);
  await assert.rejects(()=>reclaimFailedDirectory(f.connection,{sourceSnapshotId:f.source.id,snapshotId:f.manifest.id,actor:f.actor,staging:f.staging,manifest:f.manifest}),/recovery_source_in_use/);
  assert.equal(await f.client.companyEntity.count(),1);assert.equal(await f.repo.activeSnapshotId(),null);
  assert.equal((await f.client.companySnapshot.findUniqueOrThrow({where:{id:f.source.id}})).errorCode,'production_directory_storage_limit');
  await f.connection.query("UPDATE platform_prospects SET source_snapshot_id='preserved' WHERE id='real-crm'");
  await f.client.companySnapshot.create({data:{id:'other-run',competence:'2026-10',manifestHash:'other',manifest:{},sourceUrl:'https://official.test',parserVersion:'x'}});
  await assert.rejects(()=>reclaimFailedDirectory(f.connection,{sourceSnapshotId:f.source.id,snapshotId:f.manifest.id,actor:f.actor,staging:f.staging,manifest:f.manifest}),/recovery_source_not_owned/);
  assert.equal(await f.client.companyEntity.count(),1);assert.equal(await f.repo.activeSnapshotId(),null);
 }finally{await f.finish();}
});
test('REC-01 incomplete persistence never publishes an active snapshot',async()=>{
 const f=await setup();
 try{await assert.rejects(()=>publishRetailDirectory(f.connection,f.staging,f.manifest,f.actor),/recovery_count_mismatch/);assert.equal(await f.repo.activeSnapshotId(),null);assert.equal(await f.client.companyEntity.count(),1);}
 finally{await f.finish();}
});
