import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const api=resolve(fileURLToPath(new URL('../',import.meta.url))),root=resolve(api,'../..');
const state=resolve(api,'.sandbox-state/service-test-build.json'),beforePath=resolve(api,'.sandbox-state/service-test-build-inputs.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
export function productionCompilationFiles(configPath){
  const ts=createRequire(import.meta.url)('typescript');
  const config=ts.readConfigFile(configPath,ts.sys.readFile);assert.equal(config.error,undefined,'service_build_config_unreadable');
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,dirname(configPath));
  assert.equal(parsed.errors.length,0,'service_build_config_invalid');
  assert.notEqual(parsed.options.noCheck,true,'service_checked_build_required');
  // A source excluded as a root still participates if production imports it.
  // Use the actual compiler program rather than filename-based assumptions.
  const program=ts.createProgram(parsed.fileNames,parsed.options);
  return program.getSourceFiles().filter(source=>!source.isDeclarationFile&&!program.isSourceFileFromExternalLibrary(source))
    .map(source=>resolve(source.fileName));
}
export function assertProductionCoverage(compiledFiles,inputPaths){
  const covered=new Set(inputPaths.map(path=>resolve(path)));
  assert.ok(compiledFiles.length>0,'service_compiler_sources_required');
  for(const path of compiledFiles)assert.ok(covered.has(resolve(path)),`service_compiler_source_outside_fingerprint:${path}`);
  return{checked:true,sourceCount:compiledFiles.length};
}
function inventory(emitted,productionInputs){
  const files=[];
  const add=p=>{assert.ok(lstatSync(p).isFile());files.push({path:relative(root,p).replaceAll('\\','/'),sha256:sha(readFileSync(p))});};
  const walk=(p,extensions)=>{if(!existsSync(p))return;for(const entry of readdirSync(p,{withFileTypes:true})){
    assert.equal(entry.isSymbolicLink(),false,'service_artifact_symlink_forbidden');
    const path=resolve(p,entry.name);if(entry.isDirectory())walk(path,extensions);else if(extensions.some(x=>entry.name.endsWith(x)))add(path);
  }};
  if(productionInputs){
    assert.equal(emitted,true);files.push(...productionInputs);
    for(const entry of readdirSync(resolve(root,'packages'),{withFileTypes:true}))
      if(entry.isDirectory())walk(resolve(root,'packages',entry.name,'dist'),['.js','.json']);
    walk(resolve(api,'dist'),['.js','.json']);
    return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  }
  // Production compilation inputs only. The JS harness is executed directly
  // and proven separately by its own tests, not typechecked by Nest build.
  // A conservative superset keeps runtime verification cheap and restrictive.
  // Build-time compiler coverage below proves no productive source is omitted.
  walk(resolve(api,'src'),['.ts','.tsx','.mts','.cts','.json']);
  for(const name of ['package.json','tsconfig.json','tsconfig.build.json','nest-cli.json','prisma.config.ts','prisma/schema.prisma'])add(resolve(api,name));
  for(const name of ['package.json','pnpm-lock.yaml','tsconfig.base.json'])add(resolve(root,name));
  for(const entry of readdirSync(resolve(root,'packages'),{withFileTypes:true}))if(entry.isDirectory()){
    const base=resolve(root,'packages',entry.name);if(existsSync(resolve(base,'package.json')))add(resolve(base,'package.json'));
    for(const name of ['tsconfig.json','tsconfig.build.json'])if(existsSync(resolve(base,name)))add(resolve(base,name));
    walk(resolve(base,'src'),['.ts','.tsx','.mts','.cts','.json']);if(emitted)walk(resolve(base,'dist'),['.js','.json']);
  }
  if(emitted)walk(resolve(api,'dist'),['.js','.json']);
  files.sort((a,b)=>a.path.localeCompare(b.path,'en'));return files;
}
function checkedBuildInputs(){
  for(const path of [resolve(api,'tsconfig.json'),resolve(api,'tsconfig.build.json'),resolve(root,'tsconfig.base.json')])
    assert.notEqual(JSON.parse(readFileSync(path,'utf8')).compilerOptions?.noCheck,true,'service_checked_build_required');
  return inventory(false);
}
export function serviceBuildInputs(){return sha(JSON.stringify(checkedBuildInputs()));}
export function assertServiceArtifacts(){
  const evidence=JSON.parse(readFileSync(state,'utf8'));
  assert.equal(evidence.version,1);assert.equal(evidence.buildCommand,'pnpm --dir apps/api build');
  assert.equal(evidence.buildExitCode,0);assert.equal(evidence.checked,true);
  assert.equal(evidence.compilerCoverage?.checked,true,'service_build_compiler_coverage_required');
  assert.ok(Number.isInteger(evidence.compilerCoverage.sourceCount)&&evidence.compilerCoverage.sourceCount>0);
  const inputs=checkedBuildInputs();
  assert.equal(evidence.inputSha256,sha(JSON.stringify(inputs)),'service_source_changed_since_checked_build');
  assert.equal(evidence.artifactSha256,sha(JSON.stringify(inventory(true,inputs))),'service_artifact_changed_since_checked_build');
  assert.ok(existsSync(resolve(api,'dist/app.module.js')),'service_real_app_module_required');
  return Object.freeze({checked:true,inputSha256:evidence.inputSha256,artifactSha256:evidence.artifactSha256,
    compilerCoverage:evidence.compilerCoverage});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  assert.ok(['--capture-inputs','--record-build-exit0'].includes(process.argv[2])&&process.argv.length===3);
  mkdirSync(dirname(state),{recursive:true});
  if(process.argv[2]==='--capture-inputs'){
    const inputs=checkedBuildInputs();
    const compilerCoverage=assertProductionCoverage(productionCompilationFiles(resolve(api,'tsconfig.build.json')),
      inputs.map(input=>resolve(root,input.path)));
    writeFileSync(beforePath,JSON.stringify({inputSha256:sha(JSON.stringify(inputs)),compilerCoverage}));
    console.log('service compiler input coverage:',compilerCoverage.sourceCount);
  }
  else{
    const before=JSON.parse(readFileSync(beforePath,'utf8'));
    assert.equal(before.compilerCoverage?.checked,true,'service_build_compiler_coverage_required');
    const inputs=checkedBuildInputs();
    assert.equal(before.inputSha256,sha(JSON.stringify(inputs)),'service_source_changed_during_build');
    assert.ok(existsSync(resolve(api,'dist/app.module.js')));
    writeFileSync(state,JSON.stringify({version:1,buildCommand:'pnpm --dir apps/api build',buildExitCode:0,checked:true,
      inputSha256:before.inputSha256,artifactSha256:sha(JSON.stringify(inventory(true,inputs))),compilerCoverage:before.compilerCoverage,
      recordedAt:new Date().toISOString()}));
    console.log('service checked production artifact recorded');
  }
}
