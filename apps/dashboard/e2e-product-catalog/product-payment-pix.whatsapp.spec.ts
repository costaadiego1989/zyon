import {test,expect,preparePayment,choosePayment,assertPending,approveOnce,assertPaid,capture,verifyNative} from './product-payment-helpers';
test.use({paymentChannel:'whatsapp',paymentScenario:'pix'});
test('C60 S5 signed WA Pix text, pending check and canonical approved order/stock effects',async({page,journey})=>{
  const before=await preparePayment(page,journey);const intent=await choosePayment(page,journey,'pix');
  await assertPending(journey,before,intent);await verifyNative(page);
  await expect(page.getByRole('log',{name:'Mensagens capturadas',exact:true})).toContainText(intent.buyerFacing.qrCodeCopyPaste);
  expect(intent.buyerFacing.qrCodeCopyPaste).toMatch(/^CAPTURED_PIX_NOT_PAYABLE:/);
  await expect(page.getByRole('img',{name:'QR Code Pix',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Copiar código',exact:true})).toHaveCount(0);
  await capture(page,'wa-pix-pending');await approveOnce(page,journey,intent);await assertPaid(page,journey,before,intent);await capture(page,'wa-pix-paid');
});

// Private viewer contract only: controlled body data is not buyer/payment proof.
test('C60 S5 local viewer waits for canonical response body and rejects an unprocessed status',async({page})=>{
  const {createProductCatalogViewer}=await import('../../api/tests/product-catalog-read.viewer.mjs');
  const viewer=await createProductCatalogViewer({runtime:{whatsapp:{events:()=>[]}},db:{},merchantId:'viewer-contract',
    deviceId:'META_CLOUD:viewer-contract',phoneNumberId:'900088000001',buyerPhone:'5511998000088',paymentLinks:true});
  try{
    await page.addInitScript(()=>{
      const realFetch=globalThis.fetch.bind(globalThis);
      globalThis.fetch=async(input,init)=>{
        const url=new URL(input instanceof Request?input.url:String(input),location.href);
        const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
        if(url.origin!==location.origin||url.pathname!=='/send'||method!=='POST')return realFetch(input,init);
        const body=new ReadableStream({start(controller){Reflect.set(globalThis,'__c60ReleaseViewerBody',(value={status:''})=>{
          controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));controller.close();
        });}});
        const response=new Response(body,{status:200,headers:{'content-type':'application/json'}});
        const read=response.json.bind(response);
        response.json=()=>{Reflect.set(globalThis,'__c60ViewerBodyReadStarted',true);return read();};
        Reflect.set(globalThis,'__c60ViewerHeadersAvailable',true);return response;
      };
    });
    for(const status of ['processed','blocked']){
      await page.goto(viewer.origin);
      await page.getByRole('textbox',{name:'Mensagem',exact:true}).fill('/produtos');
      await page.getByRole('textbox',{name:'Mensagem',exact:true}).press('Enter');
      await page.waitForFunction(()=>Reflect.get(globalThis,'__c60ViewerHeadersAvailable')===true
        &&Reflect.get(globalThis,'__c60ViewerBodyReadStarted')===true);
      await expect(page.getByRole('status')).toHaveText('Processando entrada real…');
      await expect(page.getByRole('button',{name:'Enviar',exact:true})).toBeDisabled();
      await page.evaluate(value=>Reflect.get(globalThis,'__c60ReleaseViewerBody')({status:value}),status);
      await expect(page.getByRole('status')).toHaveText(status==='processed'?'Entrada processada pela API local.':'Falha no processamento canônico');
      await expect(page.getByRole('log',{name:'Mensagens capturadas',exact:true})).toBeEmpty();
      await expect(page.getByRole('button',{name:'Enviar',exact:true})).toBeEnabled();
    }
  }finally{await viewer.close();}
});

// Private viewer capture/lifecycle contract only: no provider or payment proof.
test('C60 S5 local viewer binds exact buyer spelling and waits for owned TCP socket closure',async({page})=>{
  const {createProductCatalogViewer}=await import('../../api/tests/product-catalog-read.viewer.mjs');
  const {createConnection}=await import('node:net');const {once}=await import('node:events');
  const digits='5511998000088',deviceId='META_CLOUD:viewer-phone-contract';
  const captured=[
    {sequence:1,kind:'sendText',input:{toNumber:digits,deviceId,text:'Owned digits'}},
    {sequence:2,kind:'sendText',input:{toNumber:'+'+digits,deviceId,text:'Owned plus'}},
    {sequence:3,kind:'sendText',input:{toNumber:'5511998000099',deviceId,text:'Foreign buyer'}},
    {sequence:4,kind:'sendText',input:{toNumber:'+'+digits,deviceId:deviceId+'-foreign',text:'Foreign device'}},
    {sequence:5,kind:'sendMedia',input:{toNumber:digits,deviceId,text:'Wrong event kind'}},
    {sequence:6,kind:'sendText',input:{toNumber:'++'+digits,deviceId,text:'Invalid recipient'}},
    {sequence:7,kind:'sendText',input:{deviceId,text:'Missing recipient'}},
  ];
  for(const buyerPhone of [digits,'+'+digits]){
    const viewer=await createProductCatalogViewer({runtime:{whatsapp:{events:()=>captured}},db:{},merchantId:'viewer-phone-contract',
      deviceId,phoneNumberId:'900088000001',buyerPhone});
    let socket:import('node:net').Socket|undefined;
    try{
      expect(viewer.view().messages.map(entry=>({sequence:entry.sequence,text:entry.text}))).toEqual([
        {sequence:1,text:'Owned digits'},{sequence:2,text:'Owned plus'},
      ]);
      await page.goto(viewer.origin);const log=page.getByRole('log',{name:'Mensagens capturadas',exact:true});
      await expect(log.locator('article')).toHaveCount(2);await expect(log).toContainText('Owned digits');await expect(log).toContainText('Owned plus');
      for(const excluded of ['Foreign buyer','Foreign device','Wrong event kind','Invalid recipient','Missing recipient'])await expect(log).not.toContainText(excluded);
      const url=new URL(viewer.origin);socket=createConnection({host:url.hostname,port:Number(url.port)});await once(socket,'connect');
      const response=once(socket,'data');socket.write('GET /view HTTP/1.1\r\nHost: '+url.host+'\r\nConnection: keep-alive\r\n\r\n');await response;
      expect(socket.destroyed).toBe(false);const socketClosed=once(socket,'close');await viewer.close();await socketClosed;
      expect(socket.destroyed).toBe(true);
    }finally{socket?.destroy();await viewer.close();}
  }
});

// Private DOM projection only: controlled envelopes are not product/provider/payment proof.
test('C60 S5 local viewer renders native text bodies with exact interactive and legacy precedence',async({page})=>{
  const {createProductCatalogViewer}=await import('../../api/tests/product-catalog-read.viewer.mjs');
  const buyerPhone='5511998000088',deviceId='META_CLOUD:viewer-text-contract',nativeBody='Private native text body\nCriterion remains visible';
  const captured=[
    {sequence:1,kind:'sendText',input:{toNumber:buyerPhone,deviceId,text:'',uiMessage:{type:'text',text:{body:nativeBody}}}},
    {sequence:2,kind:'sendText',input:{toNumber:buyerPhone,deviceId,text:'Private suppressed text envelope',uiMessage:{type:'text',text:{body:'Preferred native text body'}}}},
    {sequence:3,kind:'sendText',input:{toNumber:buyerPhone,deviceId,text:'Private suppressed interactive envelope',uiMessage:{type:'interactive',interactive:{type:'button',body:{text:'Preferred interactive body'},action:{buttons:[{type:'reply',reply:{id:'zyon:'+'a'.repeat(32),title:'Private control'}}]}}}}},
    {sequence:4,kind:'sendText',input:{toNumber:buyerPhone,deviceId,text:'Legacy envelope fallback'}},
    {sequence:5,kind:'sendText',input:{toNumber:buyerPhone,deviceId,text:'Private suppressed empty native envelope',uiMessage:{type:'text',text:{body:''}}}},
  ];
  const viewer=await createProductCatalogViewer({runtime:{whatsapp:{events:()=>captured}},db:{},merchantId:'viewer-text-contract',
    deviceId,phoneNumberId:'900088000001',buyerPhone,paymentLinks:true});
  try{
    await page.goto(viewer.origin);const log=page.getByRole('log',{name:'Mensagens capturadas',exact:true});await expect(log.locator('article')).toHaveCount(5);
    await expect(log.locator('article[data-wire-sequence="1"]')).toHaveText(nativeBody);
    await expect(log.locator('article[data-wire-sequence="2"]')).toHaveText('Preferred native text body');
    const interactive=log.locator('article[data-wire-sequence="3"]');await expect(interactive).toContainText('Preferred interactive body');
    await expect(interactive.getByRole('button',{name:'Private control',exact:true})).toBeVisible();
    await expect(log.locator('article[data-wire-sequence="4"]')).toHaveText('Legacy envelope fallback');
    await expect(log.locator('article[data-wire-sequence="5"]')).toBeEmpty();await expect(log).not.toContainText('Private suppressed');
  }finally{await viewer.close();}
});
