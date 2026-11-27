import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {exportCiApiBundle} from './service-ci-api-transport/export-ci.mjs';
import {REPOSITORY,COMMANDS,RECEIPT,sha,hashFile,treeEntries,rootsFor,inspectTar,verifyBundle,canonicalPrismaSchema} from './service-ci-api-transport/transport-core.mjs';
import {lockedPrismaVersion} from './service-ci-api-transport/import-windows.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const STEP_NAMES={checked:'API checked build (capture, normal build, record)','api-types':'API typecheck (original)',export:'Export API transport early',upload:'Upload API transport early'};
const INPUT_STAMP='apps/api/.sandbox-state/service-test-build-inputs.json';
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const git=(workspace,args)=>execFileSync('git',args,{cwd:workspace,encoding:'utf8'}).trim();
const prefix=(workspace,head)=>path.join(workspace,'.cache','service-ci-api-'+head);
// The host runner owns .cache, whereas the mounted build-output directory is
// created by container root. Keep the host-written binding in the former.
const bindingPath=(workspace,head)=>path.join(workspace,'.cache','service-ci-api-binding-'+head+'.json');
export function nodeIdentity(){return{platform:process.platform,arch:process.arch,nodeVersion:process.version,nodeAbi:process.versions.modules,nodeExecutableSha256:hashFile(process.execPath),validatorImageId:process.env.SERVICE_RELEASE_VALIDATOR_IMAGE_ID??'',nodeBaseImage:process.env.SERVICE_RELEASE_NODE_BASE_IMAGE??''};}
function requireContainer(){assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');assert.match(process.env.SERVICE_RELEASE_VALIDATOR_IMAGE_ID??'',/^sha256:[a-f0-9]{64}$/);for(const name of ['GH_TOKEN','GITHUB_TOKEN','RAILWAY_TOKEN','ACTIONS_RUNTIME_TOKEN'])assert.ok(!process.env[name],'host credentials must never enter validation container');}
async function helper(workspace){return import(pathToFileURL(path.join(workspace,'apps/api/tests/service-test-artifacts.mjs')).href);}
const invocationCommands={capture:['node','tests/service-test-artifacts.mjs','--capture-inputs'],checked:COMMANDS.checked,'seed-compile':['node','apps/api/prisma/seeds/cashback-validation-build.mjs'],record:['node','tests/service-test-artifacts.mjs','--record-build-exit0'],'api-types':COMMANDS['api-types']};
const REQUIRED_INVOCATIONS=['capture','checked','seed-compile','record','api-types'];
async function actualRun(workspace,directory,id,argv,cwd,extra={}){
  const startedAt=new Date().toISOString(),pieces={stdout:[],stderr:[]};let bytes=0;
  const child=spawn(argv[0],argv.slice(1),{cwd:path.join(workspace,cwd),env:{...process.env,...extra},shell:false,stdio:['ignore','pipe','pipe']});
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);for(const stream of ['stdout','stderr'])child[stream].on('data',chunk=>{bytes+=chunk.length;if(bytes>64_000_000){child.kill('SIGTERM');reject(Error('api_phase_output_bound'));return;}pieces[stream].push(chunk);process[stream].write(chunk);});child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});
  const row={id,argv,cwd,startedAt,completedAt:new Date().toISOString(),...result,node:nodeIdentity()};
  for(const stream of ['stdout','stderr']){const content=Buffer.concat(pieces[stream]),file=id+'.'+stream+'.log';fs.writeFileSync(path.join(directory,file),content,{flag:'wx'});row[stream]={path:file,bytes:content.length,sha256:sha(content)};}
  write(path.join(directory,id+'.invocation.json'),row);assert.equal(row.signal,null);assert.equal(row.exitCode,0,'actual API command failed:'+id);return row;
}
export function validateInvocation(directory,id,expectedNode){
  const row=read(path.join(directory,id+'.invocation.json'));assert.equal(row.id,id);assert.deepEqual(row.argv,invocationCommands[id]);assert.equal(row.cwd,id==='capture'||id==='record'?'apps/api':'.');assert.equal(row.exitCode,0);assert.equal(row.signal,null);assert.deepEqual(row.node,expectedNode);
  assert.ok(Date.parse(row.completedAt)>=Date.parse(row.startedAt));
  for(const stream of ['stdout','stderr']){assert.equal(row[stream].path,id+'.'+stream+'.log');const bytes=fs.readFileSync(path.join(directory,row[stream].path));assert.equal(bytes.length,row[stream].bytes);assert.equal(sha(bytes),row[stream].sha256);}return row;
}
export function discoverBinding({run,jobs,head,target}){
  assert.equal(run.repository.full_name,REPOSITORY);assert.equal(run.head_repository.full_name,REPOSITORY);assert.equal(run.head_sha,head);assert.equal(run.path,'.github/workflows/service-business-linux-release.yml');
  const name='Service Linux release ('+target+')',matches=jobs.jobs.filter(job=>job.name===name&&job.status==='in_progress'&&job.run_id===run.id);assert.equal(matches.length,1,'real numeric current job ID required');const job=matches[0];assert.ok(Number.isSafeInteger(job.id)&&job.id>0);
  const steps={};for(const id of ['checked','api-types','export']){const matches=job.steps.filter(step=>step.name===STEP_NAMES[id]);assert.equal(matches.length,1);const step=matches[0];assert.ok(Number.isInteger(step.number)&&step.number>0);assert.equal(step.status,id==='export'?'in_progress':'completed');if(id!=='export')assert.equal(step.conclusion,'success');steps[id]={stepNumber:step.number,stepName:step.name};}
  assert.ok(steps.checked.stepNumber<steps['api-types'].stepNumber&&steps['api-types'].stepNumber<steps.export.stepNumber);
  return{source:'authenticated GitHub REST on host; no credentials in this document',github:{repository:REPOSITORY,runId:run.id,jobId:job.id,runAttempt:run.run_attempt,workflowPath:run.path},jobName:job.name,steps,head,target};
}
function generationEvidence(workspace){
  const names=['apps/api/prisma/schema.prisma','apps/api/prisma/company-directory.prisma','apps/api/prisma.config.ts','apps/api/prisma.company-directory.config.ts','apps/api/package.json','pnpm-lock.yaml','apps/api/tests/service-test-artifacts.mjs','apps/api/src/shared/bookings/service-release-artifact.ts','apps/api/prisma/seeds/cashback-validation-build.mjs',
    'apps/api/prisma/seeds/cashback-validation-seed.ts','apps/api/prisma/seeds/cashback-validation-guard.ts','apps/api/tsconfig.json','apps/api/tsconfig.build.json','tsconfig.base.json','pnpm-workspace.yaml','package.json',
    '.github/workflows/service-business-linux-release.yml','scripts/service-linux-api-phase.mjs','scripts/service-linux-release.mjs','ops/service-release/run-linux-validation.sh',
    'scripts/service-ci-api-transport/transport-core.mjs','scripts/service-ci-api-transport/export-ci.mjs','scripts/service-ci-api-transport/import-windows.mjs'];
  const sourceFiles=names.map(name=>({path:name,sha256:hashFile(path.join(workspace,name))}));
  const require=createRequire(path.join(workspace,'apps/api/package.json')),clientEntry=require.resolve('@prisma/client');
  const main=path.dirname(createRequire(clientEntry).resolve('.prisma/client/default'));
  const clients=[main,path.join(workspace,'apps/api/node_modules/.prisma/company-directory')];
  const installedVersions=Object.fromEntries(['@prisma/client','prisma','typescript'].map(name=>[name,read(require.resolve(name+'/package.json')).version]));
  const lockedVersion=lockedPrismaVersion(workspace);assert.equal(installedVersions.prisma,lockedVersion);assert.equal(installedVersions['@prisma/client'],lockedVersion);
  installedVersions.pnpm=execFileSync('pnpm',['--version'],{cwd:workspace,encoding:'utf8'}).trim();
  const packageRoots=rootsFor(workspace).filter(name=>name.startsWith('packages/')).map(name=>name.slice(0,-5));
  const sourceTrees=['apps/api/src',...packageRoots.map(name=>name+'/src')].map(name=>({root:name,files:treeEntries(workspace,name)}));
  const ts=require('typescript'),configs=['tsconfig.base.json','apps/api/tsconfig.json','apps/api/tsconfig.build.json',
    ...packageRoots.flatMap(name=>['tsconfig.json','tsconfig.build.json'].map(file=>name+'/'+file).filter(file=>fs.existsSync(path.join(workspace,file))))];
  const typeScriptConfigurations=configs.map(name=>{
    const file=path.join(workspace,name),config=ts.readConfigFile(file,ts.sys.readFile);assert.equal(config.error,undefined);
    const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,path.dirname(file));
    assert.notEqual(parsed.options.noCheck,true,'source evidence cannot admit unchecked compilation');
    return{path:name,sha256:hashFile(file),configuredNoCheck:config.config.compilerOptions?.noCheck??null,effectiveNoCheck:parsed.options.noCheck===true};
  });
  return{sourceFiles,sourceTrees,sourceTreesScope:'diagnostic conservative full trees; canonical input fingerprint remains serviceBuildInputs()',
    inputSha256:read(path.join(workspace,INPUT_STAMP)).inputSha256,compilerCoverage:read(path.join(workspace,INPUT_STAMP)).compilerCoverage,
    outputInventory:rootsFor(workspace).flatMap(name=>treeEntries(workspace,name)),typeScriptConfigurations,installedVersions,
    generatedClients:clients.map((directory,index)=>{
      const relative=path.relative(workspace,directory).replaceAll('\\','/');assert.ok(relative&&!relative.startsWith('../')&&!path.isAbsolute(relative));
      const schema=names[index],runtime=fs.readFileSync(path.join(directory,'index.js'),'utf8'),versions=[...runtime.matchAll(/["']clientVersion["']\s*:\s*["']([^"']+)["']/g)].map(match=>match[1]);
      assert.ok(versions.length&&versions.every(version=>version===lockedVersion));assert.equal(read(path.join(directory,'package.json')).version,lockedVersion);
      const generatedSchemaUtf8=fs.readFileSync(path.join(directory,'schema.prisma'),'utf8'),sourceSchemaUtf8=fs.readFileSync(path.join(workspace,schema),'utf8');
      const generatedCanonical=canonicalPrismaSchema(workspace,generatedSchemaUtf8,lockedVersion),sourceCanonical=canonicalPrismaSchema(workspace,sourceSchemaUtf8,lockedVersion);
      assert.equal(generatedCanonical,sourceCanonical,'actual generated Prisma schema must match the current source through the locked formatter');
      return{root:relative,sourceSchema:schema,sourceSchemaSha256:hashFile(path.join(workspace,schema)),generatedSchemaSha256:hashFile(path.join(directory,'schema.prisma')),
        generatedSchemaUtf8,canonicalSchemaSha256:sha(Buffer.from(generatedCanonical)),formatterPrismaVersion:lockedVersion,runtimeClientVersions:versions,
        packageVersion:read(path.join(directory,'package.json')).version,files:treeEntries(workspace,relative,{allowNative:true})};}),node:nodeIdentity()};
}
export async function validateApiResume({workspaceRoot,expectedHead,requireExport=true}){
  requireContainer();assert.equal(git(workspaceRoot,['rev-parse','HEAD']),expectedHead);const directory=prefix(workspaceRoot,expectedHead),state=read(path.join(directory,'api-gates-state.json'));
  assert.equal(state.status,'REAL_API_BUILD_AND_TYPECHECK_ZERO');assert.equal(state.head,expectedHead);assert.deepEqual(state.node,nodeIdentity());
  const h=await helper(workspaceRoot);assert.equal(h.serviceBuildInputs(),state.inputSha256);assert.deepEqual(h.assertServiceArtifacts(),state.checkedArtifacts);
  assert.equal(hashFile(path.join(workspaceRoot,'apps/api/tests/service-test-artifacts.mjs')),state.artifactHelperSha256);
  assert.equal(hashFile(path.join(workspaceRoot,INPUT_STAMP)),state.inputStampSha256);assert.equal(hashFile(path.join(workspaceRoot,RECEIPT)),state.checkedStampSha256);
  for(const id of REQUIRED_INVOCATIONS){validateInvocation(directory,id,state.node);assert.equal(hashFile(path.join(directory,id+'.invocation.json')),state.invocationHashes[id]);}
  if(requireExport){const exported=read(path.join(directory,'export-receipt.json'));assert.equal(exported.head,expectedHead);assert.equal(hashFile(path.join(directory,'api-ci.tar')),exported.attestation.bundleSha256);
    const archive=inspectTar(path.join(directory,'api-ci.tar'));try{const prepared=verifyBundle(archive,{head:expectedHead,inputSha256:state.inputSha256,outputRoots:rootsFor(workspaceRoot)});assert.equal(sha(prepared.metadataBytes),exported.attestation.metadataSha256);assert.deepEqual(rootsFor(workspaceRoot).flatMap(name=>treeEntries(workspaceRoot,name)),prepared.metadata.outputs);}finally{fs.closeSync(archive.fd);}}
  return{directory,state};
}
export async function main(args=process.argv.slice(2)){
  const mode=args[0],head=git(root,['rev-parse','HEAD']);assert.match(head,/^[a-f0-9]{40}$/);const directory=prefix(root,head);
  if(mode==='github-binding'){
    assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_REPOSITORY,REPOSITORY);assert.equal(process.env.GITHUB_SHA,head);assert.ok(['sandbox','production'].includes(args[1]));assert.ok(process.env.GH_TOKEN);
    const api=suffix=>JSON.parse(execFileSync('gh',['api','repos/'+REPOSITORY+'/'+suffix],{encoding:'utf8',maxBuffer:16*1024**2}));
    const run=api('actions/runs/'+process.env.GITHUB_RUN_ID);assert.equal(run.head_sha,head);assert.equal(run.run_attempt,Number(process.env.GITHUB_RUN_ATTEMPT));
    assert.equal(run.repository.full_name,REPOSITORY);assert.equal(run.head_repository.full_name,REPOSITORY);
    let binding;
    // GitHub can publish the new step status a moment after its process starts.
    // Retry only that bounded visibility lag; all identities still come from REST.
    for(let attempt=0;attempt<6;attempt++){
      const jobs=api('actions/runs/'+run.id+'/attempts/'+process.env.GITHUB_RUN_ATTEMPT+'/jobs?per_page=100');assert.ok(jobs.total_count<=100);
      const named=jobs.jobs.filter(job=>job.name==='Service Linux release ('+args[1]+')'&&job.run_id===run.id&&job.status==='in_progress');
      const visible=named.length===1&&named[0].steps.some(step=>step.name===STEP_NAMES.export&&step.status==='in_progress');
      if(visible){binding=discoverBinding({run,jobs,head,target:args[1]});break;}
      if(attempt<5)await new Promise(resolve=>setTimeout(resolve,2000));
    }
    assert.ok(binding,'real GitHub export-step identity was not visible within the bounded window');
    assert.equal(binding.github.runAttempt,Number(process.env.GITHUB_RUN_ATTEMPT));write(bindingPath(root,head),binding);return;
  }
  requireContainer();assert.equal(git(root,['status','--porcelain','--untracked-files=no']),'');const h=await helper(root);
  if(mode==='checked'){
    assert.equal(fs.existsSync(directory),false);fs.mkdirSync(directory,{recursive:true});
    await actualRun(root,directory,'capture',invocationCommands.capture,'apps/api');
    await actualRun(root,directory,'checked',invocationCommands.checked,'.',{DATABASE_URL:'postgresql://prisma:prisma@127.0.0.1:5432/prisma?schema=public',PROSPECTING_DIRECTORY_DATABASE_URL:'postgresql://prisma:prisma@127.0.0.1:5432/prisma?schema=company_directory'});
    await actualRun(root,directory,'seed-compile',invocationCommands['seed-compile'],'.');
    await actualRun(root,directory,'record',invocationCommands.record,'apps/api');
    write(path.join(directory,'checked-phase.json'),{head,node:nodeIdentity(),inputSha256:h.serviceBuildInputs(),checkedArtifacts:h.assertServiceArtifacts()});return;
  }
  if(mode==='api-types'){
    const checked=read(path.join(directory,'checked-phase.json'));assert.equal(checked.head,head);assert.deepEqual(checked.node,nodeIdentity());assert.equal(checked.inputSha256,h.serviceBuildInputs());assert.deepEqual(checked.checkedArtifacts,h.assertServiceArtifacts());
    await actualRun(root,directory,'api-types',invocationCommands['api-types'],'.');assert.equal(checked.inputSha256,h.serviceBuildInputs());assert.deepEqual(checked.checkedArtifacts,h.assertServiceArtifacts());
    const invocationHashes=Object.fromEntries(REQUIRED_INVOCATIONS.map(id=>[id,hashFile(path.join(directory,id+'.invocation.json'))]));
    write(path.join(directory,'api-gates-state.json'),{status:'REAL_API_BUILD_AND_TYPECHECK_ZERO',head,node:nodeIdentity(),inputSha256:h.serviceBuildInputs(),checkedArtifacts:h.assertServiceArtifacts(),artifactHelperSha256:hashFile(path.join(root,'apps/api/tests/service-test-artifacts.mjs')),inputStampSha256:hashFile(path.join(root,INPUT_STAMP)),checkedStampSha256:hashFile(path.join(root,RECEIPT)),invocationHashes});return;
  }
  if(mode==='export'){
    const {state}=await validateApiResume({workspaceRoot:root,expectedHead:head,requireExport:false}),binding=read(bindingPath(root,head));assert.equal(binding.head,head);
    assert.equal(binding.target,process.env.SERVICE_RELEASE_TARGET);
    const bindingBytes=fs.readFileSync(bindingPath(root,head));fs.writeFileSync(path.join(directory,'github-binding.json'),bindingBytes,{flag:'wx'});
    const gates=['checked','api-types'].map(id=>{const row=validateInvocation(directory,id,state.node);return{id,argv:row.argv,cwd:row.cwd,exitCode:row.exitCode,...binding.steps[id],stdout:fs.readFileSync(path.join(directory,row.stdout.path)),stderr:fs.readFileSync(path.join(directory,row.stderr.path))};});
    const exported=await exportCiApiBundle({workspaceRoot:root,destination:path.join(directory,'api-ci.tar'),head,github:binding.github,gates,measureInputs:h.serviceBuildInputs,assertArtifacts:h.assertServiceArtifacts,sourceEvidence:{...generationEvidence(root),actualInvocationHashes:state.invocationHashes}});
    write(path.join(directory,'export-receipt.json'),{head,...exported});return;
  }
  assert.fail('unsupported API phase');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
