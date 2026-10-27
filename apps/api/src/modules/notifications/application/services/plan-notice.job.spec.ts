import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { PlanNoticeJob } from "./plan-notice.job.js";
import { PlanNoticeSender, renderPlanNoticeEmail } from "../../infrastructure/adapters/plan-notice.sender.js";
import { EmailProviderRejection } from "../../domain/ports/email-provider-rejection.js";
const now = new Date("2026-09-14T12:00:00Z");
const notice = { id:"plan1",merchantId:"m1",subscriptionKey:"sub1",planKey:"growth",endsAt:new Date("2026-09-21T12:00:00Z"),milestone:"7d" };
function fixture() {
  const sent: string[] = [], results: any[] = [];
  const claims = ["email","whatsapp"].map(channel => ({id:channel,channel,attempts:1,leaseUntil:new Date(now.getTime()+90_000),notice}));
  const repo = { scan:async()=>1,expireSending:async()=>0,claim:async()=>claims.shift()??null,current:async()=>true,
    begin:async()=>true,finish:async(c:any,r:any)=>{results.push({channel:c.channel,...r});return true;} };
  const sender = { prepare:async(_n:any,channel:string)=>({send:async()=>{sent.push(channel);return {status:"accepted",providerMessageId:channel};}}) };
  return {repo,sender,sent,results,job:new PlanNoticeJob(repo as never,sender as never)};
}
test("email and WhatsApp are processed independently, including provider uncertainty", async()=>{
  const f=fixture();
  f.sender.prepare=async(_n,channel)=>({send:async()=>{ f.sent.push(channel); if(channel==="whatsapp")throw Error("transport timeout"); return {status:"accepted",providerMessageId:"email1"}; }});
  await f.job.run(()=>now);
  assert.deepEqual(f.sent,["email","whatsapp"]);
  assert.deepEqual(f.results.map(r=>r.status),["accepted","unknown"]);
});
test("renewal during preparation cancels the email before dispatch",async()=>{
  const f=fixture();let calls=0;
  f.repo.current=async()=>++calls===1;
  await f.job.run(()=>now);
  assert.equal(f.sent.length,0);
  assert.ok(f.results.every(r=>r.status==="skipped"));
});
test("a lost lease cannot dispatch; preparation failures remain retryable",async()=>{
  const f=fixture(); f.repo.begin=async()=>false;
  await f.job.run(()=>now); assert.equal(f.sent.length,0);
  const g=fixture();g.sender.prepare=async()=>{throw Error("temporary database failure");};
  await g.job.run(()=>now);assert.ok(g.results.every(r=>r.status==="retryable_failed"));
});
test("email is always eligible independently of absent Meta configuration",async()=>{
  const sent:any[]=[];
  const prisma={merchant:{findUnique:async()=>({name:"Loja <Teste>",budgetEmail:null,budgetWhatsapp:null,storeSettings:null})},
    merchantUser:{findFirst:async()=>({email:"owner@example.test"})}};
  const sender=new PlanNoticeSender(prisma as never,{send:async(input:any)=>{sent.push(input);return {status:"sent",messageId:"email1"};}} as never,
    {sendTemplate:async()=>assert.fail("WhatsApp must not gate email")} as never);
  const prepared=await sender.prepare(notice,"email");assert.ok("send" in prepared);
  assert.equal((await prepared.send()).status,"accepted");
  assert.equal(sent[0].requireDelivery,true);assert.equal(sent[0].idempotencyKey,"plan1:email");assert.match(sent[0].html,/Loja &lt;Teste&gt;/);
});
test("unconfigured email and known rate-limit rejection remain pending for retry",async()=>{
  const prisma={merchant:{findUnique:async()=>({name:"Loja",budgetEmail:null})},merchantUser:{findFirst:async()=>({email:"owner@example.test"})}};
  for(const email of [{send:async()=>({status:"skipped",messageId:""})},{send:async()=>{throw new EmailProviderRejection("resend_http_429",true,"Rate limited");}}]) {
    const sender=new PlanNoticeSender(prisma as never,email as never,{} as never);
    const prepared=await sender.prepare(notice,"email");assert.ok("send" in prepared);
    assert.equal((await prepared.send()).status,"retryable_failed");
  }
});
test("WhatsApp requires merchant contact, active Meta and approved matching template",async()=>{
  const state:any={merchant:{name:"Loja",budgetWhatsapp:"+5511999998888"},connection:{enabled:true,status:"ACTIVE",provider:"META_CLOUD"},
    template:{isActive:true,metaStatus:"approved",twilioContentSid:"zyon_plan_7d",metaLanguage:"pt_BR",
      metaVariableMap:{"1":"merchantName","2":"planName","3":"expiresAt","4":"dashboardLink"}}};
  const prisma={merchant:{findUnique:async()=>state.merchant},whatsAppChannelConfig:{findUnique:async()=>state.connection},
    postSaleMessageTemplate:{findUnique:async()=>state.template}};
  let count=0;
  const sender=new PlanNoticeSender(prisma as never,{} as never,{sendTemplate:async(input:any)=>{count++;assert.equal(input.toNumber,"+5511999998888");
    assert.equal(input.type,"plan_expiry_7d");assert.equal(input.contentVariables["2"],"Growth");return {status:"sent",messageId:"wa1"};}} as never);
  const ready=await sender.prepare(notice,"whatsapp");assert.ok("send" in ready);assert.equal((await ready.send()).status,"accepted");
  state.template.metaStatus="rejected";assert.equal((await sender.prepare(notice,"whatsapp") as any).status,"skipped");
  state.connection.enabled=false;assert.equal((await sender.prepare(notice,"whatsapp") as any).reason,"meta_not_connected");
  assert.equal(count,1);
});
test("email copy uses an escaped, absolute deadline and plan link",()=>{
  const rendered=renderPlanNoticeEmail(notice,'<script>alert("bad")</script>');
  assert.ok(!rendered.html.includes("<script>"));assert.match(rendered.html,/21\/09\/2026/);
  assert.match(rendered.html,/#billing-plans/);
});
