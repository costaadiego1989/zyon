import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,lstatSync,existsSync,mkdirSync,copyFileSync,constants,openSync,readSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const targets={api:{archive:'payload.tar.gz',dockerfile:'apps/api/Dockerfile'},storefront:{archive:'payload.tar.gz',dockerfile:'apps/storefront/Dockerfile'},
  dashboard:{archive:'dashboard.tar.gz',dockerfile:'apps/dashboard/Dockerfile'},'widget-v2':{archive:'widget-app.tar.gz',dockerfile:'apps/widget_v2/Dockerfile'}};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function regular(path){const stat=lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'release_stage_regular_file_required');return readFileSync(path);}
function fileSha(path){const stat=lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'release_stage_regular_file_required');
  const fd=openSync(path,'r'),buffer=Buffer.allocUnsafe(1024*1024),hash=createHash('sha256');
  try{let size;while((size=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,size));return hash.digest('hex');}finally{closeSync(fd);}}
/** No archive is expanded on Windows. Only verified opaque bytes and a fixed
 * Dockerfile template enter a newly created owned context under this repo/.cache. */
export function stagePrebuiltContext({bundle,target,output,expectedRevision,expectedEnvironment}){
  assert.match(expectedRevision,/^[a-f0-9]{40}$/);assert.ok(Object.hasOwn(targets,target),'release_stage_target_unknown');
  assert.ok(['sandbox','production'].includes(expectedEnvironment),'release_stage_environment_required');
  const source=resolve(bundle),metadata=JSON.parse(regular(resolve(source,'contexts.json')).toString('utf8'));
  assert.equal(metadata.version,1);assert.equal(metadata.sourceRevision,expectedRevision,'release_stage_revision_changed');
  assert.equal(metadata.targetEnvironment,expectedEnvironment,'release_stage_environment_changed');
  const row=metadata.contexts[target],fixed=targets[target];assert.ok(row,'release_stage_context_missing');
  assert.equal(row.archive,fixed.archive);assert.equal(row.dockerfile,fixed.dockerfile);assert.equal(row.template,'templates/'+target+'.Dockerfile');
  const dockerfile=regular(resolve(source,row.template));
  assert.equal(fileSha(resolve(source,row.archive)),row.archiveSha256,'release_stage_archive_changed');assert.equal(sha(dockerfile),row.templateSha256,'release_stage_template_changed');
  const directory=resolve(root,output),cache=resolve(root,'.cache'),rel=relative(cache,directory);
  assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'release_stage_owned_cache_required');
  assert.equal(existsSync(directory),false,'release_stage_fresh_context_required');
  mkdirSync(directory,{recursive:true});mkdirSync(dirname(resolve(directory,fixed.dockerfile)),{recursive:true});
  copyFileSync(resolve(source,row.archive),resolve(directory,'payload.tar.gz'),constants.COPYFILE_EXCL);
  copyFileSync(resolve(source,row.template),resolve(directory,fixed.dockerfile),constants.COPYFILE_EXCL);
  const segments=fixed.dockerfile.split('/');let prefix='';const allowed=[];for(const segment of segments.slice(0,-1)){prefix+=segment+'/';allowed.push('!'+prefix);}
  writeFileSync(resolve(directory,'.dockerignore'),['**','!payload.tar.gz',...allowed,'!'+fixed.dockerfile,''].join('\n'),{flag:'wx'});
  assert.equal(fileSha(resolve(directory,'payload.tar.gz')),row.archiveSha256);assert.equal(sha(regular(resolve(directory,fixed.dockerfile))),row.templateSha256);
  const result={version:1,sourceRevision:expectedRevision,target,context:directory,dockerfile:fixed.dockerfile,
    archiveSha256:row.archiveSha256,templateSha256:row.templateSha256,requiredStartCommand:row.requiredStartCommand??null,targetEnvironment:expectedEnvironment,
    archiveExpanded:false,deployPerformed:false};
  writeFileSync(resolve(directory,'.stage-receipt.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  assert.equal(process.argv.length,7,'release_stage_usage_bundle_target_output_revision_environment');
  console.log(JSON.stringify(stagePrebuiltContext({bundle:process.argv[2],target:process.argv[3],output:process.argv[4],expectedRevision:process.argv[5],expectedEnvironment:process.argv[6]})));
}
