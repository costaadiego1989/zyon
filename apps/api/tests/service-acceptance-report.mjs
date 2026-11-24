import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {activationCriterionInventory,activationProofCommands,parseActivationTap,parseActivationPlaywright,
  produceServiceActivationRelease,measureProofSourceInputs,assertActivationProofSourceInputs} from './service-activation-release-producer.mjs';
import {businessRagEvaluationCorpus} from './business-rag-evaluation-corpus.mjs';

const api=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(api,'../..');
const feature='whatsapp-service-booking-business-rag';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.length>0;
const same=(a,b)=>a.length===b.length&&[...a].sort().every((value,index)=>value===[...b].sort()[index]);
const normal=path=>path.split(sep).join('/');
function within(root,path){const value=relative(root,path);return value===''||(!isAbsolute(value)&&value!=='..'&&!value.startsWith('..'+sep));}
function owned(root,path){assert.ok(text(path),'acceptance_path_required');const file=resolve(root,path);
  assert.ok(within(root,file)&&file!==root,'acceptance_path_escape');assert.equal(lstatSync(file).isSymbolicLink(),false);
  assert.equal(lstatSync(file).isFile(),true);assert.ok(within(realpathSync(root),realpathSync(file)),'acceptance_borrowed_path');return file;}
function read(root,path){const file=owned(root,path);assert.ok(lstatSync(file).size<=16_000_000,'acceptance_evidence_bound');return readFileSync(file);}
const json=(root,path)=>JSON.parse(read(root,path).toString('utf8').replace(/^\uFEFF/,''));
function keys(value,allowed,required=allowed){assert.ok(plain(value));assert.ok(Object.keys(value).every(key=>allowed.includes(key)),'acceptance_input_field');
  for(const key of required)assert.ok(Object.hasOwn(value,key),'acceptance_input_missing_field');}

/** Only paths are caller input. IDs, counters, readiness, provider and final
 * completion claims are derived or deliberately left unestablished. */
export function validateAcceptanceInput(input){
  keys(input,['version','reportRoot','activationDescriptor','evidence','builds','previews','output']);assert.equal(input.version,1);
  for(const key of ['reportRoot','activationDescriptor','output'])assert.ok(text(input[key]));
  for(const key of ['evidence','builds']){assert.ok(Array.isArray(input[key])&&input[key].length<=2000);
    const seen=new Set();for(const item of input[key]){keys(item,['receipt','raw']);assert.ok(text(item.receipt)&&text(item.raw));
      assert.equal(seen.has(item.receipt),false,'acceptance_duplicate_receipt');seen.add(item.receipt);}}
  assert.ok(Array.isArray(input.previews)&&input.previews.length<=100);for(const path of input.previews)assert.ok(text(path));
  assert.equal(new Set(input.previews).size,input.previews.length,'acceptance_duplicate_preview');return input;
}

// Narrow command lexer, never a shell executor. Unsupported command operators
// remain blockers; the shared T94 parser separates compound Proof commands.
function tokens(command){assert.ok(text(command));const result=[];let value='',quote;
  for(let i=0;i<command.length;i++){const char=command[i];if(quote){if(char===quote)quote=undefined;
      else if(char==='\\'&&quote==='"'&&['"','\\'].includes(command[i+1]))value+=command[++i];else value+=char;}
    else if(char==='"'||char==="'")quote=char;else if(/\s/.test(char)){if(value){result.push(value);value='';}}
    else{assert.ok(![';','&','|','`'].includes(char),'acceptance_compound_command_unparsed');value+=char;}}
  assert.equal(quote,undefined,'acceptance_unclosed_command_quote');if(value)result.push(value);assert.ok(result.length);return result;
}
function option(argv,names){let found;for(let i=0;i<argv.length;i++)for(const name of names){if(argv[i]===name){assert.equal(found,undefined);found=argv[++i];assert.ok(text(found));}
    else if(argv[i].startsWith(name+'=')){assert.equal(found,undefined);found=argv[i].slice(name.length+1);}}return found;}
