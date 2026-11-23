import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCompanyDirectoryFixture,seedSearchDirectory} from './company-directory-fixture.js';
import {PrismaDirectoryRepository} from '../src/modules/platform-prospecting/infrastructure/company-directory/prisma-directory.repository.js';
import {createProspectCrmFixture} from './prospect-crm-fixture.js';
import {FreezeCampaignAudience} from '../src/modules/platform-prospecting/application/campaigns/freeze-campaign-audience.js';
import {PrismaAudienceRepository} from '../src/modules/platform-prospecting/infrastructure/campaigns/prisma-audience.repository.js';

async function setup(){
 const f=await createCompanyDirectoryFixture(),storage='progressive-storage',records=await seedSearchDirectory(f,storage,'2026-11');
 const ordered=[...records].sort((a,b)=>a.cnpj<b.cnpj?-1:1),maximumCnpj=ordered[0].cnpj;
 await f.client.sourceDomain.create({data:{snapshotId:storage,kind:'municipios',code:'6001',label:'Rio de Janeiro'}});
 await f.client.companySnapshot.update({where:{id:storage},data:{state:'importing'}});
 const view='progressive-view',parserVersion='rfb-cnpj-retail-read-view-v1';
 await f.client.companySnapshot.create({data:{id:view,competence:'2026-11',manifestHash:view,parserVersion,sourceUrl:'https://official.invalid',state:'published',storageSnapshotId:storage,storageMaxCnpj:maximumCnpj,
  manifest:{progressiveStorage:{snapshotId:storage,maximumCnpj,parentManifestHash:storage}},counts:{coverage:{kind:'regional_retail',scopeComplete:false,companyCount:1}},availableFilters:['cadastral','contact','commercial']}});
 await f.client.companyDirectoryActiveSnapshot.update({where:{id:'national'},data:{snapshotId:view}});
 return {...f,storage,view,ordered,maximumCnpj,repo:new PrismaDirectoryRepository(f.client,'a'.repeat(64))};
}
test('PRG-01 reads retain logical identity and frozen prefix for search, details and domains',async()=>{
 const f=await setup();try{
  const page=await f.repo.search({filters:{},limit:20});
  const observation=await f.repo.sourceObservation();assert.equal(observation.snapshotId,f.view);assert.equal(observation.latestImport?.id,f.storage);assert.equal(observation.latestImport?.state,'importing');
  assert.equal(page.snapshotId,f.view);assert.equal(page.count,1);assert.deepEqual(page.items.map(c=>c.cnpj),[f.maximumCnpj]);
  assert.equal(page.items[0].snapshotId,f.view);assert.equal(page.items[0].legalName,f.ordered[0].legalName);
  assert.deepEqual(page.items[0].contacts,[{channel:'phone',originalValue:'11999999999',normalizedValue:null,validationState:'unknown'}]);
  assert.equal((await f.repo.find(f.maximumCnpj,f.view))?.cnpj,f.maximumCnpj);
  assert.equal(await f.repo.find(f.ordered[1].cnpj,f.view),null);
  const domains=await f.repo.domains({snapshotId:f.view,kind:'municipios',uf:f.ordered[0].uf,limit:30});
  assert.equal(domains.snapshotId,f.view);assert.ok(domains.items.some(d=>d.code===f.ordered[0].cityCode));
  assert.deepEqual((await f.repo.domains({snapshotId:f.view,kind:'municipios',uf:'RJ',limit:30})).items,[]);
  await f.client.companyDirectoryActiveSnapshot.update({where:{id:'national'},data:{snapshotId:f.storage}});
  await f.client.companySnapshot.update({where:{id:f.storage},data:{state:'published'}});
  assert.equal((await f.repo.search({snapshotId:f.view,filters:{},limit:20})).count,1);
  assert.equal((await f.repo.search({snapshotId:f.storage,filters:{},limit:20})).count,f.ordered.length);
 }finally{await f.close();}
});
test('PRG-01 rejects malformed and chained views and restricts deletion of their storage',async()=>{
 const f=await setup();try{
  await assert.rejects(()=>f.pg.query('DELETE FROM company_directory.company_snapshots WHERE id=$1',[f.storage]),(error:unknown)=>{
   const e=error as {code:string;constraint:string};assert.equal(e.code,'23503');assert.equal(e.constraint,'company_snapshots_progressive_storage_fkey');return true;
  });
  await f.client.companySnapshot.update({where:{id:f.view},data:{storageMaxCnpj:f.ordered[1].cnpj}});
  await assert.rejects(()=>f.repo.search({snapshotId:f.view,filters:{}}),/snapshot_unavailable/);
  await f.client.companySnapshot.update({where:{id:f.view},data:{storageMaxCnpj:f.maximumCnpj}});
  await f.client.companySnapshot.create({data:{id:'chained',competence:'2026-11',manifestHash:'chained',parserVersion:'rfb-cnpj-retail-read-view-v1',sourceUrl:'https://official.invalid',state:'published',storageSnapshotId:f.view,storageMaxCnpj:f.maximumCnpj,manifest:{progressiveStorage:{snapshotId:f.view,maximumCnpj:f.maximumCnpj,parentManifestHash:f.view}},counts:{coverage:{scopeComplete:false}}}});
  await assert.rejects(()=>f.repo.search({snapshotId:'chained',filters:{}}),/snapshot_unavailable/);
 }finally{await f.close();}
});
test('PRG-01 audiences keep the original explicit and filtered prefix after storage growth',async()=>{
 const f=await createProspectCrmFixture(),storage='search-old',view='audience-view',maximumCnpj='00000000000191';
 try{
  await f.client.companySnapshot.update({where:{id:storage},data:{state:'importing'}});
  await f.client.companySnapshot.create({data:{id:view,competence:'2026-10',manifestHash:view,parserVersion:'rfb-cnpj-retail-read-view-v1',sourceUrl:'https://official.invalid',state:'published',storageSnapshotId:storage,storageMaxCnpj:maximumCnpj,manifest:{progressiveStorage:{snapshotId:storage,maximumCnpj,parentManifestHash:storage}},counts:{coverage:{scopeComplete:false,companyCount:1}}}});
  const segment=await f.prisma.savedProspectSegment.create({data:{name:'partial',filterJson:{},ownerOperatorId:'operator'}});
  const create=(name:string)=>f.prisma.prospectCampaign.create({data:{name,message:'synthetic',senderBindingId:'sender',senderVersion:1,sendWindow:{},createdBy:'operator'}});
  const filtered=await create('filtered'),explicit=await create('explicit'),rejected=await create('outside');
  const freeze=new FreezeCampaignAudience(new PrismaAudienceRepository(f.prisma,{currentVersion:1,keys:{1:'a'.repeat(64)}})),actor={operatorId:'operator',correlationId:'progressive-audience'};
  const a=await freeze.enqueue(filtered.id,{snapshotId:view,segmentId:segment.id,segmentVersion:1,expectedRevision:1,clientRequestId:'partial-filtered'},actor);
  const b=await freeze.enqueue(explicit.id,{snapshotId:view,cnpjs:[maximumCnpj],expectedRevision:1,clientRequestId:'partial-explicit'},actor);
  await assert.rejects(()=>freeze.enqueue(rejected.id,{snapshotId:view,cnpjs:['11222333000181'],expectedRevision:1,clientRequestId:'partial-outside'},actor),/company_not_found/);
  assert.equal((await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:rejected.id}})).revision,1);
  const entity=await f.client.companyEntity.findFirstOrThrow({where:{snapshotId:storage}}),company=await f.client.companyEstablishment.findFirstOrThrow({where:{snapshotId:storage}});
  await f.client.companyEntity.create({data:{...entity,baseCnpj:'ZZZZZZZZ',legalName:'Later company',normalizedLegalName:'LATER COMPANY'}});
  await f.client.companyEstablishment.create({data:{...company,baseCnpj:'ZZZZZZZZ',cnpj:'ZZZZZZZZ000191'}});
  for(let i=0;i<6;i++)await freeze.processNext(1);
  for(const selection of [a,b]){const actual=await freeze.poll(selection.selectionId);assert.equal(actual?.state,'complete');assert.equal(actual.companyCount,1);assert.equal(actual.recipientCount,1);assert.equal(actual.missingEndpointCount,0);}
  const leads=await f.prisma.platformProspect.findMany();assert.equal(leads.length,1);assert.equal(leads[0].cnpj,maximumCnpj);assert.equal(leads[0].sourceSnapshotId,view);
  const recipients=await f.prisma.campaignRecipient.findMany();assert.equal(recipients.length,2);assert.ok(recipients.every(r=>(r.frozenSnapshot as {snapshotId:string}).snapshotId===view));
  assert.equal(await f.prisma.contactPermissionReceipt.count(),0);
 }finally{await f.close();}
});
