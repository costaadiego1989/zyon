import {test,expect,type Page}from "@playwright/test";
import {BILLING_PLANS,billingOffer}from "@zyon/shared-types";

// Actual main.tsx App/PlanSelection/CSS, with synthetic HTTP fixtures only.
// No account creation, subscription selection or real billing/provider request.
const origin="http://127.0.0.1:5219";
const fixtureApiOrigin=process.env.DASHBOARD_STATIC_DIR
  ?new URL(process.env.DASHBOARD_STATIC_API_ORIGIN!).origin:origin;
const apiPrefix=process.env.DASHBOARD_STATIC_DIR?"/v1":"/audit-api/v1";
const labels=["Gerenciar cobranças existentes do marketplace","Gerenciar remessas existentes do marketplace",
  "Gerenciar estornos existentes do marketplace","Gerenciar retornos Asaas do marketplace",
  "Gerenciar aportes para estornos do marketplace","Gerenciar taxas existentes do marketplace","Gerenciar taxas existentes da loja principal"];
function catalog(){return Object.entries(BILLING_PLANS).map(([key,plan])=>({plan_id:key,name:plan.name,monthly_price_brl:plan.monthlyPriceBrl,
  transaction_fee_cents:plan.transactionFeeCents,limits:plan.limits,features:plan.features,annual_checkout_available:key!=="starter",
  billing_options:[billingOffer(plan.monthlyPriceBrl*100,"monthly"),...(key!=="starter"?[billingOffer(plan.monthlyPriceBrl*100,"annual",15)]:[])]}));}
