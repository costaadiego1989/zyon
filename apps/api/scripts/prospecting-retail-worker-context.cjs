const path=require('node:path');

function retailWorkerContext({standalone=false,cwd,env={}}){
 const apiRoot=standalone?path.resolve(__dirname,'..'):'/repo/apps/api';
 if(path.resolve(cwd)!==path.resolve(apiRoot))throw Error('recovery_worker_directory_invalid');
 if(standalone){
  let url;try{url=new URL(env.DATABASE_URL);}catch{throw Error('standalone_database_config_invalid');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='15439'||url.pathname!=='/aacp_prod'
    ||env.DATABASE_URL!==env.PROSPECTING_DATABASE_URL||env.DATABASE_URL!==env.PROSPECTING_DIRECTORY_DATABASE_URL)
   throw Error('standalone_database_config_invalid');
 }
 return {apiRoot,mode:standalone?'standalone':'railway',folder:standalone
  ?path.resolve(apiRoot,'../../.specs/features/admin-prospecting-import-recovery/standalone-runtime')
  :'/tmp/zyon-retail-recovery-20261123'};
}
module.exports={retailWorkerContext};
