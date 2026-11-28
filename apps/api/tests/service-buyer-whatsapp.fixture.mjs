import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {PrismaClient} from '@prisma/client';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {lockCatalogMerchant} from '../dist/shared/persistence/catalog-stock-ledger.js';
import {MARKETING_DECLINE} from '../dist/shared/contracts/marketing.js';

const viewer=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jornada WhatsApp local</title><style>body{margin:0;background:#eef2ef;color:#183c2c;font:16px/1.5 system-ui}main{max-width:840px;margin:24px auto;padding:18px}aside{position:sticky;top:0;z-index:2000;background:#173c2c;color:white;padding:12px}h1{font-size:24px}article{white-space:pre-wrap;background:white;padding:16px;margin:12px 0;border:1px solid #ccdbd2;overflow-wrap:anywhere}button{font:inherit;padding:10px 14px;margin:5px 5px 5px 0;border:1px solid #527965;background:#fff;color:#183c2c;border-radius:8px;max-width:100%}button:focus-visible,input:focus-visible{outline:3px solid #b7571c;outline-offset:2px}input{font:inherit;padding:10px;min-width:0;flex:1}form{display:flex;gap:8px;flex-wrap:wrap}small{display:block;color:#4d6658}#result{overflow-wrap:anywhere}</style><main><aside>WhatsApp local: entrada assinada, API e banco reais. Transporte Meta capturado; sem envio ou entrega externa.</aside><h1>Atendimento por WhatsApp â€” teste local</h1><p>Os textos e botÃµes abaixo vieram do adaptador canÃ´nico. Esta tela Ã© um visualizador de teste; nÃ£o Ã© o aplicativo WhatsApp.</p><section id="messages" role="log" aria-label="Mensagens capturadas"></section><form id="compose"><label for="text">Mensagem</label><input id="text" maxlength="4000" autocomplete="off"><button>Enviar</button></form><button id="duplicate" type="button">Reentregar última entrada</button><p id="result" role="status"></p></main><script type="module">
const output=document.querySelector('#messages'),status=document.querySelector('#result');let busy=false;
function choices(message){const i=message?.interactive;if(!i)return[];return i.action?.buttons?.map(row=>({id:row.reply?.id,title:row.reply?.title}))??i.action?.sections?.flatMap(section=>section.rows??[]).map(row=>({id:row.id,title:row.title,description:row.description}))??[];}
async function refresh(){const response=await fetch('/view',{cache:'no-store'});if(!response.ok)throw Error('Leitura indisponÃ­vel');const data=await response.json();output.replaceChildren();for(const entry of data.messages){const article=document.createElement('article');article.textContent=entry.text;for(const row of choices(entry.uiMessage)){if(!row.id||!row.title)continue;const button=document.createElement('button');button.type='button';button.textContent=row.title;button.dataset.controlId=row.id;button.onclick=()=>send({text:row.title,interactiveId:row.id});if(row.description){const description=document.createElement('small');description.textContent=row.description;button.append(description);}article.append(button);}output.append(article);} }
async function send(body,path='/send'){if(busy)return;busy=true;document.querySelectorAll('button').forEach(button=>button.disabled=true);status.textContent='Processando entrada realâ€¦';try{const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error('Falha no processamento canÃ´nico');await response.json();await refresh();status.textContent='Entrada processada pela API local.';}catch(error){status.textContent=error.message;}finally{busy=false;document.querySelectorAll('button').forEach(button=>button.disabled=false);}}
document.querySelector('#compose').onsubmit=event=>{event.preventDefault();const input=document.querySelector('#text');const text=input.value;input.value='';send({text});};document.querySelector('#duplicate').onclick=()=>send({},'/duplicate');await refresh();
</script></html>`;

/** Separate WhatsApp runtime: never combined with private storefront issuer or
 * model overrides. The viewer forwards actual text/current control IDs only. */
export async function createBuyerWhatsAppJourney(mode='services'){
  assert.ok(['services','products'].includes(mode),'buyer_whatsapp_mode_invalid');
  const runtime=await createServiceTestRuntime({local:true,whatsapp:{marketingOpening:true},metaCapabilitiesFixture:'owned-empty-v1',recoveryTemplateMonitorFixture:'manual-only-v1',bookingAwaitTrace:'native18-v1',localModelFailureFixture:'owned-503-v1',native18HttpFailures:'closed-failures-v1',serviceReleaseFixture:'matching'});
  let db,server;const sockets=new Set();let lastWire,closed=false;
  const close=async()=>{if(closed)return;closed=true;const errors=[];
    try{if(server){const socketClosures=[...sockets].map(socket=>new Promise(resolve=>socket.once('close',resolve)));
      const stop=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
      server.closeIdleConnections?.();for(const socket of sockets)socket.destroy();await stop;await Promise.all(socketClosures);assert.equal(sockets.size,0);}}catch(error){errors.push(error);}
    try{await db?.$disconnect();}catch(error){errors.push(error);}try{await runtime.close();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'buyer_whatsapp_cleanup_failed');
    assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});};
  try{
    db=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runtime.db.runId}]);
    const merchantId='t93-wa-'+mode,configId=merchantId+'-config',phone='5511998000093',phoneNumberId='900046000093',deviceId='META_CLOUD:'+configId;
    await db.merchant.create({data:{id:merchantId,name:'Empresa WhatsApp local',businessMode:mode,businessModeSelectedAt:new Date(),plan:'STORE_ONLY',
      storeSettings:{company:{description:'Empresa sintÃ©tica com atendimento local.'}}}});
    await db.merchantBillingSubscription.create({data:{merchantId,status:'active',planKey:'growth'}});
    await db.merchantRule.create({data:{merchantId,maxDiscountPercent:0,minimumMarginPercent:0,allowFreeShipping:false,allowShippingDiscount:false,
      allowBonusItem:false,allowStackDiscountAndFreeShipping:false,couponBoxEnabled:false,autonomousEngineEnabled:false,freeShippingMinCartValue:0,
      maxShippingSubsidy:0,maxPartialShippingDiscount:0,offerExpirationMinutes:10,blockedRegions:[],brandVoice:'Cordial',originZip:'01310000'}});
    await db.whatsAppChannelConfig.create({data:{id:configId,merchantId,provider:'META_CLOUD',enabled:true,status:'ACTIVE',deviceId,
      credentials:{phoneNumberId,wabaId:'900046999',accessToken:'synthetic-not-a-provider-secret'}}});
    const productId=merchantId+'-offer',variantId=productId+'-variant',professionalId=merchantId+'-professional';
    const createProduct=client=>client.product.create({data:{id:productId,merchantId,name:mode==='services'?'Consulta local':'Produto físico local',type:mode==='services'?'service':'physical',isActive:true,
      ...(mode==='services'?{metadata:{serviceSchedule:{durationMinutes:30,timeZone:'America/Sao_Paulo',slots:[]}}}:{}),
      variants:{create:{id:variantId,sku:'T93-WA',isActive:true,price:{create:{basePriceInCents:5000,currency:'BRL'}},stock:{create:{quantity:10}}}}}});
    if(mode==='products')await db.$transaction(async tx=>{
      await lockCatalogMerchant(tx,merchantId);await createProduct(tx);
      const location=await tx.inventoryLocation.findFirst({where:{merchantId:merchantId,isDefault:true,isActive:true},orderBy:{id:'asc'}})
        ??await tx.inventoryLocation.create({data:{merchantId:merchantId,name:'Estoque principal',kind:'warehouse',isDefault:true,isActive:true}});
      await tx.inventoryItem.create({data:{merchantId:merchantId,locationId:location.id,sku:'T93-WA',productName:mode==='services'?'Consulta local':'Produto físico local',quantity:10,reserved:0,salePriceCents:5000}});
    });else await createProduct(db);
    if(mode==='services'){
      await db.serviceBusinessPolicy.create({data:{merchantId,admissionsEnabled:true,paymentMode:'at_attendance',holdEnabled:false,holdMinutes:null,version:1,configuredAt:new Date()}});
      await db.serviceProfessional.create({data:{id:professionalId,merchantId,publicName:'Profissional Ana',timeZone:'America/Sao_Paulo',isPublished:true,isActive:true}});
      await db.professionalService.create({data:{merchantId,professionalId,productId}});
      await db.professionalAvailability.createMany({data:Array.from({length:7},(_,weekday)=>({merchantId,professionalId,weekday,
        startMinute:600,endMinute:720,timeZone:'America/Sao_Paulo'}))});
    }
    const read=()=>db.whatsAppSession.findFirst({where:{merchantId,deviceId,buyerPhone:phone,status:'active'}});
    const snapshot=async()=>({appointments:await db.serviceAppointment.findMany({where:{merchantId},include:{payments:true},orderBy:{id:'asc'}}),
      intents:await db.paymentIntent.findMany({where:{merchantId},orderBy:{id:'asc'}}),audits:await db.appointmentAudit.findMany({where:{merchantId},orderBy:{commandId:'asc'}}),
      receipts:await db.attendanceReceipt.findMany({where:{merchantId},orderBy:{id:'asc'}}),
      events:await db.outboxMessage.findMany({where:{merchantId,producer:'service-booking'},select:{eventId:true,eventType:true,correlationId:true,causationId:true,payload:true},orderBy:{eventId:'asc'}}),
      stock:await db.productStock.findMany({where:{variantId},orderBy:{id:'asc'}}),inventory:await db.inventoryMovement.count({where:{merchantId}}),
      sessions:await db.checkoutSession.findMany({where:{merchantId},select:{sessionId:true,cart:true,customer:true,globalUserId:true},orderBy:{sessionId:'asc'}})});
    const deliver=async (wire,observation)=>{
      observation.stage='webhook_request';
      const raw=JSON.stringify(wire.payload),response=await fetch(runtime.apiOrigin+'/webhooks/whatsapp/meta',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
        headers:{'content-type':'application/json','x-hub-signature-256':runtime.whatsapp.signature(raw)},body:raw});observation.webhookStatus=response.status;assert.equal(response.status,200);
      observation.stage='inbox_poll';
      const until=Date.now()+15000;let inbox;
      do{inbox=await db.whatsAppWebhookInbox.findFirst({where:{eventId:wire.eventId}});if(inbox){observation.inbox={status:['pending','processing','processed','retry','blocked','dead'].includes(inbox.status)?inbox.status:'unknown',attempts:inbox.attempts,hasError:inbox.lastError!==null};}if(inbox&&['processed','blocked','dead'].includes(inbox.status))break;
        await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<until);
      observation.stage='inbox_processed_assertion';
      assert.equal(inbox?.status,'processed','buyer_whatsapp_inbox_must_process');return{status:inbox.status};
    };
    const send=async (body,observation)=>{
      observation.stage='input_validation';
      assert.ok(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(key=>['text','interactiveId'].includes(key))
        &&typeof body.text==='string'&&body.text.trim()&&body.text.length<=4000
        &&(body.interactiveId===undefined||typeof body.interactiveId==='string'&&body.interactiveId.length<=256),'buyer_whatsapp_input_invalid');
      const eventId='t93-browser-inbound-'+randomUUID(),payload={entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:phoneNumberId},messages:[{
        id:eventId,from:phone,timestamp:String(Math.floor(Date.now()/1000)),type:body.interactiveId?'interactive':'text',
        ...(body.interactiveId?{interactive:body.interactiveId===MARKETING_DECLINE
          ?{button_reply:{id:body.interactiveId,title:body.text}}:{list_reply:{id:body.interactiveId,title:body.text}}}:{text:{body:body.text}}),
      }]}}]}]};lastWire={eventId,payload};return deliver(lastWire,observation);
    };
    const view=()=>({messages:runtime.whatsapp.events().filter(event=>event.kind==='sendText'&&(event.input.toNumber===phone||event.input.toNumber==='+'+phone)&&(event.input.deviceId===deviceId||(event.input.marketingOpening===true&&event.input.provider==='META_CLOUD')))
      .slice(-12).map(event=>({text:event.input.uiMessage?.text?.body??event.input.uiMessage?.interactive?.body?.text??event.input.text,uiMessage:event.input.uiMessage}))});
    server=createServer((request,response)=>{const observation={stage:'request',path:request.url==='/send'?'/send':request.url==='/duplicate'?'/duplicate':'other'};void(async()=>{
      if(!request.headers.host?.startsWith('127.0.0.1:')){response.statusCode=403;response.end();return;}
      response.setHeader('cache-control','no-store');
      if(request.method==='GET'&&request.url==='/'){response.setHeader('content-type','text/html;charset=utf-8');response.end(viewer);return;}
      if(request.method==='GET'&&request.url==='/view'){response.setHeader('content-type','application/json');response.end(JSON.stringify(view()));return;}
      if(request.method==='POST'&&['/send','/duplicate'].includes(request.url)){
        assert.equal(request.headers.origin,'http://'+request.headers.host,'buyer_whatsapp_same_origin_required');
        let raw='';for await(const chunk of request){raw+=chunk;assert.ok(Buffer.byteLength(raw)<=8192,'buyer_whatsapp_body_limit');}
        observation.stage='parse_body';const body=JSON.parse(raw);let result;
        if(request.url==='/duplicate'){assert.deepEqual(body,{});assert.ok(lastWire);result=await deliver(lastWire,observation);}else result=await send(body,observation);
        response.setHeader('content-type','application/json');response.end(JSON.stringify(result));return;
      }
      response.statusCode=404;response.end();
    })().catch(error=>{
      try{const code=['ERR_ASSERTION','P2002','P2025'].includes(error?.code)?error.code:'unclassified';
        process.stderr.write('owned_whatsapp_viewer_failure:'+JSON.stringify({...observation,errorType:['AssertionError','TypeError','SyntaxError','Error','PrismaClientKnownRequestError'].includes(error?.name)?error.name:'other',code}).slice(0,1500)+'\n');
      }catch{}
      response.statusCode=500;response.end('owned_whatsapp_viewer_failed');});});
    server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert.equal(address.address,'127.0.0.1');
    return Object.freeze({origin:'http://127.0.0.1:'+address.port,merchantId,productId,variantId,professionalId,runId:runtime.db.runId,
      snapshot,state:async()=>{const row=await read();return row?.conversationState;},evidence:()=>runtime.evidence(),close});
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'buyer_whatsapp_setup_cleanup_failed');}throw error;}
}
