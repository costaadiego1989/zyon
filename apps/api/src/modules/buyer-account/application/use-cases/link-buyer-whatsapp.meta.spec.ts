import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { LinkBuyerWhatsAppUseCase } from "./link-buyer-whatsapp.use-case.js";
import { InMemoryOtpStore } from "../../infrastructure/in-memory-otp-store.js";

const phone = "5511987654321";
const key = `link-whatsapp:buyer-a:${phone}`;
function setup(result: any = { channel: "whatsapp_template", status: "sent", messageId: "wamid.owned" }) {
  const otp = new InMemoryOtpStore(); const sent: any[] = []; const bound: any[] = [];
  const identities = { prisma: { $transaction: async (run: any) => run({ $queryRaw: async () => [] }), buyerIdentity: { findMany: async () => [] } }, bind: async (_tx: any, buyerId: string, value: string, id: string) => { bound.push({buyerId, phone:value});return id; }, status: async () => ({ linked: true, phone: "+55 (***) *****-4321" }) };
  const useCase = new LinkBuyerWhatsAppUseCase(identities as any, otp, { findByGlobalUserId: async (id: string) => id === "buyer-a" ? {globalUserId:id} : null } as any,
    { execute: async (input) => { sent.push(input); if(result instanceof Error) throw result; return result; } });
  return {otp, sent, bound, useCase};
}

test("accepted scoped official delivery persists a five-minute proof without consent or fallback", async () => {
  const h=setup();const before=Date.now();
  assert.deepEqual(await h.useCase.send("buyer-a",phone,"store-a"),{sent:true,delivered_to:"***4321"});
  const payload=h.sent[0];const code=payload.variables.otpCode;
  assert.deepEqual(payload,{merchantId:"store-a",type:"buyer_whatsapp_link_otp",toPhone:phone,variables:{otpCode:code}});
  assert.match(code,/^\d{6}$/);
  const proof=await h.otp.findActive(key);assert.ok(proof);
  assert.equal(proof.maxAttempts,5);assert.equal(proof.attempts,0);assert.equal(proof.consumedAt,null);
  assert.ok(proof.expiresAt.getTime()>=before+300000 && proof.expiresAt.getTime()<=Date.now()+300000);
  assert.equal(proof.codeHash,createHash("sha256").update(JSON.stringify(["store-a",code])).digest("hex"));
  assert.equal(h.bound.length,0);
  await assert.rejects(h.useCase.send("buyer-a",phone,"store-b"),/otp_resend_too_soon/);
  assert.equal(h.sent.length,1);
  await assert.rejects(h.useCase.verify("buyer-a",phone,code,"store-b"),/otp_invalid/);
  assert.equal(h.bound.length,0);
  assert.deepEqual(await h.useCase.verify("buyer-a",phone,code,"store-a"),{linked:true,phone:"+55 (***) *****-4321"});
  assert.deepEqual(h.bound,[{buyerId:"buyer-a",phone}]);
  assert.equal(await h.otp.findActive(key),null);
  await assert.rejects(h.useCase.verify("buyer-a",phone,code,"store-a"),/otp_expired_or_locked/);
});

test("refused uncertain and wrong-channel delivery retain the previous valid challenge", async () => {
  for(const result of [{channel:"whatsapp_template",status:"uncertain",messageId:"wamid.uncertain"},{channel:"whatsapp_template",status:"failed",messageId:"wamid.refused"},{channel:"whatsapp_template",status:"skipped",messageId:"wamid.skipped"},{channel:"none",status:"skipped"},{channel:"whatsapp_template",status:"failed"},{channel:"whatsapp_template",status:"uncertain"},{channel:"email",status:"sent",messageId:"mail"},{channel:"bubblewhats",status:"sent",messageId:"legacy"},{channel:"whatsapp_template",status:"sent",messageId:""},new Error("timeout")]) {
    const h=setup(result);await h.otp.save({phone:key,codeHash:"existing",expiresAt:new Date(Date.now()+180000),maxAttempts:5});
    const previous=await h.otp.findActive(key);
    await assert.rejects(h.useCase.send("buyer-a",phone,"store-a"),/otp_whatsapp_delivery_unavailable/);
    assert.deepEqual(await h.otp.findActive(key),previous);assert.equal(h.sent.length,1);assert.equal(h.bound.length,0);
  }
});

test("wrong buyer missing issuer expired codes and five failed attempts cannot bind", async () => {
  const h=setup();
  await assert.rejects(h.useCase.send("buyer-a",phone,undefined),/merchant_context_required/);
  await assert.rejects(h.useCase.send("other-buyer",phone,"store-a"),/buyer_account_not_found/);
  assert.equal(h.sent.length,0);
  await h.useCase.send("buyer-a",phone,"store-a");const code=h.sent[0].variables.otpCode;
  await assert.rejects(h.useCase.verify("other-buyer",phone,code,"store-a"),/buyer_account_not_found/);
  const wrong=code==="000000"?"111111":"000000";
  for(let i=0;i<5;i++)await assert.rejects(h.useCase.verify("buyer-a",phone,wrong,"store-a"),/otp_invalid/);
  assert.equal((await h.otp.findActive(key))?.attempts,5);
  await assert.rejects(h.useCase.verify("buyer-a",phone,code,"store-a"),/otp_expired_or_locked/);
  await h.otp.save({phone:key,codeHash:createHash("sha256").update(JSON.stringify(["store-a",code])).digest("hex"),expiresAt:new Date(Date.now()-1),maxAttempts:5});
  await assert.rejects(h.useCase.verify("buyer-a",phone,code,"store-a"),/otp_expired_or_locked/);
  assert.equal(h.bound.length,0);
});

test("a valid fifth attempt consumes the code before binding and consumption failure cannot bind", async () => {
  const h=setup();await h.useCase.send("buyer-a",phone,"store-a");
  for(let i=0;i<4;i++)await h.otp.incrementAttempts(key);
  const order:string[]=[];const consume=h.otp.consume.bind(h.otp);
  h.otp.consume=async value=>{order.push("consume");await consume(value);};
  const identities=(h.useCase as any).identities;const bind=identities.bind;
  identities.bind=async(...args:any[])=>{order.push("bind");return bind(...args);};
  await h.useCase.verify("buyer-a",phone,h.sent[0].variables.otpCode,"store-a");
  assert.deepEqual(order,["consume","bind"]);assert.equal(h.bound.length,1);assert.equal(await h.otp.findActive(key),null);
  const broken=setup();await broken.useCase.send("buyer-a",phone,"store-a");
  broken.otp.consume=async()=>{throw Error("owned OTP store unavailable");};
  await assert.rejects(broken.useCase.verify("buyer-a",phone,broken.sent[0].variables.otpCode,"store-a"),/owned OTP store unavailable/);
  assert.deepEqual(broken.bound,[]);assert.ok(await broken.otp.findActive(key));
});
