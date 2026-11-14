import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,basename} from 'node:path';
import {productionCompilationFiles,assertProductionCoverage} from './service-test-artifacts.mjs';

test('production fingerprint includes excluded files actually imported by the compiler',()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'zyon-service-inputs-'));
  try{
    mkdirSync(resolve(directory,'src'));
    writeFileSync(resolve(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{noLib:true},include:['src'],exclude:['**/*.spec.ts']}));
    writeFileSync(resolve(directory,'src/main.ts'),"import './imported.spec.js'; export const value=1;");
    writeFileSync(resolve(directory,'src/imported.spec.ts'),'export const imported=1;');
    writeFileSync(resolve(directory,'src/unused.spec.ts'),'export const unused=1;');
    const files=productionCompilationFiles(resolve(directory,'tsconfig.json'));
    assert.ok(files.includes(resolve(directory,'src/main.ts')));
    assert.ok(files.includes(resolve(directory,'src/imported.spec.ts')));
    assert.equal(files.includes(resolve(directory,'src/unused.spec.ts')),false);
    assert.deepEqual(assertProductionCoverage(files,[resolve(directory,'src/main.ts'),resolve(directory,'src/imported.spec.ts')]),
      {checked:true,sourceCount:2});
    assert.throws(()=>assertProductionCoverage(files,[resolve(directory,'src/main.ts')]),/service_compiler_source_outside_fingerprint/);
  }finally{
    assert.equal(dirname(directory),resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('zyon-service-inputs-'));
    rmSync(directory,{recursive:true});
  }
});
