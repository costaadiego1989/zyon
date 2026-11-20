import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompanyDirectoryFixture, seedSearchDirectory } from "../../../../../tests/company-directory-fixture.js";
import { PrismaDirectoryRepository } from "../../infrastructure/company-directory/prisma-directory.repository.js";
import { SearchCompaniesQuery } from "./search-companies.query.js";
const key="c".repeat(64);
test("PROS-06 AC1 combines every national and commercial dimension using AND and OR within a dimension",async()=>{
  const f=await createCompanyDirectoryFixture();const repo=new PrismaDirectoryRepository(f.client,key);const query=new SearchCompaniesQuery(repo,key);
  try{await seedSearchDirectory(f);const filters={mainCnaes:["0111302","0111301"],secondaryCnaes:["0111302"],ufs:["RJ","SP"],cityCodes:["7107"],districts:["cêntro"],sizes:["01"],legalNatures:["2062"],capitalMinCents:"10000",capitalMaxCents:"10020",statuses:["02"],matrixBranches:["matrix" as const],openedFrom:"2019-01-01",openedTo:"2020-12-31",simples:true,mei:false,stages:["responded" as const]};
    const result=await query.execute({filters});assert.deepEqual(result.items.map(r=>r.cnpj),["00000000000191"]);assert.equal(result.count,1);assert.equal(result.items[0].stage,"responded");assert.equal(result.items[0].capitalCents,"10019");
    for(const dimension of [{secondaryCnaes:["9999999"]},{ufs:["MG"]},{cityCodes:["6001"]},{districts:["Norte"]},{sizes:["05"]},{legalNatures:["2135"]},{capitalMinCents:"10020"},{capitalMaxCents:"10018"},{statuses:["08"]},{matrixBranches:["branch" as const]},{openedFrom:"2020-02-01"},{openedTo:"2019-12-31"},{simples:false},{mei:true},{stages:["new" as const]}]){const empty=await query.execute({filters:{...filters,...dimension}});assert.equal(empty.count,0,JSON.stringify(dimension));assert.deepEqual(empty.items,[]);}
  }finally{await f.close();}
});
test("PROS-06 AC2 pins cursor snapshot, filters and canonical CNPJ ordering across publication",async()=>{
  const f=await createCompanyDirectoryFixture();const query=new SearchCompaniesQuery(new PrismaDirectoryRepository(f.client,key),key);
  try{await seedSearchDirectory(f);const first=await query.execute({filters:{},limit:1});assert.deepEqual(first.items.map(r=>r.cnpj),["00000000000191"]);assert.ok(first.nextCursor);
    await seedSearchDirectory(f,"search-new","2026-11");const second=await query.execute({filters:{},cursor:first.nextCursor!,limit:2});assert.equal(second.snapshotId,"search-old");assert.equal(second.competence,"2026-10");assert.deepEqual(second.items.map(r=>r.cnpj),["11222333000181","12ABC34501DE35"]);assert.equal(second.nextCursor,null);assert.equal(second.count,3);
    await assert.rejects(()=>query.execute({filters:{ufs:["SP"]},cursor:first.nextCursor!}),/invalid_cursor/);await assert.rejects(()=>query.execute({filters:{},cursor:first.nextCursor!.slice(0,-1)+"!"}),/invalid_cursor/);
    assert.equal((await query.execute({filters:{}})).snapshotId,"search-new");
  }finally{await f.close();}
});
test("PROS-06 AC3 count uses the list predicates on the same read snapshot",async()=>{
  const f=await createCompanyDirectoryFixture();const query=new SearchCompaniesQuery(new PrismaDirectoryRepository(f.client,key),key);
  try{await seedSearchDirectory(f);const first=await query.execute({filters:{ufs:["SP"]},limit:1});const second=await query.execute({filters:{ufs:["SP"]},limit:1,cursor:first.nextCursor!});assert.equal(first.count,2);assert.equal(second.count,2);assert.equal(first.countState,"complete");assert.deepEqual([...first.items,...second.items].map(r=>r.cnpj),["00000000000191","12ABC34501DE35"]);assert.notEqual(first.count,3);
  }finally{await f.close();}
});
test("PROS-06 AC5 searches CNPJ, legal/trade names and registered contacts without claiming WhatsApp",async()=>{
  const f=await createCompanyDirectoryFixture();const repo=new PrismaDirectoryRepository(f.client,key);const query=new SearchCompaniesQuery(repo,key);
  try{await seedSearchDirectory(f);
    for(const [filters,expected] of [[{cnpj:"12.ABC.345/01DE-35"},["12ABC34501DE35"]],[{legalName:"maca"},["00000000000191","12ABC34501DE35"]],[{tradeName:"norte"},["11222333000181"]],[{search:"maca"},["00000000000191","12ABC34501DE35"]],[{hasContact:false},["11222333000181"]],[{hasContact:true},["00000000000191","12ABC34501DE35"]]] as const){const result=await query.execute({filters:{...filters}});assert.deepEqual(result.items.map(r=>r.cnpj),expected);for(const r of result.items)for(const c of r.contacts)assert.equal(c.validationState,"unknown");}
    assert.deepEqual((await repo.domains({kind:"cnaes",limit:1})).items,[{kind:"cnaes",code:"0111301",label:"Cultivo de arroz"}]);const domains=await repo.domains({kind:"cnaes",limit:1,afterCode:"0111301"});assert.deepEqual(domains.items,[{kind:"cnaes",code:"0111302",label:"Cultivo de milho"}]);assert.equal(domains.nextCursor,null);
    assert.equal((await repo.find("12ABC34501DE35"))?.competence,"2026-10");assert.equal((await repo.find("12ABC34501DE35"))?.contacts[0].validationState,"unknown");
  }finally{await f.close();}
});
