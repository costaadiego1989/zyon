import type { CompanyFilters, CompanyDomainQuery } from "@zyon/shared-types";
import { canonicalCnpj } from "./cnpj.js";
import { normalizeDirectoryText } from "./directory-values.js";
const stages=["new","contacted","responded","qualified","proposal","converted","lost","do_not_contact"];
const ufs="AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
export function companyPageLimit(value:unknown):number {if(value===undefined)return 50;if(!Number.isInteger(value)||Number(value)<1||Number(value)>100)throw new Error("invalid_filter:limit");return Number(value);}
export function validateCompanyFilters(input:unknown):CompanyFilters {
  if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("invalid_filter");
  const output:Record<string,unknown>={};
  for(const [key,value] of Object.entries(input)){
    if(["mainCnaes","secondaryCnaes","ufs","cityCodes","districts","sizes","legalNatures","statuses","matrixBranches","stages"].includes(key)){
      if(!Array.isArray(value)||!value.length||value.length>100||value.some(v=>typeof v!=="string"||!v.trim()||v.length>200))throw new Error(`invalid_filter:${key}`);
      const normalized=[...new Set((value as string[]).map(v=>["districts","ufs"].includes(key)?normalizeDirectoryText(v):v.trim()))].sort();
      const valid=(v:string)=>key==="ufs"?ufs.includes(v):key==="stages"?stages.includes(v):key==="matrixBranches"?["matrix","branch"].includes(v):key==="districts"?true:new RegExp(`^\\d{${["mainCnaes","secondaryCnaes"].includes(key)?7:["cityCodes","legalNatures"].includes(key)?4:2}}$`).test(v);
      if(!normalized.every(valid))throw new Error(`invalid_filter:${key}`);output[key]=normalized;
    }else if(["simples","mei","hasContact"].includes(key)){if(typeof value!=="boolean")throw new Error(`invalid_filter:${key}`);output[key]=value;
    }else if(["capitalMinCents","capitalMaxCents"].includes(key)){if(typeof value!=="string"||!/^\d{1,24}$/.test(value))throw new Error(`invalid_filter:${key}`);output[key]=BigInt(value).toString();
    }else if(["openedFrom","openedTo"].includes(key)){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new Error(`invalid_filter:${key}`);output[key]=value;
    }else if(["cnpj","legalName","tradeName","search"].includes(key)){if(typeof value!=="string"||!value.trim()||value.length>200)throw new Error(`invalid_filter:${key}`);output[key]=key==="cnpj"?canonicalCnpj(value):normalizeDirectoryText(value);
    }else throw new Error(`invalid_filter:${key}`);
  }
  if(output.capitalMinCents!==undefined&&output.capitalMaxCents!==undefined&&BigInt(output.capitalMinCents as string)>BigInt(output.capitalMaxCents as string))throw new Error("invalid_filter:capital_range");
  if(output.openedFrom&&output.openedTo&&output.openedFrom>output.openedTo)throw new Error("invalid_filter:date_range");
  return output as CompanyFilters;
}
export function validateCompanyDomainQuery(query:CompanyDomainQuery):CompanyDomainQuery {
  if(!["cnaes","municipios","naturezas"].includes(query.kind)||query.search!==undefined&&(typeof query.search!=="string"||query.search.length>200)||query.afterCode!==undefined&&!/^\d{1,7}$/.test(query.afterCode))throw new Error("invalid_filter:domain");
  if(query.uf!==undefined && (query.kind!=="municipios"||!ufs.includes(query.uf)))throw new Error("invalid_filter:uf");
  return {...query,limit:companyPageLimit(query.limit)};
}
