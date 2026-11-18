import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Module,type Provider} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import type {AddressInfo} from 'node:net';
import {MetaAdsAgentModule} from '../../meta-ads-agent.module.js';
import {MetaAdsAgentService} from '../../application/meta-ads-agent.service.js';
import {InitialLaunchService} from '../../application/initial-launch.service.js';
import {CampaignPreparationService} from '../../application/campaign-preparation.service.js';
import {CampaignNoticeContactService} from '../../application/campaign-notice-contact.service.js';
import {CampaignPreparationWorker} from '../campaign-preparation.worker.js';
import {CampaignReadyNoticeWorker} from '../campaign-ready-notice.worker.js';
import {CampaignApprovalController} from '../../presentation/campaign-approval.controller.js';
import {MetaAdsHttpErrorFilter} from '../../presentation/meta-ads-agent.controller.js';
import {AuthGuard} from '../../../auth/presentation/auth.guard.js';
import {JwtService} from '../../../auth/domain/services/jwt.service.js';
import {AuthCookieService} from '../../../auth/domain/services/auth-cookie.service.js';
import {PrismaAuthRepository} from '../../../auth/infrastructure/prisma-auth.repository.js';
import type {agenticRuntimeFixture} from './runtime-fixture.js';
import type {MetaAdsRuntime} from '../runtime.js';

export async function campaignRuntimeHttp(f:Awaited<ReturnType<typeof agenticRuntimeFixture>>,runtime:MetaAdsRuntime=f.runtime){
  const tokensToBind=[MetaAdsAgentService,InitialLaunchService,CampaignPreparationService,CampaignNoticeContactService,CampaignPreparationWorker,CampaignReadyNoticeWorker];
  const production=Reflect.getMetadata('providers',MetaAdsAgentModule) as Array<{provide:unknown;inject?:unknown[]}>;
  const bindings=production.filter(provider=>tokensToBind.includes(provider.provide as typeof MetaAdsAgentService));
  assert.equal(bindings.length,tokensToBind.length,'every approval service and worker must use its actual production binding');
  const runtimeToken=bindings.find(binding=>binding.provide===MetaAdsAgentService)!.inject![0];
  assert.ok(Reflect.getMetadata('controllers',MetaAdsAgentModule).includes(CampaignApprovalController));
  const jwt=new JwtService(randomBytes(32).toString('base64'),3600,new PrismaAuthRepository(f.prisma)),tokens:Record<string,string>={};
  for(const [userId,merchantId,role] of [['owner-a','store-a','owner'],['admin-a','store-a','admin'],['owner-b','store-b','owner']] as const)tokens[userId]=await jwt.issue({userId,merchantId,role,email:userId+'@example.test'});
  Reflect.defineMetadata('design:paramtypes',[JwtService,AuthCookieService],AuthGuard);
  @Module({controllers:[CampaignApprovalController],providers:[{provide:runtimeToken,useValue:runtime},...bindings as Provider[],{provide:JwtService,useValue:jwt},{provide:AuthCookieService,useValue:new AuthCookieService('aacp_access_token',false)},AuthGuard,MetaAdsHttpErrorFilter]})class RuntimeHttpModule{}
  const app=await NestFactory.create(RuntimeHttpModule,{logger:false});await app.listen(0,'127.0.0.1');
  await Promise.all([runtime.preparationWorker.drain(),runtime.noticeWorker.drain(),runtime.launches.drain()]);
  const base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/meta-ads-agent`;
  const request=(path:string,method='GET',body?:unknown,actor:string|null='owner-a')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(actor?{Authorization:'Bearer '+tokens[actor]}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{request,close:()=>app.close(),app};
}
