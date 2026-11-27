import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,existsSync,rmSync,lstatSync,realpathSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const migration='apps/api/prisma/deploy-migrations/20261003021500_digital_order_fulfillment/migration.sql';
const helper='scripts/service-release-migration-bytes.mjs';
const expected={sandbox:'485bce8aa74d04f420512dc982b4c72cad8b2e1fab23bb4c7cdc0426c52943ce',production:'16f89183401eeefca7659d3e92ef5a26ff54df7b9ffa21a85d4602f4bd141ef5'};
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=Buffer.from(readFileSync(resolve(sourceRoot,migration),'utf8').replaceAll('\r\n','\n'));
assert.equal(sha(canonical),expected.sandbox);
const temporary=resolve(sourceRoot,'.cache/service-migration-byte-contract-fixtures');mkdirSync(temporary,{recursive:true});
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP'].includes(key.toUpperCase())));
Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'});
function fixture(t,bytes=canonical){
 const root=mkdtempSync(resolve(temporary,'fixture-'));const command=args=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',windowsHide:true});
 const put=(name,data)=>{const path=resolve(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,data)};
 put(migration,bytes);put('stable.txt','preserved\n');put('.gitignore','.cache/\n');
 put(helper,readFileSync(resolve(sourceRoot,helper)));
 command(['init','--quiet']);command(['config','core.autocrlf','false']);command(['config','core.longpaths','true']);command(['add','.']);
 command(['-c','user.name=Synthetic release fixture','-c','user.email=synthetic@example.test','-c','commit.gpgsign=false','-c','core.hooksPath='+resolve(root,'.git/no-hooks'),'commit','--quiet','-m','fixture: preserve canonical migration']);
 const before={head:command(['rev-parse','HEAD']).trim(),index:command(['ls-files','--stage']),bytes:readFileSync(resolve(root,migration))};
 t.after(()=>{const actual=realpathSync(root),parent=realpathSync(temporary),part=relative(parent,actual);assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part)&&/^fixture-[A-Za-z0-9]+$/.test(basename(actual)));assert.equal(lstatSync(root).isSymbolicLink(),false);rmSync(actual,{recursive:true,force:true});assert.equal(existsSync(actual),false)});
 return{root,command,put,before,run(target){return spawnSync(process.execPath,[helper,target],{cwd:root,env,encoding:'utf8',windowsHide:true})}};
}
for(const target of ['sandbox','production'])test('materializes '+target+' exact applied bytes without changing Git history or index',t=>{
 const f=fixture(t),result=f.run(target);assert.equal(result.status,0,result.stderr);
 assert.equal(sha(readFileSync(resolve(f.root,migration))),expected[target]);
 assert.equal(f.command(['rev-parse','HEAD']).trim(),f.before.head);assert.equal(f.command(['ls-files','--stage']),f.before.index);
 assert.equal(f.command(['status','--porcelain','--untracked-files=no']).trim(),'');
 assert.deepEqual(Buffer.from(f.command(['show',f.before.head+':'+migration])),canonical);
 const receipt=JSON.parse(readFileSync(resolve(f.root,'.cache/service-release-migration-materialization.json'),'utf8'));
 assert.equal(receipt.target,target);assert.equal(receipt.path,migration);assert.equal(receipt.gitBlobSha256,expected.sandbox);assert.equal(receipt.materializedSha256,expected[target]);assert.equal(receipt.sourceRevision,f.before.head);
 assert.equal(receipt.gitIndexOrCommitChanged,false);assert.equal(receipt.existingDatabaseChanged,false);
 assert.equal(receipt.gitIndexTreeBefore,receipt.gitIndexTreeAfter);assert.equal(receipt.gitIndexStatMetadataRefreshed,true);assert.equal(receipt.canonicalGitBlobUnchanged,true);
});
test('rejects an unknown target before changing migration bytes',t=>{
 const f=fixture(t),result=f.run('staging');assert.notEqual(result.status,0);assert.deepEqual(readFileSync(resolve(f.root,migration)),f.before.bytes);
 assert.equal(existsSync(resolve(f.root,'.git/info/attributes')),false);assert.equal(existsSync(resolve(f.root,'.cache/service-release-migration-materialization.json')),false);
});
test('rejects a different canonical Git migration without converting it',t=>{
 const f=fixture(t,Buffer.concat([canonical,Buffer.from('\n-- different canonical bytes\n')])),result=f.run('production');assert.notEqual(result.status,0);assert.match(result.stderr,/release_migration_canonical_git_blob_changed/);
 assert.deepEqual(readFileSync(resolve(f.root,migration)),f.before.bytes);assert.equal(f.command(['rev-parse','HEAD']).trim(),f.before.head);
 assert.equal(existsSync(resolve(f.root,'.git/info/attributes')),false);assert.equal(existsSync(resolve(f.root,'.cache/service-release-migration-materialization.json')),false);
});
test('preserves unrelated dirty source and refuses materialization',t=>{
 const f=fixture(t);f.put('stable.txt','uncommitted source must remain\n');const result=f.run('production');assert.notEqual(result.status,0);assert.match(result.stderr,/release_migration_source_not_clean/);
 assert.equal(readFileSync(resolve(f.root,'stable.txt'),'utf8'),'uncommitted source must remain\n');assert.deepEqual(readFileSync(resolve(f.root,migration)),f.before.bytes);
 assert.equal(existsSync(resolve(f.root,'.git/info/attributes')),false);assert.equal(existsSync(resolve(f.root,'.cache/service-release-migration-materialization.json')),false);
});
test('does not overwrite an existing migration attribute rule',t=>{
 const f=fixture(t),rule=migration+' text eol=lf\n';f.put('.git/info/attributes',rule);const result=f.run('production');assert.notEqual(result.status,0);assert.match(result.stderr,/release_migration_attribute_already_configured/);
 assert.equal(readFileSync(resolve(f.root,'.git/info/attributes'),'utf8'),rule);assert.deepEqual(readFileSync(resolve(f.root,migration)),f.before.bytes);
 assert.equal(existsSync(resolve(f.root,'.cache/service-release-migration-materialization.json')),false);
});
