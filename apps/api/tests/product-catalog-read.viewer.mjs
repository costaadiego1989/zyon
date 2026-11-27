import {capturedPaymentLink,paymentViewerDocument} from './product-payment-viewer-link.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';

const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catálogo WhatsApp local</title><style>body{margin:0;background:#eef2ef;color:#183c2c;font:16px/1.5 system-ui}main{max-width:840px;margin:24px auto;padding:18px}aside{background:#173c2c;color:white;padding:12px}h1{font-size:24px}article{white-space:pre-wrap;background:white;padding:16px;margin:12px 0;border:1px solid #ccdbd2;overflow-wrap:anywhere}button{font:inherit;padding:10px 14px;margin:5px 5px 5px 0;border:1px solid #527965;background:#fff;color:#183c2c;border-radius:8px;max-width:100%}button:focus-visible,input:focus-visible{outline:3px solid #b7571c;outline-offset:2px}input{font:inherit;padding:10px;min-width:0;flex:1}form{display:flex;gap:8px;flex-wrap:wrap}small{display:block;color:#4d6658}</style><main><aside>WhatsApp local: entrada assinada, API e banco reais. Transporte Meta capturado; sem envio ou entrega externa. Perfil estruturado configurado.</aside><h1>Catálogo local — visualizador de teste</h1><p>Textos e controles vêm do adaptador original. Esta tela não é o aplicativo WhatsApp.</p><section id="messages" role="log" aria-label="Mensagens capturadas"></section><form id="compose"><label for="text">Mensagem</label><input id="text" maxlength="4000" autocomplete="off"><button>Enviar</button></form><p id="result" role="status"></p></main><script type="module">
const log=document.querySelector('#messages'),status=document.querySelector('#result');let busy=false;
function controls(value){const interactive=value?.interactive;if(!interactive)return[];return interactive.action?.buttons?.map(row=>({id:row.reply?.id,title:row.reply?.title}))??interactive.action?.sections?.flatMap(section=>section.rows??[]).map(row=>({id:row.id,title:row.title,description:row.description}))??[];}
async function refresh(){const response=await fetch('/view',{cache:'no-store'});if(!response.ok)throw Error('Leitura indisponível');const data=await response.json();log.replaceChildren();for(const entry of data.messages){const article=document.createElement('article');article.dataset.wireSequence=String(entry.sequence);article.textContent=entry.uiMessage?.interactive?.body?.text??entry.uiMessage?.text?.body??entry.text;for(const control of controls(entry.uiMessage)){if(!control.id||!control.title)continue;const button=document.createElement('button');button.type='button';button.textContent=control.title;button.dataset.controlId=control.id;button.onclick=()=>send({text:control.title,interactiveId:control.id});if(control.description){const description=document.createElement('small');description.textContent=control.description;button.append(description);}article.append(button);}log.append(article);}}
async function send(body){if(busy)return;busy=true;document.querySelectorAll('button').forEach(button=>button.disabled=true);status.textContent='Processando entrada real…';try{const response=await fetch('/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error('Falha no processamento canônico');const result=await response.json();if(result?.status!=='processed')throw Error('Falha no processamento canônico');await refresh();status.textContent='Entrada processada pela API local.';}catch(error){status.textContent=error.message;}finally{busy=false;document.querySelectorAll('button').forEach(button=>button.disabled=false);}}
document.querySelector('#compose').onsubmit=event=>{event.preventDefault();const input=document.querySelector('#text'),text=input.value;input.value='';send({text});};await refresh();
</script></html>`;

/** Only an owned browser control viewer. It forwards actual text/captured IDs
 * through original signed Meta ingress. No tool/cart/result authority is added. */
export async function createProductCatalogViewer({runtime,db,merchantId,deviceId,phoneNumberId,buyerPhone,paymentLinks=false}){
  assert.equal(typeof paymentLinks,'boolean','payment_viewer_optin_invalid');
  assert.match(buyerPhone,/^\+?\d{8,15}$/,'catalog_viewer_owned_buyer_phone_required');const ownedBuyerPhone=buyerPhone.replace(/^\+/,'');
  const document=paymentLinks?paymentViewerDocument(html):html;
  let closed=false,origin;const sockets=new Set();
  const view=()=>{const messages=runtime.whatsapp.events().filter(event=>event.kind==='sendText'
      &&typeof event.input.toNumber==='string'&&/^\+?\d{8,15}$/.test(event.input.toNumber)
      &&event.input.toNumber.replace(/^\+/,'')===ownedBuyerPhone&&event.input.deviceId===deviceId)
    .map(event=>({sequence:event.sequence,text:event.input.text,uiMessage:event.input.uiMessage,
      ...(paymentLinks?{paymentLink:capturedPaymentLink(event.input.uiMessage)}:{})}));
    assert.ok(messages.length<=80,'catalog_viewer_owned_message_bound');return{messages};};
  const send=async input=>{
    assert.ok(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(key=>['text','interactiveId'].includes(key))
      &&typeof input.text==='string'&&input.text.trim()&&input.text.length<=4000
      &&(input.interactiveId===undefined||typeof input.interactiveId==='string'&&input.interactiveId.length<=256),'catalog_viewer_input_invalid');
    let interactive;
    if(input.interactiveId){
      const messages=view().messages;let matched;
      for(const message of messages){const candidate=message.uiMessage?.interactive;
        const button=candidate?.action?.buttons?.find(row=>row.reply?.id===input.interactiveId);
        const list=candidate?.action?.sections?.flatMap(section=>section.rows??[]).find(row=>row.id===input.interactiveId);
        if(button)matched={kind:'button_reply',title:button.reply.title};else if(list)matched={kind:'list_reply',title:list.title};}
      assert.ok(matched&&matched.title===input.text,'catalog_viewer_captured_control_required');
      // Derive the native reply kind from the actual captured outbound control,
      // never a browser flag or a finished tool payload.
      interactive={[matched.kind]:{id:input.interactiveId,title:input.text}};
    }
    const eventId='c60-s1-inbound-'+randomUUID(),payload={entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:phoneNumberId},messages:[{
      id:eventId,from:buyerPhone,timestamp:String(Math.floor(Date.now()/1000)),type:interactive?'interactive':'text',
      ...(interactive?{interactive}:{text:{body:input.text}}),
    }]}}]}]};
    const raw=JSON.stringify(payload),response=await fetch(runtime.apiOrigin+'/webhooks/whatsapp/meta',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{'content-type':'application/json','x-hub-signature-256':runtime.whatsapp.signature(raw)},body:raw});
    assert.equal(response.status,200);let inbox;const until=Date.now()+15000;
    do{inbox=await db.whatsAppWebhookInbox.findFirst({where:{eventId}});if(inbox&&['processed','blocked','dead'].includes(inbox.status))break;
      await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<until);
    assert.equal(inbox?.status,'processed','catalog_viewer_real_inbox_must_process');
    assert.equal(inbox.merchantId,merchantId,'catalog_viewer_real_tenant_required');return{status:inbox.status};
  };
  const server=createServer((request,response)=>{void(async()=>{
    if(!origin||request.headers.host!==new URL(origin).host){response.statusCode=403;response.end();return;}
    response.setHeader('cache-control','no-store');
    if(request.method==='GET'&&request.url==='/'){response.setHeader('content-type','text/html;charset=utf-8');response.end(document);return;}
    if(request.method==='GET'&&request.url==='/view'){response.setHeader('content-type','application/json');response.end(JSON.stringify(view()));return;}
    if(request.method==='POST'&&request.url==='/send'){
      assert.equal(request.headers.origin,origin,'catalog_viewer_same_origin_required');let body='';
      for await(const chunk of request){body+=chunk;assert.ok(Buffer.byteLength(body)<=8192,'catalog_viewer_body_limit');}
      const result=await send(JSON.parse(body));response.setHeader('content-type','application/json');response.end(JSON.stringify(result));return;
    }
    response.statusCode=404;response.end();
  })().catch(()=>{response.statusCode=500;response.end('catalog_viewer_real_processing_failed');});});
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  const close=async()=>{if(closed)return;closed=true;
    const stop=server.listening?new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())):Promise.resolve();
    const socketClosures=[...sockets].map(socket=>new Promise(resolve=>socket.once('close',resolve)));
    server.closeIdleConnections?.();for(const socket of sockets)socket.destroy();await Promise.all([stop,...socketClosures]);
    assert.equal(server.listening,false);assert.equal(sockets.size,0);};
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert.equal(address.address,'127.0.0.1');origin='http://127.0.0.1:'+address.port;
    return Object.freeze({origin,close,view});
  }catch(error){await close();throw error;}
}