async function syntheticApp(page:Page,trialExpired=false,options:{pending?:boolean;initial?:string;role?:"OWNER"|"ADMIN"|"STAFF"}={}){
  const mutations:string[]=[],unexpected:string[]=[],blockedExternal:string[]=[];
  const billing={expired:trialExpired,fail:false};
  const requests:string[]=[];
  await page.context().route(/.*/,async route=>{
    const request=route.request(),url=new URL(request.url());
    const isFixtureApi=url.origin===fixtureApiOrigin && (fixtureApiOrigin!==origin || url.pathname.startsWith("/audit-api/"));
    if(!isFixtureApi){
      if(request.method()!=="GET"){mutations.push(`${request.method()}:${url.pathname}`);return route.abort("blockedbyclient");}
      if(url.origin===origin)return route.continue();
      blockedExternal.push(url.origin);return route.abort("blockedbyclient");
    }
    // The API origin embedded in a static artifact is intercepted, never fetched.
    // Unknown API paths and every mutation fail closed, including on loopback.
    const path=url.pathname.startsWith(`${apiPrefix}/`)?url.pathname.slice(apiPrefix.length):url.pathname;
    requests.push(path);
    if(request.method()!=="GET"){mutations.push(`${request.method()}:${path}`);return route.abort("blockedbyclient");}
    let data:unknown;
    if(path==="/merchants/me")data={id:"synthetic-layout-merchant",name:"Loja de teste",user_id:"synthetic-owner",role:options.role??"OWNER",plan:"BOTH"};
    else if(path==="/merchants/me/store-settings")data={plan_selection_pending:options.pending??true};
    else if(path==="/billing/subscription"){
      if(billing.fail)return route.fulfill({status:503,json:{code:"synthetic_billing_unavailable"}});
      data={plan:"starter",status:billing.expired?"canceled":"trialing",trial_expired:billing.expired,features:{}};
    }
    else if(path==="/onboarding")data={completed:true,steps:[]};
    else if(path==="/billing/plans")data=catalog();
    else if(path==="/billing/promotions/automatic")data={campaigns:[]};
    else if(path==="/auth/me")data={id:"synthetic-owner",name:"Operador fictício",email:"synthetic@example.test",role:options.role??"OWNER"};
    else if(path==="/merchants/me/domains")data=[];
    else if(path==="/merchants/me/stores")data={data:[]};
    else if(path==="/dashboard/nav-counts")data={orders:0,messages:0,cartRecovery:0};
    else if(path==="/merchants/synthetic-layout-merchant/notifications")data={items:[]};
    else if(path==="/merchants/synthetic-layout-merchant/products")data={products:[],total:0};
    else if(path==="/merchants/synthetic-layout-merchant/categories")data=[];
    else if(path==="/merchants/me/platform-support/capabilities")data={canOpen:false};
    else if(path==="/merchants/me/platform-support")data={items:[],nextCursor:null};
    else{unexpected.push(path);return route.fulfill({status:501,json:{error:"unlisted_synthetic_endpoint"}});}
    return route.fulfill({headers:{"access-control-allow-origin":origin,"access-control-allow-credentials":"true","vary":"Origin"},json:data});
  });
  await page.context().routeWebSocket(/.*/,socket=>{
    if(new URL(socket.url()).origin===origin.replace("http:","ws:"))return socket.connectToServer();
    blockedExternal.push(new URL(socket.url()).origin);socket.close({code:1008,reason:"synthetic loopback only"});
  });
  await page.goto(options.initial??"/",{waitUntil:"domcontentloaded"});
  if(trialExpired)await expect(page.locator("[data-dashboard-page]")).toHaveAttribute("data-dashboard-page",options.role&&options.role!=="OWNER"?"account-settings":"billing-plans");
  else if(options.pending!==false)await expect(page.locator(".plan-selection__grid > article")).toHaveCount(4);
  return {mutations,unexpected,blockedExternal,billing,requests};
}
for(const[viewport,columns]of [[{width:1440,height:1000},4],[{width:1024,height:1000},2],[{width:390,height:844},1]]as const)
  test(`actual signup ${viewport.width}px has ${columns} plan columns and no overflow`,async({page},info)=>{
    await page.setViewportSize(viewport);const state=await syntheticApp(page),grid=page.locator(".plan-selection__grid");
    // Chromium preserves repeat(...) in a fieldset's computed declaration;
    // measure the actual first-row boxes, not whitespace in CSS syntax.
    const row=await grid.locator(":scope > article").evaluateAll(cards=>{
      const boxes=cards.map(card=>card.getBoundingClientRect());return boxes.filter(box=>Math.abs(box.top-boxes[0]!.top)<2).length;
    });
    expect(row).toBe(columns);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    for(const card of await page.locator(".signup-plan").all()){
      const box=await card.boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width+1);
    }
    await expect(page.getByText("Gerenciar operações existentes",{exact:true})).toHaveCount(0);
    expect(state.mutations).toEqual([]);expect(state.unexpected).toEqual([]);
    await page.screenshot({path:info.outputPath(`signup-${viewport.width}.png`),fullPage:true});
    if(viewport.width===1440){
      const keys=await page.locator(".signup-plan").evaluateAll(cards=>cards.map(card=>card.getAttribute("data-plan-key")));
      await page.getByRole("radio",{name:"Selecionar Growth",exact:true}).check();
      await expect(page.getByRole("radio",{name:"Selecionar Growth",exact:true})).toBeChecked();
      await page.getByRole("button",{name:/Anual/}).click();
      await expect(page.getByRole("button",{name:/Anual/})).toHaveAttribute("aria-pressed","true");
      await expect(page.getByRole("radio",{name:"Selecionar Growth",exact:true})).toBeChecked();
      expect(await page.locator(".signup-plan").evaluateAll(cards=>cards.map(card=>card.getAttribute("data-plan-key")))).toEqual(keys);
      expect(state.mutations).toEqual([]);expect(state.unexpected).toEqual([]);
    }
  });
test("expired owner has one closed keyboard-operable disclosure instead of seven loose operational entries",async({page})=>{
  await page.setViewportSize({width:1440,height:1000});const state=await syntheticApp(page,true);
  const summary=page.locator("summary").filter({hasText:"Gerenciar operações existentes"});await expect(summary).toHaveCount(1);
  const details=summary.locator("..");await expect(details).not.toHaveAttribute("open","");
  const nav=page.getByRole("navigation",{name:"Operações existentes do marketplace",includeHidden:true});await expect(nav).not.toBeVisible();
  for(const label of labels)await expect(page.getByRole("button",{name:label,exact:true})).not.toBeVisible();
  await summary.focus();await page.keyboard.press("Enter");await expect(details).toHaveAttribute("open","");await expect(nav).toBeVisible();
  await expect(nav.getByRole("button")).toHaveCount(7);
  for(const label of labels)await expect(nav.getByRole("button",{name:label,exact:true})).toHaveAttribute("type","button");
  await summary.focus();await page.keyboard.press("Enter");await expect(nav).not.toBeVisible();
  expect(state.mutations).toEqual([]);expect(state.unexpected).toEqual([]);
});

