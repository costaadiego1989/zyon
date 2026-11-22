import {Reflector} from "@nestjs/core";
import {type Provider,type Type,ServiceUnavailableException} from "@nestjs/common";
import {SELF_DECLARED_DEPS_METADATA,PARAMTYPES_METADATA} from "@nestjs/common/constants.js";
import type {PrismaClient} from "@prisma/client";
import {PlatformAuthController} from "../src/modules/platform-control/presentation/platform-auth.controller.js";
import {PlatformAccessGuard} from "../src/modules/platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../src/modules/platform-control/presentation/platform-permission.guard.js";
import {PlatformJwtService} from "../src/modules/platform-control/domain/services/platform-jwt.service.js";
import {LoginPlatformOperatorUseCase} from "../src/modules/platform-control/application/login-platform-operator.use-case.js";
import {LoginPlatformOperatorWithRateLimitUseCase} from "../src/modules/platform-control/application/login-platform-operator-with-rate-limit.use-case.js";
import {RefreshPlatformSessionUseCase} from "../src/modules/platform-control/application/refresh-platform-session.use-case.js";
import {PrismaPlatformOperatorRepository} from "../src/modules/platform-control/infrastructure/prisma-platform-operator.repository.js";
import {AuthController} from "../src/modules/auth/presentation/auth.controller.js";
import {AuthGuard} from "../src/modules/auth/presentation/auth.guard.js";
import {JwtService} from "../src/modules/auth/domain/services/jwt.service.js";
import {AuthCookieService} from "../src/modules/auth/domain/services/auth-cookie.service.js";
import {PrismaAuthRepository} from "../src/modules/auth/infrastructure/prisma-auth.repository.js";
import {PasswordHasher} from "../src/modules/auth/domain/services/password-hasher.service.js";
import {LoginRateLimiter} from "../src/modules/auth/domain/services/login-rate-limiter.service.js";
import {DefaultMerchantIdGenerator} from "../src/modules/auth/domain/ports/merchant-id-generator.port.js";
import {RegisterMerchantUseCase} from "../src/modules/auth/application/register-merchant.use-case.js";
import {GetMeUseCase} from "../src/modules/auth/application/get-me.use-case.js";
import {LoginUseCase} from "../src/modules/auth/application/login.use-case.js";
import {LoginWithRateLimitUseCase} from "../src/modules/auth/application/login-with-rate-limit.use-case.js";
import {VerifyCaptchaUseCase} from "../src/modules/auth/application/verify-captcha.use-case.js";
import {RefreshTokenUseCase} from "../src/modules/auth/application/refresh-token.use-case.js";
import {MerchantController} from "../src/modules/merchant/presentation/merchant.controller.js";
import {GetMerchantProfileUseCase} from "../src/modules/merchant/application/merchant.use-cases.js";
import {UpdateMerchantThemeUseCase} from "../src/modules/merchant/application/update-merchant-theme.use-case.js";
import {PrismaMerchantRepository} from "../src/modules/merchant/infrastructure/prisma-merchant.repository.js";
import {BillingController} from "../src/modules/payment/presentation/http/payment-platform.controller.js";
import {GetBillingSubscriptionUseCase} from "../src/modules/payment/application/payment-platform/billing/get-billing-subscription.use-case.js";
import {PrismaPaymentPlatformRepository} from "../src/modules/payment/infrastructure/prisma-payment-platform.repository.js";
import {PrismaPaymentRepository} from "../src/modules/payment/infrastructure/prisma-payment.repository.js";
import {HandleStripeWebhookUseCase} from "../src/modules/payment/application/handle-stripe-webhook.use-case.js";
import {HandleStripePlatformEventUseCase} from "../src/modules/payment/application/payment-platform/platform-events/handle-stripe-platform-event.use-case.js";
import {HandleAsaasBillingWebhookUseCase} from "../src/modules/payment/application/payment-platform/billing/handle-asaas-billing-webhook.use-case.js";
import {StripeWebhookController} from "../src/modules/payment/presentation/http/stripe-webhook.controller.js";
import {AsaasBillingWebhookController} from "../src/modules/payment/presentation/http/asaas-billing-webhook.controller.js";
import {SUBSCRIPTION_ATTRIBUTION} from "../src/modules/payment/domain/ports/subscription-attribution.port.js";
import {ProspectBillingBridgeService} from "../src/modules/platform-prospecting/application/billing/prospect-billing-bridge.service.js";
import {TenantAccessGuard} from "../src/modules/integrations/presentation/http/tenant-access.guard.js";
import {TenantCredentialGuard} from "../src/modules/integrations/presentation/http/tenant-credential.guard.js";
import {AuthenticateMerchantApiKeyService} from "../src/modules/integrations/application/authenticate-merchant-api-key.service.js";
import {PRISMA_CLIENT} from "../src/shared/persistence/persistence.module.js";

