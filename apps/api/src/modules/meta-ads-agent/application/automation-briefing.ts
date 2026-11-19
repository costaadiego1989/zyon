import type {AssistantAutomationBriefing,AssistantCampaignProgress,MetaAdsAutomaticAction} from '@zyon/shared-types';
import {normalizeAnswer,isBriefingHelp,receiveBriefingAnswer} from './campaign-briefing.js';

export const isAutomationRequest=(message:string)=>/\b(modo automatico|modo autonomo|politica automatica|autonomia)\b/.test(normalizeAnswer(message))&&/\b(configurar|ative|ativar|quero|ajude|ajustar|configuracao)\b/.test(normalizeAnswer(message));
export function automationChecklist(progress:AssistantCampaignProgress){
 const b=progress.automationBriefing??{scope:{},limits:{}},s=b.scope,l=b.limits;
 const items=[['selection',s.variantIds?.length?s.variantIds:undefined,b.selection?.selectionQuery],['campaigns',s.campaignIds&&(s.allowNewCampaigns||s.campaignIds.length)&&typeof s.allowNewCampaigns==='boolean'?{campaignIds:s.campaignIds,allowNewCampaigns:s.allowNewCampaigns}:undefined,b.answers?.campaigns],['actions',s.actions?.length?s.actions:undefined,b.answers?.actions],['destination',s.destination],['priority',s.priority],['country',s.country],['campaignCeilingCents',l.campaignCeilingCents],['storeCeilingCents',l.storeCeilingCents],['cadence',l.cadence],['start',l.startsAt,b.startText],['end',l.endsAt,b.endText]].map(([key,value,answer])=>({key:key as string,status:value!==undefined?'confirmed':answer?'received':'pending',...(value!==undefined?{value}:{}),...(answer?{answer}:{})}));
 return {kind:'automation',items,next:items.find(item=>item.status!=='confirmed'&&!(item.status==='received'&&['start','end'].includes(item.key)))?.key??null,needsInterpretation:items.filter(item=>item.status==='received').map(item=>item.key),selection:b.selection??{},complete:items.every(item=>item.status==='confirmed'),newCampaignApproval:'always_required',policyAcceptance:'explicit_review_button_only'};
}
function amount(value:string){const match=value.match(/^(?:r\$\s*)?(\d{1,9}(?:[.,]\d{1,2})?)(?:\s*reais)?$/i);if(!match)return undefined;const result=Math.round(Number(match[1].replace(',','.'))*100);return Number.isSafeInteger(result)&&result>0?result:undefined;}
export function receiveAutomationAnswer(previous:AssistantCampaignProgress|null,message:string,turnId:string,start=false):AssistantCampaignProgress|null{
 if(!start&&previous?.planningKind!=='automation')return previous;
 if(previous?.automationBriefing?.capturedTurnId===turnId||!start&&isBriefingHelp(message))return previous;
 const progress:AssistantCampaignProgress=structuredClone(previous??{campaignId:null,draft:{},awaitingFields:['priority','variantIds','destination','budget','country'],approvalPreference:'manual'});
 progress.planningKind='automation';const b:AssistantAutomationBriefing=progress.automationBriefing??{scope:{},limits:{}},s=b.scope,l=b.limits,value=normalizeAnswer(message),next=automationChecklist({...progress,automationBriefing:b}).next;
 if(!start){
  const mirror:AssistantCampaignProgress={campaignId:null,draft:{variantIds:s.variantIds,destination:s.destination??'store',priority:s.priority,country:s.country},briefing:b.selection,awaitingFields:[],approvalPreference:'manual'};
  const receipt=receiveBriefingAnswer(mirror,message,turnId);
  if(receipt&&receipt!==mirror){
   for(const field of ['destination','priority','country'] as const)if(receipt.briefing?.answers?.[field]===message&&receipt.draft[field])s[field]=receipt.draft[field] as never;
   if(receipt.briefing)b.selection={selectionKind:receipt.briefing.selectionKind,selectionQuery:receipt.briefing.selectionQuery,selectedVariantId:receipt.briefing.selectedVariantId,categoryId:receipt.briefing.categoryId,categoryOptions:receipt.briefing.categoryOptions,productOptions:receipt.briefing.productOptions};
   if(b.selection?.selectionKind&&!receipt.draft.variantIds?.length)delete s.variantIds;
  }
  if(next==='campaigns'&&/^(todas|todas as campanhas|todas as campanhas da ia|todas as campanhas gerenciadas|atuais e futuras|campanhas atuais e futuras)$/.test(value)){s.campaignIds=[];s.allowNewCampaigns=true;}
  if(next==='actions'){
   const actions:Record<string,MetaAdsAutomaticAction>={pausar:'pause','pausar anuncios':'pause','pausar campanhas':'pause','ajustar verba':'budget','ajustar orcamento':'budget','trocar criativos':'creative','renovar criativos':'creative','preparar campanhas':'prepare','reativar anuncios':'publish'};
   const choices=value.split(/\s*(?:,| e )\s*/).filter(Boolean);if(choices.length&&choices.every(choice=>actions[choice]))s.actions=[...new Set(choices.map(choice=>actions[choice]))];
  }
  const money=amount(message.trim());if(money!==undefined&&(next==='campaignCeilingCents'||next==='storeCeilingCents')){l[next]=money;l.currency='BRL';}
  if(/^(por dia|diario|diaria|diariamente)$/.test(value)){l.cadence='daily';l.currency='BRL';}
  if(/^(no total|total|todo o periodo|para todo o periodo)$/.test(value)){l.cadence='lifetime';l.currency='BRL';}
  if(next==='start'&&message.trim().length<=200)b.startText=message.trim();
  if(next==='end'&&message.trim().length<=200)b.endText=message.trim();
  if(next&&message.trim().length<=250)b.answers={...b.answers,[next]:message.trim()};
 }
 b.capturedTurnId=turnId;progress.automationBriefing=b;return progress;
}
export function automationQuestion(progress:AssistantCampaignProgress):string|null{
 const checklist=automationChecklist(progress),next=checklist.next??checklist.needsInterpretation[0],b=progress.automationBriefing;
 const questions:Record<string,string>={selection:b?.selection?.selectionKind==='category'?'Qual categoria você quer incluir no modo automático?':b?.selection?.selectionKind==='product'?'Qual produto você quer incluir no modo automático?':'Vamos escolher os produtos que a IA poderá usar. Prefere um produto específico ou uma categoria?',campaigns:'A política pode incluir campanhas atuais e futuras da IA; cada campanha nova continua exigindo aprovação. Quer incluir todas as campanhas da IA ou escolher algumas?',actions:'A IA pode pausar anúncios, ajustar a verba ou renovar os criativos. Quais dessas ações você quer autorizar?',destination:'Esses anúncios devem levar para a loja ou para o WhatsApp?',priority:'Qual resultado você quer buscar: mais vendas, gastar menos por compra ou mais retorno por real investido?',country:'Em qual país esses anúncios devem aparecer?',campaignCeilingCents:'Qual será o limite de investimento para cada campanha?',storeCeilingCents:'Qual será o limite de investimento da loja somando essas campanhas?',cadence:'Esses limites são por dia ou para todo o período?',start:'Em que dia a política pode começar a valer?',end:'Até que dia a política pode valer?'};
 return next?questions[next]??null:null;
}
