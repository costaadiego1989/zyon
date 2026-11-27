import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {measureServiceReleaseRuntime,SERVICE_RELEASE_ASSET} from '../apps/api/dist/shared/bookings/service-release-artifact.js';
import {verifyServiceReleaseManifest} from '../apps/api/dist/shared/bookings/service-release-manifest.js';

const root=fileURLToPath(new URL('../',import.meta.url)),api=resolve(root,'apps/api');
assert.equal(process.argv.length,2,'release_no_caller_identity_override');
const metadata=JSON.parse(readFileSync(resolve(root,'.release/transport.json'),'utf8'));
assert.match(metadata.sourceRevision,/^[a-f0-9]{40}$/);
const raw=readFileSync(resolve(api,SERVICE_RELEASE_ASSET)),manifest=JSON.parse(raw);
assert.equal(createHash('sha256').update(raw).digest('hex'),metadata.manifestSha256,'release_transported_manifest_changed');
assert.equal(manifest.sourceRevision,metadata.sourceRevision,'release_transported_revision_changed');
const runtime=measureServiceReleaseRuntime(api,metadata.sourceRevision);
assert.equal(runtime.sourceInputSha256,metadata.sourceInputSha256,'release_transported_source_changed');
assert.equal(runtime.apiPayloadSha256,metadata.apiPayloadSha256,'release_transported_payload_changed');
assert.deepEqual({platform:process.platform,arch:process.arch,nodeVersion:process.version,nodeAbi:process.versions.modules},metadata.nodeRuntime,'release_transported_node_changed');
assert.equal(verifyServiceReleaseManifest(manifest,runtime).kind,'verified','release_transported_evidence_invalid');
const frontendRoots={dashboard:'apps/dashboard/dist',widget:'apps/widget_v2/dist',storefront:'apps/storefront/.next','widget-app':'apps/widget_v2/dist-app'};
assert.equal(metadata.supplementalArtifacts.length,1,'release_supplemental_artifact_required');
assert.equal(metadata.supplementalArtifacts[0].id,'widget-app','release_supplemental_artifact_unknown');
for(const frontend of [...manifest.frontendArtifacts,...metadata.supplementalArtifacts]){
  assert.ok(Object.hasOwn(frontendRoots,frontend.id),'release_transported_frontend_unknown');
  const directory=resolve(root,frontendRoots[frontend.id]),entries=[];
  function walk(path){for(const item of readdirSync(path,{withFileTypes:true})){
    assert.equal(item.isSymbolicLink(),false,'release_transported_frontend_symlink');const file=resolve(path,item.name);
    if(item.isDirectory()){if(item.name!=='cache')walk(file);}else if(item.isFile())entries.push({path:relative(directory,file).split(sep).join('/'),sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});
  }}
  walk(directory);assert.ok(entries.length>0);entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  assert.equal(createHash('sha256').update(JSON.stringify(entries)).digest('hex'),frontend.artifactSha256,'release_transported_frontend_changed');
}
console.log('VERIFIED_SAME_RELEASE_PAYLOAD '+metadata.sourceRevision+' '+runtime.apiPayloadSha256);
