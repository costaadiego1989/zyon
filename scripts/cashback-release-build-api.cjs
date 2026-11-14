const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const candidate='C:/tmp/zyon-cashback-release-20261114';
const evidence=path.join(root,'.specs/features/cashback-release/evidence');
const pnpm=path.join(process.env.APPDATA,'npm/node_modules/pnpm/bin/pnpm.cjs');
const inputs=()=>{
 const run=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:candidate});
 if(run.status!==0)throw Error('candidate_git_inventory_failed');
 return Object.fromEntries([...new Set(run.stdout.toString().split('\0').filter(Boolean))].filter(p=>
  p.startsWith('apps/api/')||p.startsWith('packages/')||['package.json','pnpm-lock.yaml','tsconfig.base.json'].includes(p))
  .sort().map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(candidate,p))).digest('hex')]));
};
const before=inputs();
const steps=[
 ['production', [pnpm,'--filter','@zyon/api','exec','tsc','-p','tsconfig.build.json','--pretty','false']],
 ['seed',[path.join(candidate,'apps/api/prisma/seeds/cashback-validation-build.mjs')]],
 ['all-types',[pnpm,'--filter','@zyon/api','exec','tsc','-p','tsconfig.json','--noEmit','--pretty','false']],
];
const results=[];
for(const [name,args]of steps){
 const run=spawnSync(process.execPath,args,{cwd:candidate,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=4096'},
   encoding:'utf8',windowsHide:true,timeout:300000,maxBuffer:16*1024*1024});
 fs.writeFileSync(path.join(evidence,`candidate-api-${name}-definitive.log`),(run.stdout??'')+(run.stderr??''));
 results.push({name,exitCode:run.status,errorCode:run.error?.code});
 console.log(JSON.stringify({step:name,exitCode:run.status,errorCode:run.error?.code}));
 if(run.status!==0)break;
}
const after=inputs(),unchanged=JSON.stringify(before)===JSON.stringify(after);
const report={completedAt:new Date().toISOString(),candidate,results,inputFiles:Object.keys(before).length,
  inputSha256:crypto.createHash('sha256').update(JSON.stringify(before)).digest('hex'),inputsUnchanged:unchanged,
  success:results.length===3&&results.every(r=>r.exitCode===0)&&unchanged};
fs.writeFileSync(path.join(evidence,'candidate-api-definitive-build.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(evidence,'candidate-api-definitive-inputs.json'),JSON.stringify(before,null,2)+'\n');
console.log(JSON.stringify(report));process.exitCode=report.success?0:1;
