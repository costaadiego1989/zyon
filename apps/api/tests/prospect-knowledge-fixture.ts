import { randomUUID } from "node:crypto";
import neo4j from "neo4j-driver";
import { createProspectCrmFixture } from "./prospect-crm-fixture.js";
import { readProspectingTestConfig,validateProspectingTestConfig } from "./prospecting-fixture.js";
import { PrismaSalesKnowledgeRepository } from "../src/modules/platform-prospecting/infrastructure/knowledge/prisma-sales-knowledge.repository.js";
import { Neo4jSalesKnowledgeAdapter,SalesPublicationService } from "../src/modules/platform-prospecting/infrastructure/knowledge/neo4j-sales-knowledge.adapter.js";

export const actor={operatorId:"operator",correlationId:"review"};
export function knowledgeDraft(label:string) {return {clientRequestId:"draft-"+label,expectedVersion:0,title:label,sourceRef:"Zyon handbook",validFrom:"2020-01-01T00:00:00.000Z",validUntil:null as string|null,facts:[{id:"f1",subject:"Chat",predicate:"feature",value:"Published "+label}]};}
export async function createSalesKnowledgeFixture() {
  const config=readProspectingTestConfig();validateProspectingTestConfig(config);
  const crm=await createProspectCrmFixture();
  const driver=neo4j.driver(config.neo4jUri,neo4j.auth.basic(config.neo4jUser,config.neo4jPassword),{maxTransactionRetryTime:0,connectionTimeout:1500});
  const namespace="prospect-fixture-"+randomUUID();
  const repo=new PrismaSalesKnowledgeRepository(crm.prisma);
  try { await driver.verifyConnectivity(); }
  catch(error){await driver.close();await crm.close();throw error;}
  const service=new SalesPublicationService(repo,new Neo4jSalesKnowledgeAdapter(driver,namespace));
  return {...crm,driver,namespace,repo,service,async close(){
    const session=driver.session();
    try {await session.run("MATCH (n {namespace:$ns}) WHERE n:ZyonSalesPublication OR n:ZyonSalesFact DETACH DELETE n",{ns:namespace});}
    finally {await session.close();await driver.close();await crm.close();}
  }};
}
