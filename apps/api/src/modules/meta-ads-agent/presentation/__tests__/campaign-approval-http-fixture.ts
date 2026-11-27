import 'reflect-metadata';
import {randomBytes} from 'node:crypto';
import {Module,type Type,type Provider} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import type {AddressInfo} from 'node:net';
import {AuthGuard} from '../../../auth/presentation/auth.guard.js';
import {JwtService} from '../../../auth/domain/services/jwt.service.js';
import {AuthCookieService} from '../../../auth/domain/services/auth-cookie.service.js';
import {PrismaAuthRepository} from '../../../auth/infrastructure/prisma-auth.repository.js';
import {campaignLaunchFixture} from '../../application/__tests__/launch-fixture.js';
import {InitialLaunchService} from '../../application/initial-launch.service.js';
import {CampaignPreparationService} from '../../application/campaign-preparation.service.js';
import {CampaignNoticeContactService} from '../../application/campaign-notice-contact.service.js';
import {MetaAdsAgentService} from '../../application/meta-ads-agent.service.js';
import {MetaAdsError} from '../../domain/types.js';
import {MetaAdsHttpErrorFilter} from '../meta-ads-agent.controller.js';
import {CampaignApprovalController} from '../campaign-approval.controller.js';

export async function campaignApprovalHttpFixture(extend?:(context:Awaited<ReturnType<typeof campaignLaunchFixture>>&{authorizeActor:(merchantId:string,actorId:string)=>Promise<void>})=>{controllers:Type[];providers:Provider[]}){
  const f=await campaignLaunchFixture();
  try{
    Object.assign(f.service.env,{META_ADS_DASHBOARD_URL:'https://dashboard.example.test'});
    await f.sql.query(`
      CREATE TABLE merchant_users(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),email TEXT NOT NULL UNIQUE,password_hash TEXT,role TEXT NOT NULL,auth_version INTEGER NOT NULL DEFAULT 0,disabled_at TIMESTAMPTZ,oauth_provider TEXT,oauth_provider_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE merchant_team_members(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES merchant_users(id),role TEXT NOT NULL,invited_by TEXT,joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(merchant_id,user_id));
      CREATE TABLE merchant_auth_sessions(id TEXT PRIMARY KEY,family_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES merchant_users(id),merchant_id TEXT NOT NULL,auth_version INTEGER NOT NULL,refresh_expires_at TIMESTAMPTZ NOT NULL,consumed_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO merchant_users(id,merchant_id,email,role) VALUES ('owner-a','store-a','owner-a@example.test','owner'),('admin-a','store-a','admin-a@example.test','admin'),('staff-a','store-a','staff-a@example.test','staff'),('owner-b','store-b','owner-b@example.test','owner');
      INSERT INTO merchant_team_members(id,merchant_id,user_id,role) SELECT id||'-membership',merchant_id,id,upper(role) FROM merchant_users;
    `);
    const authorizeActor=async(merchantId:string,actorId:string)=>{
      const member=await f.prisma.merchantTeamMember.findUnique({where:{merchantId_userId:{merchantId,userId:actorId}},include:{user:true}});
      if(!member||member.user.disabledAt||!['OWNER','ADMIN'].includes(member.role))throw new MetaAdsError('meta_ads_role_forbidden',403);
    };
    let enabled=true;
    const restartLaunches=()=>new InitialLaunchService({repo:f.repo,commerce:f.commerce,campaigns:f.service.campaigns,proposals:f.service.proposals,executions:f.executions,preparations:f.preparations,notices:f.notices,authorizeActor,enabled:()=>enabled,clock:f.clock});
    const launches=restartLaunches();
    const preparation=new CampaignPreparationService({repo:f.repo,commerce:f.commerce,campaigns:f.service.campaigns,connection:f.service.connection,preparations:f.preparations,authorizeActor,enabled:()=>enabled,clock:f.clock});
    const contact=new CampaignNoticeContactService({db:f.prisma,authorizeActor,senderNumber:async()=>'+5511999999999',clock:f.clock});
    const p=await f.propose('launch');
    const authRepo=new PrismaAuthRepository(f.prisma),jwt=new JwtService(randomBytes(32).toString('base64'),3600,authRepo);
    const tokens:Record<string,string>={};
    for(const [actor,role,merchantId] of [['owner-a','owner','store-a'],['admin-a','admin','store-a'],['staff-a','staff','store-a'],['owner-b','owner','store-b']] as const){tokens[actor]=await jwt.issue({userId:actor,merchantId,email:actor+'@example.test',role});}
    tokens.expired=jwt.sign({userId:'owner-a',merchantId:'store-a',email:'owner-a@example.test',role:'owner'},Math.floor(Date.now()/1000)-7200);
    Reflect.defineMetadata('design:paramtypes',[JwtService,AuthCookieService],AuthGuard);
    const extra=extend?.({...f,authorizeActor})??{controllers:[],providers:[]};
    @Module({controllers:[CampaignApprovalController,...extra.controllers],providers:[{provide:MetaAdsAgentService,useValue:f.service},{provide:InitialLaunchService,useValue:launches},{provide:CampaignPreparationService,useValue:preparation},{provide:CampaignNoticeContactService,useValue:contact},{provide:JwtService,useValue:jwt},{provide:AuthCookieService,useValue:new AuthCookieService('aacp_access_token',false)},AuthGuard,MetaAdsHttpErrorFilter,...extra.providers]})class HttpModule{}
    const app=await NestFactory.create(HttpModule,{logger:false});await app.listen(0,'127.0.0.1');
    // Lifecycle polling is tested by the runtime task. Keep HTTP admission assertions deterministic.
    await launches.onModuleDestroy();
    const base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/meta-ads-agent`;
    const request=(path:string,method='GET',body?:unknown,actor:string|null='owner-a',headers:Record<string,string>={})=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(actor?{Authorization:'Bearer '+(tokens[actor]??actor)}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return{...f,p,launches,restartLaunches,preparation,contact,jwt,tokens,request,enabled:(value:boolean)=>{enabled=value;},closeHttp:async()=>{await app.close();await f.close();}};
  }catch(error){await f.close();throw error;}
}
