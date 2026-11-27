import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompanyDirectoryFixture, fixtureManifest, fixtureSourceRows, companyDirectoryZip, directoryArchiveLimits } from "../../../../../tests/company-directory-fixture.js";
import { PrismaDirectoryRepository } from "../../infrastructure/company-directory/prisma-directory.repository.js";
import { CnpjArchiveReader } from "../../infrastructure/company-directory/cnpj-archive-reader.js";
import { ImportCompanySnapshotWorker } from "./import-company-snapshot.worker.js";
import type { DirectoryArchivePort } from "../../domain/prospecting.ports.js";

const source = (extraInvalid=false)=>new CnpjArchiveReader({openResource:async url=>{
  const family=/Empresas/.test(url)?"empresas":/Estabelecimentos/.test(url)?"estabelecimentos":/Simples/.test(url)?"simples":/Cnaes/.test(url)?"cnaes":/Municipios/.test(url)?"municipios":"naturezas";
  let rows=fixtureSourceRows(family);if(extraInvalid&&family==="estabelecimentos")rows+="\n"+rows.replace('"35"','"34"');
  return new Response(companyDirectoryZip(Buffer.from(rows)));
}},directoryArchiveLimits);
test("PROS-05 AC2 interruption keeps the active snapshot and resumes committed batches without duplication", async()=>{
  const f=await createCompanyDirectoryFixture();const repo=new PrismaDirectoryRepository(f.client);
  try{
    const old=await repo.saveManifest(fixtureManifest("2026-10"));await new ImportCompanySnapshotWorker(repo,source(),{ingestionEnabled:true,importBatchSize:1}).run(old.id);
    const next=await repo.saveManifest(fixtureManifest());let interrupted=false;const archives=source();
    const interruptedSource:DirectoryArchivePort={async prepare(resource){const archive=await archives.prepare(resource);return {...archive,async *rows(){for await(const row of archive.rows()){yield row;if(!interrupted&&resource.family==="estabelecimentos"){interrupted=true;throw new Error("controlled_interruption");}}}};}};
    await assert.rejects(()=>new ImportCompanySnapshotWorker(repo,interruptedSource,{ingestionEnabled:true,importBatchSize:1}).run(next.id),/controlled_interruption/);
    assert.equal((await repo.getImport(next.id))!.activeSnapshotId,old.snapshotId);assert.equal((await repo.getImport(next.id))!.state,"failed");
    const resumed=await new ImportCompanySnapshotWorker(repo,source(),{ingestionEnabled:true,importBatchSize:1}).run(next.id);
    assert.equal(resumed.activeSnapshotId,next.snapshotId);assert.equal(resumed.state,"published");
    assert.equal(await f.client.companyEstablishment.count({where:{snapshotId:next.snapshotId}}),1);
    assert.equal(await f.client.companyImportCheckpoint.count({where:{file:{snapshotId:next.snapshotId}}}),24);
  }finally{await f.close();}
});
test("PROS-05 AC3 publishes only all validated mandatory shards with atomic compare-and-swap",async()=>{
  const f=await createCompanyDirectoryFixture();const repo=new PrismaDirectoryRepository(f.client);
  try{
    const partial=fixtureManifest();partial.resources=partial.resources.filter(r=>!r.url.endsWith("Estabelecimentos9.zip"));const job=await repo.saveManifest(partial);
    await assert.rejects(()=>new ImportCompanySnapshotWorker(repo,source(),{ingestionEnabled:true,importBatchSize:1}).run(job.id),/manifest_incomplete/);
    assert.equal(await f.client.companyDirectoryActiveSnapshot.count(),0);assert.equal(await f.client.companyImportCheckpoint.count(),0);
    const valid=await repo.saveManifest(fixtureManifest("2026-12"));const result=await new ImportCompanySnapshotWorker(repo,source(),{ingestionEnabled:true,importBatchSize:1}).run(valid.id);
    assert.equal(result.activeSnapshotId,valid.snapshotId);assert.equal(result.files.filter(file=>file.state==="validated").length,24);
    assert.equal((await f.client.companySnapshot.findUniqueOrThrow({where:{id:valid.snapshotId}})).state,"published");
    await assert.rejects(()=>repo.publish(job.snapshotId,null),/snapshot_not_ready|manifest_incomplete/);
    assert.equal((await repo.getImport(valid.id))!.activeSnapshotId,valid.snapshotId);
  }finally{await f.close();}
});
test("PROS-05 AC4 source replacement preserves prospect owner, conversation, suppression and commercial facts",async()=>{
  const f=await createCompanyDirectoryFixture();const repo=new PrismaDirectoryRepository(f.client);
  try{
    const old=await repo.saveManifest(fixtureManifest("2026-10"));await new ImportCompanySnapshotWorker(repo,source(),{ingestionEnabled:true,importBatchSize:1}).run(old.id);
    await f.pg.query("INSERT INTO platform_operators VALUES ('operator')");
    await f.pg.query(`INSERT INTO platform_prospects(id,cnpj,source_snapshot_id,assigned_operator_id,tags,stage,last_reply_preview) VALUES ('prospect','12ABC34501DE35',$1,'operator',ARRAY['kept'],'responded','real reply')`,[old.snapshotId]);
    await f.pg.query(`INSERT INTO platform_prospect_sender_bindings(id,app_id,waba_id,phone_number_id,display_phone_number,encrypted_credentials,granted_assets,connected_by) VALUES ('sender','app','waba','phone','synthetic','ciphertext','{}','operator');INSERT INTO prospect_endpoints(id,channel,normalized_value,protected_lookup,sender_binding_id) VALUES ('endpoint','whatsapp','synthetic','hmac','sender');INSERT INTO prospect_conversations(id,endpoint_id,prospect_id) VALUES ('conversation','endpoint','prospect');INSERT INTO prospect_messages(id,conversation_id,sender_binding_id,sequence,author_type,direction,content,state) VALUES ('message','conversation','sender',1,'prospect','inbound','kept message','received');INSERT INTO contact_suppressions(id,sender_scope,protected_lookup,key_version,reason) VALUES ('suppression','zyon_platform','hmac',1,'opt_out')`);
    const before=(await f.pg.query("SELECT row_to_json(p) AS value FROM platform_prospects p")).rows;
    const next=await repo.saveManifest(fixtureManifest());await new ImportCompanySnapshotWorker(repo,source(),{ingestionEnabled:true,importBatchSize:1}).run(next.id);
    assert.deepEqual((await f.pg.query("SELECT row_to_json(p) AS value FROM platform_prospects p")).rows,before);
    assert.deepEqual((await f.pg.query("SELECT content,state FROM prospect_messages")).rows,[{content:"kept message",state:"received"}]);
    assert.deepEqual((await f.pg.query("SELECT protected_lookup,reason FROM contact_suppressions")).rows,[{protected_lookup:"hmac",reason:"opt_out"}]);
    assert.equal(await f.client.companyEstablishment.count({where:{snapshotId:old.snapshotId}}),1);
  }finally{await f.close();}
});
test("PROS-04 AC2 invalid DV rows increment rejectedCount without persisting an establishment",async()=>{
  const f=await createCompanyDirectoryFixture();const repo=new PrismaDirectoryRepository(f.client);
  try{const job=await repo.saveManifest(fixtureManifest());const status=await new ImportCompanySnapshotWorker(repo,source(true),{ingestionEnabled:true,importBatchSize:2}).run(job.id);
    assert.equal(status.rejectedCount,10);assert.equal(await f.client.companyEstablishment.count(),1);assert.equal(await f.client.companyEstablishment.count({where:{cnpj:"12ABC34501DE34"}}),0);
    assert.equal((await f.client.companySourceFile.aggregate({_sum:{rejectedCount:true}}))._sum.rejectedCount,10n);
    assert.deepEqual(((await f.client.companySnapshot.findUniqueOrThrow({where:{id:job.id}})).counts as {rejectedReasons:unknown}).rejectedReasons,{invalid_cnpj:10});
  }finally{await f.close();}
});
test("PROS-04 AC3 corrupt ZIP leaves failed import unpublished even after committed rows",async()=>{
  const f=await createCompanyDirectoryFixture();const repo=new PrismaDirectoryRepository(f.client);
  try{
    const job=await repo.saveManifest(fixtureManifest());
    const reader=new CnpjArchiveReader({openResource:async()=>{const zip=companyDirectoryZip(Buffer.from(fixtureSourceRows("empresas")+"\n"));zip[38+20]^=1;return new Response(zip);}},directoryArchiveLimits);
    await assert.rejects(()=>new ImportCompanySnapshotWorker(repo,reader,{ingestionEnabled:true,importBatchSize:1}).run(job.id),/archive_corrupt/);
    const status=(await repo.getImport(job.id))!;assert.equal(status.state,"failed");assert.equal(status.activeSnapshotId,null);assert.match(status.errorCode!,/archive_corrupt/);
  }finally{await f.close();}
});
test("PROS-05 AC3 competing complete imports cannot replace an active pointer changed after their claim",async()=>{
  const f=await createCompanyDirectoryFixture();const repo=new PrismaDirectoryRepository(f.client);let release!:()=>void;
  try{
    const a=await repo.saveManifest(fixtureManifest("2026-10"));const b=await repo.saveManifest(fixtureManifest());
    let reached!:()=>void;const started=new Promise<void>(resolve=>{reached=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});let paused=false;const reader=source();
    const delayed:DirectoryArchivePort={async prepare(resource){if(!paused){paused=true;reached();await gate;}return reader.prepare(resource);}};
    const running=new ImportCompanySnapshotWorker(repo,delayed,{ingestionEnabled:true,importBatchSize:1}).run(a.id);const outcome=running.then(()=>null,error=>error as Error);
    await started;const published=await new ImportCompanySnapshotWorker(repo,source(),{ingestionEnabled:true,importBatchSize:1}).run(b.id);assert.equal(published.activeSnapshotId,b.id);release();
    assert.match((await outcome)!.message,/active_snapshot_conflict/);assert.equal((await repo.getImport(a.id))!.activeSnapshotId,b.id);
    assert.equal((await repo.getImport(a.id))!.state,"failed");assert.equal((await repo.getImport(b.id))!.state,"published");
  }finally{release?.();await f.close();}
});

