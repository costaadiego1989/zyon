import test from "node:test";
import assert from "node:assert/strict";
import { HandleMetaConversationUseCase } from "../../whatsapp-channel/application/use-cases/handle-meta-conversation.use-case.js";
import { HandleIncomingMessageUseCase } from "../../whatsapp-channel/application/use-cases/handle-incoming-message.use-case.js";

for (const scenario of [
  {stage:"awaiting_nps",question:"5 Ótimo atendimento",expected:{merchantId:"store",buyerId:"buyer",orderId:"order",score:10,feedback:"Ótimo atendimento"}},
  {stage:"awaiting_review",question:"4 Produto confortável",expected:{merchantId:"store",buyerId:"buyer",productId:"product",orderId:"order",rating:4,text:"Produto confortável"}},
]) {
  test(`release native consent resumes the original ${scenario.stage} answer exactly once`, async () => {
    const answers:unknown[]=[];
    let sends=0;
    const session:any={id:"session",currentOptions:[],previousOptions:[],currentPage:0,
      postSaleContext:{stage:scenario.stage,buyerId:"buyer",orderId:"order",productId:"product",askedAt:new Date().toISOString()},
      conversationState:{version:1,conversationId:"conversation",stage:"store",history:[],revision:"",page:0,previousViews:[]}};
    const repository={update:async(_id:string,value:any)=>Object.assign(session,value),clearPostSaleContext:async()=>{delete session.postSaleContext;}};
    const sender={sendUi:async()=>{sends++;return {status:"sent",messageId:"sent"};}};
    const marketing={enabled:async()=>true,inbound:async(i:any)=>({conversationId:"crm",contactId:"contact",human:false,
      openingRequired:i.messageId==="answer",originalQuestion:scenario.question,responseKey:"answer"}),
      opening:async(_a:unknown,_b:unknown,deliver:()=>Promise<unknown>)=>{await deliver();return true;},
      aiReply:async(_a:unknown,_b:unknown,_c:unknown,_d:unknown,deliver:()=>Promise<unknown>)=>{await deliver();return true;},
      commerce:async()=>{},history:async()=>[]};
    const responses=new Map<string,Record<string,unknown>>();
    const native=new HandleMetaConversationUseCase({respondStore:async()=>assert.fail("post-sale owns its answer")} as never,repository as never,
      {saveResponse:async(claim:any,state:any)=>{responses.set(claim.id,structuredClone(state));return true;}} as never,sender as never,
      undefined,undefined,undefined,undefined,marketing as never,
      {sendOpening:async()=>{sends++;return {status:"accepted",messageId:"opening"};}} as never);
    const replies={handleNpsReply:async(input:unknown)=>{answers.push(input);},handleReviewReply:async(input:unknown)=>{answers.push(input);}};
    const incoming=new HandleIncomingMessageUseCase({execute:async()=>({whatsappSession:session,buyerData:{}})} as never,sender as never,
      repository as never,{} as never,replies as never,native);
    const input=(body:string,id:string)=>({merchantId:"store",provider:"META_CLOUD",deviceId:"META_CLOUD:config",fromNumber:"5511000000001",
      body,timestamp:Date.now(),providerMessageId:id,inboxClaim:{id,eventId:id,merchantId:"store",leaseToken:"lease",responseState:responses.get(id)}} as never);
    await incoming.execute(input(scenario.question,"answer"));assert.deepEqual(answers,[]);assert.equal(sends,1);
    await incoming.execute(input("marketing_decline_v1","choice"));
    assert.deepEqual(answers,[scenario.expected]);assert.equal(session.postSaleContext,undefined);assert.equal(sends,2);
    await incoming.execute(input("marketing_decline_v1","choice"));
    assert.deepEqual(answers,[scenario.expected]);assert.equal(sends,2);
  });
}