test("expired Free uses dashboard plans and refuses URL, desktop and mobile route bypasses",async({page})=>{
  const state=await syntheticApp(page,true,{initial:"/?billing=success#catalog"});
  await expect(page).toHaveURL(/#billing-plans$/);
  await expect(page.getByRole("heading",{name:"Planos e assinatura",exact:true})).toBeVisible();
  await expect(page.locator(".plan-selection__grid")).toHaveCount(0);
  await expect(page.getByRole("link",{name:"Acessar loja",exact:true})).toHaveCount(0);
  for(const hash of ["catalog","onboarding","product-detail?productId=synthetic","delivery","marketplace"]){
    await page.evaluate(value=>{window.location.hash=value;},hash);
    await expect(page).toHaveURL(/#billing-plans$/);
    await expect(page.locator("[data-dashboard-page]")).toHaveAttribute("data-dashboard-page","billing-plans");
  }
  await page.setViewportSize({width:390,height:844});
  const choices=await page.locator(".console-mobile-nav option").evaluateAll(els=>els.map(e=>(e as HTMLOptionElement).value));
  expect(choices).not.toContain("catalog");expect(choices).not.toContain("onboarding");
  expect(choices).toContain("billing-plans");
  expect(state.requests.some(path=>/products|nav-counts|notifications|domains/.test(path))).toBe(false);
  expect(state.mutations).toEqual([]);expect(state.unexpected).toEqual([]);
});

test("an active Free trial still opens the catalog after signup completion",async({page})=>{
  const state=await syntheticApp(page,false,{pending:false,initial:"/#catalog"});
  await expect(page.locator("[data-dashboard-page]")).toHaveAttribute("data-dashboard-page","catalog");
  await expect(page.getByRole("heading",{name:"Produtos",exact:true,level:1})).toBeVisible();
  expect(state.mutations).toEqual([]);expect(state.unexpected).toEqual([]);
});

test("a failed billing refresh cannot unlock a confirmed-expired trial",async({page})=>{
  const state=await syntheticApp(page,true);state.billing.fail=true;
  const before=state.requests.filter(path=>path==="/billing/subscription").length;
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await expect.poll(()=>state.requests.filter(path=>path==="/billing/subscription").length).toBeGreaterThan(before);
  await page.evaluate(()=>{window.location.hash="catalog";});
  await expect(page.locator("[data-dashboard-page]")).toHaveAttribute("data-dashboard-page","billing-plans");
  expect(state.requests.some(path=>path.includes("/products"))).toBe(false);
  expect(state.mutations).toEqual([]);expect(state.unexpected).toEqual([]);
});

test("only a fresh server subscription response releases the operational routes",async({page})=>{
  const state=await syntheticApp(page,true,{pending:false,initial:"/?billing=success#catalog"});
  await expect(page.locator("[data-dashboard-page]")).toHaveAttribute("data-dashboard-page","billing-plans");
  state.billing.expired=false;
  const before=state.requests.filter(path=>path==="/billing/subscription").length;
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await expect.poll(()=>state.requests.filter(path=>path==="/billing/subscription").length).toBeGreaterThan(before);
  await expect(page.getByText("Os módulos da loja estão bloqueados.",{exact:false})).toHaveCount(0);
  await page.evaluate(()=>{window.location.hash="catalog";});
  await expect(page.getByRole("heading",{name:"Produtos",exact:true,level:1})).toBeVisible();
  expect(state.mutations).toEqual([]);expect(state.unexpected).toEqual([]);
});

for(const role of ["ADMIN","STAFF"] as const)test(`expired ${role} cannot gain owner billing permission`,async({page})=>{
  const state=await syntheticApp(page,true,{role,initial:"/#catalog"});
  await expect(page).toHaveURL(/#account-settings$/);
  await expect(page.getByText(/Peça ao proprietário/)).toBeVisible();
  await expect(page.getByRole("heading",{name:"Planos e assinatura",exact:true})).toHaveCount(0);
  expect(state.mutations).toEqual([]);expect(state.unexpected).toEqual([]);
});
