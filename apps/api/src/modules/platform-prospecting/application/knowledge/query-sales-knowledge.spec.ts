import assert from "node:assert/strict";
import { test } from "node:test";
import { createSalesKnowledgeFixture,actor,knowledgeDraft } from "../../../../../tests/prospect-knowledge-fixture.js";
import { QuerySalesKnowledge } from "./query-sales-knowledge.js";
import { Neo4jSalesKnowledgeReader } from "../../infrastructure/knowledge/neo4j-sales-knowledge.reader.js";

test("PROS-20 AC1 the four typed operations select their own predicates, bounded to ten facts",async()=>{
  const f=await createSalesKnowledgeFixture();
  try {
    const facts=["feature","plan","faq","integration"].flatMap(predicate=>Array.from({length:12},(_,i)=>({id:predicate+i,predicate,subject:"Chat",value:predicate+" "+i})));
    const d=await f.repo.save("docs",{...knowledgeDraft("many"),facts},actor);
    await f.service.publish("docs",{clientRequestId:"p1",expectedVersion:1,contentHash:d.contentHash},actor);
    const log:unknown[]=[];
    const q=new QuerySalesKnowledge(f.repo,new Neo4jSalesKnowledgeReader(f.driver,1000,f.namespace),event=>log.push(event));
    for(const [operation,params,predicate] of [["explain_feature",{feature:"Chat"},"feature"],["compare_plans",{planKeys:["Chat"]},"plan"],["answer_faq",{question:"Chat"},"faq"],["integration_capability",{integration:"Chat"},"integration"]] as const){
      const results=await q.queryPublishedKnowledge({operation,params:{...params},limit:10},new Date());
      assert.equal(results.length,10);assert.ok(results.every(x=>x.predicate===predicate && x.subject==="Chat"));
    }
    assert.equal(log.length,4);
    assert.deepEqual(log[0],{queryVersion:"sales-read-v1",operation:"explain_feature",count:10,publications:[d.draft[0].publicationId]});
    assert.throws(()=>new Neo4jSalesKnowledgeReader(f.driver,0,f.namespace),/invalid_/);
  } finally {await f.close();}
});
test("PROS-20 AC2 rejects unsupported operations, raw query inputs and merchant resources before any lookup",async()=>{
  let reads=0;
  const q=new QuerySalesKnowledge({async active(){reads++;return [];}},{async read(){reads++;return [];}});
  for(const request of [{operation:"custom",params:{}},{operation:"constructor",params:{}},{operation:"answer_faq",params:{question:"chat",merchantId:"another"}},{operation:"answer_faq",params:{question:"CALL db.labels()"}},{operation:"explain_feature",params:{feature:"Chat"},cypher:"query"},{operation:"compare_plans",params:{planKeys:[]}}, {operation:"explain_feature",params:{feature:"Chat"},limit:11}]){
    await assert.rejects(q.queryPublishedKnowledge(request as never,new Date()),/invalid_knowledge_query/);
  }
  assert.equal(reads,0);
});
test("PROS-20 AC3 only current published platform facts retain their source and version even when graph content outlives authority",async()=>{
  const f=await createSalesKnowledgeFixture();
  try {
    const d=await f.repo.save("docs",{...knowledgeDraft("public"),validUntil:"2099-01-01T00:00:00.000Z"},actor);
    await f.repo.save("private",knowledgeDraft("unreviewed"),actor);
    await f.service.publish("docs",{expectedVersion:1,contentHash:d.contentHash,clientRequestId:"publish-public"},actor);
    const q=new QuerySalesKnowledge(f.repo,new Neo4jSalesKnowledgeReader(f.driver,1000,f.namespace));
    const query={operation:"explain_feature" as const,params:{feature:"Chat"}};
    assert.deepEqual(await q.queryPublishedKnowledge(query,new Date()),d.draft);
    assert.deepEqual(await q.queryPublishedKnowledge(query,new Date("2100-01-01")),[]);
    await f.prisma.salesKnowledgeActivePublication.delete({where:{sourceId:"docs"}});
    assert.deepEqual(await q.queryPublishedKnowledge(query,new Date()),[]);
  } finally {await f.close();}
});
