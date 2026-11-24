import neo4j,{type Driver,type Session} from "neo4j-driver";

const definitions=[
  {label:"ZyonSalesPublication",statement:"CREATE INDEX zyon_sales_publication_lookup IF NOT EXISTS FOR (n:ZyonSalesPublication) ON (n.namespace,n.id)"},
  {label:"ZyonSalesFact",statement:"CREATE INDEX zyon_sales_fact_lookup IF NOT EXISTS FOR (n:ZyonSalesFact) ON (n.namespace,n.id)"},
] as const;
const initialized=new WeakMap<Driver,Promise<void>>();
async function indexes(session:Session) {
  const result=await session.run("SHOW INDEXES YIELD name,type,labelsOrTypes,properties,state WHERE type='RANGE' AND labelsOrTypes IN [['ZyonSalesPublication'],['ZyonSalesFact']] AND properties=['namespace','id'] RETURN name,labelsOrTypes,state",{}, {timeout:5000});
  return result.records.map(r=>({name:r.get("name") as string,label:r.get("labelsOrTypes")[0] as string,state:r.get("state") as string}));
}
async function initialize(driver:Driver) {
  // Only the projection writer bootstraps schema. Read credentials never execute DDL.
  const session=driver.session({defaultAccessMode:neo4j.session.WRITE});
  try {
    const existing=await indexes(session);
    for(const definition of definitions) {
      if(!existing.some(index=>index.label===definition.label)) await session.run(definition.statement,{}, {timeout:5000});
    }
    const current=await indexes(session);
    for(const definition of definitions) {
      const index=current.find(index=>index.label===definition.label);
      if(!index)throw new Error("knowledge_schema_unavailable");
      if(index.state!=="ONLINE")await session.run("CALL db.awaitIndex($name,$seconds)",{name:index.name,seconds:neo4j.int(5)},{timeout:5000});
    }
  } finally {await session.close();}
}
export function initializeSalesKnowledgeSchema(driver:Driver) {
  let result=initialized.get(driver);
  if(!result) {
    result=initialize(driver).catch(error=>{initialized.delete(driver);throw error;});
    initialized.set(driver,result);
  }
  return result;
}