function localArgument(value,cwd,root){let path=value;if(value.startsWith('file:'))path=fileURLToPath(value);
  const absolute=resolve(cwd,path);assert.ok(within(root,absolute),'acceptance_selected_path_escape');return normal(relative(root,absolute));}

/** Normalize actual argv and proof commands without running either. */
export function acceptanceInvocation(command,root,cwd=root){
  let argv=Array.isArray(command)?[...command]:tokens(command);assert.ok(argv.length&&argv.every(text));cwd=resolve(root,cwd);assert.ok(within(root,cwd));
  const executable=value=>basename(value.replaceAll('\\','/')).toLowerCase();
  if(/^node(?:\.exe)?$/.test(executable(argv[0]))&&/pnpm\.(?:cjs|js)$/.test(executable(argv[1]??'')))argv.splice(0,1);
  if(/^(?:pnpm(?:\.exe|\.cmd)?|pnpm\.(?:cjs|js))$/.test(executable(argv[0]))){argv[0]='pnpm';
    const directory=option(argv,['--dir','-C']);if(directory){cwd=resolve(cwd,directory);assert.ok(within(root,cwd));const at=argv.findIndex(value=>value==='--dir'||value==='-C'||value.startsWith('--dir=')||value.startsWith('-C='));argv.splice(at,argv[at].includes('=')?1:2);}
    if(argv[1]==='exec')argv=argv.slice(2);
  }
  if(argv[0].startsWith('-')||/\.(?:mjs|cjs|js)$/.test(argv[0]))argv.unshift('node');
  let program=executable(argv[0]);if(/^node(?:\.exe)?$/.test(program))program='node';argv[0]=program;
  assert.ok(!argv.some(value=>/^(?:--test-skip-pattern|--test-only|--grep-invert|--shard|--list|--passWithNoTests|--onlyChanged|--changed|--related)(?:=|$)/.test(value)),'acceptance_scope_bypass');
  const runner=program==='node'&&argv.includes('--test')?'tap':program==='playwright'?'playwright':program==='vitest'?'vitest':'build';
  if(runner==='build'&&program==='node'&&argv[1]&&/\.(?:mjs|cjs|js)$/.test(argv[1]))argv[1]=localArgument(argv[1],cwd,root);
  const files=argv.filter(value=>/\.(?:spec|test|integration)\.(?:mjs|ts|tsx)$/.test(value)).map(value=>localArgument(value,cwd,root));
  assert.equal(new Set(files).size,files.length,'acceptance_duplicate_selected_file');
  const config=option(argv,['--config']);const filter=option(argv,runner==='tap'?['--test-name-pattern']:runner==='playwright'?['--grep','-g']:['--testNamePattern','-t']);
  if(filter!==undefined)new RegExp(filter);
  const imports=[];for(let i=0;i<argv.length;i++)if(argv[i]==='--import'){assert.ok(text(argv[i+1]));imports.push(localArgument(argv[++i],cwd,root));}
    else if(argv[i].startsWith('--import='))imports.push(localArgument(argv[i].slice(9),cwd,root));
  return{runner,cwd:normal(relative(root,cwd)),files,config:config?localArgument(config,cwd,root):null,filter:filter??null,argv,imports,
    concurrency:option(argv,['--test-concurrency'])??null};
}

function browserNames(report){const names=[];function visit(suites,prefix=[]){for(const suite of suites??[]){const path=[...prefix,suite.title??''];
    for(const spec of suite.specs??[])for(const item of spec.tests??[]){assert.equal(item.expectedStatus??'passed','passed');
      names.push([...path,spec.title??''].filter(Boolean).join(' '));}visit(suite.suites,path);}}visit(report.suites);return names;}
