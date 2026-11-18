import type {AssistantCampaignBriefing,AssistantCampaignProgress} from '@zyon/shared-types';

type AnswerKey=keyof NonNullable<AssistantCampaignBriefing['answers']>;
export const normalizeAnswer=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[.!]+$/,'').replace(/\s+/g,' ');
export const isBriefingHelp=(value:string)=>/\?|\b(como|explique|explica|duvida|entender|o que e|por que|para que serve|ajude)\b/.test(normalizeAnswer(value));
export function briefingChecklist(progress:AssistantCampaignProgress|null){
  const draft=progress?.draft??{},memory=progress?.briefing??{},budget={...draft.budget,...memory.budget},answers=memory.answers??{};
  const item=(key:AnswerKey,value:unknown,received?:unknown)=>({key,status:value!==undefined&&value!==null?'confirmed':received?'received':'pending',...(value!==undefined?{value}:{}),...(received?{answer:received}:{})});
  const selection=draft.variantIds?.length?{variantIds:draft.variantIds}:undefined;
  const end=budget.endsAt===null?(budget.cadence==='daily'?'no_end_date':undefined):budget.endsAt;
  const items=[item('destination',draft.destination,answers.destination),item('selection',selection,memory.selectionQuery??answers.selection),item('priority',draft.priority,answers.priority),item('amount',budget.amountCents,answers.amount),item('cadence',budget.cadence,answers.cadence),item('start',budget.startsAt,budget.startText??answers.start),item('end',end,budget.endText??answers.end),item('country',draft.country,answers.country)];
  const first=items.find(entry=>entry.status!=='confirmed'),collect=items.find(entry=>entry.status!=='confirmed'&&!(entry.status==='received'&&['start','end'].includes(entry.key)));
  return {items,next:collect?.key??null,needsInterpretation:items.filter(entry=>entry.status==='received').map(entry=>entry.key),selection:{kind:memory.selectionKind??null,query:memory.selectionQuery??null,categoryId:memory.categoryId??null,categories:memory.categoryOptions??[],products:memory.productOptions??[]},creative:{status:draft.mediaIds?.length?'ready':'agent_prepares',requestedImages:progress?.requestedImages??null},newCampaignApproval:'always_required',complete:!first};
}
function money(value:string){const match=value.match(/^(?:r\$\s*)?(\d{1,9}(?:[.,]\d{1,2})?)(?:\s*reais)?$/i);if(!match)return undefined;const cents=Math.round(Number(match[1].replace(',','.'))*100);return Number.isSafeInteger(cents)&&cents>0?cents:undefined;}
function choice<T>(value:string,options:T[],name:(item:T)=>string):T|undefined{
  const ordinal:Record<string,number>={'1':0,'primeiro':0,'o primeiro':0,'a primeira':0,'2':1,'segundo':1,'o segundo':1,'a segunda':1,'3':2,'terceiro':2,'o terceiro':2,'a terceira':2,'4':3,'quarto':3,'5':4,'quinto':4};
  const index=ordinal[value];if(index!==undefined)return options[index];
  const matches=options.filter(option=>normalizeAnswer(name(option))===value);return matches.length===1?matches[0]:undefined;
}
/** Records explicit answers, not guesses. Unresolved dates remain text until the normal date/zone tools resolve them. */
export function receiveBriefingAnswer(previous:AssistantCampaignProgress|null,message:string,turnId:string,start=false):AssistantCampaignProgress|null{
  if(previous?.briefing?.capturedTurnId===turnId)return previous;
  if(!previous&&!start||isBriefingHelp(message)&&!start)return previous;
  const progress:AssistantCampaignProgress=structuredClone(previous??{campaignId:null,draft:{},awaitingFields:['priority','variantIds','destination','budget','country'],approvalPreference:'manual'});
  const memory=progress.briefing??={},draft=progress.draft,budget={...(draft.budget?{amountCents:draft.budget.amountCents,cadence:draft.budget.cadence,startsAt:draft.budget.startsAt,endsAt:draft.budget.endsAt}:{}),...memory.budget},answers={...memory.answers},value=normalizeAnswer(message),next=briefingChecklist(progress).next;
  const priorBudget=JSON.stringify(budget);
  let recognized=false;
  if(/^(na loja|loja|pelo site|no site|site|pela loja)$/.test(value)){draft.destination='store';answers.destination=message;recognized=true;}
  if(/^(whatsapp|no whatsapp|pelo whatsapp|wpp|zap)$/.test(value)){draft.destination='whatsapp';answers.destination=message;recognized=true;}
  if(/^(mais vendas|vender mais|quero mais vendas|vendas pagas)$/.test(value)){draft.priority='paid_sales';answers.priority=message;recognized=true;}
  if(/^(gastar menos por compra|custo por compra)$/.test(value)){draft.priority='cost_per_purchase';answers.priority=message;recognized=true;}
  if(/^(mais retorno|retorno por real investido|roas)$/.test(value)){draft.priority='roas';answers.priority=message;recognized=true;}
  if(/^(lucro apos anuncios|lucro|contribuicao)$/.test(value)){draft.priority='contribution';answers.priority=message;recognized=true;}
  if(/^(brasil|todo o brasil|br)$/.test(value)){draft.country='BR';answers.country=message;recognized=true;}
  if(/^(por dia|diario|diaria|diariamente)$/.test(value)){budget.cadence='daily';answers.cadence=message;recognized=true;}
  if(/^(no total|total|todo o periodo|para todo o periodo)$/.test(value)){budget.cadence='lifetime';answers.cadence=message;recognized=true;}
  const amount=money(message.trim());if(amount!==undefined&&(next==='amount'||/^r\$/i.test(message.trim()))){budget.amountCents=amount;answers.amount=message;recognized=true;}
  if(/^(produto|um produto|produto especifico|um produto especifico)$/.test(value)){memory.selectionKind='product';answers.selection=message;recognized=true;}
  if(/^(categoria|uma categoria|por categoria|escolher por categoria)$/.test(value)){memory.selectionKind='category';answers.selection=message;recognized=true;}
  if(/^(catalogo|pelo catalogo|ver o catalogo)$/.test(value)){memory.selectionKind='catalog';answers.selection=message;recognized=true;}
  if(next==='selection'&&!recognized){const product=choice(value,memory.productOptions??[],item=>item.name),category=choice(value,memory.categoryOptions??[],item=>item.name);if(product){memory.selectionQuery=product.name;memory.selectionKind='product';answers.selection=message;recognized=true;}else if(category){memory.categoryId=category.id;memory.selectionQuery=category.name;memory.selectionKind='category';answers.selection=message;recognized=true;}}
  if(next==='start'&&!recognized&&message.trim().length<=200){budget.startText=message.trim();answers.start=message;recognized=true;}
  if(next==='end'&&!recognized&&message.trim().length<=200){budget.endText=message.trim();answers.end=message;if(budget.cadence==='daily'&&/^(sem fim|sem data de fim|sem prazo|continuo)$/.test(value))budget.endsAt=null;recognized=true;}
  if(next==='selection'&&!recognized&&message.trim().length<=200&&!start&&!/\b(criar|crie|campanha|anuncio|ajud|quero anunciar)\b/.test(value)){memory.selectionQuery=message.trim();answers.selection=message.trim();recognized=true;}
  if(!recognized&&!start)return previous;
  memory.answers=answers;memory.budget=budget;memory.capturedTurnId=turnId;progress.briefing=memory;
  if(priorBudget!==JSON.stringify(budget))delete draft.budget;
  progress.awaitingFields=['priority','variantIds','destination','budget','country'].filter(key=>!draft[key as keyof typeof draft]);
  return progress;
}
