import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
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

test('productive module worker changes cannot reuse the checked input fingerprint',async()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'zyon-service-worker-inputs-'));
  const write=(path,value)=>{const file=resolve(directory,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,value);};
  try{
    const api='apps/api/';
    for(const path of ['package.json','tsconfig.base.json',api+'package.json',api+'tsconfig.json',api+'tsconfig.build.json',api+'nest-cli.json'])write(path,'{}');
    for(const path of ['pnpm-lock.yaml',api+'prisma.config.ts',api+'prisma/schema.prisma',api+'prisma.company-directory.config.ts',api+'prisma/company-directory.prisma'])write(path,'// isolated fingerprint fixture');
    mkdirSync(resolve(directory,'packages'));
    const helper=api+'tests/service-test-artifacts.mjs';
    write(helper,readFileSync(new URL('./service-test-artifacts.mjs',import.meta.url),'utf8'));
    const {serviceBuildInputs}=await import(pathToFileURL(resolve(directory,helper)).href);
    for(const suffix of ['js','jsx','mjs','cjs']){
      const path=api+'src/worker.'+suffix;write(path,'// original worker');
      const before=serviceBuildInputs();write(path,'// changed worker');
      assert.notEqual(serviceBuildInputs(),before,suffix+' worker changes must invalidate the checked inputs');
    }
    for(const path of [api+'prisma.config.ts',api+'prisma/schema.prisma',api+'prisma.company-directory.config.ts',api+'prisma/company-directory.prisma']){
      const before=serviceBuildInputs();write(path,'// changed generator input '+path);
      assert.notEqual(serviceBuildInputs(),before,path+' changes must invalidate the checked inputs');
    }
  }finally{
    assert.equal(dirname(directory),resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('zyon-service-worker-inputs-'));
    rmSync(directory,{recursive:true});
  }
});
