import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const api=fileURLToPath(new URL('../',import.meta.url));
const ts=createRequire(import.meta.url)('typescript');
const evidence='C:/Users/Admin/Desktop/AACP/.specs/features/cashback-release/evidence';
const mode=process.argv[2];
if(!['before','after'].includes(mode))throw Error('explicit_before_or_after_required');
const config=ts.readConfigFile(path.join(api,'tsconfig.build.json'),ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,api);
const inputs=[...parsed.fileNames,'prisma/schema.prisma','prisma/seeds/cashback-validation-seed.ts','prisma/seeds/cashback-validation-guard.ts','prisma/seeds/cashback-validation-build.mjs'];
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const rows=inputs.map(input=>{
  const file=path.resolve(api,input);
  return{path:path.relative(api,file).split(path.sep).join('/'),sha256:sha(fs.readFileSync(file))};
}).sort((a,b)=>a.path.localeCompare(b.path));
fs.writeFileSync(path.join(evidence,`candidate-final-source-${mode}.json`),JSON.stringify(rows,null,2)+'\n');
if(mode==='after'){
  const before=JSON.parse(fs.readFileSync(path.join(evidence,'candidate-final-source-before.json'),'utf8'));
  if(JSON.stringify(before)!==JSON.stringify(rows))throw Error('source_changed_during_final_build');
  const artifacts=[];
  for(const row of rows){
    if(!row.path.startsWith('src/')||row.path.endsWith('.d.ts'))continue;
    const output='dist/'+row.path.slice(4).replace(/\.ts$/,'.js');
    if(!fs.existsSync(path.join(api,output)))throw Error('compiled_output_missing:'+row.path);
    artifacts.push({source:row.path,sourceSha256:row.sha256,artifact:output,artifactSha256:sha(fs.readFileSync(path.join(api,output)))});
  }
  for(const name of['cashback-validation-seed','cashback-validation-guard']){
    const file=`dist/seeds/${name}.js`;artifacts.push({source:`prisma/seeds/${name}.ts`,artifact:file,artifactSha256:sha(fs.readFileSync(path.join(api,file)))});
  }
  fs.writeFileSync(path.join(evidence,'candidate-final-built-affinity.json'),JSON.stringify({sourceStableDuringBuild:true,sourceFiles:rows.length,sourceBundleSha256:sha(JSON.stringify(rows)),artifacts},null,2)+'\n');
}
console.log(JSON.stringify({mode,productionInputs:rows.length,sourceStable:mode==='after'}));
