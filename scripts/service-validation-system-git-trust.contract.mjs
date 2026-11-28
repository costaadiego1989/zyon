import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync,writeFileSync,lstatSync,unlinkSync,rmdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

test('the validation image trusts only its admitted mount in system config, without global wildcard',()=>{
  const recipe=readFileSync(new URL('../ops/service-release/Dockerfile.linux-validation',import.meta.url),'utf8');
  assert.match(recipe,/^RUN git config --system --add safe\.directory \/repo$/m);
  assert.doesNotMatch(recipe,/safe\.directory\s+(?:['"]?\*|\/\*)/);
});
test('real Git system trust remains available when browser sanitization removes HOME',()=>{
  const owned=mkdtempSync(resolve(tmpdir(),'zyon-validation-git-trust-')),system=resolve(owned,'owned-system.gitconfig');
  let failure;const cleanup=[];
  try{
    writeFileSync(system,'');
    // Override only the system config path for this test: never write this host's
    // real system configuration and never mutate a shared repository or index.
    const env={...process.env,GIT_CONFIG_SYSTEM:system,GIT_CONFIG_GLOBAL:resolve(owned,'absent-global')};
    delete env.HOME;delete env.USERPROFILE;delete env.GIT_CONFIG_NOSYSTEM;
    execFileSync('git',['config','--system','--add','safe.directory','/repo'],{cwd:owned,env,windowsHide:true});
    assert.equal(execFileSync('git',['config','--get-all','safe.directory'],{cwd:owned,env,encoding:'utf8',windowsHide:true}).trim(),'/repo');
    assert.match(readFileSync(system,'utf8'),/directory = \/repo/);
    assert.equal(execFileSync('git',['config','--system','--get-all','safe.directory'],{cwd:owned,env,encoding:'utf8',windowsHide:true}).trim(),'/repo');
  }catch(error){failure=error;}
  finally{
    // Delete only our two known files. An unexpected file keeps the directory
    // nonempty and makes rmdir fail; no recursive delete or foreign cleanup.
    for(const file of[system,system+'.lock'])try{
      if(existsSync(file)){const entry=lstatSync(file);assert.ok(entry.isFile()&&!entry.isSymbolicLink());unlinkSync(file);}
    }catch(error){cleanup.push(error);}
    try{rmdirSync(owned);}catch(error){cleanup.push(error);}
  }
  if(failure&&cleanup.length)throw new AggregateError([failure,...cleanup],'validation_git_test_and_cleanup_failed');
  if(failure)throw failure;
  if(cleanup.length)throw new AggregateError(cleanup,'validation_git_test_cleanup_failed');
});
