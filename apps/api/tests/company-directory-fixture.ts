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
    await db.pg.query(readFileSync(new URL("../prisma/migrations/20261121120000_prospect_contact_identity/migration.sql",import.meta.url),"utf8"));
    await db.pg.query(readFileSync(new URL("../prisma/migrations/20261121130000_prospect_privacy/migration.sql",import.meta.url),"utf8"));
    await db.pg.query(readFileSync(new URL("../prisma/migrations/20261121140000_prospect_audience/migration.sql",import.meta.url),"utf8"));
    await db.pg.query(readFileSync(new URL("../prisma/migrations/20261121150000_prospect_reservation_day/migration.sql",import.meta.url),"utf8"));
    await db.pg.query(readFileSync(new URL("../prisma/migrations/20261121160000_prospect_inbox_time/migration.sql",import.meta.url),"utf8"));
    await db.pg.query(readFileSync(new URL("../prisma/migrations/20261121170000_prospect_conversation_dispatch/migration.sql",import.meta.url),"utf8"));
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
export async function seedSearchDirectory(fixture:Awaited<ReturnType<typeof createCompanyDirectoryFixture>>,id="search-old",competence="2026-10") {
  await fixture.client.companySnapshot.create({data:{id,competence,manifestHash:id,manifest:{},state:"published",sourceUrl:"https://official.invalid",parserVersion:"rfb-cnpj-cp1252-v1"}});
  const records=[{cnpj:"00000000000191",baseCnpj:"00000000",legalName:"Maçã Comércio",tradeName:"Loja Centro",uf:"SP",mainCnae:"0111301",secondary:"0111302",cityCode:"7107",district:"Centro",size:"01",nature:"2062",capital:"10019",simples:true,mei:false,status:"02",matrix:"matrix",opened:"2020-01-01",contact:true,stage:"responded"},{cnpj:"11222333000181",baseCnpj:"11222333",legalName:"Outro Mercado",tradeName:"Loja Norte",uf:"RJ",mainCnae:"0111302",secondary:"0111301",cityCode:"6001",district:"Norte",size:"03",nature:"2135",capital:"20000",simples:false,mei:false,status:"08",matrix:"branch",opened:"2022-01-01",contact:false,stage:"new"},{cnpj:"12ABC34501DE35",baseCnpj:"12ABC345",legalName:"Maçã Filial",tradeName:null,uf:"SP",mainCnae:"0111301",secondary:"0111302",cityCode:"7107",district:"Centro",size:"01",nature:"2062",capital:"900719925474099317",simples:null,mei:null,status:"02",matrix:"branch",opened:"2021-01-01",contact:true,stage:null}];
  for(const r of records){await fixture.client.companyEntity.create({data:{snapshotId:id,baseCnpj:r.baseCnpj,legalName:r.legalName,normalizedLegalName:r.legalName.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase(),size:r.size,legalNature:r.nature,capitalCents:r.capital,simples:r.simples,mei:r.mei}});await fixture.client.companyEstablishment.create({data:{snapshotId:id,cnpj:r.cnpj,baseCnpj:r.baseCnpj,tradeName:r.tradeName,normalizedTradeName:r.tradeName?.toUpperCase(),uf:r.uf,mainCnae:r.mainCnae,cityCode:r.cityCode,district:r.district,normalizedDistrict:r.district.toUpperCase(),status:r.status,matrixBranch:r.matrix,openingDate:new Date(r.opened),secondaryCnaes:{create:{cnae:r.secondary}},...(r.contact?{contacts:{create:{channel:"phone",originalValue:"11999999999",validationState:"unknown"}}}:{})}});
    if(r.stage)await fixture.pg.query("INSERT INTO platform_prospects(id,cnpj,source_snapshot_id,stage) VALUES ($1,$2,$3,$4) ON CONFLICT(cnpj) DO NOTHING",["prospect-"+r.cnpj,r.cnpj,id,r.stage]);
  }
  await fixture.client.sourceDomain.createMany({data:[{snapshotId:id,kind:"cnaes",code:"0111301",label:"Cultivo de arroz"},{snapshotId:id,kind:"cnaes",code:"0111302",label:"Cultivo de milho"},{snapshotId:id,kind:"municipios",code:"7107",label:"SÃO PAULO"}]});
  await fixture.client.companyDirectoryActiveSnapshot.upsert({where:{id:"national"},create:{snapshotId:id},update:{snapshotId:id,version:{increment:1}}});
  return records;
}
