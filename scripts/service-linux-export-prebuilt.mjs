import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync,readdirSync,readlinkSync,openSync,readSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {measureServiceReleaseRuntime,SERVICE_RELEASE_ASSET} from '../apps/api/dist/shared/bookings/service-release-artifact.js';
import {verifyServiceReleaseManifest} from '../apps/api/dist/shared/bookings/service-release-manifest.js';
import {servedFrontendDigest,assertServedObservationFacts} from '../apps/dashboard/e2e/service-served-artifact-observation.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),api=resolve(root,'apps/api');
assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');assert.equal(process.argv.length,5,'release_node_nginx_digest_and_target_required');
const [nodeBase,nginxBase,target]=process.argv.slice(2);
assert.match(nodeBase,/^(?:docker\.io\/library\/)?node@sha256:[a-f0-9]{64}$/,'release_pinned_node_base_required');
assert.match(nginxBase,/^(?:docker\.io\/)?nginxinc\/nginx-unprivileged@sha256:[a-f0-9]{64}$/,'release_pinned_nginx_base_required');
assert.ok(['sandbox','production'].includes(target));
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();assert.match(revision,/^[a-f0-9]{40}$/);
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim(),'');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fileHash(path){const fd=openSync(path,'r'),buffer=Buffer.allocUnsafe(1024*1024),hasher=createHash('sha256');
  try{let size;while((size=readSync(fd,buffer,0,buffer.length,null))>0)hasher.update(buffer.subarray(0,size));return hasher.digest('hex');}finally{closeSync(fd);}}
const runtime=measureServiceReleaseRuntime(api,revision),manifestBytes=readFileSync(resolve(api,SERVICE_RELEASE_ASSET)),manifest=JSON.parse(manifestBytes);
assert.equal(verifyServiceReleaseManifest(manifest,runtime).kind,'verified');
const evidence=resolve(root,'.cache/linux-service-release-'+revision),sealed=JSON.parse(readFileSync(resolve(evidence,'sealed-release.json'),'utf8'));
assert.equal(sealed.revision,revision);assert.equal(sealed.targetEnvironment,target);assert.equal(sealed.manifestSha256,hash(manifestBytes));
const materialization=JSON.parse(readFileSync(resolve(root,'.cache/service-release-migration-materialization.json'),'utf8'));
assert.equal(materialization.target,target);assert.equal(materialization.sourceRevision,revision);
const observedBytes=readFileSync(resolve(evidence,'standalone-widget-observation.json')),observed=JSON.parse(observedBytes);
assert.equal(hash(observedBytes),sealed.standaloneObservationSha256);assertServedObservationFacts(observed);
assert.equal(observed.frontendId,'widget-app');assert.equal(observed.sourceRevision,revision);assert.equal(observed.releasePayloadSha256,runtime.apiPayloadSha256);
assert.equal(observed.artifactSha256,servedFrontendDigest('widget-app'));
assert.equal(existsSync(resolve(root,'apps/storefront/.next/standalone')),false,'release_next_must_be_nonstandalone');
const release=resolve(root,'.release');assert.equal(existsSync(release),false,'release_fresh_transport_metadata_required');mkdirSync(release);
const metadata={version:1,targetEnvironment:target,sourceRevision:revision,sourceInputSha256:runtime.sourceInputSha256,apiPayloadSha256:runtime.apiPayloadSha256,
  manifestSha256:hash(manifestBytes),nodeBase,nginxBase,nodeRuntime:{platform:process.platform,arch:process.arch,nodeVersion:process.version,nodeAbi:process.versions.modules},
  supplementalArtifacts:[{id:'widget-app',artifactSha256:observed.artifactSha256,observationSha256:hash(observedBytes),browserRawSha256:sealed.standaloneBrowserRawSha256}]};
writeFileSync(resolve(release,'transport.json'),JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
const start=['#!/bin/sh','set -eu','cd /repo/apps/api','node /repo/scripts/service-release-payload-verify.mjs',
  "export RAILWAY_GIT_COMMIT_SHA='"+revision+"'",'node scripts/predeploy-migrations.mjs','exec node dist/main.js',''].join('\n');
writeFileSync(resolve(release,'start-api.sh'),start,{flag:'wx',mode:0o755});
const selected=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','packages','node_modules','apps/api','apps/storefront',
  'apps/dashboard/dist','apps/dashboard/nginx.conf','apps/widget_v2','scripts/service-release-payload-verify.mjs','.release'];
const excluded=path=>path==='apps/api/.sandbox-state'||path==='apps/storefront/.next/cache'||
  path.split('/').at(-1)==='.env'||path.split('/').at(-1).startsWith('.env.');
