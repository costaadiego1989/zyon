import test from "node:test";
import assert from "node:assert/strict";
import { marketingHttpFixture } from "../marketing-http.fixture.js";
import { MarketingLifecycleService } from "../application/marketing-lifecycle.service.js";
import { MARKETING_CLOCK, type MarketingClock } from "../domain/marketing-context.port.js";
import { MARKETING_RELATIONSHIP, type MarketingRelationshipPort } from "../../../shared/contracts/marketing.js";

test("release historical native WhatsApp imports a known phone without inventing consent or message dates",async()=>{
  const f=await marketingHttpFixture();
  try {
    f.app.get<MarketingClock>(MARKETING_CLOCK).now=()=>new Date(f.now);
    await f.db.whatsAppSession.create({data:{merchantId:f.merchantId,buyerPhone:"5511998887766",deviceId:"META_CLOUD:known-channel",
      createdAt:new Date("2026-11-26T12:00:00Z"),lastActivityAt:new Date("2026-11-27T11:00:00Z"),
      conversationState:{version:1,conversationId:"native-history",history:[{role:"user",content:"Mensagem sem data"}]}}});
    const lifecycle=f.app.get(MarketingLifecycleService);
    await lifecycle.start(f.merchantId,"owner");
    for(let i=0;i<5 && (await lifecycle.status(f.merchantId))?.status !== "completed";i++) await lifecycle.process(f.merchantId);
    assert.equal((await lifecycle.status(f.merchantId))?.status,"completed");
    const page=await f.contacts.list(f.merchantId,{limit:10,offset:0});assert.equal(page.total,1);
    const detail=await f.contacts.detail(f.merchantId,page.items[0].id);
    assert.equal(detail.contact.phone,"5511998887766");assert.equal(detail.contact.name,null);assert.equal(detail.consent,null);
    const port=f.app.get<MarketingRelationshipPort>(MARKETING_RELATIONSHIP);
    assert.deepEqual(await port.history(f.merchantId,"whatsapp","native-history"),[]);
  } finally {await f.db.whatsAppSession.deleteMany({where:{merchantId:f.merchantId}});await f.cleanup();}
});

test("release native cart advances an identified phone to shopping before checkout and stays tenant scoped",async()=>{
  const f=await marketingHttpFixture();
  try {
    const incoming=await f.contacts.inbound({merchantId:f.merchantId,channel:"whatsapp",conversationKey:"native-cart",messageId:"first",
      verifiedPhone:"5511998887766",text:"Quero tênis",receivedAt:f.now,consentChoice:"declined"});
    const port=f.app.get<MarketingRelationshipPort>(MARKETING_RELATIONSHIP);
    await f.db.storefrontCart.create({data:{merchantId:f.merchantId,sessionId:"native-cart",items:[{productId:"shoe",quantity:1}],expiresAt:new Date(Date.now()+3600000)}});
    await port.commerce("foreign-merchant","native-cart");
    assert.equal((await f.contacts.detail(f.merchantId,incoming.contactId!)).contact.stage,"new");
    await port.commerce(f.merchantId,"native-cart");
    const detail=await f.contacts.detail(f.merchantId,incoming.contactId!);
    assert.equal(detail.contact.stage,"shopping");assert.equal(detail.contact.purchaseCount,0);assert.equal(detail.contact.totalSpentCents,0);
  } finally {await f.db.storefrontCart.deleteMany({where:{merchantId:f.merchantId}});await f.cleanup();}
});
