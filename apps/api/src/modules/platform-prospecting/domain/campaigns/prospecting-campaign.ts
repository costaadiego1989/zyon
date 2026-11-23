import { createHash } from "node:crypto";
import type { CampaignState, ProspectCampaignAction, ProspectCampaignLimits, ProspectingBlocker, ProspectingSendWindow } from "@zyon/shared-types";
import { stableDirectoryJson } from "../company-directory/directory-values.js";

export function validateLimits(value: ProspectCampaignLimits | null | undefined): ProspectCampaignLimits {
  const fields: string[]=[];
  if (!Number.isInteger(value?.dailyRecipients) || value!.dailyRecipients < 1 || value!.dailyRecipients > 2147483647) fields.push("dailyRecipients");
  if (!Number.isSafeInteger(value?.budget?.amountCents) || value!.budget.amountCents < 1 || value!.budget.currency !== "BRL") fields.push("budget");
  if (fields.length) throw new Error("limits_missing:"+fields.join(","));
  return value!;
}
export function validateSendWindow(window: ProspectingSendWindow) {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!window || !window.timezone || !time.test(window.start) || !time.test(window.end) || window.start>=window.end || !Array.isArray(window.weekdays) || !window.weekdays.length || window.weekdays.some(day=>!Number.isInteger(day)||day<1||day>7) || new Set(window.weekdays).size!==window.weekdays.length) throw new Error("invalid_command:sendWindow");
  try {new Intl.DateTimeFormat("en",{timeZone:window.timezone});} catch {throw new Error("invalid_command:sendWindow");}
  return {...window,weekdays:[...window.weekdays].sort((a,b)=>a-b)};
}
interface ReviewContent { message: string | null; offer:unknown; senderBindingId:string|null; senderVersion:number|null; template:unknown; audienceHash:string|null; sendWindow:unknown; limits:unknown; setupVersion?: number; businessContext?:string|null; offerPolicy?:unknown }
export function campaignContentHash(fields:ReviewContent) {
  const {message,offer,senderBindingId,senderVersion,template,audienceHash,sendWindow,limits}=fields;
  return createHash("sha256").update(stableDirectoryJson({message,offer,senderBindingId,senderVersion,template,audienceHash,sendWindow,limits,...(fields.setupVersion===2?{setupVersion:2,businessContext:fields.businessContext??null,offerPolicy:fields.offerPolicy??null}:{})})).digest("hex");
}
export function campaignTransition(current:CampaignState, action:ProspectCampaignAction["action"], approvalCurrent:boolean, blockers:ProspectingBlocker[]):CampaignState {
  if(action==="pause"&&current==="running") return "paused";
  if(!((action==="start"&&current==="approved")||(action==="resume"&&current==="paused"))) throw new Error("campaign_state_conflict");
  if(!approvalCurrent) throw new Error("approval_stale");
  if(blockers.length) throw new Error(blockers[0]);
  return "running";
}
