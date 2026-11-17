import {readFile} from 'node:fs/promises';
import {assistantDatabase} from '../../../merchant-assistant/infrastructure/__tests__/database.js';

export async function campaignApprovalDatabase(){
  const db=await assistantDatabase();
  try{
    await db.sql.query(`CREATE TABLE merchant_notifications (
      id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,type TEXT NOT NULL,title TEXT NOT NULL,
      body TEXT,metadata JSONB,read BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.sql.query(`CREATE TABLE whatsapp_deliveries (
      id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,config_id TEXT NOT NULL,device_id TEXT NOT NULL,
      state TEXT NOT NULL,processing_token TEXT NOT NULL,response JSONB,provider_message_id TEXT,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP(3) NOT NULL
    )`);
    await db.sql.query(await readFile(new URL('../../../../../prisma/migrations/20261117010000_campaign_approval/migration.sql',import.meta.url),'utf8'));
    return db;
  }catch(error){await db.close();throw error;}
}
