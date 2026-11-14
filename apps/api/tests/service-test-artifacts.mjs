import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const api=resolve(fileURLToPath(new URL('../',import.meta.url))),root=resolve(api,'../..');
const state=resolve(api,'.sandbox-state/service-test-build.json'),beforePath=resolve(api,'.sandbox-state/service-test-build-inputs.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
function inventory(emitted){
  const files=[];
  const add=p=>{assert.ok(lstatSync(p).isFile());files.push({path:relative(root,p).replaceAll('\\','/'),sha256:sha(readFileSync(p))});};
  const walk=(p,extensions)=>{if(!existsSync(p))return;for(const entry of readdirSync(p,{withFileTypes:true})){
    assert.equal(entry.isSymbolicLink(),false,'service_artifact_symlink_forbidden');
    const path=resolve(p,entry.name);if(entry.isDirectory())walk(path,extensions);else if(extensions.some(x=>entry.name.endsWith(x)))add(path);
  }};
  // Production compilation inputs only. The JS harness is executed directly
  // and proven separately by its own tests, not typechecked by Nest build.
  walk(resolve(api,'src'),['.ts','.json']);
  for(const name of ['package.json','tsconfig.json','tsconfig.build.json','nest-cli.json','prisma.config.ts','prisma/schema.prisma'])add(resolve(api,name));
  for(const name of ['package.json','pnpm-lock.yaml','tsconfig.base.json'])add(resolve(root,name));
  for(const entry of readdirSync(resolve(root,'packages'),{withFileTypes:true}))if(entry.isDirectory()){
    const base=resolve(root,'packages',entry.name);if(existsSync(resolve(base,'package.json')))add(resolve(base,'package.json'));
    walk(resolve(base,'src'),['.ts','.json']);if(emitted)walk(resolve(base,'dist'),['.js','.json']);
  }
  if(emitted)walk(resolve(api,'dist'),['.js','.json']);
  files.sort((a,b)=>a.path.localeCompare(b.path,'en'));return files;
}
export function serviceBuildInputs(){
  for(const path of [resolve(api,'tsconfig.json'),resolve(api,'tsconfig.build.json'),resolve(root,'tsconfig.base.json')])
    assert.notEqual(JSON.parse(readFileSync(path,'utf8')).compilerOptions?.noCheck,true,'service_checked_build_required');
  return sha(JSON.stringify(inventory(false)));
}
export function assertServiceArtifacts(){
  const evidence=JSON.parse(readFileSync(state,'utf8'));
  assert.equal(evidence.version,1);assert.equal(evidence.buildCommand,'pnpm --dir apps/api build');
  assert.equal(evidence.buildExitCode,0);assert.equal(evidence.checked,true);
  assert.equal(evidence.inputSha256,serviceBuildInputs(),'service_source_changed_since_checked_build');
  assert.equal(evidence.artifactSha256,sha(JSON.stringify(inventory(true))),'service_artifact_changed_since_checked_build');
  assert.ok(existsSync(resolve(api,'dist/app.module.js')),'service_real_app_module_required');
  return Object.freeze({checked:true,inputSha256:evidence.inputSha256,artifactSha256:evidence.artifactSha256});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  assert.ok(['--capture-inputs','--record-build-exit0'].includes(process.argv[2])&&process.argv.length===3);
  mkdirSync(dirname(state),{recursive:true});
  if(process.argv[2]==='--capture-inputs')writeFileSync(beforePath,JSON.stringify({inputSha256:serviceBuildInputs()}));
  else{
    const before=JSON.parse(readFileSync(beforePath,'utf8'));
    assert.equal(before.inputSha256,serviceBuildInputs(),'service_source_changed_during_build');
    assert.ok(existsSync(resolve(api,'dist/app.module.js')));
    writeFileSync(state,JSON.stringify({version:1,buildCommand:'pnpm --dir apps/api build',buildExitCode:0,checked:true,
      inputSha256:before.inputSha256,artifactSha256:sha(JSON.stringify(inventory(true))),recordedAt:new Date().toISOString()}));
    assertServiceArtifacts();console.log('service checked production artifact recorded');
  }
}