const inventory=[];
function inspect(path){
  if(excluded(path))return;const absolute=resolve(root,path),stat=lstatSync(absolute);
  if(stat.isSymbolicLink()){
    const link=readlinkSync(absolute);assert.equal(isAbsolute(link),false,'release_absolute_dependency_symlink');
    assert.ok(!relative(root,resolve(dirname(absolute),link)).startsWith('..'),'release_dependency_symlink_escape');inventory.push({path,symlink:link});
  }else if(stat.isDirectory())for(const name of readdirSync(absolute).sort())inspect(path+'/'+name);
  else if(stat.isFile())inventory.push({path,sha256:fileHash(absolute),bytes:stat.size});else assert.fail('release_unsupported_payload_entry');
}
for(const path of selected)inspect(path);inventory.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const directory=resolve(root,'.cache/railway-prebuilt-'+revision);assert.equal(existsSync(directory),false);mkdirSync(resolve(directory,'templates'),{recursive:true});
const tar=resolve(directory,'payload.tar.gz');
execFileSync('tar',['--create','--gzip','--file',tar,...['apps/api/.sandbox-state','apps/storefront/.next/cache','*/.env','*/.env.*'].map(name=>'--exclude='+name),'--',...selected],{cwd:root,stdio:'inherit'});
const contexts={};
function template(id,archive,dockerfile,body,requiredStartCommand=null){
  const text=body.join('\n')+'\n',path=resolve(directory,'templates/'+id+'.Dockerfile');writeFileSync(path,text,{flag:'wx'});
  contexts[id]={archive,dockerfile,template:'templates/'+id+'.Dockerfile',archiveSha256:fileHash(resolve(directory,archive)),templateSha256:hash(text),requiredStartCommand};
}
const runtimeHeader=['FROM '+nodeBase,'RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl libgomp1 && rm -rf /var/lib/apt/lists/*',
  'ADD payload.tar.gz /repo/','LABEL org.opencontainers.image.revision="'+revision+'"','RUN node /repo/scripts/service-release-payload-verify.mjs'];
template('api','payload.tar.gz','apps/api/Dockerfile',[...runtimeHeader,'WORKDIR /repo/apps/api','ENV NODE_ENV=production PORT=3009',
  'CMD ["sh", "/repo/.release/start-api.sh"]'],'sh /repo/.release/start-api.sh');
template('storefront','payload.tar.gz','apps/storefront/Dockerfile',[...runtimeHeader,'WORKDIR /repo/apps/storefront',
  'RUN mkdir -p /repo/apps/storefront/.next/cache && chown -R node:node /repo/apps/storefront/.next/cache',
  'ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0','USER node','EXPOSE 8080',
  'CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "8080"]'],
  'node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 8080');
function staticTar(id,source,configuration,archive){
  const proof=resolve(evidence,'static-'+id);mkdirSync(proof,{recursive:false});const checks=[];
  function files(path){for(const item of readdirSync(path,{withFileTypes:true})){
    assert.equal(item.isSymbolicLink(),false,'release_static_symlink');const absolute=resolve(path,item.name);
    if(item.isDirectory())files(absolute);else if(item.isFile()){
      const local=relative(resolve(root,source),absolute).replaceAll('\\','/');assert.ok(local&&!/[\x00-\x1f\\]/.test(local),'release_static_path_invalid');
      checks.push({path:local,sha256:fileHash(absolute)});
    }
  }}files(resolve(root,source));assert.ok(checks.some(row=>row.path==='index.html'),'release_static_app_index_required');checks.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  writeFileSync(resolve(proof,'static-files.sha256'),checks.map(row=>row.sha256+'  '+row.path).join('\n')+'\n',{flag:'wx'});
  const configurationHash=fileHash(resolve(root,configuration));
  execFileSync('tar',['--create','--gzip','--file',resolve(directory,archive),'-C',root,source,configuration,'-C',proof,'static-files.sha256'],{stdio:'inherit'});
  const body=['FROM '+nginxBase,'USER root','ADD payload.tar.gz /payload/',
    'RUN rm -rf /usr/share/nginx/html && mkdir -p /usr/share/nginx/html && rm -f /etc/nginx/conf.d/default.conf',
    'RUN cp -a /payload/'+source+'/. /usr/share/nginx/html/ && cp /payload/'+configuration+' /etc/nginx/conf.d/default.conf',
    'RUN cd /usr/share/nginx/html && sha256sum -c /payload/static-files.sha256',
    'RUN echo "'+configurationHash+'  /etc/nginx/conf.d/default.conf" | sha256sum -c - && nginx -t',
    'RUN chown -R nginx:nginx /usr/share/nginx/html','LABEL org.opencontainers.image.revision="'+revision+'"','USER nginx','EXPOSE 8080',
    'HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1',
    'CMD ["nginx", "-g", "daemon off;"]'];
  template(id,archive,id==='dashboard'?'apps/dashboard/Dockerfile':'apps/widget_v2/Dockerfile',body);
  return{artifactSha256:servedFrontendDigest(id==='dashboard'?'dashboard':'widget-app'),configurationSha256:configurationHash,files:checks};
}
const staticArtifacts={dashboard:staticTar('dashboard','apps/dashboard/dist','apps/dashboard/nginx.conf','dashboard.tar.gz'),
  'widget-v2':staticTar('widget-v2','apps/widget_v2/dist-app','apps/widget_v2/nginx.generated.conf','widget-app.tar.gz')};
writeFileSync(resolve(directory,'contexts.json'),JSON.stringify({version:1,targetEnvironment:target,sourceRevision:revision,contexts},null,2)+'\n',{flag:'wx'});
writeFileSync(resolve(directory,'transport-inventory.json'),JSON.stringify({...metadata,payloadArchiveSha256:fileHash(tar),fileInventorySha256:hash(JSON.stringify(inventory)),
  files:inventory,staticArtifacts},null,2)+'\n',{flag:'wx'});
assert.deepEqual(measureServiceReleaseRuntime(api,revision),runtime,'release_export_changed_source_payload');
console.log(JSON.stringify({sourceRevision:revision,targetEnvironment:target,bundle:relative(root,directory),contexts:Object.keys(contexts),
  payloadArchiveSha256:fileHash(tar),fileInventorySha256:hash(JSON.stringify(inventory)),nodeBase,nginxBase,deploymentPerformed:false,providerAccepted:false}));
