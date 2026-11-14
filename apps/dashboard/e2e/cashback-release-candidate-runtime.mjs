import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const evidence="C:/Users/Admin/Desktop/AACP/.specs/features/cashback-release/evidence/candidate-browser";
const auth=JSON.parse(await fs.readFile(process.env.CASHBACK_BROWSER_AUTH_FILE??"C:/Users/Admin/Desktop/AACP/.specs/features/cashback-release/evidence/candidate-auth.private.json","utf8"));
const manifest=JSON.parse(await fs.readFile("C:/Users/Admin/Desktop/AACP/.specs/features/cashback-release/evidence/candidate-compiled-seed-manifest.json","utf8"));
const origin=process.env.CASHBACK_BROWSER_ORIGIN??"http://127.0.0.1:5193";
const api=auth.baseUrl.replace(/\/$/,"");
if(!/^http:\/\/127\.0\.0\.1:5193$/.test(origin)||!/^http:\/\/127\.0\.0\.1:13150(?:\/v1)?$/.test(api))throw new Error("browser_target_outside_exclusive_local_qa");
await fs.mkdir(evidence,{recursive:true});
const results=[],requests=[],writes=[],errors=[],responses=[];
const selected=process.env.CASHBACK_BROWSER_CASES?new Set(process.env.CASHBACK_BROWSER_CASES.split(",")):null;
if(selected){
  const previous=JSON.parse(await fs.readFile(path.join(evidence,"results.json"),"utf8"));
  await fs.writeFile(path.join(evidence,"before-targeted-recapture.json"),JSON.stringify(previous,null,2)+"\n");
  results.push(...previous.results.filter(item=>!selected.has(item.name)));requests.push(...previous.requests);responses.push(...previous.responses);writes.push(...previous.writes);errors.push(...previous.pageErrors);
}
const browser=await chromium.launch({headless:true});
const contexts=new Map();
const money=cents=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);
const safeError=error=>String(error.message??error).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,"[REDACTED]").slice(0,2000);
async function getJson(merchantId,route){const res=await fetch(`${api.replace(/\/v1$/,"")}/v1${route}`,{headers:{Authorization:`Bearer ${auth.ownerTokens[merchantId]}`}});if(!res.ok)throw new Error(`read_failed:${route}:${res.status}`);return res.json();}
async function open(key,viewport){
  const cacheKey=`${key}:${viewport.width}`;if(contexts.has(cacheKey))return contexts.get(cacheKey);
  const merchantId=`qa-cashback-v1-${key}`,token=auth.ownerTokens[merchantId];if(!token)throw new Error("seed_owner_token_missing");
  const context=await browser.newContext({viewport,timezoneId:"America/Sao_Paulo",acceptDownloads:true,isMobile:viewport.width===390,hasTouch:viewport.width===390});
  // AuthCookieService's real HTTP-only cookie; token was issued into the real
  // merchant_auth_sessions table. No business route or fetch is intercepted.
  await context.addCookies([{name:"aacp_access_token",value:token,domain:"127.0.0.1",path:"/",httpOnly:true,secure:false,sameSite:"Lax"}]);
  const page=await context.newPage();page.setDefaultTimeout(12000);
  page.on("pageerror",error=>errors.push({key,message:safeError(error)}));
  page.on("response",response=>{const u=new URL(response.url());if(u.origin === "http://127.0.0.1:13150")responses.push({key,path:u.pathname,status:response.status()});});
  page.on("request",request=>{const u=new URL(request.url());if(u.origin==="http://127.0.0.1:13150"&&u.pathname.startsWith("/v1/dashboard/cashback")){const item={key,method:request.method(),path:u.pathname,query:u.search};requests.push(item);if(!["GET","HEAD","OPTIONS"].includes(item.method))writes.push(item);}});
  await page.goto(`${origin}/#cashback`);await expect(page.getByRole("heading",{name:"Cashback",exact:true})).toBeVisible({timeout:15000});
  await expect(page.getByRole("region",{name:"Situação do programa"})).toBeVisible({timeout:15000});
  const opened={context,page,merchantId};contexts.set(cacheKey,opened);return opened;
}
async function screenshot(page,name){for(let attempt=0;attempt<3;attempt++){try{await page.screenshot({path:path.join(evidence,`${name}.png`),fullPage:true,animations:"disabled"});return;}catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,250));}}}
async function noOverflow(page){const dims=await page.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth}));expect(dims.body).toBeLessThanOrEqual(dims.viewport+1);}
async function run(name,key,viewport,fn){if(selected&&!selected.has(name))return;let opened;try{opened=await open(key,viewport);await fn(opened);await noOverflow(opened.page);await screenshot(opened.page,name);results.push({name,status:"passed",viewport,merchantId:opened.merchantId});}catch(error){if(opened)await screenshot(opened.page,`${name}-failed`).catch(()=>{});results.push({name,status:"failed",viewport,error:safeError(error)});}await fs.writeFile(path.join(evidence,"results.json"),JSON.stringify({scope:"Real compiled local API and PostgreSQL QA seeds; real dashboard gestures, no business mocks, no PSP or Meta",results,requests,responses,writes,pageErrors:errors},null,2)+"\n");await new Promise(resolve=>setTimeout(resolve,5000));}
try{
  for(const [size,viewport]of[["desktop",{width:1440,height:1000}],["mobile",{width:390,height:844}]]){
    if(selected&&![...selected].some(name=>name.startsWith(size+"-")))continue;
    if(size === "mobile")await new Promise(resolve=>setTimeout(resolve,30000));
    await run(`${size}-overview`,"specific",viewport,async({page,merchantId})=>{
      const metrics=await getJson(merchantId,"/dashboard/cashback/metrics");expect(metrics.availableCents).toBe(3700);expect(metrics.reservedCents).toBe(1500);expect(metrics.grantedCents).toBe(2000);
      await expect(page.getByRole("region",{name:"Situação do programa"})).toContainText("Ativo");
      const balance=page.getByRole("definition").filter({hasText:money(3700)});await expect(page.locator(".cashback-current")).toContainText(money(3700));await expect(page.locator(".cashback-current")).toContainText(money(1500));
      await expect(page.locator(".cashback-statements")).toContainText(money(2000));
    });
    await run(`${size}-customers-statement-csv`,"specific",viewport,async({page,merchantId})=>{
      await page.getByRole("group",{name:"Seções de cashback"}).getByRole("button",{name:"Clientes",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Clientes com cashback"})).toBeVisible();await expect(page.getByRole("button",{name:"QA Cashback Canal Unico",exact:true})).toBeVisible();
      await expect(page.locator(".cashback-table tbody tr")).toHaveCount(2);
      await page.getByRole("searchbox",{name:"Buscar cliente por nome ou e-mail"}).fill("Outro Cliente");await expect(page.locator(".cashback-table tbody tr")).toHaveCount(1);await expect(page.locator(".cashback-table tbody")).toContainText("QA Cashback Outro Cliente");
      await page.getByRole("button",{name:"Limpar busca",exact:true}).click();await expect(page.locator(".cashback-table tbody tr")).toHaveCount(2);
      await page.getByRole("group",{name:"Filtrar resultados"}).getByRole("button",{name:"Já utilizaram",exact:true}).click();await expect(page.getByText("Nenhum cliente encontrado",{exact:true})).toBeVisible();
      await page.getByRole("group",{name:"Filtrar resultados"}).getByRole("button",{name:"Todos",exact:true}).click();await expect(page.locator(".cashback-table tbody tr")).toHaveCount(2);
      const download=page.waitForEvent("download");await page.getByRole("button",{name:"Exportar clientes",exact:true}).click();const csv=await download,file=path.join(evidence,`${size}-customers.csv`);await csv.saveAs(file);const text=await fs.readFile(file,"utf8");expect(text).toContain("qa-cashback-v1-buyer-canonical");expect(text).toContain('"3500"');expect(text).not.toContain("whatsapp-before-link");
      await page.getByRole("button",{name:"QA Cashback Canal Unico",exact:true}).click();await expect(page.getByRole("heading",{name:"Extrato do cliente"})).toBeVisible();await expect(page.locator(".cashback-customer-detail .cashback-current")).toContainText(money(3500));
      await page.getByLabel("Tipo de movimentação").selectOption("grant");await expect(page.locator(".cashback-table tbody tr")).toHaveCount(4);
      const statementDownload=page.waitForEvent("download");await page.getByRole("button",{name:"Exportar extrato",exact:true}).click();const statement=await statementDownload;const statementFile=path.join(evidence,`${size}-statement.csv`);await statement.saveAs(statementFile);const statementText=await fs.readFile(statementFile,"utf8");expect(statementText).toContain('"500"');expect(statementText).toContain("qa-cashback-v1-buyer-canonical");
      const real=await getJson(merchantId,"/dashboard/cashback/transactions?buyerId=qa-cashback-v1-buyer-canonical&type=grant");expect(real.total).toBe(4);expect(real.items.reduce((sum,item)=>sum+item.amountCents,0)).toBe(2000);
    });
    for(const[key,max,total]of[["specific",1500,7000],["general",500,8000]])await run(`${size}-${key}-review-simulator`,key,viewport,async({page})=>{
      await page.getByRole("group",{name:"Seções de cashback"}).getByRole("button",{name:"Configuração",exact:true}).click();await expect(page.getByRole("heading",{name:"Regras do programa",exact:true})).toBeVisible();
      await expect(page.getByLabel("Percentual de cashback (%)",{exact:true})).toHaveValue("5,00");await expect(page.getByLabel("Combinar cashback com cupons",{exact:true})).toHaveValue("yes");
      await page.getByRole("button",{name:/Revisar e publicar/}).click();await expect(page.getByRole("heading",{name:"Confira antes de ativar",exact:true})).toBeVisible();
      await page.getByLabel("Valor dos produtos para simular (R$)",{exact:true}).fill("100");await page.getByLabel("Desconto efetivo do cupom (R$)",{exact:true}).fill("10");await page.getByLabel("Desconto efetivo da regra avançada (R$)",{exact:true}).fill("5");
      await expect(page.locator(".cashback-simulation-result")).toContainText(`Cashback máximo nesta compra: ${money(max)}`);await expect(page.locator(".cashback-simulation-result")).toContainText(`Produtos após todos os benefícios: ${money(total)}`);
      await page.getByRole("button",{name:"Publicar e ativar",exact:true}).scrollIntoViewIfNeeded();
    });
    await run(`${size}-paused`,"paused",viewport,async({page})=>{await expect(page.getByRole("region",{name:"Situação do programa"})).toContainText("Novos ganhos pausados");await expect(page.locator(".cashback-current")).toContainText(money(3000));});
    await run(`${size}-disabled-blank`,"disabled",viewport,async({page})=>{await expect(page.getByRole("region",{name:"Situação do programa"})).toContainText("Não configurado");await page.getByRole("group",{name:"Seções de cashback"}).getByRole("button",{name:"Configuração",exact:true}).click();await expect(page.getByLabel("Percentual de cashback (%)",{exact:true})).toHaveValue("");await expect(page.getByLabel("Combinar cashback com cupons",{exact:true})).toHaveValue("");await expect(page.getByLabel("Qual teto deve prevalecer?",{exact:true})).toHaveValue("");});
    await run(`${size}-expiry-filter`,"expiry",viewport,async({page})=>{await expect(page.locator(".cashback-statements")).toContainText(money(500));await page.getByRole("group",{name:"Seções de cashback"}).getByRole("button",{name:"Clientes",exact:true}).click();await page.getByRole("group",{name:"Filtrar resultados"}).getByRole("button",{name:"A vencer",exact:true}).click();await expect(page.locator(".cashback-table tbody tr")).toHaveCount(1);await expect(page.locator(".cashback-table tbody")).toContainText("QA Cashback Canal Unico");});
    for(const value of contexts.values())await value.context.close();contexts.clear();
  }
  if(writes.length)throw new Error("unexpected_cashback_write_during_readonly_browser_gate");
}finally{await browser.close();await fs.writeFile(path.join(evidence,"results.json"),JSON.stringify({scope:"Real compiled local API and PostgreSQL QA seeds; actual dashboard gestures, no business mocks; no PSP/Meta evidence",results,requests,responses,writes,pageErrors:errors},null,2)+"\n");}
process.stdout.write(JSON.stringify({tests:results.length,passed:results.filter(item=>item.status === "passed").length,failed:results.filter(item=>item.status === "failed").length,businessWrites:writes.length,pageErrors:errors.length})+"\n");
if(results.some(item=>item.status !== "passed")||writes.length)process.exitCode=1;
