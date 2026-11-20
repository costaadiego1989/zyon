import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import type { CompanyManifest } from "@zyon/shared-types";
import { createProspectingLogicalDatabase } from "./prospecting-fixture.js";
import { createDirectoryPrismaClient } from "../src/modules/platform-prospecting/infrastructure/company-directory/directory-prisma-client.js";

export async function createCompanyDirectoryFixture() {
  const db = await createProspectingLogicalDatabase();
  const client = createDirectoryPrismaClient({ databaseUrl: db.databaseUrl, directoryDatabaseUrl: db.databaseUrl, directoryPoolSize: 2 });
  try {
    await db.pg.query("CREATE TABLE platform_operators(id text PRIMARY KEY)");
    await db.pg.query(readFileSync(new URL("../prisma/migrations/20261117190000_platform_prospecting/migration.sql",import.meta.url),"utf8"));
    await db.pg.query(readFileSync(new URL("../prisma/company-directory-migrations/20261117190100_company_directory/migration.sql",import.meta.url),"utf8"));
    return { ...db, client, async close() { await client.$disconnect(); await db.close(); } };
  } catch (error) { await client.$disconnect(); await db.close(); throw error; }
}
export function fixtureManifest(competence = "2026-11", revision = "v1"): CompanyManifest {
  const id = `${competence}-${revision}`;
  return { id, competence, hash: id, parserVersion: "rfb-cnpj-cp1252-v1", discoveredAt: "2026-11-20T00:00:00.000Z", resources: ["empresas","estabelecimentos","simples","cnaes","municipios","naturezas"].flatMap(family => Array.from({length:["empresas","estabelecimentos"].includes(family)?10:1},(_,index)=>({id:`${id}-${family}${index?`-${index}`:""}`,family,url:`https://arquivos.receitafederal.gov.br/public.php/dav/files/YggdBLfdninEJX9/${competence}/${({empresas:`Empresas${index}`,estabelecimentos:`Estabelecimentos${index}`,simples:"Simples",cnaes:"Cnaes",municipios:"Municipios",naturezas:"Naturezas"} as Record<string,string>)[family]}.zip`,competence,discoveredAt:"2026-11-20T00:00:00.000Z",etag:null,lastModified:null}))) };
}
export const csv = (columns: string[])=>columns.map(value=>`"${value.replaceAll('"','""')}"`).join(";");
export function companyDirectoryZip(content: Buffer) {
  const name=Buffer.from("DATA.CSV");const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc32(content),14);header.writeUInt32LE(content.length,18);header.writeUInt32LE(content.length,22);header.writeUInt16LE(name.length,26);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt32LE(crc32(content),16);directory.writeUInt32LE(content.length,20);directory.writeUInt32LE(content.length,24);directory.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(directory.length+name.length,12);end.writeUInt32LE(header.length+name.length+content.length,16);
  return Buffer.concat([header,name,content,directory,name,end]);
}
export const directoryArchiveLimits={importMaximumFileBytes:100_000,importMaximumExpandedBytes:100_000,importMaximumEntries:2,importMaximumLineBytes:4096,importMaximumMemoryBytes:65_536,importMinimumFreeDiskBytes:1};
export function fixtureSourceRows(family: string): string {
  if(family==="empresas")return csv(["12ABC345","Zyon synthetic fixture","2062","49","10,19","01",""]);
  if(family==="simples")return csv(["12ABC345","S","","","N","",""]);
  if(family==="estabelecimentos")return csv(["12ABC345","01DE","35","1","Synthetic","02","20200101","00","","","20200101","0111301","0111302","RUA","Synthetic","1","","Centro","00000000","SP","7107","11","999999999","","","","","fixture@example.test","",""]);
  return csv([family==="cnaes"?"0111301":family==="municipios"?"7107":"2062","Synthetic domain"]);
}
