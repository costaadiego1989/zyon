import { readFileSync } from "node:fs";
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
  return { id, competence, hash: id, parserVersion: "rfb-cnpj-cp1252-v1", discoveredAt: "2026-11-20T00:00:00.000Z", resources: ["empresas","estabelecimentos","simples","cnaes","municipios","naturezas"].map(family => ({id:`${id}-${family}`,family,url:`https://arquivos.receitafederal.gov.br/public.php/dav/files/YggdBLfdninEJX9/${competence}/${({empresas:"Empresas0",estabelecimentos:"Estabelecimentos0",simples:"Simples",cnaes:"Cnaes",municipios:"Municipios",naturezas:"Naturezas"} as Record<string,string>)[family]}.zip`,competence,discoveredAt:"2026-11-20T00:00:00.000Z",etag:null,lastModified:null})) };
}
