import type {AssistantThread} from '@zyon/shared-types';
export interface CampaignChoice{label:string;message:string;}
export function campaignChoices(thread:AssistantThread|null):CampaignChoice[]{
 const last=thread?.turns.at(-1),progress=thread?.campaign;if(!last||last.status!=='completed'||!last.reply?.includes('?')||progress?.planningKind==='automation')return[];
 const question=last.reply.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/\n|[.!]\s+/).filter(x=>x.includes('?')).join(' '),draft=progress?.draft??{},memory=progress?.briefing,choice=(label:string,message=label)=>({label,message});
 if(memory?.budgetIssue&&/ajustar.*reduzir|reduzir.*ajustar/.test(question)){const total=memory.budgetIssue.estimatedMinimumTotalCents;return[...(total?[choice(`Usar ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(total/100)} no total`)]:[]),choice('Ajustar o valor','Quero ajustar o valor do anúncio, mantendo as datas. Me pergunte o novo valor.'),choice('Reduzir os dias','Quero manter o valor total e reduzir os dias. Me ajude a escolher o período.')];}
 if(!draft.destination&&/(loja|site).*whatsapp|whatsapp.*(loja|site)|destino|receber.*whatsapp/.test(question))return[choice('Vender na loja','Quero vender pela loja'),choice('Receber no WhatsApp','Quero receber clientes no WhatsApp')];
 if(!draft.variantIds?.length&&/produto|categoria|catalogo|desses|opcoes/.test(question)){
  if(memory?.productOptions?.length&&/qual|prefere|escolh/.test(question))return memory.productOptions.slice(0,3).map(product=>choice(product.name,`Quero anunciar ${product.name}.`));
  if(memory?.categoryOptions?.length)return memory.categoryOptions.slice(0,5).map(category=>choice(category.name,`Quero anunciar a categoria ${category.name}.`));
  if(!memory?.selectionKind)return[choice('Um produto','Quero escolher um produto específico'),choice('Uma categoria','Quero escolher uma categoria')];return[];
 }
 if(!draft.priority&&/resultado|prioriz|vendas|retorno/.test(question))return[choice('Mais vendas'),choice('Gastar menos por compra'),choice('Mais retorno por real investido')];
 if(!memory?.budget?.cadence&&!draft.budget?.cadence&&/por dia|diario|periodo|total/.test(question))return[choice('Por dia'),choice('No total do período','O valor é para todo o período')];
 if(/quando|que dia|data/.test(question)&&/comec|inici/.test(question))return[choice('Hoje'),choice('Amanhã')];
 if(/ate quando|ate que dia|termin|fim|ficar no ar/.test(question)&&!memory?.budgetIssue)return[choice('7 dias'),choice('10 dias')];
 if(!draft.country&&/pais|regiao/.test(question))return[choice('Brasil')];return[];
}