test("PROS-04 AC2 CP1252 import records the rejected identity without creating the expanded establishment", async () => {
  const f = await createCompanyDirectoryFixture();
  try {
    const repo = new PrismaDirectoryRepository(f.client);
    const manifest = fixtureManifest();
    const reader = new CnpjArchiveReader({ async openResource(url) {
      const resource = manifest.resources.find(resource => resource.url === url)!;
      let rows = fixtureSourceRows(resource.family);
      if (url.endsWith("/Estabelecimentos0.zip")) rows += "\n" + ["00ABß27","0003","45",...Array(27).fill("")].join(";");
      return new Response(companyDirectoryZip(Buffer.from(rows,"latin1")));
    }}, directoryArchiveLimits);
    const job = await repo.saveManifest(manifest);
    const result = await new ImportCompanySnapshotWorker(repo, reader, {ingestionEnabled:true,importBatchSize:2}).run(job.id);
    assert.equal(result.state, "published");
    assert.equal(result.rejectedCount, 1);
    const snapshot = await f.client.companySnapshot.findUniqueOrThrow({where:{id:job.snapshotId}});
    assert.deepEqual((snapshot.counts as {rejectedReasons:unknown}).rejectedReasons, {invalid_cnpj:1});
    const rejectedFile = await f.client.companySourceFile.findFirstOrThrow({where:{snapshotId:job.snapshotId,rejectedCount:1n}});
    assert.equal(rejectedFile.family, "estabelecimentos");
    assert.equal(await f.client.companyEstablishment.count({where:{snapshotId:job.snapshotId,cnpj:"00ABSS27000345"}}),0);
    assert.equal(await f.client.companyEstablishment.count({where:{snapshotId:job.snapshotId,cnpj:"12ABC34501DE35"}}),1);
  } finally { await f.close(); }
});
