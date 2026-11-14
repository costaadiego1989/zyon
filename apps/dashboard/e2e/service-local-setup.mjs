import {createServer} from 'vite';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServiceTestRuntime} from '../../api/tests/service-test-runtime.mjs';
import {assertLocalServiceOrigin,serviceBrowserEnvironment} from './service-local-scope.mjs';

const directory=dirname(fileURLToPath(import.meta.url)),dashboard=resolve(directory,'..');
const origin=assertLocalServiceOrigin('http://127.0.0.1:5187');
const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixture WhatsApp local</title><style>body{margin:0;font:16px/1.6 system-ui;background:#edf1ef;color:#162b22}main{max-width:620px;margin:40px auto;padding:28px;background:white;border-radius:12px}strong{display:block;font-size:13px;color:#385545}h1{font-size:24px}button{padding:12px 18px;background:#167848;color:white;border:0;border-radius:7px;font:inherit;cursor:pointer}p{max-width:60ch}output{display:block;margin-top:24px}@media(max-width:640px){main{margin:16px;padding:24px}}</style><main><strong>Fixture local de teste · Sem conexão com a Meta</strong><h1>WhatsApp</h1><p>Este ambiente prepara os testes de produtos e agendamentos com a API e o banco locais. As jornadas serão adicionadas nas tarefas seguintes.</p><button id="check">Verificar API local</button><output id="result" aria-live="polite">Aguardando verificação.</output></main><script>document.getElementById('check').onclick=async()=>{const target=document.getElementById('result');try{const response=await fetch('/v1/ready');const data=await response.json();if(!response.ok||data.status!=='ready')throw Error();target.textContent='API local pronta. Banco conectado.';}catch{target.textContent='API local indisponível.';}};</script></html>`;

export default async function setup(){
  const previousEnvironment=process.env;
  process.env=serviceBrowserEnvironment(previousEnvironment);
  let runtime,server;
  const close=async()=>{
    const errors=[];
    try{await server?.close();}catch(error){errors.push(error);}
    try{await runtime?.close();}catch(error){errors.push(error);}
    process.env=previousEnvironment;
    if(errors.length)throw new AggregateError(errors,'service_browser_cleanup_failed');
  };
  try{
    runtime=await createServiceTestRuntime({local:true});
    console.log('Local service runtime startup:',JSON.stringify(runtime.evidence().startupTimings));
    assertLocalServiceOrigin(runtime.apiOrigin);
    process.env.VITE_API_BASE_URL=origin;
    process.env.SERVICE_LOCAL_ORIGIN=origin;
    process.env.SERVICE_LOCAL_RUN_ID=runtime.db.runId;
    const plugin={name:'service-local-owned-fixtures',configureServer(vite){
      vite.middlewares.use((request,response,next)=>{
        if(request.url==='/__service/manifest'){
          response.setHeader('Content-Type','application/json');response.end(JSON.stringify({origin,apiOrigin:runtime.apiOrigin,
            runId:runtime.db.runId,kind:'local-owned',metaConnected:false,pspConnected:false}));return;
        }
        if(request.url==='/__service/whatsapp'){
          response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);return;
        }
        next();
      });
    }};
    server=await createServer({root:dashboard,configFile:resolve(dashboard,'vite.config.ts'),envFile:false,
      clearScreen:false,logLevel:'error',plugins:[plugin],
      define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify(origin)},
      server:{host:'127.0.0.1',port:5187,strictPort:true,
        proxy:{'/v1':{target:runtime.apiOrigin,changeOrigin:false}}}});
    await server.listen();
    return close;
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'service_browser_setup_cleanup_failed');}throw error;}
}
