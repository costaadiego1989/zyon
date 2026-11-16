import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const apiRoot=fileURLToPath(new URL('../',import.meta.url));
export async function discoverTests(roots) {
  const files=[];
  async function visit(directory) {
    let entries;
    try {entries=await readdir(directory,{withFileTypes:true});}
    catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile()&&/\.spec\.(?:ts|mjs)$/.test(entry.name))files.push(path.resolve(file));
    }
  }
  for(const root of roots)await visit(root);
  return [...new Set(files)].sort();
}

export async function runSuite(files,{cwd=apiRoot,loader=path.join(apiRoot,'tests/ready-prod-loader.mjs'),stdout=process.stdout,stderr=process.stderr}={}) {
  if(!files.length){stderr.write('agentic_runner_no_test_ran\n');return 1;}
  const loaderUrl=loader?(loader.startsWith('file:')?loader:pathToFileURL(path.resolve(loader)).href):null;
  const args=[...(loaderUrl?['--loader',loaderUrl]:[]),'--test-reporter=tap','--test','--test-concurrency=1',...files];
  return new Promise(resolve=>{
    const env={...process.env};
    // A runner invoked by its own contract test must start an independent harness.
    delete env.NODE_TEST_CONTEXT;
    const child=spawn(process.execPath,args,{cwd,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    let tail='';let completed=false;
    const finish=code=>{if(!completed){completed=true;resolve(code);}};
    child.stdout.on('data',chunk=>{stdout.write(chunk);tail=(tail+String(chunk)).slice(-65536);});
    child.stderr.on('data',chunk=>stderr.write(chunk));
    child.once('error',()=>{stderr.write('agentic_runner_spawn_failed\n');finish(1);});
    child.once('close',code=>{
      if(code!==0){finish(code??1);return;}
      const count=Number([...tail.matchAll(/^# tests (\d+)\s*$/gm)].at(-1)?.[1]??0);
      const filenames=new Set(files.flatMap(file=>[path.normalize(file),path.relative(cwd,file),path.basename(file)]));
      const namedCase=[...tail.matchAll(/^# Subtest: (.+)\r?$/gm)].some(match=>!filenames.has(path.normalize(match[1].trim())));
      if(!count||!namedCase){stderr.write('agentic_runner_no_test_ran\n');finish(1);return;}
      finish(0);
    });
  });
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  if(process.argv.length>2)throw new Error('agentic_runner_unexpected_argument');
  const files=await discoverTests(['merchant-assistant','meta-ads-agent'].map(module=>path.join(apiRoot,'src/modules',module)));
  process.exitCode=await runSuite(files);
}
