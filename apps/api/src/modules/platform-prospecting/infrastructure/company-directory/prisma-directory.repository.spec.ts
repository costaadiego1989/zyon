import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompanyDirectoryFixture, fixtureManifest } from "../../../../../tests/company-directory-fixture.js";
import { PrismaDirectoryRepository } from "./prisma-directory.repository.js";
import type { DirectoryBatch } from "../../domain/prospecting.ports.js";

test("REC-02 REC-03 persisted import failures expose actual progress and superseded imports cannot resume",async()=>{
 const f=await createCompanyDirectoryFixture(),repo=new PrismaDirectoryRepository(f.client);
 try{
  const manifest=fixtureManifest(),status=await repo.saveManifest(manifest);
  await f.client.companySourceFile.update({where:{id:status.files[0].id},data:{committedCount:57018146,state:"validated"}});
  await f.client.companySnapshot.update({where:{id:status.id},data:{state:"failed",errorCode:"production_directory_storage_limit"}});
  const observation=await repo.sourceObservation();assert.equal(observation.snapshotId,null);assert.equal(observation.state,"unavailable");
  assert.deepEqual(observation.latestImport,{id:status.id,state:"failed",phase:null,committedCount:57018146,selectedCompanies:0,validatedFiles:1,totalFiles:24,errorCode:"production_directory_storage_limit",updatedAt:observation.latestImport!.updatedAt});
  assert.ok(Number.isFinite(Date.parse(observation.latestImport!.updatedAt)));
  await f.client.companySnapshot.update({where:{id:status.id},data:{counts:{supersededBy:"regional"}}});
  await assert.rejects(()=>repo.claimImport(status.id,"worker",new Date()),/import_superseded/);
  await assert.rejects(()=>repo.enqueueImport({snapshotId:status.id,clientRequestId:"superseded-resume",requestHash:"test",action:"resume"},{operatorId:"operator",correlationId:"corr"}),/import_superseded/);
  assert.equal((await f.client.companySnapshot.findUniqueOrThrow({where:{id:status.id}})).state,"failed");
  assert.equal((await f.pg.query("SELECT 1 FROM prospect_commands WHERE client_request_id='superseded-resume'")).rowCount,0);
 }finally{await f.close();}
});

test("PROS-05 AC1 commits real Prisma batches once, rejects divergent replay and rolls back incomplete records", async () => {
  const fixture = await createCompanyDirectoryFixture(); const repo = new PrismaDirectoryRepository(fixture.client);
  try {
    const status = await repo.saveManifest(fixtureManifest()); const file = status.files.find(f=>f.resourceId.endsWith("empresas"))!;
    const entity = { baseCnpj:"12ABC345",legalName:"Maçã Comércio",legalNature:"2062",size:"01",capitalCents:"900719925474099317",simples:null,mei:null };
    const batch: DirectoryBatch = {snapshotId:status.snapshotId,fileId:file.id,fileHash:"a".repeat(64),batchIndex:0,rowOffset:1,byteOffset:0,entities:[entity],establishments:[],domains:[]};
    const concurrent = await Promise.allSettled([repo.commitBatch(batch),repo.commitBatch(batch)]);
    for (const result of concurrent) if (result.status === "rejected") throw result.reason;
    assert.deepEqual(concurrent.map(r=>(r as PromiseFulfilledResult<{committed:number;replay:boolean}>).value).sort((a,b)=>Number(a.replay)-Number(b.replay)), [{committed:1,replay:false},{committed:1,replay:true}]);
    assert.deepEqual(await fixture.client.companyEntity.findMany({select:{baseCnpj:true,legalName:true,capitalCents:true,simples:true,mei:true}}).then(rows=>rows.map(r=>({...r,capitalCents:r.capitalCents?.toString()}))), [{baseCnpj:"12ABC345",legalName:"Maçã Comércio",capitalCents:"900719925474099317",simples:null,mei:null}]);
    assert.equal(await fixture.client.companyImportCheckpoint.count(),1);
    await assert.rejects(()=>repo.commitBatch({...batch,entities:[{...entity,legalName:"changed"}]}),/batch_conflict/);
    await assert.rejects(()=>repo.commitBatch({...batch,fileHash:"b".repeat(64),batchIndex:1,rowOffset:2}),/source_changed/);
    const establishments = (await repo.getImport(status.id))!.files.find(f=>f.resourceId.endsWith("estabelecimentos"))!;
    const establishment = {cnpj:"12ABC34501DE35",baseCnpj:"12ABC345",tradeName:null,mainCnae:"0111301",secondaryCnaes:["0111302"],cityCode:"7107",uf:"SP",district:"Centro",openingDate:"2020-01-01",status:"02",matrixBranch:"matrix" as const,contacts:[{channel:"phone" as const,originalValue:"11999999999",normalizedValue:null,validationState:"unknown" as const}]};
    await assert.rejects(()=>repo.commitBatch({...batch,fileId:establishments.id,entities:[],establishments:[{...establishment,baseCnpj:"MISSING0"}]}));
    assert.equal(await fixture.client.companyImportCheckpoint.count({where:{fileId:establishments.id}}),0); assert.equal(await fixture.client.companyEstablishment.count(),0);
    assert.deepEqual(await repo.commitBatch({...batch,fileId:establishments.id,entities:[],establishments:[establishment]}),{committed:1,replay:false});
    assert.equal(await fixture.client.companyPublicContact.count(),1); assert.equal(await fixture.client.establishmentSecondaryCnae.count(),1);
    const next = await repo.saveManifest(fixtureManifest("2026-12"));
    await assert.rejects(()=>repo.commitBatch({...batch,snapshotId:next.snapshotId}),/file_snapshot_mismatch/);
    assert.equal((await repo.getImport(status.id))!.committedCount,2); assert.equal((await repo.getImport(next.id))!.committedCount,0);
    assert.equal(await fixture.client.sourceDomain.count(),0);
    const domains = status.files.find(f=>f.resourceId.endsWith("cnaes"))!;
    await repo.commitBatch({...batch,fileId:domains.id,entities:[],domains:[{kind:"cnaes",code:"0111301",label:"Cultivo de arroz"}]});
    assert.deepEqual(await fixture.client.sourceDomain.findMany({select:{kind:true,code:true,label:true}}),[{kind:"cnaes",code:"0111301",label:"Cultivo de arroz"}]);
    const simples = status.files.find(f=>f.resourceId.endsWith("simples"))!;
    await repo.commitBatch({...batch,fileId:simples.id,entities:[],taxes:[{baseCnpj:"12ABC345",simples:false,mei:null}]});
    assert.deepEqual(await fixture.client.companyEntity.findUnique({where:{snapshotId_baseCnpj:{snapshotId:status.snapshotId,baseCnpj:"12ABC345"}},select:{simples:true,mei:true}}),{simples:false,mei:null});
    await assert.rejects(()=>repo.commitBatch({...batch,fileId:establishments.id,batchIndex:1,rowOffset:2,entities:[{...entity,baseCnpj:"00000000"}],establishments:[{...establishment,cnpj:"11222333000181",baseCnpj:"11222333"}]}));
    assert.equal(await fixture.client.companyEntity.count({where:{baseCnpj:"00000000"}}),0);
    assert.equal(await fixture.client.companyImportCheckpoint.count({where:{fileId:establishments.id}}),1);
  } finally { await fixture.close(); }
});
