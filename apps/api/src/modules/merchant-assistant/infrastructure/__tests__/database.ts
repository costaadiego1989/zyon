import {readFile} from 'node:fs/promises';
import {testDatabase} from '../../../meta-ads-agent/infrastructure/__tests__/database.js';

export async function assistantDatabase(){
  const db=await testDatabase();
  try{
    await db.sql.query(await readFile(new URL('../../../../../prisma/migrations/20261116103000_merchant_assistant/migration.sql',import.meta.url),'utf8'));
    return db;
  }catch(error){await db.close();throw error;}
}
