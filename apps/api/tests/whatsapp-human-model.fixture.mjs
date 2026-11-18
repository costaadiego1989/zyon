import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {operatorDiagnosticError,observeProviderTrapFailure} from './whatsapp-operator-delivery-diagnostics.mjs';

export const HUMAN_MODEL_REPLY='MODEL_REPLY_MUST_NOT_REPLACE_CANONICAL_HANDOFF';
export const humanModelScript=()=>[
  {phase:'storefront.intent',response:{schemaVersion:2,domain:'STORE_SUPPORT',intent:'COMPLEX_QUESTION',confidence:1,
    requiresTool:true,needsProductDiscovery:false,shoppingPhase:null,serviceRequest:null}},
  {phase:'storefront.sales',humanToolCall:{reason:'Synthetic model reason; not authority from the buyer'}},
  {phase:'storefront.sales',response:{schemaVersion:1,message:HUMAN_MODEL_REPLY}},
  {phase:'storefront.reply-review',response:{schemaVersion:1,verdict:'ALLOW',confidence:1}},
];

/** Real signed inbox/worker/tools/SQL/Redis. Only provider/model transports are
 * explicit local fixtures; no auth, repository, authority or clock override. */
export async function humanModelFixture(mode,{model=true,transcript,missing='name'}={}){
  assert.ok(['products','services'].includes(mode));assert.ok(['name','address'].includes(missing));
  const runtime=await createServiceTestRuntime({local:true,storefrontQueryModel:true,
    whatsapp:transcript?{voiceTranscripts:{'12345':transcript}}:true,...(model?{modelScript:humanModelScript()}:{} )});
  let raw;
  try{
    raw=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    assert.deepEqual(await raw.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
    const merchantId='synthetic-human-'+mode,configId=merchantId+'-config',phoneNumberId=mode==='products'?'90005701':'90005702',
      buyerPhone='5511999995701',deviceId='META_CLOUD:'+configId,conversationId=merchantId+'-conversation',checkoutId=merchantId+'-checkout',buyerId=merchantId+'-buyer';
    await raw.merchant.create({data:{id:merchantId,name:'Synthetic '+mode,businessMode:mode,businessModeSelectedAt:new Date(),
      plan:'STORE_ONLY',storeSettings:{company:{description:'Published synthetic company providing customer support.'}}}});
    await raw.merchantBillingSubscription.create({data:{merchantId,planKey:'growth',status:'active'}});
    await raw.whatsAppChannelConfig.create({data:{id:configId,merchantId,provider:'META_CLOUD',enabled:true,status:'ACTIVE',credentials:{phoneNumberId}}});
    await raw.buyerIdentity.create({data:{merchantId,identityKey:'phone:'+buyerPhone,globalUserId:buyerId}});
    const contact={email:'synthetic-buyer@example.test',phone:buyerPhone,phone_verified:true};
    const customer=missing==='name'?contact:{...contact,fullName:'Synthetic Buyer'};
    // Named historical product checkout in either business mode. This proves
    // support preserves an existing checkout, not service-booking address UX.
    const cart={cart_ref:conversationId,items:[{productId:'synthetic-preserved-product',variantId:'synthetic-preserved-variant',quantity:2,unitPrice:3}],total:6,currency:'BRL'};
    await raw.checkoutSession.create({data:{merchantId,sessionId:checkoutId,globalUserId:buyerId,conversationId,cart,customer,
      chatHistory:[{role:'assistant',content:missing==='name'?'Qual é o seu nome?':'Qual é o seu endereço?'}],createdAt:new Date(),updatedAt:new Date()}});
    const {toCheckoutSession}=await import('../dist/modules/checkout/domain/services/checkout-session-projection.js');
    const {deriveChatStage,missingFieldsForStage}=await import('../dist/modules/checkout/domain/services/customer-extraction.service.js');
    const canonical=toCheckoutSession(await raw.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:checkoutId}}}));
    assert.equal(missingFieldsForStage(canonical,deriveChatStage(canonical))[0],missing==='name'?'nome':'CEP','actual current collector precondition required');
    const session=await raw.whatsAppSession.create({data:{merchantId,buyerPhone,deviceId,checkoutSessionId:checkoutId,
      conversationState:{version:1,conversationId,stage:'checkout',checkoutSessionId:checkoutId,expectsFreeInput:true,
        history:[{role:'assistant',content:missing==='name'?'Qual é o seu nome?':'Qual é o seu endereço?'}],revision:'synthetic-current-turn',page:0,previousViews:[]}}});
    const original=new Map();
    const payload=(id,text,{audio=false,interactiveId}={})=>{
      if(original.has(id))return structuredClone(original.get(id));
      const value={entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:phoneNumberId},messages:[{
        id,from:buyerPhone,timestamp:String(Math.floor(Date.now()/1000)),type:audio?'audio':interactiveId?'interactive':'text',
        ...(audio?{audio:{id:text,mime_type:'audio/ogg'}}:interactiveId?{interactive:{list_reply:{id:interactiveId,title:text}}}:{text:{body:text}}),
      }]}}]}]};original.set(id,structuredClone(value));return value;
    };
    const post=async value=>{const body=JSON.stringify(value),response=await fetch(runtime.apiOrigin+'/webhooks/whatsapp/meta',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),headers:{'content-type':'application/json','x-hub-signature-256':runtime.whatsapp.signature(body)},body});
      assert.equal(response.status,200);assert.deepEqual(await response.json(),{received:true});};
    const processed=async id=>{
      const observedCodes=[];
      const end=Date.now()+15_000;
      do{const row=await raw.whatsAppWebhookInbox.findFirst({where:{eventId:id}});
        // Observe only the already-returned row; no new query, wait or retry.
        try{if(typeof row?.lastError==='string'&&/^whatsapp_[a-z0-9_]{1,96}$/.test(row.lastError)
          &&observedCodes.length<3&&!observedCodes.includes(row.lastError))observedCodes.push(row.lastError);}catch{}
        // Failure-only bounded observation; the terminal assertion below is unchanged.
        if(row&&['blocked','dead'].includes(row.status))try{
          const events=runtime.storefrontQueryModel.events().slice(0,40);
          console.info('t57_inbox_diagnostic',JSON.stringify({
            code:typeof row.lastError==='string'&&/^whatsapp_[a-z0-9_]{1,96}$/.test(row.lastError)?row.lastError:null,
            observedCodes:[...observedCodes],
            eventCounts:{queryEmbedding:events.filter(event=>event.kind==='queryEmbedding').length,providerFetch:events.filter(event=>event.kind==='providerFetch').length},
            phases:Object.fromEntries(['storefront.intent','storefront.sales','storefront.reply-review'].map(phase=>[phase,events.filter(event=>event.kind==='providerFetch'&&event.input.phase===phase).length])),
          }));
        }catch{}
        if(row&&['blocked','dead'].includes(row.status))assert.fail('synthetic_human_inbox_terminal:'+row.status);
        if(row?.status==='processed')return row;await new Promise(done=>setTimeout(done,20));
      }while(Date.now()<end);assert.fail('synthetic_human_inbox_not_processed');
    };
    const snapshot=async()=>({checkout:await raw.checkoutSession.findUnique({where:{merchantId_sessionId:{merchantId,sessionId:checkoutId}}}),
      binding:await raw.whatsAppHandoffBinding.findFirst({where:{merchantId,whatsappSessionId:session.id}}),
      tickets:await raw.supportTicket.findMany({where:{merchantId,sessionId:session.id},orderBy:{id:'asc'}}),
      payments:await raw.paymentIntent.count({where:{merchantId}}),orders:await raw.completedOrder.count({where:{merchantId}})});
    const sent=()=>runtime.whatsapp.events().filter(event=>['sendText','sendMedia'].includes(event.kind));
    const text=()=>sent().map(event=>event.input.uiMessage?.text?.body??event.input.uiMessage?.interactive?.body?.text??event.input.text??'').join('\n');
    const close=async()=>{
      const errors=[];
      try{await raw.$disconnect();}catch(error){errors.push(error);}
      try{await runtime.close();assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});}catch(error){errors.push(error);}
      if(errors.length){const error=new AggregateError(errors,'t57_fixture_cleanup_failed');
        try{observeProviderTrapFailure(error);console.info('t57_close_diagnostic',JSON.stringify({error:operatorDiagnosticError(error)}));}catch{}throw error;}
    };
    return{runtime,raw,merchantId,configId,buyerPhone,session,conversationId,checkoutId,payload,post,processed,snapshot,sent,text,close};
  }catch(error){const errors=[error];try{if(raw)await raw.$disconnect();}catch(cleanup){errors.push(cleanup);}
    try{await runtime.close();}catch(cleanup){errors.push(cleanup);}throw errors.length===1?error:new AggregateError(errors,'t57_fixture_setup_cleanup_failed');}
}

