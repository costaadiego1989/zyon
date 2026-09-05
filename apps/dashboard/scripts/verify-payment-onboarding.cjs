// Browser regression audit: all payment API responses are intercepted with fixtures.
// Start a dashboard preview, then run npm run test:payment-onboarding.
// PAYMENT_AUDIT_ORIGIN can target an existing deployment; no real accounts or payments are changed.
const {chromium,expect}=require('@playwright/test');
const origin=process.env.PAYMENT_AUDIT_ORIGIN||'http://127.0.0.1:5188';
const api='https://api.zyon-payments.com.br';
(async()=>{
 const browser=await chromium.launch();
 let page,stage='boot';
 try{
  page=await browser.newPage({viewport:{width:1440,height:1200}});page.setDefaultTimeout(9000);
  let connections=[],createFails=true,syncFails=true,createBody=null,manualFails=true,manualStatus='pending',manualBody=null;
  let releasePrefill,heldPrefill=null,prefillRequested=false;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const connection=status=>({id:'asaas_test',provider:'asaas',status,environment:'test',account_id:'test_account',created_at:'2026-09-05T10:00:00Z',updated_at:'2026-09-05T10:00:00Z'});
  await page.addInitScript(()=>localStorage.setItem('onb_draft_test-merchant',JSON.stringify({step:4,payment:{asaasStatus:'active',stripeStatus:'active',mercadopagoStatus:'active',cryptoEnabled:false,walletAddress:''}})));
  await page.route('https://connect.facebook.net/**',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.route(api+'/**',async route=>{
   const request=route.request(),p=new URL(request.url()).pathname.replace(/^\/v1/,'');let data={},status=200;
   if(p==='/merchants/me')data={id:'test-merchant',name:'Test Store',role:'owner',plan:'BOTH',user_id:'test-user'};
   else if(p==='/billing/subscription')data={plan:'starter',status:'trialing',features:{},limits:{},usage:{}};
   else if(p==='/onboarding')data={completed:false,steps:[]};
   else if(p==='/merchants/me/store-settings'){
    if(heldPrefill){prefillRequested=true;await heldPrefill;}
    data={company:{razaoSocial:'Test Store',email:'test@example.com',cnpj:'52998224725',phone:'11999999999',address:{street:'Rua de Teste',number:'10',neighborhood:'Centro',zip:'01001000'}}};
   }
   else if(p==='/payments/connections')data=connections;
   else if(p==='/payments/connections/asaas'){
    createBody=request.postDataJSON();if(createFails){status=502;data={code:'asaas_platform_failed'};}else{connections=[connection('pending')];data=connections[0];}
   }
   else if(p==='/merchants/me/payment-connections/asaas'){
    manualBody=request.postDataJSON();if(manualFails){status=502;data={code:'asaas_platform_failed',detail:'asaas: Chave de API recusada. (invalid_access_token)'};}else{connections=[connection(manualStatus)];data=connections[0];}
   }
   else if(p==='/payments/connections/asaas/sync'){
    if(syncFails){status=502;data={code:'asaas_platform_failed'};}else{connections=[connection('active')];data=connections[0];}
   }
   else if(p==='/payments/connections/stripe/onboarding-link'){status=503;data={code:'stripe_connect_not_enabled'};expect(request.postDataJSON().return_to).toBe('onboarding');}
   else if(p==='/payments/connections/stripe/sync')data={...connection('pending'),provider:'stripe',id:'stripe_test'};
   else if(p==='/merchants/me/payment-connections/mercadopago/sync')data={...connection('active'),provider:'mercadopago',id:'mp_test'};
   else if(p.includes('/checkout/')||p.includes('/storefront/funnel/'))data=null;
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  const asaas=page.locator('.onb-field').filter({has:page.getByText('Asaas (PIX e Boleto)',{exact:true})});
  async function submitExistingAsaasKey(input,button){
   await expect(input).toHaveValue('$aact_prod_mock-only');
   await expect(button).toBeEnabled();
   await button.click();
  }
  await page.goto(origin+'/#onboarding');
  await expect(page.getByRole('heading',{name:'Pagamento',exact:true})).toBeVisible();
  await expect(asaas.getByText('Não configurado',{exact:true})).toBeVisible();
  await asaas.getByRole('button',{name:'Conectar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Conectar Asaas',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Criar conta Asaas',exact:true}).click();
  await expect(page.getByLabel('E-mail',{exact:true})).toHaveValue('test@example.com');
  await expect(page.getByLabel('Data de nascimento',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Renda ou faturamento mensal (R$)',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'Criar subconta',exact:true}).click();
  expect(createBody).toBe(null);
  await page.getByLabel('Data de nascimento',{exact:true}).fill('1990-01-31');
  await page.getByLabel('Renda ou faturamento mensal (R$)',{exact:true}).fill('2500');
  await page.getByRole('button',{name:'Criar subconta',exact:true}).click();
  await expect(page.getByText(/O Asaas não concluiu a solicitação/).last()).toBeVisible();
  expect(createBody.birth_date).toBe('1990-01-31');expect(createBody.income_value).toBe(2500);expect(createBody.email).toBe('test@example.com');expect(createBody.cpf_cnpj).toBe('52998224725');
  await expect(asaas.getByText('Conta Asaas ativa',{exact:false})).toHaveCount(0);
  createFails=false;
  await page.getByRole('button',{name:'Criar subconta',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Conectar Asaas',exact:true})).toHaveCount(0);
  await expect(asaas.getByText('Pendente',{exact:true})).toBeVisible();
  await asaas.getByRole('button',{name:'Continuar',exact:true}).click();
  await expect(page.getByText(/O Asaas não concluiu a solicitação/).first()).toBeVisible();
  await expect(asaas.getByText('Conta Asaas ativa',{exact:false})).toHaveCount(0);
  await expect(asaas.getByText('Pendente',{exact:true})).toBeVisible();
  await page.reload();await expect(asaas.getByText('Pendente',{exact:true})).toBeVisible();
  syncFails=false;await asaas.getByRole('button',{name:'Continuar',exact:true}).click();
  await expect(asaas.getByText('Conta Asaas ativa',{exact:false})).toBeVisible();
  await page.goto(origin+'/#payment-connections');
  await expect(page.getByRole('region',{name:'Asaas',exact:true}).getByText('Conectado',{exact:true})).toBeVisible();
  connections=[];await page.goto(origin+'/#onboarding');
  await expect(asaas.getByText('Não configurado',{exact:true})).toBeVisible();
  const stripe=page.locator('.onb-field').filter({has:page.getByText('Stripe Connect',{exact:true})});
  await stripe.getByRole('button',{name:'Configurar',exact:true}).click();
  await expect(page.getByText(/A conexão Stripe ainda não foi habilitada/)).toBeVisible();
  await page.goto(origin+'/?stripe_connected=1#onboarding');await expect(stripe.getByText('Pendente',{exact:true})).toBeVisible();
  await expect(page.getByText(/Seu cadastro Stripe ainda está pendente/)).toBeVisible();
  await page.goto(origin+'/?mercadopago_error=1#onboarding');await expect(page.getByText(/O Mercado Pago não concluiu a autorização/)).toBeVisible();
  await page.goto(origin+'/?mercadopago_connected=1#onboarding');await expect(page.getByText(/Mercado Pago conectado com sucesso/)).toBeVisible();
  connections=[];
  await page.goto(origin+'/#payment-connections');
  await page.getByRole('region',{name:'Asaas',exact:true}).getByRole('button',{name:/Conectar/}).click();
  await expect(page.getByRole('button',{name:'Já tenho conta',exact:true})).toHaveAttribute('aria-pressed','true');
  const asaasApiKey=page.getByLabel('Chave de API Asaas',{exact:true});
  const connectExisting=page.getByRole('button',{name:'Conectar conta existente',exact:true});
  stage='manual-rejected';
  await asaasApiKey.fill('$aact_prod_mock-only');
  await expect(asaasApiKey).toHaveValue('$aact_prod_mock-only');
  await submitExistingAsaasKey(asaasApiKey,connectExisting);
  await expect(page.getByRole('alert').filter({hasText:'Chave de API recusada'}).last()).toBeVisible();
  expect(manualBody).toEqual({api_key:'$aact_prod_mock-only',sandbox:false});
  expect(await page.evaluate(()=>JSON.stringify(localStorage).includes('$aact_prod_mock-only'))).toBe(false);
  manualFails=false;
  stage='manual-pending';
  await asaasApiKey.fill('$aact_prod_mock-only');
  await submitExistingAsaasKey(asaasApiKey,connectExisting);
  await expect(page.getByRole('heading',{name:'Conectar Asaas',exact:true})).toHaveCount(0);
  await page.goto(origin+'/#onboarding');await expect(asaas.getByText('Pendente',{exact:true})).toBeVisible();
  connections=[];await page.reload();await expect(asaas.getByText('Não configurado',{exact:true})).toBeVisible();
  heldPrefill=new Promise(resolve=>{releasePrefill=resolve});
  stage='prefill-pending';
  await asaas.getByRole('button',{name:'Conectar',exact:true}).click();
  await expect.poll(()=>prefillRequested).toBe(true);
  await expect(page.getByText('Carregando dados da loja...', {exact:true})).toBeVisible();
  await expect(page.getByLabel('Chave de API Asaas',{exact:true})).toHaveCount(0);
  releasePrefill();heldPrefill=null;
  await expect(page.getByLabel('Chave de API Asaas',{exact:true})).toHaveValue('');
  stage='manual-active-onboarding';
  await page.getByLabel('Chave de API Asaas',{exact:true}).fill('$aact_prod_mock-only');
  manualStatus='active';await submitExistingAsaasKey(page.getByLabel('Chave de API Asaas',{exact:true}),page.getByRole('button',{name:'Conectar conta existente',exact:true}));
  await expect(page.getByRole('heading',{name:'Conectar Asaas',exact:true})).toHaveCount(0);
  await expect(asaas.getByText('Conta Asaas ativa',{exact:false})).toBeVisible();
  await page.goto(origin+'/#payment-connections');await expect(page.getByRole('region',{name:'Asaas',exact:true}).getByText('Conectado',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);console.log(JSON.stringify({passed:true,apiResponses:'mocked',scenarios:['stale-local-status-cleared','real-identity-fields-required','failed-creation-never-active','pending-creation','failed-sync-never-active','approved-account-consistent-across-pages','disconnection-clears-local-status','stripe-activation-message','stripe-return-still-pending','mercadopago-denied-return','mercadopago-connected-return','manual-key-rejection-visible-inside-panel','manual-key-not-persisted-in-browser','manual-pending-consistent-after-navigation','prefill-completes-before-editing','manual-approved-consistent-across-pages']}));
 }catch(error){
  console.error(JSON.stringify({stage,form:await page.locator('form').evaluateAll(forms=>forms.map(form=>({inputs:[...form.querySelectorAll('input')].map(input=>({type:input.type,length:input.value.length,disabled:input.disabled})),buttons:[...form.querySelectorAll('button')].map(button=>({text:button.textContent,disabled:button.disabled}))})))}));
  if(process.env.PAYMENT_AUDIT_SCREENSHOT)await page.screenshot({path:process.env.PAYMENT_AUDIT_SCREENSHOT,fullPage:true});
  throw error;
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
