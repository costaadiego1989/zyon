import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {FORMAT,REPOSITORY,MARKER,COMMANDS,RECEIPT,sha,json,hashFile,hashRange,rootsFor,treeDigest,noLinks,owned,inspectTar,verifyBundle,copyEntry,integer,revision,digest,canonicalPrismaSchema} from './transport-core.mjs';

const APPROVAL='EXPLICIT_USER_APPROVAL_CI_LOCALITY_ONLY_API_CHECKED_AND_API_TYPES';
export function validateApproval(approval){
  assert.equal(approval.kind,APPROVAL);assert.equal(approval.status,'approved','user approval is required before import');
  assert.ok(approval.userAnswer?.trim());assert.equal(approval.repository,REPOSITORY);revision(approval.head);
  assert.deepEqual(approval.gates,['checked','api-types']);assert.equal(approval.keep125Proofs9Builds3Mutations,true);
  for(const id of approval.gates){const step=approval.stepBindings?.[id];assert.ok(step);integer(step.stepNumber);assert.ok(step.stepName?.trim());assert.deepEqual(step.argv,COMMANDS[id]);}
  assert.notEqual(approval.stepBindings.checked.stepNumber,approval.stepBindings['api-types'].stepNumber);
  for(const key of ['runId','jobId','runAttempt','exportStepNumber','uploadStepNumber'])integer(approval[key]);
  for(const key of ['workflowSha256','exporterSha256','coreSha256','importerSha256','artifactHelperSha256'])digest(approval[key]);
  assert.ok(approval.workflowPath?.startsWith('.github/workflows/')&&!approval.workflowPath.includes('..'));
  assert.ok(approval.jobName?.trim()&&approval.exportStepName?.trim()&&approval.uploadStepName?.trim()&&approval.artifactName?.trim());
  assert.equal(approval.windowsPrismaClients.length,2);assert.equal(new Set(approval.windowsPrismaClients).size,2);
  for(const name of approval.windowsPrismaClients){assert.ok(name.includes('node_modules/')&&!name.includes('..'));owned('C:/synthetic',name);}
  return approval;
}
export function verifyProvenance(metadata,witness,approval){
  validateApproval(approval);const {run,job,artifact,workflowBytes,attestation}=witness;
  assert.equal(run.id,approval.runId);assert.equal(run.run_attempt,approval.runAttempt);assert.equal(run.head_sha,approval.head);
  assert.equal(run.repository.full_name,REPOSITORY);assert.equal(run.head_repository.full_name,REPOSITORY);
  assert.equal(run.path,approval.workflowPath);assert.equal(run.status,'completed');assert.ok(['success','failure'].includes(run.conclusion));
  assert.equal(job.id,approval.jobId);assert.equal(job.run_id,run.id);assert.equal(job.name,approval.jobName);assert.equal(job.status,'completed');assert.ok(['success','failure'].includes(job.conclusion));
  assert.equal(sha(workflowBytes),approval.workflowSha256,'workflow bytes at this HEAD were not approved');
  for(const gate of metadata.gates){const binding=approval.stepBindings[gate.id];assert.equal(gate.stepNumber,binding.stepNumber);assert.equal(gate.stepName,binding.stepName);assert.deepEqual(gate.argv,binding.argv);const step=job.steps.find(x=>x.number===gate.stepNumber);assert.ok(step&&step.name===gate.stepName&&step.status==='completed'&&step.conclusion==='success','real API step must succeed');}
  for(const prefix of ['export','upload']){const step=job.steps.find(x=>x.number===approval[prefix+'StepNumber']);assert.ok(step&&step.name===approval[prefix+'StepName']&&step.status==='completed'&&step.conclusion==='success');}
  assert.ok(metadata.gates.every(x=>x.stepNumber<approval.exportStepNumber));assert.ok(approval.exportStepNumber<approval.uploadStepNumber);
  assert.equal(metadata.github.repository,REPOSITORY);assert.equal(metadata.github.workflowPath,approval.workflowPath);
  for(const key of ['runId','jobId','runAttempt'])assert.equal(metadata.github[key],approval[key]);
  assert.equal(metadata.exporterSha256,approval.exporterSha256);assert.equal(metadata.coreSha256,approval.coreSha256);
  assert.equal(metadata.artifactHelperSha256,approval.artifactHelperSha256,'CI and Windows must use the same pinned hardened fingerprint helper');
  integer(artifact.id);assert.equal(artifact.name,approval.artifactName);assert.equal(artifact.expired,false);assert.equal(artifact.workflow_run.id,approval.runId);assert.equal(artifact.workflow_run.head_sha,approval.head);
  assert.equal(attestation.format,FORMAT);assert.equal(attestation.head,approval.head);for(const key of ['runId','jobId','runAttempt'])assert.equal(attestation[key],approval[key]);
  digest(attestation.bundleSha256);digest(attestation.metadataSha256);integer(attestation.bytes);
  return{origin:'github-ci',runConclusion:run.conclusion,jobConclusion:job.conclusion,artifactId:artifact.id,attestation};
}
/** Authenticated reads only. No CI dispatch, downloads, or workflow changes. */
export function githubWitness(approval){
  validateApproval(approval);const api=endpoint=>json(execFileSync('gh',['api','repos/'+REPOSITORY+'/'+endpoint],{encoding:'buffer',windowsHide:true,maxBuffer:64*1024**2}));
  const run=api('actions/runs/'+approval.runId),job=api('actions/jobs/'+approval.jobId);
  const content=api('contents/'+approval.workflowPath+'?ref='+approval.head);assert.equal(content.encoding,'base64');
  const list=api('actions/runs/'+approval.runId+'/artifacts?per_page=100');assert.ok(list.total_count<=100,'paginate explicitly before approving this run');
  const artifacts=list.artifacts.filter(x=>x.name===approval.artifactName);assert.equal(artifacts.length,1);
  const logs=execFileSync('gh',['run','view',String(approval.runId),'--repo',REPOSITORY,'--job',String(approval.jobId),'--log'],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024**2});
  const prefix=approval.jobName+'\t'+approval.exportStepName+'\t';const markers=[];
  for(const line of logs.split(/\r?\n/)){if(!line.startsWith(prefix))continue;const index=line.indexOf(MARKER,prefix.length);if(index>=0)markers.push(json(Buffer.from(line.slice(index+MARKER.length))));}
  assert.equal(markers.length,1,'one marker in the approved export step is required');
  return{run,job,artifact:artifacts[0],workflowBytes:Buffer.from(content.content,'base64'),attestation:markers[0]};
}
export function lockedPrismaVersion(workspace){
  const api=json(fs.readFileSync(path.join(workspace,'apps/api/package.json'))),lines=fs.readFileSync(path.join(workspace,'pnpm-lock.yaml'),'utf8').replaceAll('\r\n','\n').split('\n');
  const start=lines.indexOf('  apps/api:');assert.ok(start>=0,'API importer required in lock');let end=start+1;while(end<lines.length&&!/^  \S/.test(lines[end]))end++;
  const block=lines.slice(start+1,end).join('\n'),versions=[];
  for(const name of ['@prisma/client','prisma']){
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=block.match(new RegExp('^      [\'\"]?'+escaped+'[\'\"]?:\\n((?: {8}[^\\n]*(?:\\n|$))+)','m'));assert.ok(match,'locked Prisma package missing:'+name);
    const fields=match[1],specifier=fields.match(/^        specifier: (.+)$/m)?.[1],resolved=fields.match(/^        version: (\d+\.\d+\.\d+)(?:\(|$)/m)?.[1];assert.ok(resolved,'exact resolved Prisma version required');
    assert.equal(specifier,api.dependencies?.[name]??api.devDependencies?.[name],'package specifier differs from lock');versions.push(resolved);
    const relative='apps/api/node_modules/'+name+'/package.json',real=fs.realpathSync(owned(workspace,relative)),inside=path.relative(workspace,real);assert.ok(inside&&!inside.startsWith('..'+path.sep)&&!path.isAbsolute(inside));assert.equal(json(fs.readFileSync(real)).version,resolved,'installed Prisma version differs from lock');
  }
  assert.equal(versions[0],versions[1],'Prisma CLI/client locked versions differ');return versions[0];
}
export function validateWindowsPrismaClients(workspace,approval){
  const version=lockedPrismaVersion(workspace),schemaPaths=['apps/api/prisma/schema.prisma','apps/api/prisma/company-directory.prisma'],configs=['apps/api/prisma.config.ts','apps/api/prisma.company-directory.config.ts'];
  return approval.windowsPrismaClients.map((name,index)=>{
    const location=noLinks(workspace,name,{allowMissing:false});assert.ok(fs.existsSync(path.join(location,'schema.prisma'))&&fs.existsSync(path.join(location,'query_engine-windows.dll.node')),'both pre-existing Windows clients required');
    const source=fs.readFileSync(owned(workspace,schemaPaths[index]),'utf8'),generated=fs.readFileSync(path.join(location,'schema.prisma'),'utf8');
    let sourceCanonical,generatedCanonical;
    try{sourceCanonical=canonicalPrismaSchema(workspace,source,version);generatedCanonical=canonicalPrismaSchema(workspace,generated,version);}catch{throw new Error('generated Prisma schema stale:'+schemaPaths[index]+' canonical formatter rejected input; sourceSha256='+sha(Buffer.from(source))+' generatedSha256='+sha(Buffer.from(generated)));}
    const sourceCanonicalSha=sha(Buffer.from(sourceCanonical)),generatedCanonicalSha=sha(Buffer.from(generatedCanonical));
    if(sourceCanonicalSha!==generatedCanonicalSha)throw new Error('generated Prisma schema stale:'+schemaPaths[index]+' sourceCanonicalSha256='+sourceCanonicalSha+' generatedCanonicalSha256='+generatedCanonicalSha);
    const config=fs.readFileSync(owned(workspace,configs[index]),'utf8'),schemaRelative=schemaPaths[index].slice('apps/api/'.length);assert.ok(config.includes('"'+schemaRelative+'"')||config.includes("'"+schemaRelative+"'"),'schema config binding changed');
    assert.equal(json(fs.readFileSync(path.join(location,'package.json'))).version,version,'generated Prisma package version stale');
    const matches=[...fs.readFileSync(path.join(location,'index.js'),'utf8').matchAll(/["']clientVersion["']\s*:\s*["']([^"']+)["']/g)];assert.ok(matches.length>0&&matches.every(m=>m[1]===version),'generated Prisma runtime version stale');
    return{path:name,sha256:treeDigest(workspace,name,{allowNative:true}),schemaPath:schemaPaths[index],sourceSchemaSha256:hashFile(owned(workspace,schemaPaths[index])),configSha256:hashFile(owned(workspace,configs[index])),lockedPrismaVersion:version};
  });
}
const preserveClients=validateWindowsPrismaClients;
function save(file,value){const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'w'});fs.renameSync(temporary,file);}
function snapshot(root,name){return fs.existsSync(root)&&fs.existsSync(noLinks(root,name))?treeDigest(root,name):null;}
export function rollbackTransaction(journalPath){
  const journal=json(fs.readFileSync(journalPath)),workspace=journal.workspace,transaction=journal.transaction;
  assert.equal(journal.format,FORMAT);assert.equal(path.resolve(path.dirname(journalPath)),path.resolve(transaction));assert.match(path.basename(transaction),/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.equal(path.resolve(workspace),path.resolve(transaction,'../../..'),'journal cannot choose another workspace');
  assert.equal(path.dirname(path.resolve(transaction)),path.resolve(workspace,'.cache','ci-api-transport'),'rollback journal parent outside owned cache');
  const relativeJournal=path.relative(workspace,path.resolve(journalPath)).replaceAll('\\','/');assert.equal(noLinks(workspace,relativeJournal,{allowMissing:false}),path.resolve(journalPath));assert.ok(fs.lstatSync(journalPath).isFile(),'regular owned journal required');
  const allowed=[...rootsFor(workspace),RECEIPT].sort();assert.ok(Array.isArray(journal.operations));assert.deepEqual(journal.operations.map(x=>x.path).sort(),allowed,'rollback must contain exactly the known output roots and receipt');assert.equal(new Set(journal.operations.map(x=>x.path)).size,allowed.length);
  for(const operation of journal.operations){owned(workspace,operation.path);for(const key of ['oldDigest','newDigest'])if(operation[key]!==null)digest(operation[key]);}
  assert.ok(Array.isArray(journal.clientsBefore)&&journal.clientsBefore.length===2);const clientBinding={windowsPrismaClients:journal.clientsBefore.map(x=>x.path)};assert.deepEqual(validateWindowsPrismaClients(workspace,clientBinding),journal.clientsBefore,'Prisma changed before rollback');
  for(const operation of [...journal.operations].reverse()){
    const target=noLinks(workspace,operation.path),backup=noLinks(transaction,'backup/'+operation.path),failed=noLinks(transaction,'rolled-back-new/'+operation.path);
    const current=snapshot(workspace,operation.path),old=snapshot(path.join(transaction,'backup'),operation.path);
    if(old!==null){assert.equal(old,operation.oldDigest,'backup changed; do not overwrite concurrent work');
      if(current!==null){assert.equal(current,operation.newDigest,'target changed; do not overwrite concurrent work');fs.mkdirSync(path.dirname(failed),{recursive:true});fs.renameSync(target,failed);}
      fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(backup,target);
    }else if(operation.oldDigest===null&&current!==null){assert.equal(current,operation.newDigest);fs.mkdirSync(path.dirname(failed),{recursive:true});fs.renameSync(target,failed);}
    else assert.equal(current,operation.oldDigest,'unexpected state; manual recovery required');
  }
  assert.deepEqual(validateWindowsPrismaClients(workspace,clientBinding),journal.clientsBefore,'Prisma changed during rollback');journal.status='rolled-back';save(journalPath,journal);return journal;
}
/** No callers may bypass preparation. Kept separate for synthetic filesystem units. */
export async function importApprovedBundle({workspaceRoot,archivePath,approval,readWitness=githubWitness,measureInputs,verifyLocalChecked,afterSwap}){
  validateApproval(approval);assert.equal(typeof measureInputs,'function');const workspace=path.resolve(workspaceRoot),inputBefore=await measureInputs();
  const archive=inspectTar(archivePath);let transaction,journalPath;
  try{
    const prepared=verifyBundle(archive,{head:approval.head,inputSha256:inputBefore,outputRoots:rootsFor(workspace)});
    const witness=readWitness(approval),provenance=verifyProvenance(prepared.metadata,witness,approval);
    assert.equal(archive.sha256,provenance.attestation.bundleSha256);assert.equal(archive.bytes,provenance.attestation.bytes);assert.equal(sha(prepared.metadataBytes),provenance.attestation.metadataSha256);
    const clientsBefore=preserveClients(workspace,approval);
    const relative='.cache/ci-api-transport/'+randomUUID();transaction=noLinks(workspace,relative);fs.mkdirSync(transaction,{recursive:true});
    fs.mkdirSync(path.join(transaction,'stage'),{recursive:true});
    for(const entry of archive.entries){if(entry.name.startsWith('payload/'))copyEntry(archive,entry,owned(transaction,'stage/'+entry.name.slice(8)));
      else copyEntry(archive,entry,owned(transaction,'evidence/'+entry.name));}
    const receiptStage=owned(transaction,'stage/'+RECEIPT);fs.mkdirSync(path.dirname(receiptStage),{recursive:true});fs.writeFileSync(receiptStage,prepared.receiptBytes,{flag:'wx'});
    assert.equal(await measureInputs(),inputBefore,'source inputs changed before swap');
    assert.equal(hashRange(archive.fd,0,archive.bytes),archive.sha256,'archive changed before swap');assert.deepEqual(preserveClients(workspace,approval),clientsBefore);
    const targets=[...prepared.metadata.outputRoots.map(x=>x.path),RECEIPT];
    const operations=targets.map(name=>({path:name,oldDigest:snapshot(workspace,name),newDigest:snapshot(path.join(transaction,'stage'),name)}));
    const journal={format:FORMAT,status:'prepared',workspace,transaction,head:approval.head,provenance,clientsBefore,
      approvalSha256:sha(Buffer.from(JSON.stringify(approval))),metadataSha256:sha(prepared.metadataBytes),receiptSha256:sha(prepared.receiptBytes),operations};
    journalPath=path.join(transaction,'transaction.json');save(journalPath,journal);
    try{for(const operation of operations){const target=noLinks(workspace,operation.path),staged=noLinks(transaction,'stage/'+operation.path),backup=noLinks(transaction,'backup/'+operation.path);
        assert.equal(snapshot(workspace,operation.path),operation.oldDigest);if(operation.oldDigest!==null){fs.mkdirSync(path.dirname(backup),{recursive:true});fs.renameSync(target,backup);}
        if(operation.newDigest!==null){fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(staged,target);}operation.swapped=true;save(journalPath,journal);afterSwap?.(operation);
      }
      assert.equal(await measureInputs(),inputBefore);assert.deepEqual(preserveClients(workspace,approval),clientsBefore);
      assert.equal(hashFile(owned(workspace,RECEIPT)),sha(prepared.receiptBytes),'CI receipt must remain byte exact');
      if(verifyLocalChecked){const checked=await verifyLocalChecked();assert.equal(checked.checked,true);assert.equal(checked.inputSha256,inputBefore);assert.equal(checked.artifactSha256,prepared.metadata.checkedArtifactSha256);}
      journal.status='imported-origin-github-ci-not-local-build';save(journalPath,journal);return{journalPath,provenance,metadataSha256:journal.metadataSha256,receiptSha256:journal.receiptSha256};
    }catch(error){rollbackTransaction(journalPath);throw error;}
  }finally{fs.closeSync(archive.fd);}
}
/** Production wiring: approved/pinned local helper is read, never record-build. */
export function validateLocalTransportPins(approval){assert.equal(hashFile(fileURLToPath(import.meta.url)),approval.importerSha256,'local importer entry changed');assert.equal(hashFile(fileURLToPath(new URL('./transport-core.mjs',import.meta.url))),approval.coreSha256,'local loaded core changed');assert.equal(hashFile(fileURLToPath(new URL('./export-ci.mjs',import.meta.url))),approval.exporterSha256,'local exporter differs from approved CI exporter');}
export async function approvedWindowsImport({workspaceRoot,archivePath,approvalPath,approvalSha256}){
  assert.equal(process.platform,'win32');const bytes=fs.readFileSync(approvalPath);assert.equal(sha(bytes),approvalSha256);const approval=validateApproval(json(bytes));
  validateLocalTransportPins(approval);
  const helper=noLinks(workspaceRoot,'apps/api/tests/service-test-artifacts.mjs',{allowMissing:false});assert.equal(hashFile(helper),approval.artifactHelperSha256);
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:workspaceRoot,encoding:'utf8',windowsHide:true}).trim();assert.equal(head,approval.head);
  const {serviceBuildInputs,assertServiceArtifacts}=await import(pathToFileURL(helper).href);assert.equal(typeof serviceBuildInputs,'function');assert.equal(typeof assertServiceArtifacts,'function');
  // No application bootstrap; only the existing read-only input fingerprint.
  return importApprovedBundle({workspaceRoot,archivePath,approval,measureInputs:serviceBuildInputs,verifyLocalChecked:assertServiceArtifacts});
}
// There is deliberately no auto-executing CLI or dispatch wrapper. Root must
// review/approve locality and integrate only the two exact gates separately.
