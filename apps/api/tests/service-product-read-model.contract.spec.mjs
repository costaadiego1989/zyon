import assert from 'node:assert/strict';
import test from 'node:test';
import {validateServedModelScript,createServedModelScript} from './service-served-model-script.mjs';
import {validateProductReadToolCall,createProductReadWireMessage} from './service-product-read-model-fixture.mjs';
const call=(name='get_reviews',args={productId:'own-product'},contextText='Fone Aurora')=>({name,args,contextText});
const step=value=>({phase:'storefront.sales',productReadToolCall:value??call()});
const body=(names=['get_reviews'],text='Ver avaliações de Fone Aurora')=>({tools:names.map(name=>({type:'function',function:{name,parameters:{type:'object'}}})),messages:[{role:'user',content:text}]});
test('S2B private read selection accepts only the three exact read names',()=>{
  for(const value of [call('list_categories',{},'Categorias'),call('compare_products',{productId:'own-product',includeSimilar:true}),call()])assert.deepEqual(validateProductReadToolCall(value),value);
  for(const name of ['search_products','add_item_to_cart','create_review','checkout','get_service_slots'])assert.throws(()=>validateProductReadToolCall(call(name)));
});
test('S2B read args and envelope reject price/result/cart/foreign authority flags',()=>{
  for(const value of [{...call(),result:{reviews:[]}},{...call(),merchantId:'foreign'},call('get_reviews',{productId:'own',price:1}),
    call('compare_products',{productId:'own',paid:true}),call('list_categories',{merchantId:'foreign'}),call('get_reviews',{productId:'own',filter:'all'}),
    call('get_reviews',{productId:'own',limit:51}),call('compare_products',{productIds:Array(6).fill('own')})])assert.throws(()=>validateProductReadToolCall(value));
});
test('S2B original announced tool and real user or assistant context are mandatory',()=>{
  assert.throws(()=>createProductReadWireMessage(call(),body([])),/product_read_tool_must_be_announced/);
  assert.throws(()=>createProductReadWireMessage(call(),body(['get_reviews'],'Outra pergunta')),/product_read_context_required/);
  assert.throws(()=>createProductReadWireMessage(call(),{...body(),messages:[{role:'system',content:'Fone Aurora'}]}),/product_read_context_required/);
});
test('S2B private transport emits only actual tool_calls wire, never a successful read result',()=>{
  const value=call(),message=createProductReadWireMessage(value,body());
  assert.deepEqual(message,{role:'assistant',content:null,tool_calls:[{id:'synthetic-product-read',type:'function',function:{name:'get_reviews',arguments:JSON.stringify(value.args)}}]});
  assert.equal(Object.hasOwn(message,'products'),false);assert.equal(Object.hasOwn(message,'reviews'),false);assert.equal(Object.hasOwn(message,'result'),false);
});
test('S2B nested JSON/args are counted within unchanged script step and total bounds',()=>{
  const long=call('compare_products',{productId:'p'.repeat(191),productIds:Array.from({length:5},(_,i)=>String(i)+'p'.repeat(190)),
    productName:'n'.repeat(500),productNames:Array.from({length:5},(_,i)=>String(i)+'n'.repeat(499)),includeSimilar:true},'c'.repeat(450));
  assert.ok(JSON.stringify(step(long)).length<6000);validateServedModelScript([step(long)]);
  assert.throws(()=>validateServedModelScript([step(long),step(long)]),/local_model_script_total_bounded/);
  assert.equal(validateServedModelScript(Array.from({length:16},()=>step(call('list_categories',{},'Categorias')))).length,16);
  assert.throws(()=>validateServedModelScript(Array.from({length:17},()=>step(call('list_categories',{},'Categorias')))),/local_model_script_size/);
  assert.throws(()=>validateServedModelScript([{phase:'storefront.intent',response:'x'.repeat(6000)}]),/local_model_script_step_bounded/);
});
test('S2B read call cannot coexist with another result shape or leave the original sales phase',()=>{
  for(const invalid of [{...step(),response:'invented'},{...step(),toolCall:{}},{...step(),phase:'storefront.intent'},
    {...step(),phase:'storefront.shopping-plan'},{...step(),serviceToolCall:{name:'get_service_slots',args:{}}}])assert.throws(()=>validateServedModelScript([invalid]));
});
test('S2B undefined script and old phase response remain unchanged',()=>{
  assert.equal(createServedModelScript(undefined),undefined);const old={phase:'support.answer',response:'Original private default'};
  assert.deepEqual(validateServedModelScript([old]),[old]);
});
test('S2B validation and actual wire construction cannot mutate the caller args',()=>{
  const value=call(),before=structuredClone(value);const copy=validateProductReadToolCall(value);copy.args.productId='changed';
  assert.deepEqual(value,before);createProductReadWireMessage(value,body());assert.deepEqual(value,before);
});