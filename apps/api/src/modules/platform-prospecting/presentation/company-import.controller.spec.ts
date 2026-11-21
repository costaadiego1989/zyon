import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectingFixture } from "../../../../tests/prospecting-fixture.js";
import { createCompanyDirectoryFixture,fixtureManifest } from "../../../../tests/company-directory-fixture.js";
import { PrismaDirectoryRepository } from "../infrastructure/company-directory/prisma-directory.repository.js";
import { CompanyImportService } from "../application/company-directory/company-import.service.js";
import { CompanyImportController } from "./company-import.controller.js";
test("PROS-03 AC3 returns a durable 202 job with queryable progress and resumes the same files without downloading in HTTP",async()=>{
  const f=await createCompanyDirectoryFixture();const repo=new PrismaDirectoryRepository(f.client);const manifest=fixtureManifest();let metadataReads=0;let unavailable=false;
  const service=new CompanyImportService(repo,{competences:async()=>{if(unavailable)throw new Error("source_unavailable");return ["2026-11"];},discover:async()=>{if(unavailable)throw new Error("source_unavailable");metadataReads++;return manifest;}},{ingestionEnabled:true});
  const http=await createProspectingFixture({controllers:[CompanyImportController],providers:[{provide:CompanyImportService,useValue:service}]});
  await f.pg.query("INSERT INTO platform_operators VALUES ($1)",[http.operators.admin.id]);const url=http.url+"/v1/platform/prospecting/imports";const headers={Authorization:`Bearer ${http.operators.admin.token}`,"Content-Type":"application/json"};const command={clientRequestId:"start-command-1",manifestId:manifest.id,competence:manifest.competence};
  try{
    for(const [path,method]of [["","POST"],["/missing","GET"],["/missing/resume","POST"],["/competences","GET"],["/manifests/2026-11","GET"]]as const){assert.equal((await fetch(url+path,{method,headers:{"Content-Type":"application/json"},...(method==="POST"?{body:"{}"}:{})})).status,401);assert.equal((await fetch(url+path,{method,headers:{Authorization:`Bearer ${http.operators.billing.token}`,"Content-Type":"application/json"},...(method==="POST"?{body:"{}"}:{})})).status,403);}assert.equal(metadataReads,0);
    assert.deepEqual(await (await fetch(url+"/competences",{headers})).json(),["2026-11"]);assert.equal((await(await fetch(url+"/manifests/2026-11",{headers})).json()).id,manifest.id);
    assert.equal((await fetch(url+"/manifests/2026-99",{headers})).status,400);unavailable=true;for(const path of ["/competences","/manifests/2026-11"])assert.equal((await fetch(url+path,{headers})).status,503);unavailable=false;
    const start=await fetch(url,{method:"POST",headers,body:JSON.stringify(command)});assert.equal(start.status,202);const accepted=await start.json();assert.equal(accepted.importJobId,manifest.id);assert.equal(accepted.status.state,"discovered");assert.equal(accepted.status.files.length,24);
    assert.deepEqual(await repo.pendingImports(2),[manifest.id]);assert.equal(await f.client.companyImportCheckpoint.count(),0);assert.equal(await f.client.companyEstablishment.count(),0);
    const metadataBefore=metadataReads;const replay=await fetch(url,{method:"POST",headers,body:JSON.stringify(command)});assert.equal(replay.status,202);assert.equal((await replay.json()).importJobId,manifest.id);assert.equal(metadataReads,metadataBefore);
    const headerReplay=await fetch(url,{method:"POST",headers:{...headers,"Idempotency-Key":command.clientRequestId},body:JSON.stringify({manifestId:command.manifestId,competence:command.competence})});assert.equal(headerReplay.status,202);assert.equal((await headerReplay.json()).importJobId,manifest.id);
    const conflict=await fetch(url,{method:"POST",headers,body:JSON.stringify({...command,competence:"2026-12"})});assert.equal(conflict.status,409);assert.equal(metadataReads,metadataBefore);
    assert.equal((await fetch(url,{method:"POST",headers:{...headers,"Idempotency-Key":"different-key"},body:JSON.stringify(command)})).status,400);
    assert.equal((await fetch(url,{method:"POST",headers,body:JSON.stringify({...command,clientRequestId:"bad-manifest",manifestId:"different"})})).status,409);
    const files=accepted.status.files.map((file:{id:string})=>file.id);await f.client.companySnapshot.update({where:{id:manifest.id},data:{state:"failed",errorCode:"archive_corrupt"}});await f.client.companySourceFile.update({where:{id:files[0]},data:{state:"failed",errorCode:"archive_corrupt"}});
    const progress=await fetch(url+"/"+manifest.id,{headers});assert.equal(progress.status,200);const failed=await progress.json();assert.equal(failed.state,"failed");assert.equal(failed.errorCode,"archive_corrupt");assert.equal(failed.files[0].errorCode,"archive_corrupt");assert.equal(failed.activeSnapshotId,null);
    const resume=await fetch(url+"/"+manifest.id+"/resume",{method:"POST",headers,body:JSON.stringify({clientRequestId:"resume-command-1"})});assert.equal(resume.status,202);const resumed=await resume.json();assert.equal(resumed.importJobId,manifest.id);assert.equal(resumed.status.state,"discovered");assert.deepEqual(resumed.status.files.map((file:{id:string})=>file.id),files);assert.equal(await f.client.companyImportCheckpoint.count(),0);
    assert.equal((await fetch(url+"/"+manifest.id+"/resume",{method:"POST",headers,body:JSON.stringify({clientRequestId:"resume-command-1"})})).status,202);
    assert.equal((await fetch(url+"/missing",{headers})).status,404);assert.equal((await fetch(url+"/missing/resume",{method:"POST",headers,body:JSON.stringify({clientRequestId:"missing-command"})})).status,404);
    for(const body of [{},{...command,clientRequestId:""},{...command,url:"https://attacker.test"},{...command,competence:"2026-99"}])assert.equal((await fetch(url,{method:"POST",headers,body:JSON.stringify(body)})).status,400);
    assert.equal((await f.pg.query("SELECT count(*)::int AS count FROM prospect_commands")).rows[0].count,2);assert.equal((await f.pg.query("SELECT count(*)::int AS count FROM prospect_audit_events")).rows[0].count,2);
    assert.deepEqual(http.ports.meta.calls,[]);assert.deepEqual(http.ports.llm.calls,[]);await http.operatorJwt.revoke(http.operators.admin.token);assert.equal((await fetch(url+"/"+manifest.id,{headers})).status,401);
  }finally{await http.close();await f.close();}
});
test("PROS-03 AC3 disabled ingestion creates no job and concurrent replay keeps one durable command",async()=>{
  const f=await createCompanyDirectoryFixture();const repo=new PrismaDirectoryRepository(f.client);const manifest=fixtureManifest();const source={competences:async()=>["2026-11"],discover:async()=>manifest};const actor={operatorId:"operator",correlationId:"controlled"};const command={clientRequestId:"concurrent-command",manifestId:manifest.id,competence:manifest.competence};
  try{await f.pg.query("INSERT INTO platform_operators VALUES ('operator')");await assert.rejects(()=>new CompanyImportService(repo,source,{ingestionEnabled:false}).start(command,actor),/ingestion_disabled/);assert.equal(await f.client.companySnapshot.count(),0);
    const service=new CompanyImportService(repo,source,{ingestionEnabled:true});const settled=await Promise.allSettled([service.start(command,actor),service.start(command,actor)]);for(const result of settled)if(result.status==="rejected")throw result.reason;
    assert.deepEqual(settled.map(r=>(r as PromiseFulfilledResult<{importJobId:string}>).value.importJobId),[manifest.id,manifest.id]);assert.equal(await f.client.companySnapshot.count(),1);assert.equal((await f.pg.query("SELECT count(*)::int AS count FROM prospect_commands")).rows[0].count,1);assert.equal(await f.client.companySourceFile.count(),24);
  }finally{await f.close();}
});
