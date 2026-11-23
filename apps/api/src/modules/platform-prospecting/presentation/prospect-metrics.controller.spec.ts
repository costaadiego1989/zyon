import {test} from "node:test";
import assert from "node:assert/strict";
import {createConversationFixture} from "../../../../tests/prospect-conversation-fixture.js";
import {createProspectingFixture} from "../../../../tests/prospecting-fixture.js";
import {ProspectMetricsQueryService} from "../application/crm/prospect-metrics.query.js";
import {ProspectOperationalStatus, ProspectMetricsController} from "./prospect-metrics.controller.js";
import {PlatformSalesOffers} from "../../payment/public-platform-sales-offers.js";

test("REC-03 protected readiness exposes safe failed progress and regional coverage while removing private metadata",async()=>{
 const f=await createConversationFixture();
 let published=false;
 const source=async()=>({snapshotId:published?"regional":null,competence:published?"2026-11":null,state:published?"published":"unavailable",secret:"SECRET",
  coverage:published?{kind:"regional_retail",ufs:["SP","RJ","MG","ES","PR","SC","RS"],mainCnaes:["4781400"],companyCount:1234,maximumDirectoryBytes:25_000_000_000,scopeComplete:true,secret:"SECRET"}:undefined,
  latestImport:{id:"regional",state:published?"published":"failed",phase:published?"completed":"failed",committedCount:57018146,selectedCompanies:1234,validatedFiles:6,totalFiles:23,errorCode:published?null:"production_directory_storage_limit",updatedAt:"2026-11-23T05:57:06.812Z",leaseToken:"SECRET"}});
 const status=new ProspectOperationalStatus({source,knowledge:async()=>({activePublications:0}),channel:async()=>({status:"unknown",blockers:[],binding:null,updatedAt:new Date().toISOString()}),runtime:()=>({moduleEnabled:true,workersRunning:false,dispatchMode:"disabled",modelMode:"disabled",ingestionEnabled:true})},new PlatformSalesOffers("https://dashboard.example.test","https://site.example.test"));
 const http=await createProspectingFixture({controllers:[ProspectMetricsController],providers:[{provide:ProspectOperationalStatus,useValue:status},{provide:ProspectMetricsQueryService,useValue:new ProspectMetricsQueryService(f.prisma)}]});
 try{
  const read=()=>fetch(http.url+"/v1/platform/prospecting/readiness",{headers:{Authorization:"Bearer "+http.operators.admin.token}});
  const failed=await(await read()).json();assert.equal(failed.source.status,"unavailable");assert.equal(failed.source.value.snapshotId,null);
  assert.deepEqual(failed.source.value.latestImport,{id:"regional",state:"failed",phase:"failed",committedCount:57018146,selectedCompanies:1234,validatedFiles:6,totalFiles:23,errorCode:"production_directory_storage_limit",updatedAt:"2026-11-23T05:57:06.812Z"});
  assert.equal(JSON.stringify(failed).includes("SECRET"),false);
  published=true;const ready=await(await read()).json();assert.equal(ready.source.status,"current");assert.equal(ready.source.value.snapshotId,"regional");
  assert.deepEqual(ready.source.value.coverage,{kind:"regional_retail",ufs:["SP","RJ","MG","ES","PR","SC","RS"],mainCnaes:["4781400"],companyCount:1234,maximumDirectoryBytes:25_000_000_000,scopeComplete:true});assert.equal(JSON.stringify(ready).includes("SECRET"),false);
 }finally{await http.close();await f.close();}
});

test("PROS-23 AC3 guarded metrics expose cost gaps and preserve the last successful source observation",async()=>{
 const f=await createConversationFixture();
 let fail=false;
 const source=async()=>{if(fail)throw Error("SECRET");return {snapshotId:await f.directory.activeSnapshotId(),competence:"2026-10",state:"published",secret:"SECRET"};};
 const status=new ProspectOperationalStatus({source,knowledge:async()=>({activePublications:0}),channel:async()=>({status:"unknown",blockers:["sender_unavailable"],binding:null,updatedAt:new Date().toISOString()}),
   runtime:()=>({moduleEnabled:true,workersRunning:false,dispatchMode:"controlled",modelMode:"disabled",ingestionEnabled:false,secret:"SECRET"})},
   new PlatformSalesOffers("https://dashboard.example.test","https://website.example.test/"));
 const http=await createProspectingFixture({controllers:[ProspectMetricsController],providers:[{provide:ProspectOperationalStatus,useValue:status},{provide:ProspectMetricsQueryService,useValue:new ProspectMetricsQueryService(f.prisma)}]});
 try{
  const req=(path:string,token=http.operators.admin.token)=>fetch(http.url+"/v1/platform/prospecting/"+path,{headers:{Authorization:"Bearer "+token}});
  const period="metrics?from=2020-01-01T00:00:00Z&to=2099-01-01T00:00:00Z";
  for(const path of [period,period.replace("metrics?","metrics/records?metric=leads&"),"readiness","config","offers"]){assert.equal((await req(path,"")).status,401);assert.equal((await req(path,http.operators.billing.token)).status,403);}
  const records=await(await req(period.replace("metrics?","metrics/records?metric=leads&"))).json();
  assert.deepEqual(records.items.map((r:{cnpj:string})=>r.cnpj),[f.lead.cnpj]);
  assert.equal((await req(period.replace("metrics?","metrics/records?metric=other&"))).status,400);
  const m=await(await req(period)).json();assert.equal(m.leads,1);assert.deepEqual(m.costs.totals,[]);assert.equal(m.costs.coverage,"unknown");assert.deepEqual(m.costs.missing,["final_provider_charges"]);
  assert.equal((await req("metrics?from=x&to=y")).status,400);assert.equal((await req(period+"&campaignId=absent")).status,404);
  for(const path of ["readiness","config","offers"])assert.equal((await req(path+"?token=x")).status,400);
  const ready=await(await req("readiness")).json();assert.equal(ready.source.value.snapshotId,"search-old");assert.equal(ready.channel.value.status,"unknown");assert.deepEqual(ready.channel.value.blockers,["sender_unavailable"]);
  assert.equal(ready.knowledge.value.activePublications,0);assert.equal(ready.runtime.workersRunning,false);assert.equal(JSON.stringify(ready).includes("SECRET"),false);
  fail=true;const stale=await(await req("readiness")).json();assert.equal(stale.source.status,"stale");assert.deepEqual(stale.source.value,ready.source.value);assert.equal(stale.source.observedAt,ready.source.observedAt);
  const config=await(await req("config")).json();assert.equal(config.dispatchMode,"controlled");assert.equal(config.reservationDayTimezone,"UTC");assert.equal(JSON.stringify(config).includes("SECRET"),false);
  const offers=await(await req("offers")).json();assert.equal(offers.siteUrl,"https://website.example.test/");assert.equal(offers.items.find((o:{planKey:string})=>o.planKey==="growth").canonicalUrl,"https://dashboard.example.test/?mode=signup&plan=growth");
 }finally{await http.close();await f.close();}
});
