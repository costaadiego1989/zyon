const {chromium}=require("playwright");
const path=require("node:path");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const out=path.resolve(process.env.STRATEGY_REVIEW_ARTIFACTS || path.join(__dirname,"../test-results/strategy-review"));
fs.mkdirSync(out,{recursive:true});
const baseUrl=process.env.STRATEGY_REVIEW_BASE_URL || "http://127.0.0.1:5186";
const base={id:"strategy1",hypothesis_text:"Oferecer 10% de desconto para carrinhos acima de R$ 200",reasoning:"Os abandonos se concentram em carrinhos acima de R$ 200. Vamos comparar uma oferta limitada com a estratégia atual.",expected_lift_percent:7.5,risk_level:"low",status:"pending_review",created_at:"2026-09-14T12:00:00Z",
template:{hypothesis_type:"discount_rule",discount_rule_json:{id:"rule1",name:"Desconto para carrinho a partir de R$ 200",enabled:false,priority:1,conditions:[{field:"cart_total",operator:"gte",value:200}],action:{type:"offer_discount",params:{percent:10,maxDiscountReais:30}}},
variant_a:{name:"Controle",weight:50,is_control:true,system_prompt:"Atendimento atual."},variant_b:{name:"Proposta",weight:50,is_control:false,system_prompt:"Apresente as condições da compra com clareza."}}};
(async()=>{
 const browser=await chromium.launch({headless:true});const results=[];
 try {
  for(const scenario of ["desktop","mobile","decline","prompt","failed","details-error"]) {
   const context=await browser.newContext({viewport:scenario==="mobile"?{width:390,height:844}:{width:1440,height:1000},colorScheme:"light"});
   const page=await context.newPage();let h=structuredClone(base),decisions=[],loadError=scenario==="details-error";
   if(scenario==="prompt"){delete h.template.discount_rule_json;h.template.hypothesis_type="prompt";h.hypothesis_text="Explicar as opções de entrega antes de pedir o pagamento";}
   const errors=[];page.on("pageerror",e=>errors.push(e.message));
   await page.route("**/audit-api/**",async route=>{
    const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
    let body={};
    if(path.endsWith("/billing/subscription"))body={plan:"scale",features:{revenueManager:true},status:"active"};
    else if(path.endsWith("/hypotheses"))body=h.status==="pending_review"?[h]:[];
    else if(path.endsWith("/hypotheses/strategy1")){
     if(loadError){loadError=false;return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({message:"temporariamente indisponível"})});}
     body=h;
    }
    else if(method==="POST"&&path.endsWith("/approve")){
     decisions.push(route.request().postDataJSON());h.status=scenario==="failed"?"experiment_failed":"experiment_created";
     body=scenario==="failed"?{status:"experiment_failed"}:decisions[0].mode==="apply_direct"?{status:"approved",rule_id:"rule1"}:{status:"experiment_created",experiment_id:"exp1"};
    }else if(method==="POST"&&path.endsWith("/reject")){decisions.push({rejected:true});h.status="rejected";body={status:"rejected"};}
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
   });
   await page.goto(baseUrl+"/e2e/fixtures/strategy-review.html",{waitUntil:"networkidle"});
   await page.getByRole("heading",{name:"1 estratégia aguarda sua aprovação"}).waitFor();
   const shortcut=page.getByRole("button",{name:/Revisar e aprovar/});await shortcut.click();
   const dialog=page.getByRole("dialog",{name:"Revisar estratégia"});await dialog.waitFor();
   if(scenario==="details-error"){await dialog.getByRole("button",{name:"Tentar novamente"}).click();}
   await dialog.getByRole("heading",{name:h.hypothesis_text,exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"page horizontal overflow "+scenario);
   assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false,"dialog horizontal overflow "+scenario);
   await dialog.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished)));const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=(scenario==="mobile"?390:1440)+1);
   assert.equal(await dialog.locator('details.strategy-review-details').evaluate(el=>el.open),false,'details collapsed initially');
   for(const radio of await dialog.getByRole('radio').all()){const box=await radio.boundingBox();assert.ok(box.width<=20&&box.height<=20,'compact mode control');}
   await dialog.locator('details.strategy-review-details > summary').click();
   await dialog.getByRole('heading',{name:'Por que foi sugerida'}).waitFor();
   await dialog.locator('details.strategy-review-details > summary').click();
   if(scenario==="desktop"||scenario==="mobile"){
     await page.screenshot({path:out+"/strategy-"+scenario+".png",fullPage:true});
     if(scenario==="desktop"){
      await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});assert.equal(await shortcut.evaluate(el=>el===document.activeElement),true);
      await shortcut.click();await dialog.getByRole("heading",{name:h.hypothesis_text,exact:true}).waitFor();
      await dialog.getByRole("radio",{name:"Aplicar direto"}).check();
     }
   }
   if(scenario==="prompt")assert.equal(await dialog.getByRole("radio",{name:"Aplicar direto"}).count(),0);
   if(scenario==="decline")await dialog.getByRole("button",{name:"Declinar",exact:true}).click();
   else await dialog.getByRole("button",{name:scenario==="desktop"?"Aplicar estratégia":"Iniciar teste A/B",exact:true}).click();
   if(scenario==="failed"){
    await dialog.getByRole("alert").waitFor();assert.match(await dialog.innerText(),/aplicação não foi confirmada/);
    assert.equal(await dialog.getByRole("button",{name:"Iniciar teste A/B"}).count(),0);
   }else{
    await dialog.waitFor({state:"hidden"});
    await page.getByRole("heading",{name:"1 estratégia aguarda sua aprovação"}).waitFor({state:"hidden"});
   }
   assert.equal(decisions.length,1);
   if(scenario==="desktop")assert.equal(decisions[0].mode,"apply_direct");
   else if(scenario!=="decline")assert.equal(decisions[0].mode,"test_ab");
   assert.deepEqual(errors,[]);
   results.push({scenario,status:"passed"});await context.close();
  }
  fs.writeFileSync(out+"/browser-results.json",JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 } finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
