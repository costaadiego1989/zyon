import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,relative} from 'node:path';
import {assertActivationProofSourceInputs,measureActivationProofSourceInputs,measureProofSourceInputs} from './service-activation-release-producer.mjs';

const config='apps/dashboard/playwright.service-availability-local.config.ts';
const setup='apps/dashboard/e2e/service-availability-setup.mjs';
const selected=['apps/dashboard/e2e/service-availability.spec.ts','apps/dashboard/e2e/service-fixed-time-zone.spec.ts','apps/dashboard/e2e/service-catalog-business-mode.spec.ts','apps/dashboard/e2e/service-catalog-toggles.spec.ts','apps/dashboard/e2e/service-catalog-professionals.spec.ts','apps/dashboard/e2e/service-attendance-shell.spec.ts'];
const priorConfigs=[
 'apps/dashboard/playwright.service-appointments-board.config.ts',
 'apps/dashboard/playwright.service-local.config.ts','apps/dashboard/playwright.service-overview-local.config.ts','apps/dashboard/playwright.service-policy-local.config.ts',
 'apps/dashboard/playwright.product-cart-journey.storefront.config.ts','apps/dashboard/playwright.product-cart-journey.whatsapp.config.ts',
 'apps/dashboard/playwright.product-catalog-read.storefront.config.ts','apps/dashboard/playwright.product-catalog-read.whatsapp.config.ts',
 'apps/dashboard/playwright.product-contact-delivery.storefront.config.ts','apps/dashboard/playwright.product-contact-delivery.whatsapp.config.ts',
 'apps/dashboard/playwright.product-discovery-read.storefront.config.ts','apps/dashboard/playwright.product-discovery-read.whatsapp.config.ts',
 'apps/dashboard/playwright.product-payment.storefront.config.ts','apps/dashboard/playwright.product-payment.whatsapp.config.ts',
 'apps/dashboard/playwright.product-payment-duplex.storefront.config.ts','apps/dashboard/playwright.product-payment-duplex.whatsapp.config.ts',
 'apps/dashboard/playwright.product-search-read.storefront.config.ts','apps/dashboard/playwright.product-search-read.whatsapp.config.ts',
 'apps/dashboard/playwright.service-buyer-storefront.config.ts','apps/dashboard/playwright.service-buyer-whatsapp.config.ts',
];
const priorSources=['apps/api/tests/owned-prior-fixture.mjs','apps/dashboard/e2e-product-catalog/owned-prior-helper.ts',
 'apps/api/src/modules/storefront/application/services/read-post-add-cart-suggestions.ts',
 'apps/api/src/modules/whatsapp-channel/infrastructure/adapters/checkout-whatsapp-conversation.adapter.ts',
 'apps/storefront/src/lib/post-cart-suggestions.ts','apps/storefront/vitest.config.mjs','apps/storefront/package.json','apps/storefront/tsconfig.json','apps/dashboard/src/lib/auth/permissions.ts','apps/storefront/src/lib/storefront-cross-sell-operation-owner.spec.tsx'];
function fixture(run){
 const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'zyon-availability-binding-'));
 assert.equal(dirname(root),parent);assert.match(relative(parent,root),/^zyon-availability-binding-[A-Za-z0-9_-]+$/);
 try{
  for(const path of [config,setup,...selected,...priorConfigs,...priorSources]){
   const file=resolve(root,path);assert.ok(relative(root,file)&&!relative(root,file).startsWith('..'));
   mkdirSync(dirname(file),{recursive:true});if(!existsSync(file))writeFileSync(file,'// owned static source '+path+'\n');
  }
  return run(root);
 }finally{
  assert.equal(dirname(root),parent);assert.match(relative(parent,root),/^zyon-availability-binding-[A-Za-z0-9_-]+$/);rmSync(root,{recursive:true,force:true});
 }
}
const measure=root=>measureActivationProofSourceInputs(root,selected);
const receipt=value=>({proofSourceInputSha256:value.inputSha256,proofInputFiles:structuredClone(value.files)});
function mutation(root,path){
 const before=measure(root),file=resolve(root,path),bytes=readFileSync(file),reported=receipt(before);
 try{
  writeFileSync(file,Buffer.concat([bytes,Buffer.from('// changed owned source\n')]));
  const after=measure(root);assert.deepEqual(after.files,before.files);assert.notEqual(after.inputSha256,before.inputSha256);
  assert.throws(()=>assertActivationProofSourceInputs(reported,after),/activation_proof_source_changed/);
 }finally{writeFileSync(file,bytes);}
 assert.deepEqual(measure(root),before);
}
test('T94 actual availability browser config is a required source input',async t=>{
 await t.test('keeps the real selected six-file inventory and fixed productive facade',()=>fixture(root=>{
  const current=measure(root);assert.deepEqual(current.files.map(value=>value.path),selected);assert.equal(measureProofSourceInputs.length,1);
  assert.doesNotThrow(()=>assertActivationProofSourceInputs(receipt(current),current));
 }));
 await t.test('availability config byte mutation rejects an earlier receipt although the selected files are unchanged',()=>fixture(root=>mutation(root,config)));
 await t.test('missing availability config fails measurement instead of silently preserving a receipt',()=>fixture(root=>{
  const before=measure(root),file=resolve(root,config),bytes=readFileSync(file);
  try{unlinkSync(file);assert.throws(()=>measure(root),{code:'ENOENT'});}finally{writeFileSync(file,bytes);}
  assert.deepEqual(measure(root),before);
 }));
 await t.test('actual availability setup stays inside the existing e2e tree binding',()=>fixture(root=>mutation(root,setup)));
});
