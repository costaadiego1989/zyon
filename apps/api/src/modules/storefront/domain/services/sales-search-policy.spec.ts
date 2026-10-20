import test from "node:test";
import assert from "node:assert/strict";
import { createSalesSearchPolicy, salesSearchMaxPrice } from "./sales-search-policy.js";

test("a recommendation cannot widen away a budget, negated attribute or small selection",async()=>{
  const calls:any[]=[];
  const policy=createSalesSearchPolicy("Quero um hidratante para pele oleosa sem perfume, até R$ 80",[]);
  const [tool]=policy.wrap([{name:"search_products",execute:async args=>{
    calls.push(args);return {ok:true,data:{products:[]}};
  }}]);
  for(const args of [{query:"hidratante",limit:10},{query:"creme facial",maxPrice:50000},{query:"*",limit:20},{query:"outro produto"}])
    await tool!.execute(args);
  assert.equal(calls.length,3);
  assert.ok(calls.every(call=>call.limit<=3 && call.maxPrice===8000 && /sem perfume/.test(call.query) && /pele oleosa/.test(call.query)));
  assert.ok(calls.every(call=>call.query!=="*"));
  assert.equal(policy.terminal,true);
  assert.match(policy.terminalMessage!,/Não encontrei/);
});

test("short answers retain constraints from the current discovery and filter federated prices too",async()=>{
  const calls:any[]=[];
  const history:Array<{role:"user"|"assistant";content:string}>=[
    {role:"user",content:"Quero hidratante para pele oleosa sem perfume, até R$ 80"},
    {role:"assistant",content:"Você prefere textura leve ou densa?"},
  ];
  const policy=createSalesSearchPolicy("Leve",history);
  const [tool]=policy.wrap([{name:"search_products",execute:async args=>{
    calls.push(args);return {ok:true,data:{products:[{id:"above",name:"Hidratante",price:9900},{id:"within",name:"Hidratante",price:7900},{id:"unknown"}]}};
  }}]);
  const result=await tool!.execute({query:"hidratante leve",limit:10});
  assert.equal(calls[0].maxPrice,8000);
  assert.match(calls[0].query,/sem perfume/);
  assert.match(calls[0].query,/pele oleosa/);
  assert.equal(result.ok,true);
  assert.deepEqual((result as any).data.products,[{id:"within",name:"Hidratante",price:7900}]);
});

test("an empty later synonym preserves earlier real matches instead of claiming no products",async()=>{
  let lookups=0;
  const policy=createSalesSearchPolicy("Quero hidratante sem perfume",[]);
  const [tool]=policy.wrap([{name:"search_products",execute:async()=>({ok:true,data:{products:++lookups===1?[{id:"found",name:"Hidratante",price:100}]:[]}})}]);
  for(let index=0;index<4;index++){
    const result=await tool!.execute({query:"hidratante"});
    assert.deepEqual((result as any).data.products,[{id:"found",name:"Hidratante",price:100}]);
  }
  assert.equal(lookups,3);
  assert.equal(policy.terminalMessage,undefined);
});

test("broadening to a shared brand never adds another care step to a hydration recommendation", async () => {
  const [tool] = createSalesSearchPolicy("É para o rosto. Não sei meu tipo de pele, até R$ 150.", [
    { role: "user", content: "Quero um produto para hidratação com textura leve" },
    { role: "assistant", content: "É para o rosto ou corpo?" },
  ]).wrap([{ name: "search_products", execute: async args => {
    assert.match(String(args.query), /hidrat/);
    return { ok: true, data: { products: [
      { id: "wrong_step", name: "Protetor Diário FPS 50", description: "Protetor facial de uso diário", price: 9990 },
      { id: "right_step", name: "Bruma de Hidratação", description: "Hidratação leve", price: 7990 },
    ] } };
  } }]);
  const result = await tool!.execute({ query: "Núcleo", limit: 20 });
  assert.deepEqual((result as any).data.products.map((product: any) => product.id), ["right_step"]);
});