function vitest(raw,invocation,root){const report=JSON.parse(raw);assert.equal(report.success,true);assert.ok(Array.isArray(report.testResults));
  for(const key of ['numFailedTestSuites','numPendingTestSuites'])assert.equal(report[key],0);
  const resultFiles=[];const cases=report.testResults.flatMap(file=>{assert.equal(file.status,'passed');assert.ok(Array.isArray(file.assertionResults)&&file.assertionResults.length>0);
    assert.ok(text(file.name));resultFiles.push(localArgument(file.name,resolve(root,invocation.cwd),root));return file.assertionResults;});
  assert.equal(new Set(resultFiles).size,resultFiles.length);assert.ok(same(resultFiles,invocation.files),'acceptance_vitest_file_selection');
  assert.ok(cases.length>0);assert.equal(report.numTotalTests,cases.length);assert.equal(report.numPassedTests,cases.length);
  for(const key of ['numFailedTests','numPendingTests','numTodoTests'])assert.equal(report[key],0);
  assert.ok(cases.every(value=>value.status==='passed'&&text(value.fullName)));
  return{counts:{executed:cases.length,passed:cases.length,failed:0,skipped:0},names:cases.map(value=>value.fullName)};
}
function preview(receipt,raw=''){return /VISUAL_PREVIEW_ONLY|visual_preview/i.test(String(receipt.scope??''))||receipt.fixtureOnly===true||/VISUAL_PREVIEW_ONLY/.test(raw);}

/** Receipt metadata alone never establishes a passing proof: the raw runner
 * output is mandatory and its actual named cases determine selection. */
