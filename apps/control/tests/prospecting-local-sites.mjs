// Owned Vite frontends use only the loopback API and the local test certificate.
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {createServer as https} from "node:https";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";
const certDir=fileURLToPath(new URL("../../../.specs/features/admin-company-prospecting/browser-runtime/",import.meta.url));
const tls={cert:readFileSync(certDir+"/local.crt"),key:readFileSync(certDir+"/local.key")};
const origins={api:"http://127.0.0.1:3019",control:"http://127.0.0.1:5179",dashboard:"https://127.0.0.1:5180",site:"https://127.0.0.1:5181"};
const servers=[];
async function site(app,port){
 const dashboard=app==="dashboard";
 const root=fileURLToPath(new URL("../../"+app+"/",import.meta.url));
 const server=await createServer({root,configFile:false,envFile:false,resolve:{alias:{"@":fileURLToPath(new URL("../../storefront/src/",import.meta.url))}},optimizeDeps:{entries:["index.html"]},plugins:[react(),{name:"local-preview-label",
  transformIndexHtml(){return [{tag:"div",attrs:{"aria-label":"Ambiente local",style:"background:#ecf4ef;color:#254333;padding:5px 12px;font:12px system-ui"},children:"Ambiente local · Dados fictícios e provedores simulados",injectTo:"body-prepend"}];}}],
  define:{"import.meta.env.VITE_PLATFORM_API_BASE_URL":JSON.stringify(origins.api+"/v1"),"import.meta.env.VITE_API_BASE_URL":JSON.stringify(origins.dashboard+"/v1"),
    "import.meta.env.VITE_TURNSTILE_SITE_KEY":JSON.stringify(""),"import.meta.env.VITE_FACEBOOK_LOGIN_ENABLED":JSON.stringify("false")},
  server:{host:"127.0.0.1",port,strictPort:true,hmr:false,https:dashboard?tls:undefined,
   headers:{"Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' "+origins.api+"; frame-src 'self'; form-action 'self'; object-src 'none'"},
   proxy:dashboard?{"/v1":{target:origins.api,changeOrigin:true}}:undefined}});
 servers.push(()=>server.close());await server.listen();
}
async function close(){await Promise.allSettled(servers.map(stop=>stop()));process.exit(0);}
process.on("message",m=>{if(m==="stop")void close();});
process.once("disconnect",()=>void close());
try {
 await site("control",5179);await site("dashboard",5180);
 const publicSite=https(tls,(req,res)=>{if(req.url!=="/"){res.writeHead(404).end();return;}res.setHeader("Content-Type","text/html; charset=utf-8");res.end("<!doctype html><html lang='pt-BR'><title>Zyon local</title><h1>Site da Zyon</h1><p>Destino público simulado no ambiente local.</p></html>");});
 await new Promise((resolve,reject)=>{publicSite.once("error",reject);publicSite.listen(5181,"127.0.0.1",resolve);});servers.push(()=>new Promise(r=>publicSite.close(r)));
 process.send?.({ready:true,pid:process.pid});
}catch(e){process.send?.({error:String(e)});await close();}
