import assert from "node:assert/strict";
import {PrismaClient} from "@prisma/client";
import {setTimeout as delay} from "node:timers/promises";
import {PrismaSalesKnowledgeRepository} from "./prisma-sales-knowledge.repository.js";
import { test } from "node:test";
import { createSalesKnowledgeFixture, knowledgeDraft, actor } from "../../../../../tests/prospect-knowledge-fixture.js";
import { Neo4jSalesKnowledgeAdapter, SalesPublicationService } from "./neo4j-sales-knowledge.adapter.js";

test("PROS-19 AC2 competing independent publication sessions project one immutable version exactly once while the prior publication stays readable",async()=>{
 const f=await createSalesKnowledgeFixture(),other=new PrismaClient({datasources:{db:{url:f.databaseUrl}}});
 let release!:()=>void;
 const held=new Promise<void>(r=>{release=r;});
 try{
  const prior=await f.repo.save("product",knowledgeDraft("prior"),actor);
  await f.service.publish("product",{expectedVersion:1,clientRequestId:"first",contentHash:prior.contentHash},actor);
  const next=await f.repo.save("product",{...knowledgeDraft("next"),expectedVersion:1},actor);
  const graph=new Neo4jSalesKnowledgeAdapter(f.driver,f.namespace);
  let entered=0,signal!:()=>void;
  const start=new Promise<void>(r=>{signal=r;});
  const projector={async project(draft:typeof next){entered++;signal();await held;return graph.project(draft);}};
  const one=new SalesPublicationService(f.repo,projector);
  const two=new SalesPublicationService(new PrismaSalesKnowledgeRepository(other),projector);
  const command={expectedVersion:2,clientRequestId:"review-a",contentHash:next.contentHash};
  const a=one.publish("product",command,actor);await start;
  const b=two.publish("product",{...command,clientRequestId:"review-b"},actor);
  const both=Promise.allSettled([a,b]);
  let waiting=false;
  try {
   for(let tries=0;tries<150&&!waiting&&entered<2;tries++){
    const result=await f.pg.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND wait_event='advisory') AS waiting");
    waiting=result.rows[0].waiting;if(!waiting)await delay(20);
   }
   assert.equal((await f.repo.active(new Date()))[0].version,1);
  }finally{release();}
  const outcomes=await both;
  assert.equal(waiting,true,"the independent client was blocked in PostgreSQL");
  assert.equal(entered,1,"the second request never entered Neo4j projection");
  assert.deepEqual(outcomes.map(r=>r.status),["fulfilled","rejected"]);
  assert.equal((await f.repo.active(new Date()))[0].version,2);
  const session=f.driver.session();
  try {const result=await session.run("MATCH (p:ZyonSalesPublication {namespace:$ns,id:$id})-[:CONTAINS]->(f:ZyonSalesFact) RETURN count(p) AS n",{ns:f.namespace,id:next.draft[0].publicationId});
   assert.equal(Number(result.records[0].get("n")),1);}finally{await session.close();}
 }finally{release();await other.$disconnect();await f.close();}
});
test("PROS-19 AC2 verifies actual projection content before CAS and preserves the active graph on failure or superseding draft", async () => {
  const f=await createSalesKnowledgeFixture();
  try {
    const one=await f.repo.save("product",knowledgeDraft("one"),actor);
    const command={expectedVersion:1,contentHash:one.contentHash,clientRequestId:"publish-1"};
    const published=await f.service.publish("product",command,actor);
    assert.equal(published.state,"published");
    assert.deepEqual(await f.service.publish("product",command,actor),published);
    const id=one.draft[0].publicationId;
    assert.deepEqual(await f.repo.active(new Date()),[{sourceId:"product",publicationId:id,version:1}]);
    const session=f.driver.session();
    try {
      const r=await session.run("MATCH (:ZyonSalesPublication {namespace:$ns,id:$id})-[:CONTAINS]->(f:ZyonSalesFact) RETURN f.value AS v",{ns:f.namespace,id});
      assert.deepEqual(r.records.map(rec=>rec.get("v")),["Published one"]);
    } finally {await session.close();}
    const two=await f.repo.save("product",{...knowledgeDraft("two"),expectedVersion:1},actor);
    const next={expectedVersion:2,contentHash:two.contentHash,clientRequestId:"publish-2"};
    // A foreign extra fact makes count/hash verification fail inside the real Neo4j write transaction.
    const bad=f.driver.session();
    try {
      await bad.run("CREATE (p:ZyonSalesPublication {namespace:$ns,id:$id})-[:CONTAINS]->(:ZyonSalesFact {namespace:$ns,id:'extra'})",{ns:f.namespace,id:two.draft[0].publicationId});
    } finally {await bad.close();}
    await assert.rejects(f.service.publish("product",next,actor),/projection_/);
    assert.equal((await f.repo.active(new Date()))[0].publicationId,id);
    assert.equal((await f.repo.find("product"))?.state,"failed");
    const graph=new Neo4jSalesKnowledgeAdapter(f.driver,f.namespace);
    const three=await f.repo.save("product",{...knowledgeDraft("three"),expectedVersion:2},actor);
    const concurrent=new SalesPublicationService(f.repo,{async project(draft){
      const projection=await graph.project(draft);
      await f.repo.save("product",{...knowledgeDraft("four"),expectedVersion:3},actor);
      return projection;
    }},()=>new Date());
    await assert.rejects(concurrent.publish("product",{expectedVersion:3,contentHash:three.contentHash,clientRequestId:"race"},actor),/version_conflict/);
    assert.equal((await f.repo.active(new Date()))[0].publicationId,id);
    const db=await f.prisma.salesKnowledgePublication.findUniqueOrThrow({where:{id}});
    assert.equal(db.projectedHash,one.contentHash); assert.equal(db.projectedCount,1);
  } finally {await f.close();}
});