export function verifyAcceptanceReceipt({receipt,raw,current}){
  assert.ok(plain(receipt)&&typeof raw==='string');assert.equal(receipt.version,1);assert.equal(receipt.completed,true);
  assert.equal(receipt.exitCode,0);assert.equal(receipt.signal,null);
  for(const claim of ['providerAccepted','providerAccuracyProven','featureComplete','fullT95Acceptance','productionReady'])assert.equal(receipt[claim]??false,false,'acceptance_unproven_completion_claim');
  assert.equal(resolve(receipt.workspaceRoot),resolve(current.root),'acceptance_borrowed_workspace');
  assert.equal(receipt.sourceRevision,current.sourceRevision,'acceptance_revision_mismatch');
  assert.equal(receipt.releaseSourceInputSha256,current.sourceInputSha256,'acceptance_source_input_mismatch');
  assert.equal(receipt.releasePayloadSha256,current.apiPayloadSha256,'acceptance_payload_mismatch');
  assert.equal(receipt.cleanup?.completed,true,'acceptance_cleanup_incomplete');assert.deepEqual(receipt.cleanup.errors,[]);
  assert.equal(receipt.cleanup.ownedResourcesRemaining,0);assert.equal(preview(receipt,raw),false,'acceptance_preview_not_running');
  assert.ok(['component','local_http_sql_redis','served_browser'].includes(receipt.origin),'acceptance_provider_gate_separate');
  const invocation=acceptanceInvocation(receipt.argv,current.root,receipt.cwd);let counts,names=[];
  if(receipt.kind==='build'){assert.equal(invocation.runner,'build');assert.ok(raw.trim());}
  else if(invocation.runner==='tap'){counts=parseActivationTap(raw);names=[...raw.matchAll(/^\s*ok\s+\d+\s+-\s+([^\r\n]+)$/gm)].map(value=>value[1]);assert.ok(names.length,'acceptance_tap_case_names');
    assert.doesNotMatch(raw,/^\s*(?:ok|not ok)\b[^\r\n]*#\s*(?:SKIP|TODO)\b/im);}
  else if(invocation.runner==='playwright'){assert.equal(receipt.origin,'served_browser');counts=parseActivationPlaywright(raw);const report=JSON.parse(raw);assert.deepEqual(report.errors??[],[]);names=browserNames(report);}
  else if(invocation.runner==='vitest'){({counts,names}=vitest(raw,invocation,current.root));}
  else assert.fail('acceptance_unsupported_runner');
  return Object.freeze({invocation,origin:receipt.origin,counts,names,kind:receipt.kind??'test',receipt,
    rawSha256:hash(raw),sourceRevision:current.sourceRevision,apiPayloadSha256:current.apiPayloadSha256});
}

function commands(check){if(Array.isArray(check.proofs)){assert.ok(check.proofs.length);return check.proofs.flatMap(value=>activationProofCommands(value));}
  return activationProofCommands(check.proof);}
function matches(required,item){const actual=item.invocation;if(item.kind==='build'||required.runner!==actual.runner||required.cwd!==actual.cwd)return false;
  // TAP has no reliable per-case file location in successful output. Match the
  // exact file selection, as T94 does, instead of borrowing a same-named case
  // from an unrelated extra file in a larger cohort.
  if(required.config!==actual.config||!required.files.length||!same(required.files,actual.files))return false;
  if(actual.filter!==null&&actual.filter!==required.filter)return false;
  if(!required.imports.every(value=>actual.imports.includes(value))||required.concurrency!==null&&required.concurrency!==actual.concurrency)return false;
  if(required.files.some(file=>/\.integration\.|\/e2e\//.test(file))&&item.origin==='component')return false;
  return !required.filter||item.names.some(name=>new RegExp(required.filter).test(name));}
export function acceptanceMatrix(criteria,evidence,current){
  assert.ok(Array.isArray(criteria)&&criteria.length);assert.equal(new Set(criteria.map(value=>value.id)).size,criteria.length,'acceptance_duplicate_criterion');
  for(const item of evidence){assert.equal(item.sourceRevision,current.sourceRevision,'acceptance_evidence_revision_changed');
    assert.equal(item.apiPayloadSha256,current.apiPayloadSha256,'acceptance_evidence_payload_changed');}
  const rows=criteria.map(check=>{assert.match(check.id,/^C\d+$/);const proofs=commands(check).map(command=>{
    let selection;try{selection=acceptanceInvocation(command,current.root);}catch{return{command,status:'blocked',reason:'unsupported_proof_command'};}
    const candidates=evidence.filter(item=>matches(selection,item));return{command,selection,status:candidates.length===1?'covered':'blocked',
      reason:candidates.length===0?'missing_or_zero_selected_evidence':candidates.length>1?'ambiguous_evidence':undefined,
      evidence:candidates.length===1?{raw:candidates[0].rawPath,receipt:candidates[0].receiptPath,rawSha256:candidates[0].rawSha256,receiptSha256:candidates[0].receiptSha256,
        selectedNames:selection.filter?candidates[0].names.filter(name=>new RegExp(selection.filter).test(name)):undefined,
        counts:candidates[0].counts,origin:candidates[0].origin}:undefined};});
    assert.ok(proofs.length);return{id:check.id,statement:check.statement,tasks:check.tasks,proofs,status:proofs.every(value=>value.status==='covered')?'covered':'blocked'};});
  return{rows,complete:rows.every(value=>value.status==='covered')};
}
export function acceptanceBuildCoverage(required,evidence){const rows=required.map(command=>{const expected=acceptanceInvocation(command,repo);
    const items=evidence.filter(item=>item.kind==='build'&&item.invocation.cwd===expected.cwd&&JSON.stringify(item.invocation.argv)===JSON.stringify(expected.argv));
    return{command,status:items.length===1?'covered':'blocked',reason:items.length>1?'ambiguous_build':items.length===0?'build_missing':undefined,
      evidence:items.length===1?{raw:items[0].rawPath,receipt:items[0].receiptPath,rawSha256:items[0].rawSha256,receiptSha256:items[0].receiptSha256}:undefined};});
  return{rows,complete:rows.length>0&&rows.every(value=>value.status==='covered')};}

/** Summary guard after the T94 producer has checked canonical corpus hashes and
 * actual release proofs. It never upgrades local accuracy to a provider claim. */
export function acceptanceRagSummary(report,revision){
  const corpus=businessRagEvaluationCorpus(),critical=corpus.filter(value=>value.critical);
  assert.equal(report.revision,revision);assert.equal(report.mode,'owned_runtime');assert.equal(report.providerAccuracyProven,false);
  assert.equal(report.gate?.completeExecution,true);assert.equal(report.gate.passed,true);assert.equal(report.failedCritical,0);
  assert.deepEqual(report.invalidObservations,[]);assert.deepEqual(report.reviewItems,[]);
  assert.equal(report.total,corpus.length);assert.equal(report.executed,corpus.length);assert.equal(report.passed,corpus.length);
  assert.ok(Array.isArray(report.results));assert.equal(new Set(report.results.map(value=>value.id)).size,corpus.length);
  assert.equal(report.results.length,corpus.length);assert.ok(same(report.results.map(value=>value.id),corpus.map(value=>value.id)));
  for(const expected of corpus){const actual=report.results.find(value=>value.id===expected.id);assert.equal(actual.critical,expected.critical);
    assert.equal(actual.business,expected.business);assert.equal(actual.passed,true);assert.deepEqual(actual.reasons,[]);}
  return{businesses:[...new Set(corpus.map(value=>value.business))].sort(),criticalCaseIds:critical.map(value=>value.id),providerAccuracyProven:false};
}
export function classifyAcceptanceCapture(bytes,metadata){
  assert.ok(Buffer.isBuffer(bytes)&&bytes.length>=24);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);assert.ok(width>0&&height>0);
  assert.equal(metadata.width,width);assert.equal(metadata.height,height);const origin=preview(metadata)?'visual_preview':'local_application_capture';
  if(origin==='local_application_capture')assert.equal(metadata.origin,'served_browser');return{width,height,sha256:hash(bytes),origin};
}

function buildCommands(tasks){const line=tasks.split(/\r?\n/).find(value=>/^\*\*Build\*\*:/.test(value));assert.ok(line,'acceptance_build_header_missing');
  const value=line.slice(line.indexOf(':')+1).trim().replace(/^`|`$/g,'');assert.ok(!/^none\b/i.test(value));return value.split(';').map(value=>value.trim()).filter(Boolean);}
function readPair(reportRoot,pair,current){const receiptBytes=read(reportRoot,pair.receipt),receipt=JSON.parse(receiptBytes.toString('utf8').replace(/^\uFEFF/,'')),bytes=read(reportRoot,pair.raw);
  assert.equal(receipt.rawOutputSha256,hash(bytes),'acceptance_raw_changed');
  return{...verifyAcceptanceReceipt({receipt,raw:bytes.toString('utf8'),current}),receiptPath:pair.receipt,receiptSha256:hash(receiptBytes),rawPath:pair.raw};}
function currentRevision(){const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim();assert.match(sourceRevision,/^[a-f0-9]{40}$/);
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim(),'','acceptance_clean_current_tree_required');return sourceRevision;}
function captures(root,receipt,required){assert.ok(Array.isArray(receipt.captures));if(required)assert.ok(receipt.captures.length,'acceptance_browser_capture_missing');
  return receipt.captures.map(item=>{assert.ok(text(item.path));const bytes=read(root,item.path);assert.equal(item.sha256,hash(bytes),'acceptance_capture_changed');
    const result=classifyAcceptanceCapture(bytes,{...item,scope:receipt.scope??item.scope,origin:receipt.origin??item.origin});
    if(required)assert.equal(result.origin,'local_application_capture','acceptance_preview_in_running_capture');return{path:item.path,...result};});}
const safeError=(error,fallback)=>/^[a-zA-Z0-9_]+$/.test(error?.message??'')?error.message:fallback;

/** Filesystem collector only. No test runner/build/provider is invoked. Existing
 * T94 evidence is verified without sealing or altering a release artifact. */
export async function collectServiceAcceptanceReport(rawInput){
  const input=validateAcceptanceInput(rawInput),reportRoot=resolve(repo,input.reportRoot);assert.ok(within(repo,reportRoot));
  assert.ok(within(realpathSync(repo),realpathSync(reportRoot)),'acceptance_borrowed_report_root');
  const tasksPath=resolve(repo,'.specs/features',feature,'tasks.md'),tasks=readFileSync(tasksPath,'utf8');
  const report={version:1,feature,scope:'LOCAL_ACCEPTANCE_EVIDENCE_NOT_FINAL_VERIFICATION',status:'blocked',featureComplete:false,
    providerAcceptance:'not_established',criteriaSourceSha256:hash(tasks),matrix:[],builds:[],captures:[],previews:[],blockers:[],finalArtifacts:[]};
  let criteria,release,current,descriptor;
  try{criteria=activationCriterionInventory(tasks);report.criterionCount=criteria.length;}
  catch(error){report.blockers.push(safeError(error,'criterion_inventory_invalid'));return report;}
  try{const revision=currentRevision();
    for(const path of ['apps/storefront/.next','apps/widget_v2/dist','apps/dashboard/dist']){const directory=resolve(repo,path);assert.equal(lstatSync(directory).isSymbolicLink(),false);
      assert.ok(within(realpathSync(repo),realpathSync(directory)),'acceptance_borrowed_frontend_artifact');}
    descriptor=json(reportRoot,input.activationDescriptor);assert.notEqual(descriptor.seal,true,'acceptance_sealing_forbidden');
    release=await produceServiceActivationRelease({...descriptor,seal:false});assert.equal(release.fullT95Acceptance,false);
    assert.equal(release.manifest.sourceRevision,revision);current={root:repo,...release.manifest};
    report.sourceRevision=revision;report.sourceInputSha256=release.manifest.sourceInputSha256;report.apiPayloadSha256=release.manifest.apiPayloadSha256;
    report.activationManifestSha256=release.manifestSha256;report.frontendArtifacts=release.manifest.frontendArtifacts;
    report.rag=acceptanceRagSummary(json(resolve(repo,descriptor.reportRoot),descriptor.ragReport),revision);
  }catch(error){report.blockers.push(safeError(error,'current_release_evidence_unverified'));}
  const observed=[],evidence=[],builds=[];let measuredInputs;
  if(current)for(const [kind,pairs]of [['evidence',input.evidence],['builds',input.builds]])for(const pair of pairs){
    try{const item=readPair(reportRoot,pair,current);if(kind==='builds'){assert.equal(item.kind,'build');builds.push(item);}else{assert.notEqual(item.kind,'build');
        if(item.origin==='served_browser')item.applicationCaptures=captures(reportRoot,item.receipt,true);observed.push(item);}}
    catch(error){report.blockers.push({receipt:pair.receipt,reason:safeError(error,'receipt_invalid')});}}
  if(current&&observed.length)try{
      // The producer owns this hash authority. Measure its shared tree once,
      // then project its measured selected-file entries for each receipt.
      const files=[...new Set(observed.flatMap(item=>item.invocation.files))];measuredInputs=measureProofSourceInputs(files);
      report.proofSourceInputSha256=measuredInputs.inputSha256;
      for(const item of observed)try{assertActivationProofSourceInputs(item.receipt,{inputSha256:measuredInputs.inputSha256,
            files:measuredInputs.files.filter(file=>item.invocation.files.includes(file.path))});
          evidence.push(item);if(item.applicationCaptures)report.captures.push(...item.applicationCaptures);
        }catch(error){report.blockers.push({receipt:item.receiptPath,reason:safeError(error,'proof_source_inputs_invalid')});}
    }catch(error){report.blockers.push(safeError(error,'proof_source_inventory_invalid'));}
  const matrix=acceptanceMatrix(criteria,evidence,current??{root:repo});report.matrix=matrix.rows;
  for(const row of matrix.rows)for(const proof of row.proofs)if(proof.selection)for(const file of proof.selection.files)if(!existsSync(resolve(repo,file)))report.blockers.push({criterion:row.id,reason:'proof_source_path_missing',file});
  try{const result=acceptanceBuildCoverage(buildCommands(tasks),builds);report.builds=result.rows;if(!result.complete)report.blockers.push('build_evidence_incomplete');}
  catch(error){report.blockers.push(safeError(error,'build_inventory_invalid'));}
  for(const path of input.previews)try{const receipt=json(reportRoot,path);assert.equal(preview(receipt),true,'acceptance_preview_label_missing');
      const frames=captures(reportRoot,{...receipt,scope:'VISUAL_PREVIEW_ONLY'},false);report.previews.push({receipt:path,scope:'VISUAL_PREVIEW_ONLY',captures:frames});}
    catch(error){report.blockers.push({preview:path,reason:safeError(error,'preview_invalid')});}
  for(const name of ['proofs.md','verification.md','screens.md','mutations.json']){const path=resolve(repo,'.specs/features',feature,name);
    if(existsSync(path))report.finalArtifacts.push({path:normal(relative(repo,path)),sha256:hash(readFileSync(path)),status:'observed_not_self_validated'});}
  if(release&&matrix.complete&&report.blockers.length===0)try{assert.equal(currentRevision(),report.sourceRevision);
      const measuredAgain=await produceServiceActivationRelease({...descriptor,seal:false});
      assert.equal(measuredAgain.manifestSha256,release.manifestSha256,'acceptance_release_changed_during_collection');
      if(measuredInputs)assert.deepEqual(measureProofSourceInputs(measuredInputs.files.map(value=>value.path)),measuredInputs,'acceptance_proof_inputs_changed_during_collection');
      for(const item of [...evidence,...builds]){assert.equal(hash(read(reportRoot,item.rawPath)),item.rawSha256,'acceptance_raw_changed_during_collection');
        assert.equal(hash(read(reportRoot,item.receiptPath)),item.receiptSha256,'acceptance_receipt_changed_during_collection');}
      report.status='ready_for_final_verification';
    }catch(error){report.blockers.push(safeError(error,'evidence_changed_during_collection'));}
  report.finalVerificationRequired=['same_HEAD_check_proofs_after_LAST_task','independent_Verifier_and_closed_findings','independent_screens_and_required_mutations','validate_verification_exit0'];
  return report;
}
export function acceptanceMarkdown(report){const escape=value=>String(value).replaceAll('|','\\|').replaceAll('\n',' ');
  return[`# ${feature} local acceptance evidence`,'',`Status: **${report.status}**. Feature complete: **false**. Provider acceptance: **not established**.`,'',
    '| Criterion | Command | Origin | Result |','| --- | --- | --- | --- |',...report.matrix.flatMap(row=>row.proofs.map(proof=>
      `| ${row.id} | ${escape(proof.command)} | ${proof.evidence?.origin??'unverified'} | ${proof.status}${proof.reason?' — '+proof.reason:''} |`)),
    '',`Preview captures: ${report.previews.reduce((sum,item)=>sum+item.captures.length,0)}. Application captures: ${report.captures.length}.`,
    '', 'Final completion remains with the same-HEAD TLC proof, independent verification, screens and mutations gates.',''].join('\n');}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  assert.equal(process.argv.length,3,'acceptance_input_path_required');const input=json(repo,process.argv[2]),report=await collectServiceAcceptanceReport(input);
  const reportRoot=resolve(repo,input.reportRoot),output=resolve(reportRoot,input.output);assert.ok(within(reportRoot,output)&&output!==reportRoot);
  assert.equal(lstatSync(dirname(output)).isDirectory(),true,'acceptance_output_parent_required');
  assert.ok(within(realpathSync(reportRoot),realpathSync(dirname(output))));
  assert.equal(existsSync(output+'.json')||existsSync(output+'.md'),false,'acceptance_output_already_exists');
  writeFileSync(output+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});writeFileSync(output+'.md',acceptanceMarkdown(report),{flag:'wx'});
  console.log(JSON.stringify({status:report.status,featureComplete:false,criterionCount:report.criterionCount,report:output+'.json'}));
  if(report.status!=='ready_for_final_verification')process.exitCode=1;
}

export {verifyOfficialProofRawCapture} from './service-official-proof-raw-audit.mjs';
