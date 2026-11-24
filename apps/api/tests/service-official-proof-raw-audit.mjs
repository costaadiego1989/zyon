// T95 companion: audits captured output from ONE official execution; never runs tests.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parseActivationTap,activationCriterionInventory,activationProofCommands} from './service-activation-release-producer.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const ansi=/\x1b\[[0-?]*[ -/]*[@-~]/g;
const clean=value=>value.replace(ansi,'').replaceAll('\r\n','\n');
export function parseOfficialCliCounts(command,stdout,stderr){
  assert.equal(typeof stdout,'string');assert.equal(typeof stderr,'string');
  const raw=clean(stdout+'\n'+stderr);
  if(/\bexec node\b/.test(command)&&/(?:^|\s)--test(?:\s|$)/.test(command)){
    const counts=parseActivationTap(raw);assert.doesNotMatch(raw,/^\s*(?:ok|not ok)\b[^\n]*#\s*(?:SKIP|TODO)\b/im);return counts;
  }
  if(/\bexec vitest run\b/.test(command)){
    const summary=[...raw.matchAll(/^\s*Tests\s+([^\n]+)$/gm)];assert.equal(summary.length,1,'official_vitest_single_summary');
    const total=summary[0][1].match(/\((\d+)\)\s*$/);assert.ok(total,'official_vitest_total_required');
    const values={};for(const m of summary[0][1].matchAll(/(\d+)\s+(passed|failed|skipped|todo|cancelled)\b/g)){
      assert.equal(values[m[2]],undefined,'official_vitest_duplicate_count');values[m[2]]=Number(m[1]);
    }
    const count=Number(total[1]);assert.ok(count>0&&values.passed===count,'official_vitest_all_cases');
    for(const key of ['failed','skipped','todo','cancelled'])assert.equal(values[key]??0,0,'official_vitest_no_skip');
    const files=[...raw.matchAll(/^\s*Test Files\s+(\d+)\s+passed\s+\((\d+)\)\s*$/gm)];
    assert.equal(files.length,1,'official_vitest_files_required');
    assert.ok(Number(files[0][1])>0&&files[0][1]===files[0][2],'official_vitest_all_files');
    return{executed:count,passed:count,failed:0,skipped:0};
  }
  if(/\bexec playwright test\b/.test(command)){
    const announced=[...raw.matchAll(/^\s*Running (\d+) tests? using \d+ workers?\s*$/gm)];
    assert.equal(announced.length,1,'official_browser_announcement_required');
    const stats={};for(const m of raw.matchAll(/^\s*(\d+)\s+(passed|failed|skipped|flaky|interrupted|did not run|timed out)\b[^\n]*$/gm)){
      assert.equal(stats[m[2]],undefined,'official_browser_duplicate_summary');stats[m[2]]=Number(m[1]);
    }
    assert.ok(stats.passed>0,'official_browser_nonzero_summary');
    assert.equal(stats.passed,Number(announced[0][1]),'official_browser_incomplete_count');
    for(const key of ['failed','skipped','flaky','interrupted','did not run','timed out'])assert.equal(stats[key]??0,0,'official_browser_incomplete');
    return{executed:stats.passed,passed:stats.passed,failed:0,skipped:0};
  }
  assert.fail('official_unknown_test_runner');
}
export function officialCapturePlan(tasks){
  const result=[];
  for(const criterion of activationCriterionInventory(tasks)){
    activationProofCommands(criterion.proof).forEach((command,index)=>result.push({kind:'proof',cid:criterion.id,proofIndex:index+1,command}));
  }
  const header=tasks.split(/\r?\n/).find(line=>/^\**\s*Build\s*\**\s*:/.test(line));assert.ok(header,'official_build_header_required');
  const body=header.replace(/^\**\s*Build\s*\**\s*:\s*/,'').trim().replace(/^\x60|\x60$/g,'');
  const builds=body.split(';').map(value=>value.trim().replace(/^\x60|\x60$/g,'').trim()).filter(Boolean);
  assert.equal(builds.length,9,'official_nine_build_commands');
  builds.forEach((command,index)=>result.push({kind:'build',buildIndex:index+1,command}));return result;
}
export function verifyOfficialProofRawCapture({manifest,read,current}){
  assert.equal(manifest.version,1);assert.equal(manifest.officialExitCode,0,'official_skill_must_pass');
  assert.equal(resolve(manifest.workspaceRoot),resolve(current.root),'official_capture_workspace');
  assert.equal(manifest.headBefore,current.sourceRevision);assert.equal(manifest.headAfter,current.sourceRevision);
  assert.deepEqual(manifest.sourceBefore,manifest.sourceAfter,'official_code_changed');
  assert.deepEqual(manifest.sourceAfter,current.sourceFiles,'official_code_not_current');assert.deepEqual(manifest.captureErrors,[]);
  assert.ok(Object.keys(manifest.sourceBefore).length>=10,'official_source_snapshots_required');
  for(const name of ['check_proofs.py','validate_verification.py','runners.py','lean_config.py',
    'service-official-proof-capture.py','service-official-proof-raw-audit.mjs','service-acceptance-report.mjs',
    'service-activation-release-producer.mjs','tasks.md'])
    assert.equal(Object.keys(manifest.sourceBefore).filter(path=>basename(path.replaceAll('\\','/'))===name).length,1,'official_critical_code_snapshot');
  const expected=officialCapturePlan(current.tasks);
  assert.equal(new Set(expected.filter(row=>row.kind==='proof').map(row=>row.cid)).size,84);
  assert.deepEqual(manifest.plan,expected,'official_command_plan');assert.equal(manifest.entries.length,expected.length,'official_missing_observed_command');
  const proofRows=[],buildRows=[];
  for(let index=0;index<expected.length;index++){
    const row=manifest.entries[index],planned=expected[index];assert.equal(row.ordinal,index+1);
    for(const [key,value]of Object.entries(planned))assert.equal(row[key],value,'official_argv_changed');
    assert.equal(row.phase,planned.kind==='proof'?'official-positive-proof':'official-build');
    assert.equal(resolve(row.cwd),resolve(current.root));assert.equal(row.returnCode,0,'official_nonzero_exit');
    const raw={};for(const name of ['stdout','stderr']){
      const file=row[name];assert.match(file.path,/^logs\/\d{4}\.(?:stdout|stderr)\.txt$/);
      const bytes=read(file.path);assert.ok(Buffer.isBuffer(bytes));assert.ok(bytes.length<=16_000_000,'official_raw_bound');
      assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256,'official_raw_changed');raw[name]=bytes.toString('utf8');
    }
    if(planned.kind==='build'){buildRows.push({buildIndex:planned.buildIndex,command:planned.command,exitCode:0});continue;}
    const counts=parseOfficialCliCounts(planned.command,raw.stdout,raw.stderr);
    proofRows.push({cid:planned.cid,proofIndex:planned.proofIndex,command:planned.command,counts});
  }
  assert.equal(buildRows.length,9);
  return Object.freeze({version:1,scope:'T95_SAME_OFFICIAL_EXECUTION_STRICT_RAW_AUDIT_NOT_RELEASE_APPROVAL',
    sourceRevision:current.sourceRevision,criteria:84,proofCommands:proofRows.length,buildCommands:9,proofRows,buildRows,
    caseExecutions:proofRows.reduce((sum,row)=>sum+row.counts.executed,0),countsAreDistinctTests:false,
    originalSkillFilesUnmodified:true,officialCountUnknownWasNotPromoted:true,testsReexecuted:false,
    mutationCommandsCountedAsPositive:false,
    environmentRecorded:false,providerAccepted:false,featureComplete:false,productionReady:false});
}
function owned(root,name){
  const file=resolve(root,name),rel=relative(root,file);assert.ok(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));
  assert.equal(lstatSync(file).isSymbolicLink(),false);assert.ok(realpathSync(file).startsWith(realpathSync(root)+sep));return file;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  assert.equal(process.argv.length,6);assert.equal(process.argv[2],'--root');assert.equal(process.argv[4],'--capture');
  const root=resolve(process.argv[3]),directory=resolve(process.argv[5]);assert.ok(directory.startsWith(resolve(root,'.cache')+sep));
  const manifest=JSON.parse(readFileSync(owned(directory,'capture-manifest.json'),'utf8'));
  const allowedSkill=new Set(['check_proofs.py','validate_verification.py','runners.py','lean_config.py']
    .map(name=>resolve('C:/Users/Admin/.codex/skills/tlc-spec-driven/scripts',name)));
  const sourceFiles={};for(const path of Object.keys(manifest.sourceAfter??{})){
    const file=resolve(path),rel=relative(root,file);assert.ok(allowedSkill.has(file)||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep)));
    assert.equal(lstatSync(file).isSymbolicLink(),false);sourceFiles[path]=sha(readFileSync(file));
  }
  const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  assert.match(manifest.feature,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const tasks=readFileSync(owned(root,'.specs/features/'+manifest.feature+'/tasks.md'),'utf8');
  const report=verifyOfficialProofRawCapture({manifest,read:name=>readFileSync(owned(directory,name)),current:{root,sourceRevision,sourceFiles,tasks}});
  writeFileSync(resolve(directory,'strict-raw-audit.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({scope:report.scope,criteria:report.criteria,proofCommands:report.proofCommands,buildCommands:9,caseExecutions:report.caseExecutions,featureComplete:false}));
}

