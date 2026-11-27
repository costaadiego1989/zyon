// Importing this module does nothing. Call only after both real CI steps exit zero.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FORMAT,REPOSITORY,MARKER,COMMANDS,RECEIPT,sha,hashFile,rootsFor,treeEntries,noLinks,writeTar,inspectTar,verifyBundle,checkReceipt,integer,revision} from './transport-core.mjs';

/**
 * Pure module interface; never runs a compiler, Git, network, tests, or record-build.
 * CI supplies real captured gate records and the unchanged hardened helper's
 * serviceBuildInputs/assertServiceArtifacts functions. The approved workflow and
 * GitHub successful step records independently bind that invocation.
 */
export async function exportCiApiBundle({workspaceRoot,destination,head,github,gates,measureInputs,assertArtifacts,sourceEvidence,emit=console.log}){
  revision(head);assert.equal(github.repository,REPOSITORY);for(const key of ['runId','jobId','runAttempt'])integer(github[key]);
  assert.ok(github.workflowPath?.startsWith('.github/workflows/'));assert.equal(typeof measureInputs,'function');assert.equal(typeof assertArtifacts,'function');
  assert.deepEqual(gates.map(x=>x.id).sort(),Object.keys(COMMANDS).sort());
  const inputSha256=await measureInputs(),checked=await assertArtifacts();assert.equal(checked.checked,true);assert.equal(checked.inputSha256,inputSha256);
  const receiptBytes=fs.readFileSync(noLinks(workspaceRoot,RECEIPT,{allowMissing:false}));checkReceipt(receiptBytes,inputSha256);
  const inputStampBytes=fs.readFileSync(noLinks(workspaceRoot,'apps/api/.sandbox-state/service-test-build-inputs.json',{allowMissing:false}));assert.equal(JSON.parse(inputStampBytes).inputSha256,inputSha256);
  assert.ok(sourceEvidence&&Array.isArray(sourceEvidence.sourceFiles)&&Array.isArray(sourceEvidence.generatedClients)&&sourceEvidence.generatedClients.length===2,'both generated-client evidence snapshots required');const sourceEvidenceBytes=Buffer.from(JSON.stringify(sourceEvidence,null,2)+'\n');
  const outputRoots=rootsFor(workspaceRoot).map(name=>({path:name,exists:fs.existsSync(noLinks(workspaceRoot,name))}));
  assert.equal(outputRoots.find(x=>x.path==='apps/api/dist')?.exists,true);const outputs=outputRoots.flatMap(x=>treeEntries(workspaceRoot,x.path));
  const logEntries=[],gateMetadata=[];
  for(const gate of gates){assert.deepEqual(gate.argv,COMMANDS[gate.id]);assert.equal(gate.cwd,'.');assert.equal(gate.exitCode,0);integer(gate.stepNumber);assert.ok(gate.stepName?.trim());
    const record={id:gate.id,argv:gate.argv,cwd:'.',exitCode:0,stepNumber:gate.stepNumber,stepName:gate.stepName};
    for(const stream of ['stdout','stderr']){assert.ok(Buffer.isBuffer(gate[stream]),'raw log bytes required');assert.ok(gate[stream].length<=16*1024**2);
      record[stream]={bytes:gate[stream].length,sha256:sha(gate[stream])};logEntries.push({name:'logs/'+gate.id+'.'+stream+'.txt',kind:'file',bytes:gate[stream].length,buffer:gate[stream]});}gateMetadata.push(record);}
  const self=fileURLToPath(import.meta.url),core=fileURLToPath(new URL('./transport-core.mjs',import.meta.url));
  const metadata={format:FORMAT,repository:REPOSITORY,head,github,gates:gateMetadata,inputSha256,checkedArtifactSha256:checked.artifactSha256,
    checkedReceiptSha256:sha(receiptBytes),outputRoots,outputs,exporterSha256:hashFile(self),coreSha256:hashFile(core),
    artifactHelperSha256:hashFile(noLinks(workspaceRoot,'apps/api/tests/service-test-artifacts.mjs',{allowMissing:false})),
    inputStampSha256:sha(inputStampBytes),sourceEvidenceSha256:sha(sourceEvidenceBytes),
    provenance:'REAL_GITHUB_CI_API_BUILD_AND_TYPECHECK_NOT_LOCAL_COMPILATION',releaseManifestIncluded:false,nodeModulesIncluded:false};
  const metadataBytes=Buffer.from(JSON.stringify(metadata,null,2)+'\n');
  const entries=[{name:'metadata/ci-api.json',kind:'file',bytes:metadataBytes.length,buffer:metadataBytes},
    {name:'metadata/checked-inputs.json',kind:'file',bytes:inputStampBytes.length,buffer:inputStampBytes},
    {name:'metadata/source-input-evidence.json',kind:'file',bytes:sourceEvidenceBytes.length,buffer:sourceEvidenceBytes},
    {name:'metadata/checked-build.json',kind:'file',bytes:receiptBytes.length,buffer:receiptBytes},...logEntries,
    ...outputs.map(row=>({name:'payload/'+row.path,kind:row.kind,bytes:row.bytes,...(row.kind==='file'?{file:noLinks(workspaceRoot,row.path,{allowMissing:false})}:{})}))];
  fs.mkdirSync(path.dirname(destination),{recursive:true});const bundleSha256=writeTar(destination,entries);
  const archive=inspectTar(destination);try{verifyBundle(archive,{head,inputSha256,outputRoots:outputRoots.map(x=>x.path)});}finally{fs.closeSync(archive.fd);}
  assert.equal(await measureInputs(),inputSha256,'sources changed while exporting');assert.deepEqual(await assertArtifacts(),checked,'checked outputs changed while exporting');
  // Printed in the pinned export step. The Windows verifier obtains this marker
  // independently from GitHub's authenticated job log, never from a caller JSON.
  const attestation={format:FORMAT,head,runId:github.runId,jobId:github.jobId,runAttempt:github.runAttempt,bundleSha256,metadataSha256:sha(metadataBytes),bytes:fs.statSync(destination).size};
  emit(MARKER+JSON.stringify(attestation));return{destination,attestation};
}
