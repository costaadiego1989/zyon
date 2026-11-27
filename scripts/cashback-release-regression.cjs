const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),candidate='C:/tmp/zyon-cashback-release-20261114';
const evidence=path.join(root,'.specs/features/cashback-release/evidence');
const priorFiles=JSON.parse(fs.readFileSync(path.join(evidence,'original-cashback-suite-final-files.json'),'utf8'));
const moduleRoot='apps/api/src/modules';
const walk=p=>fs.readdirSync(path.join(candidate,p),{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(p+'/'+d.name):[p+'/'+d.name]);
const expected=[...new Set([...walk(moduleRoot).filter(p=>p.endsWith('.spec.ts')&&p.includes('cashback')),
 ...['coupons/application/use-cases/apply-coupon.use-case.spec.ts','checkout/__tests__/apply-offer.use-case.spec.ts',
 'checkout/__tests__/track-checkout-event.use-case.spec.ts','checkout/application/use-cases/update-cart.use-case.spec.ts',
 'checkout/application/services/checkout-offer.service.spec.ts','buyer-account/application/use-cases/link-buyer-whatsapp.spec.ts',
 'whatsapp-channel/application/services/whatsapp-checkout-benefits.spec.ts'].map(p=>moduleRoot+'/'+p)])].sort();
if(priorFiles.some(p=>!expected.includes(p)))throw Error('original_suite_file_missing');
const files=expected;
fs.writeFileSync(path.join(evidence,'original-cashback-definitive-files.json'),JSON.stringify(files,null,2)+'\n');
const hashes=()=>Object.fromEntries(files.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(candidate,p))).digest('hex')]));
const before=hashes();
const args=['--loader','./apps/api/tests/ready-prod-loader.mjs','--test','--test-concurrency=2',...files];
const run=spawnSync(process.execPath,args,{cwd:candidate,encoding:'utf8',timeout:900000,maxBuffer:16*1024*1024,
 env:{...process.env,NODE_OPTIONS:'--max-old-space-size=2048'}});
const output=(run.stdout??'')+(run.stderr??'');
fs.writeFileSync(path.join(evidence,'original-cashback-definitive.log'),output);
const summary=output.split('\n').filter(l=>/^# (tests|pass|fail|cancelled|skipped|duration_ms)|^not ok/.test(l));
const report={completedAt:new Date().toISOString(),files:files.length,concurrency:2,timeoutMs:900000,
 processDeadlineReason:'Bounded-memory file concurrency2; only the outer process deadline scales. Individual test, SQL transaction and assertion deadlines remain unchanged.',
 allOriginalFiles:true,addedFeatureTestFiles:files.filter(p=>!priorFiles.includes(p)),sourceTestsUnchanged:JSON.stringify(before)===JSON.stringify(hashes()),
 exitCode:run.status,errorCode:run.error?.code,summary};
fs.writeFileSync(path.join(evidence,'original-cashback-definitive.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));process.exitCode=run.status??1;
