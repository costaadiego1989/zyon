import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {MODULE_METADATA} from '@nestjs/common/constants.js';
import {OpenRouterProvider} from '../../../packages/conversation-engine/dist/index.js';
import {classifyStorefrontIntent} from '../dist/modules/storefront/infrastructure/ai/structured-intent-classifier.js';
import {StorefrontLangGraphAgent} from '../dist/modules/storefront/infrastructure/agents/store-langgraph-agent.js';
import {StorefrontObserver} from '../dist/modules/storefront/infrastructure/observability/storefront-observation.js';
import {parseCopyWireResult} from '../dist/modules/storefront/domain/contracts/storefront-copy.schemas.js';
import {storefrontIntentPromptV1} from '../dist/modules/storefront/domain/prompts/storefront-intent.v1.js';
import {storefrontIntentOutputSchema,storefrontIntentUsageSchema,isConsistentStorefrontIntent} from '../dist/modules/storefront/domain/contracts/storefront-intent.schemas.js';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';
import {createPublicStorefrontModelFixture} from './service-public-storefront-model-fixture.mjs';
import {humanModelScript} from './whatsapp-human-model.fixture.mjs';

// Inert metadata containers expose the fixture's actual unchanged transport.
// No Nest application, repository, identity or authorization is constructed.
class KnowledgeMetadata {}
class StoreMetadata {}
class QueryMetadata {}
const transportToken=Symbol('wire-only-provider-transport');
Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,[QueryMetadata],KnowledgeMetadata);
Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,[],StoreMetadata);
async function transport(run){
  const events=[],fixture=createPublicStorefrontModelFixture(randomUUID(),event=>events.push(event),humanModelScript());
  const installation=fixture.install({KnowledgeBaseModule:KnowledgeMetadata,QueryKnowledgeUseCase:QueryMetadata,
    StorefrontModule:StoreMetadata,STOREFRONT_PROVIDER_FETCH_FACTORY:transportToken});
  try{
    const factory=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,StoreMetadata).find(value=>value?.provide===transportToken).useValue;
    const provider=new OpenRouterProvider({apiKey:randomBytes(32).toString('hex'),baseUrl:'http://127.0.0.1:65534/v1',
      model:'synthetic-only',fetchFn:factory('primary')});
    return await run(provider,events);
  }finally{fixture.closeModelScript();installation.restore();}
}
const message='Você consegue me colocar em contato com alguém da equipe da loja?';
const history=[{role:'assistant',content:'Qual é o seu nome?'}];
const expected=humanModelScript()[0].response;

test('T57 exact synthetic native classifier wire reaches the real parser and allowed preparation',async()=>{
  const checked=assertServiceArtifacts(),observations=[];
  const observer=new StorefrontObserver({enabled:true,record:event=>{
    if(event.kind==='decision'&&event.stage==='classifier')observations.push({stage:event.stage,outcome:event.outcome,reason:event.reason});
  }});
  const wire=await transport(provider=>provider.chat({
    messages:[{role:'system',content:JSON.stringify(storefrontIntentPromptV1)},
      {role:'user',content:JSON.stringify({userMessage:message,history})}],
    responseFormat:{type:'json_object'},model:'synthetic-only',temperature:0,maxTokens:220,
  }));
  const parsed=storefrontIntentOutputSchema.safeParse(parseCopyWireResult(wire));
  const classified=await transport(provider=>observer.turn(()=>classifyStorefrontIntent(provider,{userMessage:message,history},
    {model:'synthetic-only',structuredOutputMode:'json_object'})));
  const prepared=await transport(provider=>{
    const agent=new StorefrontLangGraphAgent({provider,toolHandlers:{},model:'synthetic-only',fastModel:'synthetic-only',
      strongModel:'synthetic-only',structuredRouting:false,structuredOutputMode:'json_object',budgetCents:500});
    return observer.turn(()=>agent.prepare({merchantId:'synthetic-human-products',sessionId:'synthetic-human-products-conversation',
      cartId:'synthetic-human-products-conversation',userMessage:message,history,storeCategory:'others',
      merchantName:'Synthetic products',messageFormat:'whatsapp'}));
  });
  // Only synthetic protocol fields, never the messages, keys, IDs or tool args.
  console.info('t57_classifier_wire_diagnostic',JSON.stringify({
    wire:{finishReason:wire.finishReason??null,refusalPresent:!!wire.refusal,toolCalls:wire.toolCalls?.length??0,
      usage:wire.usage,usageKnown:wire.usageKnown,parsed:parsed.success,
      consistent:parsed.success&&isConsistentStorefrontIntent(parsed.data)},
    classified,preparedAllowed:prepared.allowed,reasons:observations,
  }));
  assert.deepEqual(wire.usage,{promptTokens:3,completionTokens:2,totalTokens:5});
  assert.equal(wire.usageKnown,true);assert.equal(wire.finishReason,'stop');assert.equal(wire.toolCalls,undefined);
  assert.equal(storefrontIntentUsageSchema.safeParse(wire.usage).success,true);
  assert.equal(parsed.success,true);if(parsed.success)assert.deepEqual(parsed.data,expected);
  assert.equal(classified.source,'structured');assert.deepEqual(classified.classification,expected);
  assert.equal(prepared.allowed,true);assert.deepEqual(assertServiceArtifacts(),checked);
});
