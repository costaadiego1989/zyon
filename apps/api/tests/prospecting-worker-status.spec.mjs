import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {writeWorkerStatus}=require('../scripts/prospecting-retail-status-file.cjs');
function removeOwned(folder){
 assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));
 assert.ok(path.basename(folder).startsWith('zyon-worker-status-'));
 fs.rmSync(folder,{recursive:true,force:true});
}

test('PRG-02 transient status rename locks retain readable progress and the next update succeeds',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'zyon-worker-status-'));
 try{
  fs.writeFileSync(path.join(folder,'status.json'),JSON.stringify({committedRecords:500}));
  for(const code of ['EPERM','EBUSY','EACCES']){
   assert.equal(writeWorkerStatus(folder,{committedRecords:1000},{...fs,renameSync(){throw Object.assign(new Error('temporary lock'),{code});}}),false);
   assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'status.json'),'utf8')),{committedRecords:500});
  }
  assert.equal(writeWorkerStatus(folder,{committedRecords:1500}),true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'status.json'),'utf8')),{committedRecords:1500});
 }finally{removeOwned(folder);}
});

test('PRG-02 transient status write locks retry while disk failures remain visible',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'zyon-worker-status-'));
 try{
  fs.writeFileSync(path.join(folder,'status.json'),JSON.stringify({phase:'persisting_establishments'}));
  assert.equal(writeWorkerStatus(folder,{phase:'completed'},{...fs,writeFileSync(){throw Object.assign(new Error('temporary lock'),{code:'EBUSY'});}}),false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'status.json'),'utf8')),{phase:'persisting_establishments'});
  assert.throws(()=>writeWorkerStatus(folder,{phase:'completed'},{...fs,writeFileSync(){throw Object.assign(new Error('disk full'),{code:'ENOSPC'});}}),{code:'ENOSPC'});
  assert.equal(writeWorkerStatus(folder,{phase:'completed'}),true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'status.json'),'utf8')),{phase:'completed'});
 }finally{removeOwned(folder);}
});
