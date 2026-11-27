import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {PrismaClient} from '@prisma/client';

// The browser fixture owns this local database. It never reads .env or DATABASE_URL.
const url='postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback_agentic_browser_qa_20261119';
export async function testDatabase(){
 const schema=`mga_browser_${process.pid}_${randomUUID().replaceAll('-','')}`;
 const sql=new pg.Client({connectionString:url});await sql.connect();
 await sql.query(`CREATE SCHEMA "${schema}"`);await sql.query(`SET search_path TO "${schema}"`);
 const prisma=new PrismaClient({datasources:{db:{url:`${url}?schema=${schema}`}}});
 const close=async()=>{await prisma.$disconnect();if(!/^mga_browser_\d+_[a-f0-9]{32}$/.test(schema))throw Error('unsafe_browser_schema');await sql.query(`DROP SCHEMA "${schema}" CASCADE`);await sql.end();};
 try{
  await sql.query('CREATE TABLE merchants(id TEXT PRIMARY KEY)');
  await sql.query(await readFile(new URL('../prisma/migrations/20261114180000_meta_ads_agent/migration.sql',import.meta.url),'utf8'));
  await sql.query("INSERT INTO merchants(id) VALUES ('store-a'),('store-b')");
  return{sql,prisma,close};
 }catch(error){await close();throw error;}
}