/** Failure-only projection of existing bounded model events; never prompts,
 * customer content, arguments, private authority, new IO or a retry. */
export function observeHumanModelFailure(f,error){
  try{
    const events=f.runtime.storefrontQueryModel.events().slice(0,40);
    const providers=events.filter(event=>event.kind==='providerFetch');
    const domain=new Set(['STORE_COMMERCE','STORE_SUPPORT','OUT_OF_SCOPE','UNCLEAR']);
    const intent=new Set(['PRODUCT_SEARCH','ADD_CART','COMPARE_PRODUCTS','NEGOTIATE_PRICE','RECOMMEND_PERSONALIZED','ORDER_STATUS','RETURN_REQUEST','GREETING','COMPLEX_QUESTION']);
    const classifiers=providers.filter(event=>event.input.phase==='storefront.intent').slice(0,2).map(event=>{
      const value=event.result.response;
      return{schemaVersion:value?.schemaVersion===2?2:null,domain:domain.has(value?.domain)?value.domain:null,
        intent:intent.has(value?.intent)?value.intent:null,confidence:typeof value?.confidence==='number'&&Number.isFinite(value.confidence)?value.confidence:null,
        requiresTool:typeof value?.requiresTool==='boolean'?value.requiresTool:null,
        needsProductDiscovery:typeof value?.needsProductDiscovery==='boolean'?value.needsProductDiscovery:null,
        shoppingPhase:['clarify','search'].includes(value?.shoppingPhase)?value.shoppingPhase:null,
        serviceRequest:['informational','live_facts','professional_decision'].includes(value?.serviceRequest)?value.serviceRequest:null};
    });
    console.info('t57_case_diagnostic',JSON.stringify({error:operatorDiagnosticError(error),
      eventCounts:{queryEmbedding:events.filter(event=>event.kind==='queryEmbedding').length,providerFetch:providers.length},
      phases:Object.fromEntries(['storefront.intent','storefront.sales','storefront.reply-review'].map(phase=>[phase,providers.filter(event=>event.input.phase===phase).length])),
      classifiers,humanToolCalls:providers.filter(event=>!!event.result.humanToolCall).length,
      salesAnnouncedHumanTool:providers.filter(event=>event.input.phase==='storefront.sales'&&event.input.toolNames.includes('escalate_to_human')).length,
    }));
  }catch{}
}
