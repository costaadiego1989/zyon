import test from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { HandleStatusUpdateUseCase } from './handle-status-update.use-case.js';
import {campaignNoticeFixture} from '../../../meta-ads-agent/infrastructure/__tests__/campaign-notice-fixture.js';
import {WhatsAppDeliveryService} from '../services/whatsapp-delivery.service.js';
import {createHmac} from 'node:crypto';
import {Module,type INestApplication} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {WhatsAppWebhookController} from '../../presentation/http/whatsapp-webhook.controller.js';
import {WHATSAPP_CONFIG_REPOSITORY} from '../../domain/ports/whatsapp-config-repository.port.js';
import {AcceptBubbleWhatsWebhookUseCase} from './accept-bubblewhats-webhook.use-case.js';

const localFetch=globalThis.fetch;
async function campaignFixture(send=true){
  const f=await campaignNoticeFixture(),uc=new HandleStatusUpdateUseCase(f.prisma);
  if(send)await f.sender.send(f.lease);
  const row=await f.notices.read('store-a',f.notice.id),correlationId=row.deliveryId??f.notice.id.replace('campaign_notice_','campaign_ready:');
  return{...f,uc,input:{merchantId:'store-a',configId:'config-a',messageId:'wamid.campaign-a',correlationId,status:'delivered',timestamp:'1794830400'},read:()=>f.notices.read('store-a',f.notice.id)};
}
test('ACAP-21 a scoped campaign delivery receipt updates the real notice and ledger without approving the campaign',async()=>{
  const f=await campaignFixture();try{await f.uc.receiveMetaReceipt(f.input);const row=await f.read(),delivery=await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id:row.deliveryId!}});assert.equal(row.whatsappStatus,'delivered');assert.equal(row.reviewState,'awaiting_approval');assert.equal(delivery.state,'sent');assert.deepEqual((delivery.response as {receipt:unknown}).receipt,{status:'delivered',messageId:f.input.messageId,timestamp:f.input.timestamp});assert.equal(await f.prisma.merchantNotification.count(),1);assert.equal((await f.repo.read('store-a')).proposals[f.p.id].approvedBy,null);assert.equal(f.requests.length,1);}finally{await f.close();}
});
test('ACAP-21 campaign receipt precedence keeps delivery and read stronger than failure and late sent ACK',async()=>{
  const f=await campaignFixture();try{await f.uc.receiveMetaReceipt({...f.input,status:'failed',errorCode:131053});assert.equal((await f.read()).whatsappStatus,'failed');await f.uc.receiveMetaReceipt({...f.input,status:'sent'});assert.equal((await f.read()).whatsappStatus,'failed');await f.uc.receiveMetaReceipt(f.input);assert.equal((await f.read()).whatsappStatus,'delivered');await f.uc.receiveMetaReceipt({...f.input,status:'read'});for(const status of ['sent','failed','delivered','read'])await f.uc.receiveMetaReceipt({...f.input,status});const row=await f.read(),delivery=await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id:row.deliveryId!}});assert.equal(row.whatsappStatus,'delivered');assert.equal((delivery.response as {receipt:{status:string}}).receipt.status,'read');assert.equal(Object.hasOwn(delivery.response as object,'reason'),false);assert.equal(f.requests.length,1);}finally{await f.close();}
});
test('ACAP-21 foreign store configuration or provider message cannot replace a known campaign receipt',async()=>{
  const f=await campaignFixture();try{for(const change of [{merchantId:'store-b'},{configId:'config-b'},{messageId:'wamid.foreign'}])await f.uc.receiveMetaReceipt({...f.input,...change});assert.equal((await f.read()).whatsappStatus,'accepted');const row=await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id:f.input.correlationId}});assert.equal(row.providerMessageId,'wamid.campaign-a');assert.equal(Object.hasOwn(row.response as object,'receipt'),false);}finally{await f.close();}
});
test('ACAP-22 a guessed correlation before dispatch cannot manufacture acceptance or a delivery identity',async()=>{
  const f=await campaignFixture(false);try{await f.uc.receiveMetaReceipt(f.input);const row=await f.read();assert.equal(row.dispatchStartedAt,null);assert.equal(row.deliveryId,null);assert.equal(row.whatsappStatus,'sending');assert.equal(f.requests.length,0);assert.equal(await f.prisma.whatsAppDelivery.count(),0);}finally{await f.close();}
});
test('ACAP-22 an authenticated campaign receipt can settle a lost response without resending',async()=>{
  const f=await campaignFixture(false);try{f.transport('timeout');await f.sender.send(f.lease);assert.equal((await f.read()).whatsappStatus,'unknown');await f.uc.receiveMetaReceipt(f.input);const row=await f.read();assert.equal(row.whatsappStatus,'delivered');assert.equal((await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id:row.deliveryId!}})).providerMessageId,f.input.messageId);assert.equal((await f.sender.send(f.lease)).whatsappStatus,'delivered');assert.equal(f.requests.length,1);}finally{await f.close();}
});
test('ACAP-21 an early delivery through the shared receipt path is stronger than a late adapter ACK',async()=>{
  const f=await campaignFixture(false);try{const transport=globalThis.fetch,delivery=new WhatsAppDeliveryService(f.prisma,{} as never);globalThis.fetch=async(url,init)=>{const correlation=JSON.parse(String(init?.body)).biz_opaque_callback_data;await delivery.reconcileMeta('store-a','config-a',{id:f.input.messageId,status:'delivered',biz_opaque_callback_data:correlation});await f.uc.receiveMetaReceipt({...f.input,correlationId:correlation});return transport(url,init);};const result=await f.sender.send(f.lease);assert.equal(result.whatsappStatus,'delivered');assert.equal((await f.read()).whatsappStatus,'delivered');assert.equal(f.requests.length,1);}finally{await f.close();}
});
test('ACAP-21 an early delivery failure cannot be erased by the adapter unknown response',async()=>{
  const f=await campaignFixture(false);try{f.transport('timeout');const transport=globalThis.fetch;globalThis.fetch=async(url,init)=>{const correlation=JSON.parse(String(init?.body)).biz_opaque_callback_data;await f.uc.receiveMetaReceipt({...f.input,correlationId:correlation,status:'failed',errorCode:131053});return transport(url,init);};const result=await f.sender.send(f.lease);assert.equal(result.whatsappStatus,'failed');assert.equal(result.error,'provider_delivery_failed');assert.equal(f.requests.length,1);assert.equal((await f.sender.send(f.lease)).whatsappStatus,'failed');assert.equal(f.requests.length,1);}finally{await f.close();}
});
test('ACAP-21 malformed callback data is ignored and failure details retain only an allowed numeric code',async()=>{
  const f=await campaignFixture();try{for(const change of [{timestamp:'NaN'},{timestamp:'0'},{status:'deleted'},{correlationId:'campaign_ready:bad'},{messageId:'wamid. bad'}])await f.uc.receiveMetaReceipt({...f.input,...change});assert.equal((await f.read()).whatsappStatus,'accepted');await f.uc.receiveMetaReceipt({...f.input,status:'failed',errorCode:131053,details:'private phone and credential'} as typeof f.input);const row=await f.read(),delivery=await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id:row.deliveryId!}});assert.deepEqual((delivery.response as {receipt:unknown}).receipt,{messageId:f.input.messageId,status:'failed',timestamp:f.input.timestamp,errorCode:131053});assert.equal(JSON.stringify(delivery.response).includes('private phone'),false);}finally{await f.close();}
});
test('ACAP-21 inconsistent campaign ledger notice digest device or attempt metadata cannot acquire a receipt',async()=>{
  for(const change of ['digest','notice','device','fence']){const f=await campaignFixture();try{const delivery=await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id:f.input.correlationId}}),metadata=delivery.response as Record<string,unknown>;if(change==='digest')metadata.proposalDigest='f'.repeat(64);if(change==='notice')metadata.noticeId='foreign-notice';if(change==='fence')metadata.attemptFence=999;await f.prisma.whatsAppDelivery.update({where:{id:delivery.id},data:{response:metadata,deviceId:change==='device'?'foreign-device':delivery.deviceId}});await f.uc.receiveMetaReceipt(f.input);assert.equal((await f.read()).whatsappStatus,'accepted');assert.equal(Object.hasOwn((await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id:delivery.id}})).response as object,'receipt'),false);}finally{await f.close();}}
});
test('ACAP-21 a receipt after administrative approval updates delivery facts without reopening review or dispatch',async()=>{
  const f=await campaignFixture();try{await f.service.proposals.approve('store-a',f.p.id,'owner-a',f.p.digest);await f.notices.setReviewState('store-a',f.notice.id,'approved');await f.prisma.merchantNotification.update({where:{id:f.notice.notificationId},data:{read:true}});await f.uc.receiveMetaReceipt({...f.input,status:'read'});const row=await f.read();assert.equal(row.reviewState,'approved');assert.equal(row.whatsappStatus,'delivered');assert.equal((await f.prisma.merchantNotification.findUniqueOrThrow({where:{id:f.notice.notificationId}})).read,true);assert.equal(await f.prisma.merchantNotification.count(),1);assert.equal(f.requests.length,1);assert.equal(Object.keys((await f.repo.read('store-a')).executions).length,0);}finally{await f.close();}
});
test('ACAP-21 real webhook HTTP requires the Meta raw-body HMAC and routes the exact connected phone before campaign projection',async()=>{
  const f=await campaignFixture(),previous=process.env.META_APP_SECRET;let app:INestApplication|undefined;
  try{
    process.env.META_APP_SECRET='local-campaign-webhook-secret';const delivery=new WhatsAppDeliveryService(f.prisma,{} as never);
    Reflect.defineMetadata('design:paramtypes',[Object,AcceptBubbleWhatsWebhookUseCase,WhatsAppDeliveryService,HandleStatusUpdateUseCase],WhatsAppWebhookController);
    @Module({controllers:[WhatsAppWebhookController],providers:[{provide:WHATSAPP_CONFIG_REPOSITORY,useValue:{findByMetaPhoneNumberId:async(id:string)=>id==='987654321'?f.config:null}},{provide:AcceptBubbleWhatsWebhookUseCase,useValue:{}},{provide:WhatsAppDeliveryService,useValue:delivery},{provide:HandleStatusUpdateUseCase,useValue:f.uc}]})class HttpModule{}
    app=await NestFactory.create(HttpModule,{logger:false,rawBody:true});await app.listen(0,'127.0.0.1');const url=`${await app.getUrl()}/webhooks/whatsapp/meta`;
    const body=JSON.stringify({entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'987654321'},statuses:[{id:f.input.messageId,status:'delivered',timestamp:f.input.timestamp,biz_opaque_callback_data:f.input.correlationId}]}}]}]});
    const denied=await localFetch(url,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256=invalid'},body});assert.equal(denied.status,401);assert.equal((await f.read()).whatsappStatus,'accepted');
    const foreignBody=body.replace('987654321','111111111'),foreignSignature=`sha256=${createHmac('sha256',process.env.META_APP_SECRET!).update(foreignBody).digest('hex')}`;
    assert.equal((await localFetch(url,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':foreignSignature},body:foreignBody})).status,200);assert.equal((await f.read()).whatsappStatus,'accepted');
    const signature=`sha256=${createHmac('sha256',process.env.META_APP_SECRET!).update(body).digest('hex')}`,accepted=await localFetch(url,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body});assert.equal(accepted.status,200);assert.deepEqual(await accepted.json(),{received:true});assert.equal((await f.read()).whatsappStatus,'delivered');assert.equal(f.requests.length,1);
  }finally{await app?.close();if(previous===undefined)delete process.env.META_APP_SECRET;else process.env.META_APP_SECRET=previous;await f.close();}
});

