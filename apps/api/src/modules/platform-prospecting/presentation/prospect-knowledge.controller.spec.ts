import assert from "node:assert/strict";
import { test } from "node:test";
import {createProspectingFixture} from "../../../../tests/prospecting-fixture.js";
import {createSalesKnowledgeFixture,knowledgeDraft} from "../../../../tests/prospect-knowledge-fixture.js";
import {Neo4jSalesKnowledgeReader} from "../infrastructure/knowledge/neo4j-sales-knowledge.reader.js";
import {QuerySalesKnowledge} from "../application/knowledge/query-sales-knowledge.js";
import {ProspectKnowledgeController,KNOWLEDGE_ADMIN} from "./prospect-knowledge.controller.js";

test("PROS-19 AC3 guarded HTTP publication and withdrawal record origin, author, validity and version with replay",async()=>{
  const f=await createSalesKnowledgeFixture();
  const query=new QuerySalesKnowledge(f.repo,new Neo4jSalesKnowledgeReader(f.driver,1000,f.namespace));
  const http=await createProspectingFixture({controllers:[ProspectKnowledgeController],providers:[{provide:KNOWLEDGE_ADMIN,useValue:{sources:f.repo,publications:f.service,query}}]});
  try {
    const admin=http.operators.admin;
    await f.pg.query("INSERT INTO platform_operators VALUES ($1)",[admin.id]);
    const req=(path:string,method:string,body?:unknown,token=admin.token)=>fetch(http.url+"/v1/platform/prospecting/knowledge"+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
    for(const [p,m] of [["","GET"],["","POST"],["/handbook","GET"],["/handbook/publish-or-withdraw","POST"],["/query","POST"]]){
      assert.equal((await req(p,m,undefined,"")).status,401);assert.equal((await req(p,m,undefined,http.operators.support.token)).status,403);
    }
    assert.equal((await req("/absent","GET")).status,404);
    const draft={...knowledgeDraft("http"),sourceId:"handbook"};
    const created=await req("","POST",draft);assert.equal(created.status,201);const d=await created.json();
    const question={operation:"explain_feature",params:{feature:"Chat"}};
    assert.equal((await (await req("/query","POST",question)).json()).handoff,true);
    const command={action:"publish",expectedVersion:1,contentHash:d.contentHash,clientRequestId:"http-pub"};
    assert.equal((await req("/handbook/publish-or-withdraw","POST",{...command,contentHash:"0".repeat(64)})).status,409);
    const result=await req("/handbook/publish-or-withdraw","POST",command);assert.equal(result.status,200);const published=await result.json();
    assert.equal(published.publishedBy,admin.id);assert.deepEqual(await (await req("/handbook/publish-or-withdraw","POST",command)).json(),published);
    const answer=await (await req("/query","POST",question)).json();assert.equal(answer.answer,"Published http");assert.equal(answer.callMode,"controlled");
    assert.deepEqual(answer.sources,[{id:"handbook",publicationId:published.activePublicationId,version:1}]);
    assert.equal((await req("/query","POST",{...question,paid:true})).status,400);
    const edit={...knowledgeDraft("future"),sourceId:"handbook",expectedVersion:1};
    assert.equal((await req("","POST",edit)).status,201);
    assert.equal((await (await req("","GET")).json()).items[0].version,2);
    const edited=await f.repo.find("handbook");
    const graph=f.driver.session();
    try {await graph.run("CREATE (:ZyonSalesPublication {namespace:$ns,id:$id})-[:CONTAINS]->(:ZyonSalesFact {namespace:$ns,id:'extra'})",{ns:f.namespace,id:edited!.draft[0].publicationId});}
    finally {await graph.close();}
    const failed=await req("/handbook/publish-or-withdraw","POST",{...command,expectedVersion:2,contentHash:edited!.contentHash,clientRequestId:"publish-failed"});
    assert.equal(failed.status,503);
    assert.equal((await (await req("/handbook","GET")).json()).state,"failed");
    assert.equal((await (await req("/query","POST",question)).json()).answer,"Published http");
    const withdraw={...command,action:"withdraw",clientRequestId:"withdraw"};
    assert.equal((await req("/handbook/publish-or-withdraw","POST",withdraw)).status,200);
    assert.equal((await (await req("/query","POST",question)).json()).handoff,true);
    assert.equal((await (await req("/handbook","GET")).json()).activePublicationId,null);
    const audit=await f.prisma.prospectAuditEvent.findMany({where:{action:{in:["knowledge.publish","knowledge.withdraw"]}},orderBy:{occurredAt:"asc"}});
    assert.deepEqual(audit.map(a=>[a.action,a.actorOperatorId,a.resourceVersion,a.details]),["knowledge.publish","knowledge.withdraw"].map(action=>[action,admin.id,1,{publicationId:published.activePublicationId,sourceRef:draft.sourceRef,validFrom:draft.validFrom,validUntil:null}]));
  } finally {await http.close();await f.close();}
});
