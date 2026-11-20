import { Prisma,type PrismaClient } from "../../../../../node_modules/.prisma/company-directory/index.js";
import type { CompanyFilters,CompanyRecord } from "@zyon/shared-types";
function literalLike(value:string){return value.replace(/[\\%_]/g,"\\$&");}
export async function readDirectoryPage(client:PrismaClient,snapshotId:string,filters:CompanyFilters,afterCnpj:string|null,limit:number){
  const predicates:Prisma.Sql[]=[Prisma.sql`e.snapshot_id=${snapshotId}`];
  const within=(column:Prisma.Sql,values:string[]|undefined)=>{if(values?.length)predicates.push(Prisma.sql`${column} IN (${Prisma.join(values)})`);};
  within(Prisma.sql`e.main_cnae`,filters.mainCnaes);within(Prisma.sql`e.uf`,filters.ufs);within(Prisma.sql`e.city_code`,filters.cityCodes);within(Prisma.sql`e.normalized_district`,filters.districts);within(Prisma.sql`c.size`,filters.sizes);within(Prisma.sql`c.legal_nature`,filters.legalNatures);within(Prisma.sql`e.status`,filters.statuses);within(Prisma.sql`e.matrix_branch`,filters.matrixBranches);within(Prisma.sql`p.stage`,filters.stages);
  if(filters.secondaryCnaes?.length)predicates.push(Prisma.sql`EXISTS(SELECT 1 FROM company_directory.establishment_secondary_cnaes s WHERE s.snapshot_id=e.snapshot_id AND s.cnpj=e.cnpj AND s.cnae IN (${Prisma.join(filters.secondaryCnaes)}))`);
  if(filters.capitalMinCents!==undefined)predicates.push(Prisma.sql`c.capital_cents>=${filters.capitalMinCents}::numeric`);
  if(filters.capitalMaxCents!==undefined)predicates.push(Prisma.sql`c.capital_cents<=${filters.capitalMaxCents}::numeric`);
  if(filters.openedFrom)predicates.push(Prisma.sql`e.opening_date>=${filters.openedFrom}::date`);if(filters.openedTo)predicates.push(Prisma.sql`e.opening_date<=${filters.openedTo}::date`);
  if(filters.simples!==undefined)predicates.push(Prisma.sql`c.simples=${filters.simples}`);if(filters.mei!==undefined)predicates.push(Prisma.sql`c.mei=${filters.mei}`);
  if(filters.cnpj)predicates.push(Prisma.sql`e.cnpj=${filters.cnpj}`);
  if(filters.legalName)predicates.push(Prisma.sql`c.normalized_legal_name LIKE ${"%"+literalLike(filters.legalName)+"%"}`);
  if(filters.tradeName)predicates.push(Prisma.sql`e.normalized_trade_name LIKE ${"%"+literalLike(filters.tradeName)+"%"}`);
  if(filters.search){const pattern="%"+literalLike(filters.search)+"%";predicates.push(Prisma.sql`(c.normalized_legal_name LIKE ${pattern} OR e.normalized_trade_name LIKE ${pattern} OR e.cnpj LIKE ${pattern})`);}
  if(filters.hasContact!==undefined)predicates.push(Prisma.sql`EXISTS(SELECT 1 FROM company_directory.company_public_contacts a WHERE a.snapshot_id=e.snapshot_id AND a.cnpj=e.cnpj)=${filters.hasContact}`);
  const where=Prisma.join(predicates," AND ");
  const join=Prisma.sql`FROM company_directory.company_establishments e JOIN company_directory.company_entities c ON c.snapshot_id=e.snapshot_id AND c.base_cnpj=e.base_cnpj LEFT JOIN public.platform_prospects p ON p.cnpj=e.cnpj`;
  return client.$transaction(async tx=>{
    const snapshot=await tx.companySnapshot.findUnique({where:{id:snapshotId}});if(!snapshot||snapshot.state!=="published")throw new Error("snapshot_unavailable");
    const counts=await tx.$queryRaw<{count:bigint}[]>`SELECT count(*) AS count ${join} WHERE ${where}`;
    const rows=await tx.$queryRaw<Omit<CompanyRecord,"snapshotId"|"competence">[]>`SELECT e.cnpj,e.base_cnpj AS "baseCnpj",c.legal_name AS "legalName",e.trade_name AS "tradeName",c.legal_nature AS "legalNature",c.size,c.capital_cents::text AS "capitalCents",e.main_cnae AS "mainCnae",e.city_code AS "cityCode",e.uf,e.district,to_char(e.opening_date,'YYYY-MM-DD') AS "openingDate",e.status,e.matrix_branch AS "matrixBranch",c.simples,c.mei,p.id AS "prospectId",p.stage,
      COALESCE((SELECT jsonb_agg(s.cnae ORDER BY s.cnae) FROM company_directory.establishment_secondary_cnaes s WHERE s.snapshot_id=e.snapshot_id AND s.cnpj=e.cnpj),'[]'::jsonb) AS "secondaryCnaes",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('channel',a.channel,'originalValue',a.original_value,'normalizedValue',a.normalized_value,'validationState',a.validation_state) ORDER BY a.channel,a.original_value) FROM company_directory.company_public_contacts a WHERE a.snapshot_id=e.snapshot_id AND a.cnpj=e.cnpj),'[]'::jsonb) AS contacts,
      EXISTS(SELECT 1 FROM public.prospect_contact_bindings b JOIN public.prospect_endpoints pe ON pe.id=b.endpoint_id JOIN public.contact_suppressions s ON s.protected_lookup=pe.protected_lookup AND s.key_version=pe.key_version AND s.sender_scope IN ('zyon_platform',pe.sender_binding_id) WHERE b.prospect_id=p.id) AS suppressed
      ${join} WHERE ${where} ${afterCnpj?Prisma.sql`AND e.cnpj COLLATE "C">${afterCnpj}`:Prisma.empty} ORDER BY e.cnpj COLLATE "C" ASC LIMIT ${limit}`;
    return {items:rows.map(row=>({...row,snapshotId,competence:snapshot.competence})),count:Number(counts[0].count),competence:snapshot.competence};
  },{isolationLevel:"RepeatableRead"});
}
