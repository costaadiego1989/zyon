import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, readFile, rm, mkdir, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runSuite, discoverTests} from './run-agentic-tests.mjs';

async function fixture(source, run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'zyon-agentic-runner-'));
  try {
    const file = path.join(directory, 'contract.spec.mjs');
    await writeFile(file, source);
    let output=''; const capture={write(chunk){output+=String(chunk);}};
    return await run({directory,file,capture,output:()=>output});
  } finally {
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('zyon-agentic-runner-'));
    await rm(directory,{recursive:true,force:true});
  }
}

test('runner executes a passing case and returns successful evidence', async () => {
  await fixture(`import {test} from 'node:test'; import {writeFile} from 'node:fs/promises'; test('observable case',async()=>writeFile(new URL('./witness',import.meta.url),'executed'));`, async f=>{
    assert.equal(await runSuite([f.file],{cwd:f.directory,loader:null,stdout:f.capture,stderr:f.capture}),0);
    assert.equal(await readFile(path.join(f.directory,'witness'),'utf8'),'executed');
    assert.match(f.output(),/# tests 1/); assert.match(f.output(),/# fail 0/);
  });
});
test('runner propagates a failed test instead of reporting success', async () => {
  await fixture(`import {test} from 'node:test'; import assert from 'node:assert/strict'; test('fails as specified',()=>assert.equal(1,2));`, async f=>{
    assert.notEqual(await runSuite([f.file],{cwd:f.directory,loader:null,stdout:f.capture,stderr:f.capture}),0);
    assert.match(f.output(),/# fail 1/);
  });
});
test('runner rejects an empty selection and an empty test file', async () => {
  await fixture('',async f=>{
    assert.notEqual(await runSuite([],{cwd:f.directory,loader:null,stdout:f.capture,stderr:f.capture}),0);
    assert.notEqual(await runSuite([f.file],{cwd:f.directory,loader:null,stdout:f.capture,stderr:f.capture}),0);
    assert.match(f.output(),/no_test_ran/);
  });
});
test('discovery selects colocated spec files deterministically without following directory links',async()=>{
  await fixture('',async f=>{
    await writeFile(path.join(f.directory,'helper.ts'),'');
    await writeFile(path.join(f.directory,'second.spec.ts'),'');
    const result=await discoverTests([f.directory,path.join(f.directory,'missing')]);
    assert.deepEqual(result,[f.file,path.join(f.directory,'second.spec.ts')]);
  });
});
test('discovery does not traverse a directory junction outside the selected source',async()=>{
  await fixture('',async f=>{
    const selected=path.join(f.directory,'selected'); await mkdir(selected);
    await symlink(f.directory,path.join(selected,'external'),'junction');
    assert.deepEqual(await discoverTests([selected]),[]);
  });
});
