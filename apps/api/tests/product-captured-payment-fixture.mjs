import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {MODULE_METADATA} from '@nestjs/common/constants.js';

const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
const id=value=>typeof value==='string'&&value.length>0&&value.length<=191&&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);
const run=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const check=(condition,reason)=>assert.ok(condition,'captured_product_payment_'+reason);
const amount=(value,cents)=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value*100-cents)<0.000001;
export function validateCapturedProductPaymentOptions(value){
  if(value.capturedProductPayments===undefined)return false;
  check(value.capturedProductPayments===true,'option_invalid');
  check(!value.graph&&!value.supportQueryModel&&!value.observeBusinessRag,'composition_invalid');
  const browser=value.buyerBooking===true&&value.buyerBrowser===true&&value.whatsapp===undefined;
  const whatsapp=value.whatsapp!==undefined&&value.buyerBooking===undefined&&value.buyerBrowser===undefined;
  check(browser||whatsapp,'composition_invalid');return true;
}
export function validateCapturedProductPaymentControl(value,runId){
  check(keys(value,['type','runId','requestId','operation','input'])&&value.type==='local_product_payment_request'
    &&value.runId===runId&&/^[a-f0-9]{32}$/.test(value.requestId??''),'control_invalid');
  if(value.operation==='bind')check(keys(value.input,['ownerToken'])&&typeof value.input.ownerToken==='string'
    &&value.input.ownerToken.length>0&&value.input.ownerToken.length<=8192,'control_invalid');
  else check(value.operation==='notification'&&keys(value.input,['intentId','variant'])&&id(value.input.intentId)
    &&['matching','bad_token','wrong_value','wrong_reference'].includes(value.input.variant),'control_invalid');
  return structuredClone(value);
}

/** Synthetic PSP transport, never a repository, event consumer or payment API.
 * The actual RoutingPaymentAdapter/AsaasPaymentAdapter retain route validation,
 * account fingerprints, parsing, customer creation and cancellation policy. */
