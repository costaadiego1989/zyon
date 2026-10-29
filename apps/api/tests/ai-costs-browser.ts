import "reflect-metadata";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createSupportFixture } from "./platform-support-fixture.js";
import { AiMeteringService } from "../src/modules/ai-metering/ai-metering.service.js";

const evidence=process.env.AI_COSTS_EVIDENCE!;if(!evidence)throw Error("evidence_required");mkdirSync(evidence,{recursive:true});
process.env.PLATFORM_SUPPORT_TEST_PORT="56544";
const fixture=await createSupportFixture({aiMetering:true});
const meter=fixture.second.app.get(AiMeteringService);
const control=path.resolve("../control"),require=createRequire(path.join(control,"package.json")),vite=path.join(path.dirname(require.resolve("vite/package.json")),"bin/vite.js");
const server=spawn(process.execPath,[vite,"--host","127.0.0.1","--port","56545","--strictPort"],{cwd:control,env:{...process.env,VITE_PLATFORM_API_BASE_URL:fixture.first.url},stdio:"ignore",windowsHide:true});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
const checks:string[]=[];
try{
  for(let n=0;n<60;n++){try{if((await fetch("http://127.0.0.1:56545")).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  for(const [name,m] of Object.entries(fixture.merchants).slice(0,2)){
    const row=await meter.begin({merchantId:m.id,source:"checkout_chat"},"openai","gpt-4o-mini","fixture");
    await meter.complete({id:row.id,payload:{id:"browser-"+fixture.tag+name,model:"gpt-4o-mini",usage:{input_tokens:1000,output_tokens:100,total_tokens:1100}},status:"succeeded",endedAt:new Date().toISOString()});
  }
  await meter.begin({merchantId:fixture.merchants.growth!.id,source:"fixture_timeout"},"openai","gpt-4o-mini","fixture");
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const op=fixture.operators.admin!;
  await context.addInitScript(value=>sessionStorage.setItem("zyon.platform-control.session.v1",JSON.stringify(value)),{token:op.token,operator:{operator_id:op.id,email:op.email,role:op.role}});
  const page=await context.newPage(),errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:56545");await page.getByRole("button",{name:"Uso de IA",exact:true}).click();
  await page.getByRole("heading",{name:"Consumo e custos por empresa"}).waitFor();await page.getByRole("button",{name:"Ver chamadas",exact:true}).first().waitFor();
  assert((await page.locator(".ai-costs-summary").innerText()).includes("0,00042"));checks.push("known sub-cent cost matches persisted events");
  assert((await page.locator(".ai-costs-notice").innerText()).includes("1 chamada com uso pendente"));checks.push("pending measurement is visible separately");
  await page.getByRole("button",{name:"Ver chamadas",exact:true}).first().click();await page.getByRole("button",{name:"Detalhar",exact:true}).first().click();
  await page.locator(".ai-costs-event-details").waitFor();assert((await page.locator(".ai-costs-event-details").innerText()).includes("server_http"));checks.push("company call ledger and token details open");
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"Exportar CSV",exact:true}).click();const file=await download;await file.saveAs(path.join(evidence,"local-ui-export.csv"));checks.push("authorized CSV downloads");
  await page.screenshot({path:path.join(evidence,"local-admin-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);await page.screenshot({path:path.join(evidence,"local-admin-mobile.png"),fullPage:true});
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll(".ai-costs,.ai-costs>*,.control-main,.control-content")].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width}))}));
  assert(overflow.scroll<=overflow.width,JSON.stringify(overflow));checks.push("mobile has no page-level horizontal overflow");
  assert.deepEqual(errors,[]);checks.push("no browser runtime errors");
  writeFileSync(path.join(evidence,"local-browser-validation.json"),JSON.stringify({passed:true,checks,at:new Date().toISOString()},null,2));console.log(JSON.stringify({passed:true,checks}));
}finally{await browser?.close();server.kill();await fixture.close();}
