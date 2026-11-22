import {mkdirSync,readFileSync,writeFileSync,existsSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import pg from "pg";
import {PrismaClient} from "@prisma/client";
import neo4j from "neo4j-driver";
import {Redis} from "ioredis";
import {readProspectingTestConfig,validateProspectingTestConfig} from "./prospecting-fixture.js";
import {migrateProspectingData,seedSearchDirectory} from "./company-directory-fixture.js";
import {createDirectoryPrismaClient} from "../src/modules/platform-prospecting/infrastructure/company-directory/directory-prisma-client.js";

export const localDir=fileURLToPath(new URL("../../../.specs/features/admin-company-prospecting/browser-runtime/",import.meta.url));
export async function openBrowserData(mode:"preview"|"disposable"){
 const config=readProspectingTestConfig();validateProspectingTestConfig(config);
 for(const [url,port] of [[config.databaseUrl,"15438"],[config.neo4jUri,"17690"],[config.redisUrl,"16389"]])if(new URL(url).port!==port)throw Error("browser_runtime_unowned_port");
 mkdirSync(localDir,{recursive:true});
 const receipt=localDir+"/preview-db.json", existing=mode==="preview"&&existsSync(receipt);
 const identity=existing?JSON.parse(readFileSync(receipt,"utf8")):{name:"prospecting_test_"+randomUUID().replaceAll("-",""),owner:randomUUID()};
 if(!/^prospecting_test_[a-f0-9]{32}$/.test(identity.name))throw Error("invalid_database_receipt");
 const admin=new pg.Pool({connectionString:config.databaseUrl,max:1}),url=new URL(config.databaseUrl);
 url.pathname="/"+identity.name;url.search="";
 const pool=new pg.Pool({connectionString:url.href,max:3});
 const prisma=new PrismaClient({datasources:{db:{url:url.href}}});
 const client=createDirectoryPrismaClient({databaseUrl:url.href,directoryDatabaseUrl:url.href,directoryPoolSize:2});
 const driver=neo4j.driver(config.neo4jUri,neo4j.auth.basic(config.neo4jUser,config.neo4jPassword),{maxTransactionRetryTime:0});
 const redis=new Redis(config.redisUrl,{lazyConnect:true,retryStrategy:()=>null});
 let created=false,opened=false;
 async function close(){
  try{
   if((mode==="disposable"||!opened)&&created){
    const s=driver.session();
    try{await s.run("MATCH (n {namespace:$ns}) WHERE n:ZyonSalesPublication OR n:ZyonSalesFact DETACH DELETE n",{ns:identity.name});}finally{await s.close();}
   }
  }finally{
   redis.disconnect();await driver.close();await prisma.$disconnect();await client.$disconnect();await pool.end();
   try{if((mode==="disposable"||!opened)&&created)await admin.query('DROP DATABASE "'+identity.name+'"');}finally{await admin.end();}
  }
 }
 try{
  await driver.verifyConnectivity();await redis.connect();if(await redis.ping()!=="PONG")throw Error("redis_unavailable");
  if(!existing){
   await admin.query('CREATE DATABASE "'+identity.name+'"');created=true;
   await pool.query("CREATE TABLE browser_runtime_owner(owner text PRIMARY KEY)");
   await pool.query("INSERT INTO browser_runtime_owner VALUES ($1)",[identity.owner]);
   await pool.query(`CREATE TABLE platform_operators(id text PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text,role text NOT NULL,
      auth_version integer NOT NULL DEFAULT 0,disabled_at timestamp,created_at timestamp NOT NULL DEFAULT now(),updated_at timestamp NOT NULL);
     CREATE TABLE platform_auth_sessions(id text PRIMARY KEY,family_id text NOT NULL,operator_id text NOT NULL REFERENCES platform_operators(id),
      auth_version integer NOT NULL,refresh_expires_at timestamp NOT NULL,consumed_at timestamp,revoked_at timestamp,created_at timestamp NOT NULL DEFAULT now())`);
   await migrateProspectingData(pool);
   await pool.query(readFileSync(new URL("./prospect-billing-fixture.sql",import.meta.url),"utf8"));
   await seedSearchDirectory({client,pg:pool} as Parameters<typeof seedSearchDirectory>[0]);
   const longName = "Distribuição e Comércio de Equipamentos Industriais para Manutenção e Reparação do Interior Ltda.";
   await client.companyEntity.update({ where: { snapshotId_baseCnpj: { snapshotId: "search-old", baseCnpj: "12ABC345" } }, data: {
     legalName: longName, normalizedLegalName: longName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
   } });
   if(mode==="preview")writeFileSync(receipt,JSON.stringify(identity),{flag:"wx"});
  }else if((await pool.query("SELECT owner FROM browser_runtime_owner")).rows[0]?.owner!==identity.owner)throw Error("preview_ownership_mismatch");
  await pool.query("CREATE TABLE IF NOT EXISTS browser_provider_requests(id bigserial PRIMARY KEY,effect_id text NOT NULL)");
  opened=true;return {pg:pool,prisma,client,driver,redis,namespace:identity.name,owner:identity.owner,close};
 }catch(e){await close();throw e;}
}
