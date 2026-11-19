import {readFile} from 'node:fs/promises';
import type {PrismaClient} from '@prisma/client';
import type {Client} from 'pg';
import type {CashbackRules} from '@zyon/shared-types';
import {CashbackRepository} from '../src/modules/cashback/infrastructure/cashback.repository.js';
import {CashbackService} from '../src/modules/cashback/application/cashback.service.js';
import {CashbackQueriesService} from '../src/modules/cashback/application/cashback-queries.service.js';
import {CashbackAssistantContext} from '../src/modules/cashback/application/cashback-assistant.context.js';
import {CashbackAssistantReportService} from '../src/modules/cashback/application/cashback-assistant-report.service.js';
import {cashbackConfigurationChecklist} from '../src/modules/cashback/domain/cashback-configuration-checklist.js';
import {grantCredit,advance,reserve,consume} from '../src/modules/cashback/domain/cashback.js';
import type {MerchantAssistantRuntime} from '../src/modules/merchant-assistant/infrastructure/runtime.js';

const rules:CashbackRules={earnRateBps:500,minimumEarnCents:0,maximumEarnPerOrderCents:null,buyerMonthlyEarnLimitCents:null,monthlyBudgetCents:100000,releaseTrigger:'payment_confirmed',releaseDelayDays:0,expiryDays:null,minimumRedeemOrderCents:0,maximumRedeemBps:2000,maximumRedeemCents:null,allowWithDiscounts:true,combination:{allowCoupons:true,allowAdvancedRules:false,limitMode:'respect_general',maximumCombinedDiscountBps:3000,maximumCombinedDiscountCents:null},terms:'Crédito promocional para novas compras nesta loja conforme as regras revisadas.'};
export async function installCashbackBrowserSchema(sql:Client){
 await sql.query(`CREATE TABLE merchant_rules(merchant_id TEXT PRIMARY KEY,max_discount_percent NUMERIC,minimum_margin_percent NUMERIC);
 CREATE TABLE buyer_accounts(global_user_id TEXT PRIMARY KEY,display_name TEXT,email TEXT);
 CREATE TABLE buyer_identities(merchant_id TEXT,identity_key TEXT,global_user_id TEXT,PRIMARY KEY(merchant_id,identity_key));
 CREATE TABLE payment_intents(id TEXT PRIMARY KEY,merchant_id TEXT,session_id TEXT,idempotency_key TEXT,status TEXT,amount_cents INTEGER,amount_breakdown JSONB);`);
 for(const migration of ['20261114091000_buyer_verified_phones','20261114120000_cashback'])await sql.query(await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`,import.meta.url),'utf8'));
}
export function createCashbackBrowserFixture(prisma:PrismaClient,sql:Client,clock:()=>Date){
 const repository=new CashbackRepository(prisma),service=new CashbackService(repository),queries=new CashbackQueriesService(repository,service);
 const register=(assistant:MerchantAssistantRuntime)=>assistant.contexts.register(new CashbackAssistantContext({service,reports:new CashbackAssistantReportService(queries,clock),conversations:assistant.repo,authorizeActor:assistant.authorizeActor,authorizeTool:assistant.authorizeTool,clock}));
 async function seed(){
  await sql.query("INSERT INTO merchant_rules(merchant_id,max_discount_percent) VALUES('store-a',30),('store-b',25)");
  for(const [merchantId,amount]of [['store-a',1000],['store-b',77777]]as const){
   await repository.transaction(merchantId,async tx=>{
    const wallet=await repository.wallet(tx,merchantId,`buyer-${merchantId}`),at=new Date('2026-11-01T12:00:00Z');
    grantCredit(wallet,{orderId:`grant-${merchantId}`,amountCents:amount,eligibleBaseCents:amount*20,rules,ruleVersion:1,lines:[],availableAt:at.toISOString()},at);advance(wallet,at);await repository.saveWallet(tx,wallet);
   });
  }
  await repository.transaction('store-a',async tx=>{const wallet=await repository.wallet(tx,'store-a','buyer-store-a'),at=new Date('2026-11-02T12:00:00Z');const reservation=reserve(wallet,{sessionId:'browser-order',fingerprint:'browser-report',amountCents:200,maximumCents:200},at);reservation.state='payment_pending';consume(wallet,reservation.id,'redeemed-order-a',at);await repository.saveWallet(tx,wallet);});
 }
 async function reset(){
  await sql.query('TRUNCATE cashback_refund_operations,cashback_buyer_aliases,cashback_event_receipts,cashback_earning_quotes,cashback_budget_periods,cashback_ledger_entries,cashback_reservations,cashback_grants,cashback_wallets,cashback_rule_versions,cashback_programs,merchant_rules,buyer_accounts,payment_intents CASCADE');await seed();
 }
 async function facts(){
  const states=await Promise.all(['store-a','store-b'].map(async merchantId=>{const program=await service.getProgram(merchantId,{includeConfigurationRevision:true,includeGeneralCap:true});return{merchantId,program,checklist:cashbackConfigurationChecklist(program.draft??program.published??{})};}));
  const ledger=(await sql.query("SELECT count(*)::int rows,COALESCE(sum(amount_cents),0)::text total,md5(COALESCE(string_agg(row_to_json(e)::text,',' ORDER BY id),'')) hash FROM cashback_ledger_entries e")).rows[0];
  return{states,ledger};
 }
 return{service,queries,register,seed,reset,facts};
}
