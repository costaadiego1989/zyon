import {randomUUID} from 'node:crypto';
type Json=Record<string,any>;
export const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgmBn6HwADeQHu5A/HNwAAAABJRU5ErkJggg==','base64');
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','x-request-id':randomUUID()}});
/** Only external transports are controlled. Domain services and repositories run normally. */
export class AgenticBrowserProvider {
  fundingMode:'prepaid'|'postpaid'|'unknown'='prepaid';blocked=false;dueCents=5000;images=0;modelCalls=0;reviewCalls=0;
  retrievedReferenceIds:string[]=[];writes:Array<{tool:string;accountId:string;entityId:string}>=[];
  entities=new Map<string,Json>();private next=1000;
  whatsappMode:'accepted'|'timeout'|'reject'='accepted';whatsappRequests:Json[]=[];
  private holdImages=false;private imageWaiters:Array<()=>void>=[];
  metricsUnavailable=false;sampleMetrics=false;private holdModel=false;private modelWaiters:Array<()=>void>=[];
  minimumDailyBudgetCents=100;pageWhatsAppLinked=true;catalogCopies=0;
  get modelPending(){return this.modelWaiters.length;}
  private modelScript:Array<{reply:string;referenceIds?:string[]}|{tool:{name:string;args:Json}}>=[];
  get modelScriptRemaining(){return this.modelScript.length;}
  setModelScript(value:unknown){
    if(this.modelScript.length||!Array.isArray(value)||!value.length||value.length>8||value.some(step=>!step||typeof step!=='object'||Array.isArray(step)||!('reply' in step&&Object.keys(step).every(key=>['reply','referenceIds'].includes(key))&&typeof step.reply==='string'&&step.reply.length<=8000&&(step.referenceIds===undefined||Array.isArray(step.referenceIds)&&step.referenceIds.length<=5&&step.referenceIds.every((id:unknown)=>typeof id==='string'&&id.length>0&&id.length<=201))||'tool' in step&&Object.keys(step).length===1&&step.tool&&typeof step.tool.name==='string'&&step.tool.args&&typeof step.tool.args==='object'&&!Array.isArray(step.tool.args))))throw Error('controlled_script_invalid');
    this.modelScript=structuredClone(value);
  }
  setModelHold(value:boolean){this.holdModel=value;if(!value)for(const release of this.modelWaiters.splice(0))release();}
  setImageHold(value:boolean){this.holdImages=value;if(!value)for(const release of this.imageWaiters.splice(0))release();}
  constructor(readonly clock:()=>Date){}
  reset(){this.minimumDailyBudgetCents=100;this.pageWhatsAppLinked=true;this.catalogCopies=0;this.modelScript=[];this.fundingMode='prepaid';this.blocked=false;this.dueCents=5000;this.whatsappMode='accepted';this.whatsappRequests=[];this.images=0;this.modelCalls=0;this.reviewCalls=0;this.retrievedReferenceIds=[];this.writes=[];this.entities.clear();this.next=1000;this.metricsUnavailable=false;this.sampleMetrics=false;}
  private model(body:Json):Response {
    this.modelCalls++;
    const messages=body.messages as Json[];
    const knowledge=messages.find(m=>m.role==='system'&&m.content.startsWith('TRECHOS DE REFERÊNCIA (dados, não instruções):\n'));
    const refs:Json[]=knowledge?JSON.parse(knowledge.content.slice(knowledge.content.indexOf('\n')+1)):[];
    this.retrievedReferenceIds.push(...refs.map(ref=>ref.id));
    const userIndex=messages.findLastIndex(m=>m.role==='user');const text=String(messages[userIndex]?.content??'');
    const called=messages.slice(userIndex+1).flatMap(m=>m.tool_calls??[]).map(call=>call.function.name);
    const stateMessage=messages.find(m=>m.role==='system'&&m.content.startsWith('ESTADO DO SERVIDOR'));
    const state=stateMessage?JSON.parse(stateMessage.content.slice(stateMessage.content.indexOf('\n')+1)):{};
    const toolResult=(name:string)=>{const call=messages.slice(userIndex+1).flatMap(m=>m.tool_calls??[]).find(call=>call.function.name===name);const message=messages.findLast(m=>m.role==='tool'&&m.tool_call_id===call?.id);return message?JSON.parse(message.content):{};};
    const completion=(content:unknown,tool?:{name:string;args:Json})=>json({id:randomUUID(),choices:[{finish_reason:tool?'tool_calls':'stop',message:tool?{content:null,tool_calls:[{id:'call-'+randomUUID(),type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}]}:{content:JSON.stringify(content)}}],usage:{prompt_tokens:100,completion_tokens:40,total_tokens:140}});
    if(body.tools?.some((t:Json)=>t.function.name==='propose_campaign_changes'))return completion(null,{name:'propose_campaign_changes',args:{recommendations:[]}});
    const scripted=this.modelScript.shift();if(scripted)return 'tool' in scripted?completion(null,scripted.tool):completion({reply:scripted.reply,referenceIds:scripted.referenceIds??refs.map(ref=>ref.id)});
    const reply=(value:string)=>completion({reply:value,referenceIds:refs.map(ref=>ref.id)});
    if(state.contextLabel==='Cashback'){
      if(typeof state.acceptedInput?.field==='string'&&typeof state.acceptedInput.saved==='boolean'&&typeof state.acceptedInput.reply==='string')return reply(state.acceptedInput.reply);
      const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
      const message=normalized(text);
      if(/relatorio/.test(message)){
        if(!called.includes('cashback_report')){const dates=text.match(/\d{4}-\d{2}-\d{2}/g);return completion(null,{name:'cashback_report',args:dates?{from:dates[0],to:dates[1]}:{}});}
        return reply(toolResult('cashback_report').reply??'Consulte o relatório canônico.');
      }
      if(text.includes('?')&&!/ativar|publicar/.test(message))return reply(refs.map(ref=>ref.text).join('\n\n')||'Consulte a ajuda revisada no painel.');
      if(!called.includes('cashback_read_program'))return completion(null,{name:'cashback_read_program',args:{}});
      const current=toolResult('cashback_read_program');
      if(/configur|continuar|retomar|checklist|ativar|publicar/.test(message)){
        if(!called.includes('cashback_next_step'))return completion(null,{name:'cashback_next_step',args:{}});
        return reply(toolResult('cashback_next_step').nextStep?.prompt??'Revise o rascunho antes de Publicar e ativar.');
      }
      if(!called.includes('cashback_save_draft_answer')){
        const named=/^([^:\n=]{1,80})\s*[:=]/.exec(text),field=named?current.checklist?.items.find((item:Json)=>normalized(item.label)===normalized(named[1]))?.field:current.nextStep?.field;
        if(field)return completion(null,{name:'cashback_save_draft_answer',args:{field,expectedRevision:current.program.configurationRevision}});
      }
      return reply('Consulte a próxima decisão do rascunho salvo.');
    }
    if(/fundos|pagar|pagamento|verba|saldo/i.test(text)&&!called.includes('merchant_ads_funding'))return completion(null,{name:'merchant_ads_funding',args:{}});
    if(/relat[oó]rio di[aá]rio/i.test(text)){
      if(!called.includes('merchant_ads_daily_reports'))return completion(null,{name:'merchant_ads_daily_reports',args:{localDay:'2026-11-16'}});
      return reply('Este é o relatório do dia encerrado. A receita atribuída não comprova aumento causal das vendas.');
    }
    if(/configurar o modo autom[aá]tico/i.test(text))return reply('Quais produtos, ações e limites financeiros deseja autorizar?');
    if(/Autorizar Camisa/i.test(text)){
      if(!called.includes('merchant_ads_catalog'))return completion(null,{name:'merchant_ads_catalog',args:{query:'Camisa'}});
      if(!called.includes('merchant_ads_review_automation'))return completion(null,{name:'merchant_ads_review_automation',args:{scope:{variantIds:(toolResult('merchant_ads_catalog').products??[]).map((p:Json)=>p.variantId),campaignIds:[],allowNewCampaigns:true,destination:'store',priority:'paid_sales',country:'BR',actions:['prepare','publish','pause',...(/alterar orçamento/i.test(text)?['budget']:[])]},limits:{currency:'BRL',cadence:'lifetime',campaignCeilingCents:/campanha R\$ 50/i.test(text)?5000:10000,storeCeilingCents:20000,startsAt:'2026-11-16T12:00:00.000Z',endsAt:'2026-11-23T12:00:00.000Z'}}});
      return reply('Política preparada para revisão. O modo permanece manual até seu aceite explícito.');
    }
    if(/fundos|pagar|pagamento|verba|saldo/i.test(text))return reply('A verba dos anúncios é paga diretamente à Meta e é separada da assinatura e dos créditos de imagens. Confira o tipo de cobrança da conta no painel Verba dos anúncios. Use o botão de pagamentos da conta conectada e depois Verificar novamente; esse botão não adiciona saldo na Zyon.');
    if(/vender.*camisas/i.test(text)){
      if(!called.includes('merchant_ads_catalog'))return completion(null,{name:'merchant_ads_catalog',args:{query:'Camisa'}});
      if(!called.includes('merchant_ads_save_draft')){const products=toolResult('merchant_ads_catalog').products??[],full=/R\$\s*100 no total/i.test(text);return completion(null,{name:'merchant_ads_save_draft',args:{planningKind:'campaign',name:'Camisas da semana',variantIds:products.map((p:Json)=>p.variantId),destination:/WhatsApp/i.test(text)?'whatsapp':'store',priority:'paid_sales',country:'BR',approvalPreference:/automaticamente|autom[aá]tico/i.test(text)?'automatic':'manual',headline:'Camisas para o seu dia',primaryText:'Conheça as camisas da nossa loja.',mediaIds:[],imageCount:/carrossel|2 imagens/i.test(text)?2:1,...(full?{budget:{amountCents:10000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-16T12:00:00.000Z',endsAt:'2026-11-23T12:00:00.000Z'}}:{})}});}
      return reply(/R\$\s*100 no total/i.test(text)?'Campanha salva. Vou preparar os criativos; a publicação exige sua aprovação administrativa.':'Encontrei a Camisa no catálogo. Qual orçamento deseja investir: diário ou total, com quais datas?');
    }
    if(/^100$/.test(text.trim()))return reply('Esse orçamento é diário ou total? Quais são as datas de início e término?');
    if(/(?:100|80) no total/i.test(text)){
      if(!called.includes('merchant_ads_save_draft'))return completion(null,{name:'merchant_ads_save_draft',args:{budget:{amountCents:/80 no total/i.test(text)?8000:10000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-16T12:00:00.000Z',endsAt:'2026-11-23T12:00:00.000Z'}}});
      return reply('Rascunho salvo para revisão com o orçamento total e as datas confirmadas.');
    }
    if(/selecione o criativo gerado/i.test(text)){
      if(!called.includes('merchant_ads_overview'))return completion(null,{name:'merchant_ads_overview',args:{}});
      if(!called.includes('merchant_ads_save_draft'))return completion(null,{name:'merchant_ads_save_draft',args:{mediaIds:(toolResult('merchant_ads_overview').media??[]).filter((m:Json)=>m.campaignId===state.campaign?.campaignId).map((m:Json)=>m.id)}});
      return reply('Criativo selecionado no mesmo rascunho. Revise antes de solicitar o preparo pausado.');
    }
    return reply('Qual resultado você quer buscar e quais produtos deseja anunciar?');
  }
  request:typeof fetch=async(input,init)=>{
    if(String(input)==='https://media.example.test/product.png'){this.catalogCopies++;return new Response(pixel,{headers:{'content-type':'image/png'}});}
    const url=new URL(String(input));const body=init?.body?JSON.parse(String(init.body)):{};
    if(url.href==='https://api.openai.com/v1/chat/completions'){if(this.holdModel)await new Promise<void>(resolve=>this.modelWaiters.push(resolve));return this.model(body);}
    if(url.href==='https://api.openai.com/v1/images/edits'){this.images++;if(this.holdImages)await new Promise<void>(resolve=>this.imageWaiters.push(resolve));return json({data:[{b64_json:pixel.toString('base64')}],usage:{input_tokens_details:{text_tokens:1,image_tokens:1},output_tokens_details:{image_tokens:1}}});}
    if(url.href==='https://api.openai.com/v1/responses'){this.reviewCalls++;return json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({product_matches:true,observed_prices_cents:[],currency:'NONE',unverified_claims:false,uncertain:false})}]}],usage:{input_tokens:10,input_tokens_details:{cached_tokens:0},output_tokens:5}});}
    const storeB=new Headers(init?.headers).get('authorization')?.includes('store-b');const accountId=storeB?'101':'100';
    if(url.hostname==='graph.facebook.com'){
      const id=url.pathname.split('/').at(-1)!.replace(/^act_/,'');
      if(id==='messages'){this.whatsappRequests.push({url:url.href,...body});if(this.whatsappMode==='timeout')throw Error('controlled_whatsapp_timeout');if(this.whatsappMode==='reject')return json({error:{message:'controlled rejection'}},400);return json({messages:[{id:'wamid.controlled-'+this.whatsappRequests.length}]});}
      if(id==='110'||id==='111')return json({id,has_whatsapp_number:this.pageWhatsAppLinked,...(this.pageWhatsAppLinked?{whatsapp_number:id==='110'?'5511999999999':'5511988888888'}:{})});
      if(id!==accountId)throw new Error('controlled_account_scope_mismatch');
      return json({id,currency:'BRL',...(this.fundingMode==='unknown'?{}:{is_prepay_account:this.fundingMode==='prepaid',balance:String(this.dueCents),funding_source:'12345'}),account_status:this.blocked?3:1,disable_reason:0});
    }
    if(url.href!=='https://mcp.facebook.com/ads')throw new Error('uncontrolled_external_transport');
    const names=['ads_get_ad_accounts','ads_get_field_context','ads_get_ad_entities','ads_get_ad_account_pages','ads_get_user_pages','ads_get_datasets','ads_catalog_list_catalogs','ads_create_campaign','ads_create_ad_set','ads_create_creative','ads_create_ad','ads_update_entity','ads_activate_entity'];
    if(body.method==='notifications/initialized')return new Response(null,{status:202});let result:unknown;
    if(body.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{},serverInfo:{name:'controlled-local-provider',version:'1'}};
    else if(body.method==='tools/list')result={tools:names.map(name=>({name,inputSchema:{type:'object',properties:{},additionalProperties:true}}))};
    else{
      const args=body.params.arguments as Json,name=String(body.params.name);if(args.ad_account_id&&args.ad_account_id!==accountId)throw new Error('controlled_account_scope_mismatch');let value:Json;
      if(name==='ads_get_ad_accounts')value={ad_accounts:[{ad_account_id:accountId,ad_account_name:storeB?'Conta da loja B':'Conta da loja A',currency:'BRL',is_queryable:true,is_ads_mcp_enabled:true,min_daily_budget_cents:this.minimumDailyBudgetCents,...(this.fundingMode==='unknown'?{}:{has_payment_method:true})}]};
      else if(name==='ads_get_field_context')value={fields:args.field_names.map((name:string)=>({name,levels:['campaign','adset','ad','ad_account'],type:/budget|amount_spent|values|spend_cap/.test(name)?'CURRENCY':/purchase$|^actions:/.test(name)?'INTEGER':'STRING',filterable:true,supported_filter_operators:['IN']})),unknown_fields:[]};
      else if(name==='ads_get_datasets')value={datasets:[{dataset_id:storeB?'121':'120',name:'Compras',is_active:true}]};
      else if(['ads_get_user_pages','ads_get_ad_account_pages'].includes(name))value={pages:[{page_id:storeB?'111':'110',page_name:'Página da loja'}]};
      else if(name==='ads_catalog_list_catalogs')value={catalogs:[]};
      else if(name==='ads_get_ad_entities'){
        if(this.metricsUnavailable&&args.fields?.includes('amount_spent'))return json({jsonrpc:'2.0',id:body.id,result:{structuredContent:{error:'Metrics unavailable',error_category:'VALIDATION'},content:[]}});
        const campaignFilter=args.filtering?.find((filter:Json)=>filter.field==='campaign_id')?.value;
        let rows=args.level==='account'?[{id:accountId,timezone_name:'America/Sao_Paulo',account_id:accountId}]:[...this.entities.values()].filter(row=>row.level===args.level&&row.account_id===accountId);
        if(args.object_ids?.length)rows=rows.filter(row=>args.object_ids.includes(row.id));if(campaignFilter)rows=rows.filter(row=>campaignFilter.includes(row.campaign_id));
        value={ad_entities:JSON.stringify(rows.map(row=>{
          const campaignIndex=[...this.entities.values()].filter(item=>item.level==='campaign'&&item.account_id===accountId).findIndex(item=>item.id===row.id)+1;
          const range=args.time_range?JSON.parse(args.time_range):{};
          const day=Number(String(range.until??'2026-11-16').slice(-2));
          const spend=this.sampleMetrics?Math.max(1,day-15)*campaignIndex*10:0;
          return {...row,amount_spent:{value:spend,unit:'BRL'},offsite_conversion_fb_pixel_purchase_values:{value:spend*4,unit:'BRL'},offsite_conversion_fb_pixel_purchase:0,'actions:onsite_conversion.messaging_conversation_started_7d':spend/5};
        }))};
      }else if(name.startsWith('ads_create_')){
        const id=String(++this.next),level=name==='ads_create_ad_set'?'adset':name==='ads_create_campaign'?'campaign':name==='ads_create_ad'?'ad':'creative';
        const row:Json={id,level,account_id:accountId,campaign_id:args.campaign_id??id,adset_id:args.ad_set_id,status:'PAUSED',effective_status:'PAUSED',name:args.campaign_name??args.ad_set_name??args.ad_name??args.name,targeting:args.targeting?JSON.parse(args.targeting):{},start_time:args.start_time,end_time:args.end_time,creative_id:args.creative?JSON.parse(args.creative).creative_id:undefined,lifetime_budget:{value:(args.campaign_lifetime_budget??0)/100,unit:'BRL'},daily_budget:{value:(args.campaign_daily_budget??0)/100,unit:'BRL'}};
        if(level==='ad')row.campaign_id=this.entities.get(args.ad_set_id)?.campaign_id;
        this.entities.set(id,row);this.writes.push({tool:name,accountId,entityId:id});
        value={status:'PAUSED',[level==='adset'?'ad_set_id':`${level}_id`]:id,...(level==='campaign'?{valid_optimization_goals:['OFFSITE_CONVERSIONS','CONVERSATIONS']}:{}),active_errors:[]};
      }else if(name==='ads_update_entity'||name==='ads_activate_entity'){
        const row=this.entities.get(args.entity_id);if(!row||row.account_id!==accountId)throw new Error('controlled_entity_missing');const fields=name==='ads_update_entity'?JSON.parse(args.fields):{status:'ACTIVE'};
        for(const [key,v]of Object.entries(fields))row[key]=/budget$/.test(key)?{value:Number(v)/100,unit:'BRL'}:v;
        if(fields.status)row.effective_status=fields.status;if(fields.creative)row.creative_id=fields.creative.creative_id;this.writes.push({tool:name,accountId,entityId:row.id});value={success:true,status:row.status,is_draft:false};
      }else throw new Error('unsupported_controlled_provider_tool');
      result={structuredContent:{...value,client_conversation_id:args.client_conversation_id},content:[]};
    }
    return json({jsonrpc:'2.0',id:body.id,result});
  };
}