test('failed media receipt retains only a numeric provider code and stays scoped to the known message', async () => {
  const saved: any = {phase:'complete',presentation:{messages:[{type:'image'}]},sent:[{index:0,messageId:'wamid.known'}]};
  let writes=0;
  const tx: any = {$queryRaw: async(sql:any)=> { assert.ok(sql.values.includes('merchant')); assert.ok(sql.values.includes('config')); return [{response_state:saved,status:'completed'}]; },
    $executeRaw:async(sql:any)=>{writes++;const json=sql.values.find((v:any)=>typeof v==='string'&&v.startsWith('{'));assert.equal(JSON.parse(json).receipts[0].errorCode,131053);return 1;}};
  const uc = new HandleStatusUpdateUseCase({$transaction:async(fn:any)=>fn(tx)} as any);
  const input={merchantId:'merchant',configId:'config',messageId:'wamid.known',status:'failed',correlationId:'zyon:turn:0',timestamp:'123',errorCode:131053};
  await uc.receiveMetaReceipt(input);assert.equal(writes,1);assert.deepEqual(saved.receipts[0],{messageId:'wamid.known',status:'failed',timestamp:'123',errorCode:131053});
  await uc.receiveMetaReceipt({...input,messageId:'wamid.foreign'});assert.equal(writes,1);
});

test('a failed media receipt cannot recover an uncertain send or authorize dispatch continuation', async () => {
  const saved:any={phase:'dispatching',dispatchingIndex:0,presentation:{messages:[{type:'image'}]},sent:[]};
  const uc=new HandleStatusUpdateUseCase({$transaction:async(fn:any)=>fn({$queryRaw:async()=>[{response_state:saved,status:'dead'}],$executeRaw:async()=>1})} as any);
  await uc.receiveMetaReceipt({merchantId:'merchant',configId:'config',messageId:'wamid',status:'failed',correlationId:'zyon:turn:0',errorCode:131053});
  assert.equal(saved.phase,'dispatching');assert.deepEqual(saved.sent,[]);
});
