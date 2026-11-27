import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCompanyDirectoryFixture,fixtureManifest} from './company-directory-fixture.js';
import {PrismaDirectoryRepository} from '../src/modules/platform-prospecting/infrastructure/company-directory/prisma-directory.repository.js';
import * as recovery from '../scripts/prospecting-retail-recovery.mjs';
const guard=async(_pg:unknown,write:()=>Promise<unknown>)=>({result:await write()});
const fixtureCnpj=(stem:string)=>{let value=stem;for(let n=0;n<2;n++){let sum=0;for(let i=value.length-1,w=2;i>=0;i--,w=w===9?2:w+1)sum+=(Number(value[i]))*w;const remainder=sum%11;value+=remainder<2?'0':String(11-remainder);}return value;};
async function setup(){
 const f=await createCompanyDirectoryFixture(),repo=new PrismaDirectoryRepository(f.client,'a'.repeat(64)),source=fixtureManifest(),manifest=recovery.retailRecoveryManifest(source),staging=new recovery.RetailRecoveryStaging(':memory:'),actor={operatorId:'operator',correlationId:'progressive-publish'};
 await repo.saveManifest(source);await repo.saveManifest(manifest);await f.client.companySnapshot.update({where:{id:source.id},data:{state:'failed'}});await f.client.companySnapshot.update({where:{id:manifest.id},data:{state:'importing'}});await f.pg.query("INSERT INTO platform_operators VALUES ('operator')");
 staging.bind(manifest);
 const companies=Array.from({length:5},(_,i)=>{const base=String(i+1).padStart(8,'0');return {cnpj:fixtureCnpj(base+'0001'),baseCnpj:base,tradeName:'Loja '+i,mainCnae:'4781400',secondaryCnaes:['4789004'],cityCode:String(7001+i),uf:['SP','SC','RJ','PR','MG'][i],district:'Centro',openingDate:'2020-01-01',status:'02',matrixBranch:'matrix',contacts:[{channel:'phone',originalValue:'11999999'+String(i).padStart(3,'0'),normalizedValue:null,validationState:'unknown'}]};});
 for(const c of companies){staging.entity({baseCnpj:c.baseCnpj,legalName:c.tradeName,legalNature:'2062',size:'01',capitalCents:'12345',simples:null,mei:null});staging.db.prepare('INSERT INTO establishments VALUES (?,?,?)').run(c.cnpj,c.baseCnpj,JSON.stringify(c));staging.db.prepare('INSERT INTO domains VALUES (?,?,?)').run('municipios',c.cityCode,JSON.stringify({kind:'municipios',code:c.cityCode,label:'Municipio '+c.cityCode}));}
 for(const code of ['4781400','4782201','4782202','4783101','4783102','4789001','4772500','4789004'])staging.db.prepare('INSERT INTO domains VALUES (?,?,?)').run('cnaes',code,JSON.stringify({kind:'cnaes',code,label:'CNAE '+code}));
 staging.db.prepare('INSERT INTO domains VALUES (?,?,?)').run('naturezas','2062',JSON.stringify({kind:'naturezas',code:'2062',label:'Limitada'}));
 for(const r of manifest.resources)staging.putFile(r.id,{hash:'a'.repeat(64),compressedBytes:100,state:'validated',scanned:5});
 const connection=await f.pg.connect();await recovery.reclaimFailedDirectory(connection,{sourceSnapshotId:source.id,snapshotId:manifest.id,actor,staging,manifest});
 const run=(progress:Parameters<typeof recovery.persistRetailDirectory>[0]['progress'])=>recovery.persistRetailDirectory({pg:connection,staging,manifest,guard,progress,batchSize:1});
 const publish=(g=guard,now=new Date('2026-11-23T19:00:00Z'))=>recovery.publishProgressiveRetailDirectory(connection,staging,manifest,actor,g,now);
 const prefix=async(n:number)=>{await assert.rejects(()=>run(async update=>{if(update.phase==='persisting_establishments'&&update.companyCount===n)throw Error('test_checkpoint');}),/test_checkpoint/);};
 return {...f,repo,source,manifest,staging,actor,companies,connection,run,publish,prefix,async close(){connection.release();staging.close();await f.close();}};
}
test('PRG-02 preparation binding accepts semantic JSON equality and rejects changed source values',()=>{
 const manifest=recovery.retailRecoveryManifest(fixtureManifest()),staging=new recovery.RetailRecoveryStaging(':memory:');try{
  staging.bind(manifest);staging.bind(Object.fromEntries(Object.entries(manifest).reverse()));
  assert.throws(()=>staging.bind({...manifest,resources:manifest.resources.map((r,i)=>i?r:{...r,url:'https://changed.invalid/archive.zip'})}),/recovery_staging_manifest_mismatch/);
 }finally{staging.close();}
});
test('PRG-02 committed companies have their entity, contacts and domains before first availability',async()=>{
 const f=await setup();let checked=false;
 try{await f.run(async update=>{if(!checked&&update.phase==='persisting_establishments'){
  assert.equal(await f.client.sourceDomain.count({where:{snapshotId:f.manifest.id}}),f.staging.count('domains'));
  assert.equal(update.companyCount,1);assert.equal(await f.client.companyEntity.count(),1);assert.equal(await f.client.companyPublicContact.count(),1);
  const partial=await f.publish();assert.ok(partial);assert.equal(partial.coverage.scopeComplete,false);
  const company=await f.repo.find(f.companies[0].cnpj,partial.snapshotId);assert.equal(company?.legalName,'Loja 0');assert.equal(company.contacts[0].originalValue,f.companies[0].contacts[0].originalValue);assert.deepEqual(company.secondaryCnaes,['4789004']);checked=true;
 }});assert.equal(checked,true);}finally{await f.close();}
});
test('PRG-02 versions are immutable metadata over shared rows while the importer grows',async()=>{
 const f=await setup(),views:string[]=[];try{
  await f.run(async update=>{if(update.phase==='persisting_establishments'){const partial=await f.publish();if(partial)views.push(partial.snapshotId);}});
  assert.equal(views.length,2);assert.notEqual(views[0],views[1]);
  assert.equal((await f.repo.search({snapshotId:views[0],filters:{}})).count,1);assert.equal((await f.repo.search({snapshotId:views[1],filters:{}})).count,4);
  assert.equal(await f.client.companyEntity.count(),5);assert.equal(await f.client.companyEstablishment.count(),5);assert.equal(await f.client.companyPublicContact.count(),5);
  assert.equal(await f.repo.activeSnapshotId(),views[1]);assert.equal((await f.repo.sourceObservation()).latestImport?.id,f.manifest.id);
  for(const id of views){assert.equal(await f.client.companyEstablishment.count({where:{snapshotId:id}}),0);assert.equal((await f.client.companySnapshot.findUniqueOrThrow({where:{id}})).storageSnapshotId,f.manifest.id);}
  assert.equal(await f.publish(),null);
 }finally{await f.close();}
});
test('PRG-02 completion swaps only its owned pointer and failure preserves the last readable view',async()=>{
 const f=await setup();let last='';try{
  await f.run(async update=>{if(update.phase==='persisting_establishments'){const p=await f.publish();if(p)last=p.snapshotId;}});
  await f.client.companySnapshot.create({data:{id:'foreign',competence:'2026-11',manifestHash:'foreign',manifest:{},state:'published',sourceUrl:'https://official.invalid',parserVersion:'foreign'}});
  await f.client.companyDirectoryActiveSnapshot.update({where:{id:'national'},data:{snapshotId:'foreign'}});
  await assert.rejects(()=>recovery.publishRetailDirectory(f.connection,f.staging,f.manifest,f.actor),/active_snapshot_conflict/);assert.equal(await f.repo.activeSnapshotId(),'foreign');
  await f.client.companyDirectoryActiveSnapshot.update({where:{id:'national'},data:{snapshotId:last}});
  await f.client.companySnapshot.update({where:{id:f.manifest.id},data:{state:'failed',errorCode:'source_unavailable'}});
  assert.equal((await f.repo.search({filters:{}})).count,4);
  const complete=await recovery.publishRetailDirectory(f.connection,f.staging,f.manifest,f.actor);assert.equal(complete.scopeComplete,true);assert.equal(complete.companyCount,5);assert.equal(await f.repo.activeSnapshotId(),f.manifest.id);
  assert.equal((await f.repo.search({snapshotId:last,filters:{}})).count,4);assert.equal((await f.repo.search({filters:{}})).count,5);
 }finally{await f.close();}
});
test('PRG-02 versions also advance after one minute when a smaller new prefix is committed',async()=>{
 const f=await setup();try{
  await f.prefix(1);const first=await f.publish();assert.ok(first);await f.prefix(2);
  assert.equal(await f.publish(guard,new Date('2026-11-23T19:00:59Z')),null);
  const next=await f.publish(guard,new Date('2026-11-23T19:01:00Z'));assert.ok(next);assert.equal(next.coverage.companyCount,2);assert.notEqual(next.snapshotId,first.snapshotId);
  assert.equal((await f.repo.search({snapshotId:first.snapshotId,filters:{}})).count,1);
 }finally{await f.close();}
});
test('PRG-02 rollback preserves the prior view on invalid source, incomplete prefix or failed storage guard',async()=>{
 const f=await setup();try{
  await f.prefix(1);const first=await f.publish();assert.ok(first);await f.prefix(4);
  const failure=async(_pg:unknown,write:()=>Promise<unknown>)=>{await write();throw Error('retail_directory_25gb_limit');};
  await assert.rejects(()=>f.publish(failure),/retail_directory_25gb_limit/);assert.equal(await f.repo.activeSnapshotId(),first.snapshotId);assert.equal(await f.client.companySnapshot.count({where:{storageSnapshotId:f.manifest.id}}),1);
  const resource=f.manifest.resources[0],proof=f.staging.file(resource.id);f.staging.putFile(resource.id,{...proof,state:'pending'});
  await assert.rejects(()=>f.publish(),/recovery_sources_incomplete/);f.staging.putFile(resource.id,proof);
  await f.client.companyEstablishment.delete({where:{snapshotId_cnpj:{snapshotId:f.manifest.id,cnpj:f.companies[1].cnpj}}});
  const entity=JSON.parse(f.staging.db.prepare('SELECT json FROM entities WHERE base=?').get(f.companies[4].baseCnpj).json),c=f.companies[4];
  await f.client.companyEntity.create({data:{snapshotId:f.manifest.id,...entity,normalizedLegalName:entity.legalName.toUpperCase()}});
  await f.client.companyEstablishment.create({data:{snapshotId:f.manifest.id,cnpj:c.cnpj,baseCnpj:c.baseCnpj,status:c.status,uf:c.uf,mainCnae:c.mainCnae,cityCode:c.cityCode,contacts:{create:c.contacts}}});
  await assert.rejects(()=>f.publish(),/recovery_prefix_incomplete/);
  assert.equal(await f.repo.activeSnapshotId(),first.snapshotId);assert.equal((await f.repo.search({filters:{}})).count,1);
 }finally{await f.close();}
});
