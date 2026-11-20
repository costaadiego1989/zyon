import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectingFixture } from "../../../../tests/prospecting-fixture.js";
import { createCompanyDirectoryFixture,seedSearchDirectory } from "../../../../tests/company-directory-fixture.js";
import { PrismaDirectoryRepository } from "../infrastructure/company-directory/prisma-directory.repository.js";
import { SearchCompaniesQuery } from "../application/company-directory/search-companies.query.js";
import { PROSPECTING_PORTS } from "../domain/prospecting.ports.js";
import { CompanyDirectoryController } from "./company-directory.controller.js";

test("PROS-06 AC4 guards every directory route and rejects invalid searches before a database search",async()=>{
  const f=await createCompanyDirectoryFixture();let reads=0;
  class ObservedRepository extends PrismaDirectoryRepository{override readPage(...args:Parameters<PrismaDirectoryRepository["readPage"]>){reads++;return super.readPage(...args);}}
  const repo=new ObservedRepository(f.client,"c".repeat(64));await seedSearchDirectory(f);
  const http=await createProspectingFixture({controllers:[CompanyDirectoryController],providers:[{provide:PROSPECTING_PORTS.directory,useValue:repo},{provide:SearchCompaniesQuery,useValue:new SearchCompaniesQuery(repo,"c".repeat(64))}]});
  const url=http.url+"/v1/platform/prospecting/companies";const headers={Authorization:`Bearer ${http.operators.admin.token}`};
  try{
    for(const path of ["","/00000000000191","/domains?kind=cnaes"]){
      assert.equal((await fetch(url+path)).status,401);assert.equal((await fetch(url+path,{headers:{Authorization:"Bearer merchant-token"}})).status,401);assert.equal((await fetch(url+path,{headers:{Authorization:`Bearer ${http.operators.billing.token}`}})).status,403);
    }assert.equal(reads,0);
    for(const query of ["limit=101","limit=0","limit=abc","limit=1&limit=2","filters=oops",`filters=${encodeURIComponent(JSON.stringify({search:"x".repeat(201)}))}`,`filters=${encodeURIComponent(JSON.stringify({mei:"false"}))}`,`filters=${encodeURIComponent(JSON.stringify({ufs:["XX"]}))}`,`filters=${encodeURIComponent(JSON.stringify({unknown:1}))}`,"cursor=broken"]){assert.equal((await fetch(url+"?"+query,{headers})).status,400,query);}assert.equal(reads,0);
    const response=await fetch(url+"?filters="+encodeURIComponent(JSON.stringify({ufs:["SP"]}))+"&limit=1",{headers});assert.equal(response.status,200);const result=await response.json();assert.equal(result.count,2);assert.equal(result.snapshotId,"search-old");assert.equal(result.items[0].cnpj,"00000000000191");assert.ok(result.nextCursor);
    const detail=await fetch(url+"/12ABC34501DE35",{headers});assert.equal(detail.status,200);assert.equal((await detail.json()).contacts[0].validationState,"unknown");assert.equal((await fetch(url+"/11222333000180",{headers})).status,400);
    await f.client.companyEstablishment.delete({where:{snapshotId_cnpj:{snapshotId:"search-old",cnpj:"11222333000181"}}});assert.equal((await fetch(url+"/11222333000181",{headers})).status,404);
    const domains=await fetch(url+"/domains?kind=cnaes&limit=1",{headers});assert.equal(domains.status,200);const page=await domains.json();assert.deepEqual(page.items,[{kind:"cnaes",code:"0111301",label:"Cultivo de arroz"}]);assert.equal(page.nextCursor,"0111301");assert.equal(page.snapshotId,"search-old");
    assert.equal((await fetch(url+"/domains?kind=unknown",{headers})).status,400);assert.equal((await fetch(url+"/domains?kind=cnaes&limit=101",{headers})).status,400);
    await http.operatorJwt.revoke(http.operators.admin.token);for(const path of ["","/00000000000191","/domains?kind=cnaes"])assert.equal((await fetch(url+path,{headers})).status,401);
  }finally{await http.close();await f.close();}
});
