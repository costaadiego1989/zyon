import {prospectingMaxPriceReservation,validateProspectingMaxPrice,type ProspectingTemplate} from "@zyon/shared-types";

export function prospectTemplateQuote(template:ProspectingTemplate|null,now:Date,standard:()=>{amountCents:number;currency:"BRL";validUntil:Date}|null){
 const price=validateProspectingMaxPrice(template?.maxPrice);
 return price?{amountCents:prospectingMaxPriceReservation(price),currency:"BRL" as const,validUntil:new Date(now.getTime()+60_000)}:standard();
}

export type ProspectProviderCost = {amountMicros:string;currency:"BRL"};
export function prospectProviderCost(pricing:unknown):ProspectProviderCost|null{
 if(!pricing||typeof pricing!=="object"||Array.isArray(pricing))return null;
 const p=pricing as {category?:unknown;cost?:{amount?:unknown;currency?:unknown}};
 if(p.category!=="marketing_lite_dynamic"||p.cost?.currency!=="BRL"||typeof p.cost.amount!=="number"||!Number.isFinite(p.cost.amount)||p.cost.amount<0)return null;
 const match=/^(\d+)(?:\.(\d{1,6}))?$/.exec(String(p.cost.amount));if(!match)return null;
 const amount=BigInt(match[1]+(match[2]??"").padEnd(6,"0"));
 if(amount>BigInt(Number.MAX_SAFE_INTEGER))return null;
 return {amountMicros:amount.toString(),currency:"BRL"};
}
