import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const BOUNDS={"name":"FRONTEND_CONTAINED_HEAP3072_COMMIT4352_SERIAL_V1","approvalScope":"EXPRESS_FRONTEND_THREE_APPS_CONTAINED_PROFILE_ONLY","targets":["dashboard","storefront","widget-v2"],"nodeHeapMiB":3072,"requiredCommitMiB":4352,"originalDefaultCommitMiB":5168,"maximumConcurrentBuildChildren":1,"typecheck":"ORIGINAL_NORMAL_COMMAND","build":"ORIGINAL_NORMAL_PRODUCTION_COMMAND","sourceInventories":"UNCHANGED_FULL_EXACT","workersConfigsTimeouts":"UNCHANGED","noCheckIntroduced":false,"skipsIntroduced":false,"parentOnlyGc":"UNCHANGED_EXISTING_BEFORE_REAL_WINDOWS_PROBE","networkGuard":"UNCHANGED_EXISTING_LOCAL_GUARD","apiOnlyApprovalInherited":false,"productionAuthorized":false};
const BOUNDS_SHA='50cfb9278146bb1d5a974be04d38f2c4c100d1be22c2f260b029ea9d53ee98aa';
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
/** Opt-in resource policy only; no application, compiler or network is imported. */
export function frontendBuildProfile(target,extra=[]){
  assert.ok(BOUNDS.targets.includes(target),'frontend_target_required');
  if(extra.length===0)return Object.freeze({name:'ORIGINAL_FRONTEND_COMMIT5168',contained:false,requiredCommitMiB:5168,nodeHeapMiB:null,nodeOptionsSuffix:'',canonicalArgs:[],authorization:null});
  assert.equal(extra.length,3,'explicit_profile_and_actual_approval_path_sha_required');
  const [flag,approvalPath,approvalSha]=extra;
  assert.equal(flag,'--frontend-contained-profile');assert.match(approvalSha,/^[a-f0-9]{64}$/);
  assert.equal(hash(approvalPath),approvalSha,'actual_frontend_approval_sha_required');
  const approval=json(approvalPath);
  assert.equal(approval.scope,BOUNDS.approvalScope,'API_ONLY_OR_GENERIC_CONTINUATION_APPROVAL_FORBIDDEN');
  assert.equal(approval.decision,'approve');assert.equal(approval.productionAuthorized,false);
  assert.deepEqual(approval.approvedTargets,BOUNDS.targets);
  assert.equal(approval.profileBounds.sha256,BOUNDS_SHA);assert.equal(hash(approval.profileBounds.path),BOUNDS_SHA);
  assert.deepEqual(json(approval.profileBounds.path),BOUNDS,'only_exact_reviewed_resource_bounds');
  assert.ok(typeof approval.questionReference==='string'&&approval.questionReference.length>0);
  assert.ok(typeof approval.timestampBasis==='string'&&approval.timestampBasis.length>0);
  assert.ok(Number.isFinite(Date.parse(approval.answeredAtUtc)),'observed_actual_answer_time_required');
  const raw=approval.rawUserAnswer;assert.equal(raw.answerJsonPointer,'/content');assert.equal(hash(raw.path),raw.sha256);
  const answer=json(raw.path);assert.equal(answer.role,'user');assert.ok(typeof answer.content==='string'&&answer.content.trim().length>0);
  assert.equal(answer.content,approval.selectedAnswer);assert.equal(answer.observedAtUtc,approval.answeredAtUtc);
  return Object.freeze({name:BOUNDS.name,contained:true,requiredCommitMiB:4352,nodeHeapMiB:3072,nodeOptionsSuffix:' --max-old-space-size=3072',canonicalArgs:[flag,resolve(approvalPath),approvalSha],authorization:{approval:{path:resolve(approvalPath),sha256:approvalSha},rawUserAnswer:{path:resolve(raw.path),sha256:raw.sha256},profileBounds:{path:resolve(approval.profileBounds.path),sha256:BOUNDS_SHA}}});
}
