import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),target=process.argv[2];
assert.equal(process.argv.length,3);assert.ok(['sandbox','production'].includes(target));
const path='apps/api/prisma/deploy-migrations/20261116120000_platform_support_plan_limits/migration.sql';
const expected={sandbox:'87c090f5c40b785d979da27196690b9101ce57e78716b8f8926d36916d9af463',
  production:'87c090f5c40b785d979da27196690b9101ce57e78716b8f8926d36916d9af463'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',args,{cwd:root});
assert.equal(git(['status','--porcelain','--untracked-files=no']).toString('utf8').trim(),'','release_migration_source_not_clean');
const revision=git(['rev-parse','HEAD']).toString('utf8').trim();assert.match(revision,/^[a-f0-9]{40}$/);
const indexTreeBefore=git(['write-tree']).toString('utf8').trim();
const indexEntryBefore=git(['ls-files','--stage','--',path]).toString('utf8');
const canonicalBlob=git(['rev-parse',revision+':'+path]).toString('utf8').trim();
const canonical=git(['show',revision+':'+path]);assert.equal(sha(canonical),'1caf039294fc815d17c167c19df889b9a939c8a9d040b34c099d9bbe006c6056','release_migration_canonical_git_blob_changed');
assert.equal(canonical.includes(Buffer.from('\r')),false,'release_migration_git_blob_must_be_canonical_lf');
const bytes=Buffer.from(canonical.toString('utf8').replaceAll('\n','\r\n'));
assert.equal(sha(bytes),expected[target],'release_migration_target_does_not_match_read_only_db_preflight');
const info=resolve(root,git(['rev-parse','--git-path','info/attributes']).toString('utf8').trim());
const previous=existsSync(info)?readFileSync(info,'utf8'):'';
assert.ok(!previous.split(/\r?\n/).some(line=>line.startsWith(path+' ')),'release_migration_attribute_already_configured');
mkdirSync(dirname(info),{recursive:true});writeFileSync(info,previous+'\n'+path+' text eol='+'crlf'+'\n');
writeFileSync(resolve(root,path),bytes);
// Verify the clean-filtered content BEFORE refreshing only this index entry.
// Git's stat cache otherwise marks a newly configured CRLF file modified even
// when its canonical blob is identical; never stage a different blob or mode.
assert.equal(git(['hash-object','--path='+path,resolve(root,path)]).toString('utf8').trim(),canonicalBlob,'release_migration_filtered_blob_changed');
git(['add','--renormalize','--',path]);
const indexTreeAfter=git(['write-tree']).toString('utf8').trim();
assert.equal(indexTreeAfter,indexTreeBefore,'release_migration_index_tree_changed');
assert.equal(git(['ls-files','--stage','--',path]).toString('utf8'),indexEntryBefore,'release_migration_index_entry_changed');
assert.equal(git(['rev-parse','HEAD']).toString('utf8').trim(),revision,'release_migration_head_changed');
assert.deepEqual(git(['show',revision+':'+path]),canonical,'release_migration_git_blob_changed');
assert.equal(git(['status','--porcelain','--untracked-files=no']).toString('utf8').trim(),'','release_migration_materialization_not_git_clean');
mkdirSync(resolve(root,'.cache'),{recursive:true});writeFileSync(resolve(root,'.cache/service-release-support-migration-materialization.json'),JSON.stringify({
  version:1,target,sourceRevision:revision,path,gitBlobSha256:sha(canonical),materializedSha256:sha(readFileSync(resolve(root,path))),
  existingDatabaseChanged:false,gitIndexOrCommitChanged:false,gitIndexTreeBefore:indexTreeBefore,gitIndexTreeAfter:indexTreeAfter,
  gitIndexStatMetadataRefreshed:true,canonicalGitBlobUnchanged:true,sourceBytesEqualAfterCanonicalLineEndingConversion:true,
  authority:'read-only real database migration metadata 2026-11-27; applied records only, rolled-back records excluded'},null,2)+'\n',{flag:'wx'});