test("failed lookups do not claim that the merchant has no products",async()=>{
  const policy=createSalesSearchPolicy("Quero hidratante sem perfume",[]);
  const [tool]=policy.wrap([{name:"search_products",execute:async()=>({ok:false,error:"provider_unavailable"})}]);
  for(let index=0;index<3;index++) await tool!.execute({query:"hidratante"});
  assert.match(policy.terminalMessage!,/Não consegui concluir a busca/);
  assert.doesNotMatch(policy.terminalMessage!,/Não encontrei/);
});

test("explicit browsing, more results, product actions and attachments keep their existing tool contract",async()=>{
  for(const [message,attachment] of [["Ver Produtos",undefined],["Quero mais opções",undefined],["Comprar Sérum",undefined],
    ["Comparar produtos",undefined],["Finalizar compra",undefined],["Quero produto para pele","attachment"]]){
    const original={name:"search_products",execute:async(args:any)=>({ok:true as const,data:args})};
    const [tool]=createSalesSearchPolicy(message!,[],attachment).wrap([original]);
    assert.equal(tool,original,message);
  }
});

test("spending caps parse Brazilian thousands and decimals, keep zero, and reject unsafe numbers",()=>{
  for(const [input,cents] of [["Até R$ 80",8000],["Até R$ 1.000,50",100050],["Orçamento de 1.000",100000],
    ["Máximo de R$ 79.90",7990],["Limite de 0",0],["até 80, depois limite de 60",6000]])
    assert.equal(salesSearchMaxPrice(String(input)),cents);
  assert.equal(salesSearchMaxPrice("Está caro"),undefined);
  assert.equal(salesSearchMaxPrice("Até 999999999999999999999"),undefined);
});

test("client histories including the current answer retain the initial need and do not duplicate that answer",async()=>{
  const history:Array<{role:"user"|"assistant";content:string}>=[
    {role:"user",content:"Quero produto para pele"},{role:"assistant",content:"Como é sua pele?"},
    {role:"user",content:"Oleosa"},{role:"assistant",content:"Qual o objetivo?"},
    {role:"user",content:"Hidratação"},{role:"assistant",content:"Tem restrição de fragrância?"},
    {role:"user",content:"Sem perfume, até R$ 80"},
  ];
  const policy=createSalesSearchPolicy("Sem perfume, até R$ 80",history);
  const [tool]=policy.wrap([{name:"search_products",execute:async args=>{
    assert.match(String(args.query),/pele oleosa/);
    assert.match(String(args.query),/sem perfume/);
    assert.equal(args.maxPrice,8000);
    return {ok:true,data:{products:[]}};
  }}]);
  await tool!.execute({query:"hidratante"});
});

test("explicitly corrected skin types and accepted ingredients replace old preferences without a permanent restriction trap",async()=>{
  const history:Array<{role:"user"|"assistant";content:string}>=[
    {role:"user",content:"Quero hidratante para pele oleosa sem perfume, até R$ 80"},
    {role:"assistant",content:"Tem alguma outra preferência?"},
  ];
  for(const [message,expected,absent] of [["Minha pele é mista","pele mista","pele oleosa"],["Na verdade mista","pele mista","pele oleosa"],
    ["Pode ser com perfume","pele oleosa","sem perfume"]]){
    const [tool]=createSalesSearchPolicy(message!,history).wrap([{name:"search_products",execute:async args=>{
      assert.ok(String(args.query).includes(expected!));
      assert.equal(String(args.query).includes(absent!),false);
      assert.equal(args.maxPrice,8000);
      return {ok:true,data:{products:[]}};
    }}]);
    await tool!.execute({query:"hidratante"});
  }
  const [tool]=createSalesSearchPolicy("Não aceito perfume",history).wrap([{name:"search_products",execute:async args=>{
    assert.match(String(args.query),/sem perfume/);return {ok:true,data:{products:[]}};
  }}]);
  await tool!.execute({query:"hidratante"});
});