export function createCapturedAsaasProductFixture(runId,onEvidence=()=>{},options){
  check(options===undefined||keys(options,['pixImage'])&&options.pixImage==='nonpayable-png-v1','image_option_invalid');
  // A one-pixel PNG only proves the image wire/render path; never a bank QR.
  const encodedImage=options?.pixImage?'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=':undefined;
  check(run(runId)&&typeof onEvidence==='function','run_invalid');const nonce=runId.replaceAll('-','');
  const apiKey='$aact_hmlg_captured_'+randomBytes(32).toString('hex'),webhookToken=randomBytes(32).toString('hex');
  let closed=false,binding,bindingInFlight=false,deps,sequence=0,localCalls=0,refused=0;
  const customers=new Map(),payments=new Map(),byIntent=new Map();
  const alive=()=>check(!closed,'closed');
  const scoped=async()=>{
    alive();check(binding&&deps,'scope_required');
    const merchant=await deps.prisma.merchant.findUnique({where:{id:binding.merchantId},select:{businessMode:true,businessModeNeedsReview:true}});
    const connection=await deps.platform.getConnection(binding.merchantId,'asaas');
    const secret=await deps.platform.getConnectionSecret(binding.merchantId,'asaas');
    check(merchant?.businessMode==='products'&&merchant.businessModeNeedsReview===false&&connection?.status==='active'
      &&connection.environment==='test'&&connection.chargesEnabled===true&&secret===apiKey,'connection_changed');
    return binding;
  };
  const canonicalIntent=async intentId=>{
    await scoped();const row=await deps.prisma.paymentIntent.findFirst({where:{id:intentId,merchantId:binding.merchantId}});
    const input=row?.creation?.input;
    check(row&&input&&input.merchantId===binding.merchantId&&input.intentId===row.id&&input.sessionId===row.sessionId
      &&input.provider==='asaas'&&input.currency==='BRL'&&row.currency==='BRL'&&Number.isSafeInteger(input.amountCents)
      &&input.amountCents>0&&input.amountCents===row.amountCents&&input.method===row.method&&['pix','card'].includes(row.method)
      &&!input.marketplaceFunding&&!input.marketplacePublicAdmission&&!input.settlementMode&&!input.creditCard&&!input.creditCardHolderInfo,'canonical_intent_required');
    return{row,input};
  };
  const json=value=>Response.json(value);
  const fetch=async(raw,init={})=>{
    alive();await scoped();const url=new URL(raw instanceof Request?raw.url:String(raw));
    const headers=new Headers(init.headers),method=init.method??'GET';
    if(url.origin!=='https://api-sandbox.asaas.com'||url.username||url.password||url.hash||headers.get('access_token')!==apiKey
      ||init.signal?.aborted){refused++;onEvidence({localCapturedPSPCalls:localCalls,refusedCapturedRequests:refused,externalProviderCalls:0});throw Error('captured_product_payment_transport_refused');}
    check(localCalls<120,'transport_bound');localCalls++;onEvidence({localCapturedPSPCalls:localCalls,refusedCapturedRequests:refused,externalProviderCalls:0});
    if(url.pathname==='/v3/customers'&&method==='GET'){
      check([...url.searchParams.keys()].every(key=>key==='cpfCnpj')&&/^\d{11,14}$/.test(url.searchParams.get('cpfCnpj')??''),'customer_query_invalid');
      const value=customers.get(url.searchParams.get('cpfCnpj'));return json({data:value?[value]:[]});
    }
    if(url.pathname==='/v3/payments'&&method==='GET'){
      check([...url.searchParams.keys()].every(key=>['externalReference','limit'].includes(key))&&url.searchParams.get('limit')==='100','recovery_query_invalid');
      const intentId=url.searchParams.get('externalReference');await canonicalIntent(intentId);
      const payment=byIntent.get(intentId);return json({data:payment?[payment]:[],hasMore:false});
    }
    check(!url.search,'unexpected_query');
    if(url.pathname==='/v3/customers'&&method==='POST'){
      const body=JSON.parse(init.body);check(keys(body,['name','email','cpfCnpj','phone','mobilePhone'])&&typeof body.name==='string'
        &&typeof body.email==='string'&&body.email.endsWith('@buyer-journey.example.test')&&/^\d{11,14}$/.test(body.cpfCnpj??''),'customer_body_invalid');
      let value=customers.get(body.cpfCnpj);if(!value){check(customers.size<8,'customer_bound');value={id:'cus_captured_'+nonce+'_'+customers.size};customers.set(body.cpfCnpj,value);}
      return json(value);
    }
    if(url.pathname==='/v3/payments'&&method==='POST'){
      const body=JSON.parse(init.body),{row,input}=await canonicalIntent(body.externalReference);
      check(keys(body,['customer','billingType','value','dueDate','description','externalReference','split'])&&customers.size>0
        &&[...customers.values()].some(value=>value.id===body.customer)&&body.customer===input.asaasCustomerId
        &&body.billingType===(input.method==='pix'?'PIX':'CREDIT_CARD')&&amount(body.value,input.amountCents)
        &&['pending','requires_action'].includes(row.status),'creation_mismatch');
      const splits=body.split??[];check(Array.isArray(splits)&&splits.length===((input.platformFeeCents??0)>0?1:0)
        &&splits.every(value=>value.walletId==='wallet_captured_platform_'+nonce&&amount(value.fixedValue,input.platformFeeCents)),'split_mismatch');
      let payment=byIntent.get(row.id);
      if(!payment){check(payments.size<8,'payment_bound');const paymentId='pay_captured_'+nonce+'_'+(++sequence);
        payment={object:'payment',id:paymentId,externalReference:row.id,customer:body.customer,billingType:body.billingType,
          value:body.value,currency:'BRL',status:'PENDING',deleted:false,netValue:body.value,
          split:(body.split??[]).map((value,index)=>({id:'split_'+paymentId+'_'+index,fixedValue:value.fixedValue})),
          invoiceUrl:'https://sandbox.asaas.com/i/captured_'+nonce+'_'+sequence};
        payments.set(paymentId,payment);byIntent.set(row.id,payment);}
      return json(payment);
    }
    const matched=/^\/v3\/payments\/([A-Za-z0-9_-]+)(\/pixQrCode)?$/.exec(url.pathname);
    check(matched,'unexpected_endpoint');const payment=payments.get(matched[1]);check(payment,'observed_payment_required');
    const {row,input}=await canonicalIntent(payment.externalReference);
    check((row.providerPaymentId===payment.id||row.providerPaymentId===null)&&amount(payment.value,input.amountCents),'observed_payment_mismatch');
    if(matched[2]){check(method==='GET'&&payment.billingType==='PIX'&&!payment.deleted,'pix_request_invalid');
      return json({payload:'CAPTURED_PIX_NOT_PAYABLE:'+payment.id,...(encodedImage?{encodedImage}:{})});}
    if(method==='DELETE'){
      // The reviewed real adapter now supports strict standalone unpaid card/Pix cancellation.
      check(payment.billingType===(input.method==='pix'?'PIX':'CREDIT_CARD')&&payment.status==='PENDING'&&!payment.deleted
        &&payment.subscription==null&&payment.installment==null,'cancellation_unsupported');payment.deleted=true;return json({id:payment.id,deleted:true});
    }
    check(method==='GET','unexpected_method');return json(payment);
  };
  return Object.freeze({fetch,
    installEnvironment(env){
      alive();const values={ASAAS_SANDBOX:'true',ASAAS_API_KEY_SANDBOX:apiKey,ASAAS_BASE_URL_SANDBOX:'https://api-sandbox.asaas.com',
        ASAAS_WEBHOOK_TOKEN:webhookToken,ASAAS_PLATFORM_WALLET_ID_TEST:'wallet_captured_platform_'+nonce};
      const original=new Map(Object.keys(values).map(key=>[key,{present:Object.hasOwn(env,key),value:env[key]}]));Object.assign(env,values);let restored=false;
      return{restore(){if(restored)return;for(const[key,value]of original)value.present?env[key]=value.value:delete env[key];restored=true;}};
    },
    install(module,tokens){
      alive();const original=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,module),matches=original?.filter(value=>value?.provide===tokens.PAYMENT_PROVIDER_PORT);
      check(Array.isArray(original)&&matches?.length===1&&Array.isArray(matches[0].inject)&&matches[0].inject.length===6,'metadata_required');
      const replacement=original.map(value=>value!==matches[0]?value:{provide:tokens.PAYMENT_PROVIDER_PORT,inject:[...value.inject,tokens.PRISMA_CLIENT],
        useFactory:(asaas,stripe,mercadopago,evmCrypto,platform,http,prisma)=>{
          check(process.env.E2E_SEED_ENABLED!=='true','default_stub_forbidden');deps={platform,prisma};
          const provider=tokens.resolvePaymentProvider({stripe:tokens.isStripeConfigured()?stripe:null,asaas:tokens.isAsaasConfigured()?asaas:null,
            mercadopago:tokens.isMercadoPagoConfigured()?mercadopago:null,evmCrypto,platformConnections:platform,
            asaasBaseUrl:tokens.readAsaasConnection().baseUrl,mercadopagoBaseUrl:tokens.readMercadoPagoConnection().baseUrl,fetchImpl:fetch});
          check(provider.constructor.name==='RoutingPaymentAdapter','canonical_router_required');return provider;
        }});
      Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,replacement,module);let restored=false;
      return{overrides:['payment.PAYMENT_PROVIDER_PORT.fetch'],restore(){if(restored)return;
        check(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,module)===replacement,'metadata_changed');
        Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,original,module);restored=true;}};
    },
    async bindOwner(ownerToken,{jwt,tenantContext}){
      alive();check(deps&&!binding&&!bindingInFlight,'bind_once_required');bindingInFlight=true;
      try{const principal=await jwt.authenticate(ownerToken);
      check(principal.role==='owner'&&id(principal.merchantId)&&principal.email.endsWith('@buyer-journey.example.test'),'actual_owner_required');
      return await tenantContext.run({merchantId:principal.merchantId,userId:principal.userId,role:principal.role},async()=>{
        const merchant=await deps.prisma.merchant.findUnique({where:{id:principal.merchantId},select:{businessMode:true,businessModeNeedsReview:true}});
        check(merchant?.businessMode==='products'&&merchant.businessModeNeedsReview===false,'product_owner_required');
        check((await deps.platform.listConnections(principal.merchantId)).length===0,'new_owned_connection_required');
        await deps.platform.saveConnection({merchantId:principal.merchantId,provider:'asaas',environment:'test',status:'active',secret:apiKey,
          externalAccountId:'captured_account_'+nonce,walletId:'wallet_captured_merchant_'+nonce,chargesEnabled:true,payoutsEnabled:false});
        binding={merchantId:principal.merchantId,userId:principal.userId,role:'owner'};
        return{merchantId:binding.merchantId,syntheticSandboxConnection:true};
      });}finally{bindingInFlight=false;}
    },
    async notification(intentId,variant,tenantContext){
      alive();check(binding&&['matching','bad_token','wrong_value','wrong_reference'].includes(variant),'notification_invalid');
      return tenantContext.run({...binding},async()=>{
        const{row}=await canonicalIntent(intentId),payment=byIntent.get(intentId);
        check(payment&&row.providerPaymentId===payment.id&&!payment.deleted,'created_payment_required');
        if(variant==='matching')payment.status='RECEIVED';
        const body={id:'evt_captured_'+payment.id+'_'+variant,event:'PAYMENT_RECEIVED',payment:{...structuredClone(payment),
          ...(variant==='wrong_value'?{value:(row.amountCents+1)/100}:{}),
          ...(variant==='wrong_reference'?{externalReference:'pay_int_unknown_captured_reference'}:{})}};
        // Private worker->parent envelope only. Parent sends to its owned API,
        // consumes the secret header and exposes only sanitized HTTP outcome.
        return{path:'/webhooks/asaas',headers:{'content-type':'application/json','asaas-access-token':variant==='bad_token'?'invalid-captured-token':webhookToken},body};
      });
    },
    evidence:()=>({syntheticPSP:true,authentication:'Asaas secret token; timingSafeEqual; not HMAC',
      localCapturedPSPCalls:localCalls,refusedCapturedRequests:refused,externalProviderCalls:0,observedCharges:payments.size,
      nonpayablePix:true,hostedProviderUi:'not_proven',cardCancellation:'strict_standalone_pending_unpaid_readback'}),
    close(){closed=true;binding=undefined;customers.clear();payments.clear();byIntent.clear();deps=undefined;},
  });
}