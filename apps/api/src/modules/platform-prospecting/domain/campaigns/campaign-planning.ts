import type {CompanyFilters} from "@zyon/shared-types";
import {validateCompanyFilters} from "../company-directory/company-filters.js";
export interface CampaignPlanningScope {ufs:string[];cnaes:{code:string;label:string}[];cities:{code:string;uf:string;label:string}[]}
export interface CampaignPlanningRequest {requestId:string;context:string;scope:CampaignPlanningScope}
export interface CampaignPlanningModel {enabled:boolean;quote(input:CampaignPlanningRequest):number|null;interpret(input:CampaignPlanningRequest):Promise<unknown>}
const normalize=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/\s+/g," ");
export function unsupportedContext(context:string){
 const text=normalize(context);
 return /\b(nao|exceto|excluir|menos|sem|shopify|bling|woocommerce|instagram|faturamento|funcionarios|usam|usando|utilizam|que|ja)\b/.test(text);
}
export function validatePlanningCriteria(input:unknown,scope:CampaignPlanningScope):CompanyFilters{
 try{
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(k=>!["ufs","mainCnaes","cityCodes"].includes(k)))throw Error();
  const c=validateCompanyFilters(input);if(!c.ufs?.length||!c.mainCnaes?.length||c.ufs.some(v=>!scope.ufs.includes(v))||c.mainCnaes.some(v=>!scope.cnaes.some(x=>x.code===v))||c.cityCodes?.some(v=>!scope.cities.some(x=>x.code===v&&c.ufs!.includes(x.uf))))throw Error();return c;
 }catch{throw Error("context_scope_unsupported");}
}
export function resolveCampaignRules(context:string,scope:CampaignPlanningScope):CompanyFilters|null{
 const text=normalize(context).replace(/[.!]$/g,"");
 if(unsupportedContext(text))throw Error("context_scope_unsupported");
 const groups:[string,string][]=[["(?:roupas?|vestuario|artigos do vestuario)","4781400"],["calcados?","4782201"],["artigos de viagem","4782202"],["joias|joalheria","4783101"],["relogios|relojoaria","4783102"],["suvenires|bijuterias","4789001"],["cosmeticos|perfumaria","4772500"],["animais|pet shops?","4789004"]];
 const states:Record<string,string>={"sao paulo":"SP","rio de janeiro":"RJ","minas gerais":"MG","espirito santo":"ES","parana":"PR","santa catarina":"SC","rio grande do sul":"RS"};
 const region=Object.keys(states).find(s=>text.endsWith(" "+s));const normalized=region?text.slice(0,-region.length)+states[region].toLowerCase():text;
 for(const [business,code] of groups){const match=normalized.match(new RegExp("^(?:campanha )?(?:(?:lojas?|comercio|varejo) (?:de )?)?(?:"+business+") (?:em |no estado de )?([a-z]{2})$"));if(match)return validatePlanningCriteria({mainCnaes:[code],ufs:[match[1].toUpperCase()]},scope);}
 return null;
}
