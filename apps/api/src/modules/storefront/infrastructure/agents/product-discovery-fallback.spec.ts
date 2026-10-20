import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureProductDiscovery } from './product-discovery-fallback.js';
const result={message:'Você já viu a Bruma. Quer ver de novo?',blocks:[],toolsUsed:[],cartId:'same-cart'};

test('a discovery request with prior product history still performs the shared filtered search when the model skips tools', async()=>{
  let call:any;
  const output=await ensureProductDiscovery(result,{userMessage:'quero um produto para hidratação sem perfume',merchantId:'owned',handlers:{searchProducts:async(args:any)=>{call=args;return {products:[{id:'serum',name:'Sérum',description:'Hidratação sem perfume',price:500,inStock:true,variants:[],images:[]}]};}} as any});
  assert.deepEqual(call,{query:'quero um produto para hidratação sem perfume',inStockOnly:true,limit:3});
  assert.equal(output.cartId,'same-cart');assert.deepEqual(output.toolsUsed,['search_products']);
  assert.equal(output.blocks[0].type,'product_carousel');assert.match(output.message,/relacionadas/);
});

test('a broad request and a structured clarification never get replaced by a catalog dump', async()=>{
  const handlers:any={searchProducts:async()=>assert.fail('discovery is not finished')};
  assert.equal(await ensureProductDiscovery(result,{userMessage:'quero um produto para pele',merchantId:'owned',handlers}),result);
  const clarification={...result,message:'Como é sua pele?',discoveryQuestion:{question:'Como é sua pele?',replies:['Oleosa','Seca']}};
  assert.equal(await ensureProductDiscovery(clarification,{userMessage:'quero um produto para hidratação',merchantId:'owned',handlers}),clarification);
});

test('after three clarifications the fallback searches the combined need, not the last short answer alone',async()=>{
  const history:Array<{role:'user'|'assistant';content:string}>=[
    {role:'user',content:'Quero um produto para pele'}, {role:'assistant',content:'Como é sua pele?'},
    {role:'user',content:'Oleosa'}, {role:'assistant',content:'Qual seu objetivo?'},
    {role:'user',content:'Hidratação sem perfume'}, {role:'assistant',content:'Qual seu orçamento?'},
  ];
  const output=await ensureProductDiscovery(result,{userMessage:'Até R$ 80',history,merchantId:'owned',handlers:{searchProducts:async(args:any)=>{
    assert.match(args.query,/produto para pele/i);
    assert.match(args.query,/hidrat/i);
    assert.match(args.query,/sem perfume/i);
    assert.doesNotMatch(args.query,/Até R\$ 80/,'budget belongs to the price filter, not literal text matching');
    assert.equal(args.limit,3); assert.equal(args.maxPrice,8000);
    return {products:[{id:'too_expensive',name:'Caro',price:9900}]};
  }} as any});
  assert.deepEqual(output.toolsUsed,['search_products']);
  assert.deepEqual(output.blocks,[]);
  assert.doesNotMatch(output.message,/\?/,'no fourth profiling question');
});

test('an empty contextual discovery stays honest without filling the carousel with unrelated products', async()=>{
  const output=await ensureProductDiscovery(result,{userMessage:'quero um produto para pele oleosa sem perfume',merchantId:'owned',handlers:{
    searchProducts:async(args:any)=>{assert.equal(args.limit,3);assert.match(args.query,/sem perfume/);return {products:[]};},
  } as any});
  assert.match(output.message,/Não encontrei produtos correspondentes/);
  assert.equal(output.blocks.some(block=>block.type==='product_carousel'),false);
});

test('normal questions, checkout intents and already handled product responses are preserved',async()=>{
  const handlers:any={searchProducts:async()=>assert.fail('must not reinterpret a chat question or shopping mutation')};
  for(const userMessage of ['Oi, como vai?','quero pagar meu pedido','quero adicionar um produto para meu carrinho'])assert.equal(await ensureProductDiscovery(result,{userMessage,merchantId:'owned',handlers}),result);
  assert.equal(await ensureProductDiscovery({...result,toolsUsed:['search_products']},{userMessage:'quero um produto para minha pele',merchantId:'owned',handlers}).then(r=>r.message),result.message);
});