export const operator={id:"local-operator",email:"operador@prospecting.test",password:"Local-Operador-2026!"};
export const buyer={id:"local-buyer",name:"Loja de demonstração",email:"comprador@prospecting.test",password:"Local-Comprador-2026!"};
export async function browserAccounts(db:PrismaClient,bridge:ProspectBillingBridgeService){
 const passwords=new PasswordHasher(),operators=new PrismaPlatformOperatorRepository(db);
 const platformJwt=new PlatformJwtService(operators,"local-platform-signing-key-for-browser-only",3600);
 const limiter=new LoginRateLimiter(),repo=new PrismaAuthRepository(db),merchant=new PrismaMerchantRepository(db);
 const jwt=new JwtService("local-dashboard-signing-key-for-browser-only",3600,repo),cookies=new AuthCookieService("prospect_local_dashboard",true);
 const billing=new PrismaPaymentPlatformRepository(db),payments=new PrismaPaymentRepository(db);
 const register=new RegisterMerchantUseCase(repo,passwords,jwt,new DefaultMerchantIdGenerator());
 for(const person of [{...operator,role:"platform_admin"},{id:"local-auditor",email:"auditoria@prospecting.test",password:operator.password,role:"auditor"}]){
  await db.platformOperator.upsert({where:{id:person.id},update:{},create:{id:person.id,email:person.email,passwordHash:await passwords.hash(person.password),role:person.role}});
 }
 if(!await db.merchant.findUnique({where:{id:buyer.id}})){
  await repo.createMerchantWithOwner({merchantId:buyer.id,merchantName:buyer.name,storeSlug:"loja-local",email:buyer.email,passwordHash:await passwords.hash(buyer.password)});
  await db.merchant.update({where:{id:buyer.id},data:{storeSettings:{plan_selection_pending:true,registration_pending:false}}});
 }
 const unavailable=()=>{throw new ServiceUnavailableException("resource_outside_local_preview");};
 const stripe=new HandleStripeWebhookUseCase(payments,{} as never,undefined,new HandleStripePlatformEventUseCase(billing),undefined,undefined,{
  async retrieveBillingSubscription(id:string){
   const s=await db.merchantBillingSubscription.findFirstOrThrow({where:{stripeSubscriptionId:id}});
   return {merchantId:s.merchantId,customerId:s.stripeCustomerId,subscriptionId:id,priceId:s.planKey,status:"active",cancelAtPeriodEnd:false,billingAmountCents:s.billingAmountCents};
  }} as never,undefined,undefined,undefined,undefined,bridge);
 const entries:[any,any][]=[
  [PlatformJwtService,platformJwt],[PlatformAccessGuard,new PlatformAccessGuard(platformJwt)],[PlatformPermissionGuard,new PlatformPermissionGuard(new Reflector())],
  [LoginPlatformOperatorWithRateLimitUseCase,new LoginPlatformOperatorWithRateLimitUseCase(new LoginPlatformOperatorUseCase(operators,passwords,platformJwt),limiter)],
  [RefreshPlatformSessionUseCase,new RefreshPlatformSessionUseCase(platformJwt)],
  [JwtService,jwt],[AuthCookieService,cookies],[AuthGuard,new AuthGuard(jwt,cookies)],[RegisterMerchantUseCase,register],[GetMeUseCase,new GetMeUseCase(repo)],
  [LoginWithRateLimitUseCase,new LoginWithRateLimitUseCase(new LoginUseCase(repo,passwords,jwt),limiter)],[VerifyCaptchaUseCase,new VerifyCaptchaUseCase()],
  [RefreshTokenUseCase,new RefreshTokenUseCase(jwt)],[PRISMA_CLIENT,db],[GetMerchantProfileUseCase,new GetMerchantProfileUseCase(merchant)],[UpdateMerchantThemeUseCase,new UpdateMerchantThemeUseCase(merchant)],
  [AuthenticateMerchantApiKeyService,{execute:unavailable}],[TenantCredentialGuard,new TenantCredentialGuard(jwt,cookies,{execute:unavailable} as never)],[TenantAccessGuard,new TenantAccessGuard(new Reflector())],
  [GetBillingSubscriptionUseCase,new GetBillingSubscriptionUseCase(billing)],[HandleStripeWebhookUseCase,stripe],[HandleAsaasBillingWebhookUseCase,new HandleAsaasBillingWebhookUseCase(billing)],[SUBSCRIPTION_ATTRIBUTION,bridge]
 ];
 const controllers=[PlatformAuthController,AuthController,MerchantController,BillingController,StripeWebhookController,AsaasBillingWebhookController];
 // Controllers share unrelated operations. Only the normal account/plan routes are admitted by this local composition.
 const values=new Map(entries);
 for(const controller of controllers){
  const deps=[...(Reflect.getMetadata(PARAMTYPES_METADATA,controller)??[])];
  for(const p of Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA,controller)??[])deps[p.index]=p.param;
  for(const dep of deps)if(dep&&!values.has(dep))values.set(dep,Object.freeze({execute:unavailable}));
 }
 return {controllers:controllers as Type[],providers:[...values].map(([provide,useValue])=>({provide,useValue})) as Provider[]};
}
