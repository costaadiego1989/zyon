import "./test-network-guard.mjs";
import "reflect-metadata";
import {createServer} from "node:net";
import {fork,execFileSync} from "node:child_process";
import {existsSync,readFileSync,writeFileSync,unlinkSync} from "node:fs";
import {fileURLToPath,pathToFileURL} from "node:url";
import {Module} from "@nestjs/common";
import {NestFactory} from "@nestjs/core";
import {openBrowserData,localDir} from "./prospecting-browser-data.js";
import {browserServices} from "./prospecting-browser-services.js";
import {operator,buyer} from "./prospecting-browser-accounts.js";
const origins={api:"http://127.0.0.1:3019",control:"http://127.0.0.1:5179",dashboard:"https://127.0.0.1:5180",site:"https://127.0.0.1:5181"};
const profile=fileURLToPath(new URL("../../../.env.prospecting.local",import.meta.url));
async function available(port:number){await new Promise<void>((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(port,"127.0.0.1",()=>s.close(()=>resolve()));});}
export async function startProspectingBrowserRuntime(mode:"disposable"|"preview"){
 if(!["disposable","preview"].includes(mode)||process.env.NODE_ENV==="production")throw Error("local_runtime_required");
 process.loadEnvFile(profile);
 for(const flag of ["META_SEND_ENABLED","LLM_REAL_ENABLED","INGESTION_ENABLED","PAID_INGESTION_ENABLED"])if(process.env["PROSPECTING_"+flag]!=="false")throw Error("real_provider_flag_enabled");
 for(const port of [3019,5179,5180,5181])await available(port);
 const fake={STRIPE_SECRET_KEY_TEST:"sk_test_browser_local",STRIPE_WEBHOOK_SECRET_TEST:"whsec_browser_local",ASAAS_WEBHOOK_TOKEN:"browser-local-captured-asaas"};
 const prior=Object.fromEntries(Object.keys(fake).map(k=>[k,process.env[k]]));Object.assign(process.env,fake);
 const data=await openBrowserData(mode);
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined,child:ReturnType<typeof fork>|undefined;
 let timer:ReturnType<typeof setInterval>|undefined,poll:Promise<void>|null=null;
 let closed=false,receipt=false;
 const receiptFile=localDir+"/listeners.json";
 async function close(){
  if(closed)return;closed=true;
  if(timer)clearInterval(timer);if(poll)await poll;
  try{
   if(child&&child.exitCode===null&&child.signalCode===null){
    const exit=new Promise<void>(resolve=>child!.once("exit",()=>resolve()));
    if(child.connected)child.send("stop");const deadline=setTimeout(()=>child?.kill(),8000);await exit;clearTimeout(deadline);
   }
   await app?.close();
  }finally{
   await data.close();if(receipt&&existsSync(receiptFile)&&JSON.parse(readFileSync(receiptFile,"utf8")).apiPid===process.pid)unlinkSync(receiptFile);
   for(const [k,v] of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
 }
 try{
  if(!existsSync(localDir+"/local.crt")||!existsSync(localDir+"/local.key")){
   const openssl=process.platform==="win32"?"C:/Program Files/Git/usr/bin/openssl.exe":"openssl";
   execFileSync(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-days","30","-keyout",localDir+"/local.key","-out",localDir+"/local.crt","-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1"],{windowsHide:true,stdio:"ignore"});
  }
  const s=await browserServices(data,origins);
  class LocalBrowserModule{}
  Module({controllers:s.controllers,providers:s.providers})(LocalBrowserModule);
  app=await NestFactory.create(LocalBrowserModule,{logger:false,abortOnError:false,rawBody:true});app.setGlobalPrefix("v1");
  app.enableCors({origin:[origins.control,origins.dashboard],credentials:true});
  app.use((req:{url:string;method:string},res:{status:(n:number)=>{end:()=>void}},next:()=>void)=>{
   const path=req.url.split("?")[0];
   if(path.startsWith("/v1/platform/prospecting/")||/^\/v1\/(platform\/auth\/(login|me|refresh|logout)|auth\/(login|register|refresh|logout|me)|merchants\/me(?:\/store-settings)?|billing\/(prospect-proposal\/bind|plans|subscription)|webhooks\/(stripe|asaas\/billing))$/.test(path))next();else res.status(404).end();
  });
  await app.listen(3019,"127.0.0.1");
  child=fork(fileURLToPath(new URL("../../control/tests/prospecting-local-sites.mjs",import.meta.url)),[],{execArgv:[],windowsHide:true,stdio:["ignore","ignore","inherit","ipc"],
   env:Object.fromEntries(["PATH","SystemRoot","TEMP","TMP","USERPROFILE","LOCALAPPDATA","APPDATA","ComSpec"].map(k=>[k,process.env[k]]))});
  await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error("vite_start_timeout")),60000);child!.once("message",(m:any)=>{clearTimeout(timeout);m.ready?resolve():reject(Error(m.error));});child!.once("exit",code=>{clearTimeout(timeout);reject(Error("vite_exit_"+code));});child!.once("error",reject);});
  writeFileSync(receiptFile,JSON.stringify({mode,apiPid:process.pid,sitePid:child.pid,origins,database:data.namespace,startedAt:new Date().toISOString()},null,2));receipt=true;
  async function step(){
   await s.audience.processNext();
   const pending=await data.prisma.prospectMessage.findMany({where:{state:"prepared",direction:"outbound",attemptId:null},orderBy:{createdAt:"asc"},take:10,select:{id:true}});
   for(const m of pending)await s.conversation.dispatch(m.id);
  }
  timer=setInterval(()=>{if(!poll)poll=step().catch(e=>console.error("local_worker",e instanceof Error?e.name:"error")).finally(()=>{poll=null;});},800);
  return {origins,operator,buyer,prisma:data.prisma,leadId:s.leadId,conversationId:s.conversationId,incoming:s.incoming,close};
 }catch(e){await close();throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const runtime=await startProspectingBrowserRuntime(process.argv.includes("--preview")?"preview":"disposable");
 console.log("Control local em "+origins.control);
 for(const sig of ["SIGTERM","SIGINT","SIGBREAK"] as const)process.once(sig,()=>void runtime.close().then(()=>process.exit(0)));
 const stopFile=localDir+"/stop-"+process.pid;
 const check=setInterval(()=>{if(existsSync(stopFile)){clearInterval(check);unlinkSync(stopFile);void runtime.close().then(()=>process.exit(0));}},400);
}
