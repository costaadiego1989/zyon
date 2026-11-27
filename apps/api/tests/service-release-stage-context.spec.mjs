import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stagePrebuiltContext} from '../../../scripts/service-release-stage-context.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),cache=resolve(root,'.cache'),revision='a'.repeat(40);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(work){
  mkdirSync(cache,{recursive:true});const directory=mkdtempSync(resolve(cache,'release-context-contract-')),bundle=resolve(directory,'bundle');mkdirSync(resolve(bundle,'templates'),{recursive:true});
  const archive=Buffer.from([31,139,8,0,0,1,2,255]),dockerfile=Buffer.from('FROM node@sha256:'+'b'.repeat(64)+'\nADD payload.tar.gz /repo\n');
  const map={api:['payload.tar.gz','apps/api/Dockerfile'],storefront:['payload.tar.gz','apps/storefront/Dockerfile'],dashboard:['dashboard.tar.gz','apps/dashboard/Dockerfile'],'widget-v2':['widget-app.tar.gz','apps/widget_v2/Dockerfile']};
  const contexts={};for(const [target,[name,file]]of Object.entries(map)){
    writeFileSync(resolve(bundle,name),archive);writeFileSync(resolve(bundle,'templates',target+'.Dockerfile'),dockerfile);
    contexts[target]={archive:name,dockerfile:file,template:'templates/'+target+'.Dockerfile',archiveSha256:hash(archive),templateSha256:hash(dockerfile),requiredStartCommand:null};
  }
  const metadata={version:1,sourceRevision:revision,targetEnvironment:'sandbox',contexts};writeFileSync(resolve(bundle,'contexts.json'),JSON.stringify(metadata));
  try{return work({directory,bundle,metadata,archive,dockerfile});}finally{
    const actual=realpathSync(directory),owned=relative(realpathSync(cache),actual);
    assert.ok(!isAbsolute(owned)&&!owned.startsWith('..')&&owned.startsWith('release-context-contract-')&&!owned.includes('/')&&!owned.includes('\\'));
    rmSync(actual,{recursive:true,force:false});
  }
}
for(const target of ['api','storefront','dashboard','widget-v2'])test('prebuilt '+target+' context copies exact opaque bytes without archive expansion or recompilation',()=>fixture(({directory,bundle,archive,dockerfile})=>{
  const output=resolve(directory,target),result=stagePrebuiltContext({bundle,target,output,expectedRevision:revision,expectedEnvironment:'sandbox'});
  assert.deepEqual(readFileSync(resolve(output,'payload.tar.gz')),archive);assert.deepEqual(readFileSync(resolve(output,result.dockerfile)),dockerfile);
  assert.equal(result.archiveExpanded,false);assert.equal(result.deployPerformed,false);assert.equal(result.sourceRevision,revision);
  assert.deepEqual(readFileSync(resolve(bundle,target==='dashboard'?'dashboard.tar.gz':target==='widget-v2'?'widget-app.tar.gz':'payload.tar.gz')),archive);
}));
test('prebuilt context rejects changed identity and payload before creating output',()=>fixture(({directory,bundle})=>{
  const output=resolve(directory,'out');assert.throws(()=>stagePrebuiltContext({bundle,target:'api',output,expectedRevision:'c'.repeat(40),expectedEnvironment:'sandbox'}),/release_stage_revision_changed/);
  assert.throws(()=>stagePrebuiltContext({bundle,target:'api',output,expectedRevision:revision,expectedEnvironment:'production'}),/release_stage_environment_changed/);
  writeFileSync(resolve(bundle,'payload.tar.gz'),'changed');assert.throws(()=>stagePrebuiltContext({bundle,target:'api',output,expectedRevision:revision,expectedEnvironment:'sandbox'}),/release_stage_archive_changed/);
  assert.equal(existsSync(output),false);
}));
test('prebuilt context rejects unknown target, path escape, template changes and an existing destination',()=>fixture(({directory,bundle})=>{
  const input={bundle,target:'api',output:resolve(directory,'out'),expectedRevision:revision,expectedEnvironment:'sandbox'};
  assert.throws(()=>stagePrebuiltContext({...input,target:'../../other'}),/release_stage_target_unknown/);
  assert.throws(()=>stagePrebuiltContext({...input,output:resolve(root,'outside-cache')}),/release_stage_owned_cache_required/);
  mkdirSync(input.output);assert.throws(()=>stagePrebuiltContext(input),/release_stage_fresh_context_required/);
  writeFileSync(resolve(bundle,'templates/api.Dockerfile'),'changed');assert.throws(()=>stagePrebuiltContext({...input,output:resolve(directory,'other')}),/release_stage_template_changed/);
}));
