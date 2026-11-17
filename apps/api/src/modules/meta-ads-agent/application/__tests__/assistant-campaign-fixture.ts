import {agenticRuntimeFixture} from '../../infrastructure/__tests__/runtime-fixture.js';
import {assistantScope} from './assistant-fixture.js';

export async function assistantCampaignFixture(flags:Record<string,string|undefined>={}){
  const f=await agenticRuntimeFixture({META_ADS_AGENT_CAMPAIGN_APPROVAL_ENABLED:'true',...flags});
  try{
    const context=await f.assistant.contexts.resolve(assistantScope),thread=await f.assistant.repo.createThread(assistantScope);
    const turn=(await f.assistant.admission.submit(assistantScope,thread.id,{message:'Quero anunciar a camisa da loja',expectedRevision:0,idempotencyKey:'briefing'})).turn;
    const input={scope:assistantScope,threadId:thread.id,turnId:turn.id,leaseToken:'briefing-lease'};
    const at=async(iso:string,renewLease=true)=>{f.setNow(iso);if(renewLease)await f.assistant.repo.atomic(assistantScope,thread.id,tx=>tx.update(turn.id,{status:'running',leaseToken:input.leaseToken,leaseUntil:new Date(f.clock().getTime()+60000).toISOString()}));};
    await at(f.clock().toISOString());
    const call=(name:string,args:Record<string,unknown>={})=>context.execute({...input,name,args});
    const progress=async()=>(await f.assistant.repo.readThread(assistantScope,thread.id)).campaignProgress!;
    const verifyMedia=async(campaignId:string)=>{const campaign=(await f.repo.read('store-a')).campaigns[campaignId],product=campaign.products[0];await f.repo.mutate('store-a',[],state=>{state.media['brief-media']={id:'brief-media',campaignId,productId:product.productId,variantId:product.variantId,productVersion:product.commercialVersion,url:'https://media.example.test/verified-brief.png',createdAt:f.clock().toISOString(),commercialReview:{status:'verified',productVersion:product.commercialVersion,imageSha256:'a'.repeat(64),reviewedAt:f.clock().toISOString()}};return{result:null};});};
    return{...f,context,thread,turn,input,call,at,progress,verifyMedia};
  }catch(error){await f.close();throw error;}
}
