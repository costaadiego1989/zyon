import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync,unlinkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,relative} from 'node:path';
import * as producer from './service-activation-release-producer.mjs';

// Real filesystem mutations only, scoped to one newly owned temp tree.
// This static superset also permits the unchanged C60 measurement roots/configs;
// it supplies no application, identity, commercial result or release receipt.
const newConfigs=['apps/dashboard/playwright.service-overview-local.config.ts','apps/dashboard/playwright.service-policy-local.config.ts'];
const setup='apps/dashboard/e2e/service-overview-setup.ts';
const selected=['apps/dashboard/e2e/service-overview-journeys.spec.ts','apps/dashboard/e2e/service-appointment-policy.spec.ts'];
const prior=['apps/api/tests/owned-prior-fixture.mjs','apps/dashboard/e2e/owned-prior-helper.ts','apps/dashboard/playwright.service-local.config.ts'];
const c60StaticInputs=[
 'apps/dashboard/playwright.service-availability-local.config.ts',
  'apps/dashboard/playwright.service-appointments-board.config.ts',
 'apps/dashboard/playwright.product-cart-journey.storefront.config.ts','apps/dashboard/playwright.product-cart-journey.whatsapp.config.ts',
 'apps/dashboard/playwright.product-catalog-read.storefront.config.ts','apps/dashboard/playwright.product-catalog-read.whatsapp.config.ts',
 'apps/dashboard/playwright.product-contact-delivery.storefront.config.ts','apps/dashboard/playwright.product-contact-delivery.whatsapp.config.ts',
 'apps/dashboard/playwright.product-discovery-read.storefront.config.ts','apps/dashboard/playwright.product-discovery-read.whatsapp.config.ts',
 'apps/dashboard/playwright.product-payment.storefront.config.ts','apps/dashboard/playwright.product-payment.whatsapp.config.ts',
 'apps/dashboard/playwright.product-payment-duplex.storefront.config.ts','apps/dashboard/playwright.product-payment-duplex.whatsapp.config.ts',
 'apps/dashboard/playwright.product-search-read.storefront.config.ts','apps/dashboard/playwright.product-search-read.whatsapp.config.ts',
 'apps/dashboard/playwright.service-buyer-storefront.config.ts','apps/dashboard/playwright.service-buyer-whatsapp.config.ts',
 'apps/dashboard/e2e-product-catalog/owned-prior-helper.ts',
 'apps/api/src/modules/storefront/application/services/read-post-add-cart-suggestions.ts',
 'apps/api/src/modules/whatsapp-channel/infrastructure/adapters/checkout-whatsapp-conversation.adapter.ts',
 'apps/storefront/src/lib/post-cart-suggestions.ts','apps/storefront/vitest.config.mjs','apps/storefront/package.json','apps/storefront/tsconfig.json','apps/dashboard/src/lib/auth/permissions.ts','apps/storefront/src/lib/storefront-cross-sell-operation-owner.spec.tsx',
];
function withOwnedTree(run){
 const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'zyon-metrics-policy-bind-'));
 assert.equal(dirname(root),parent);assert.match(relative(parent,root),/^zyon-metrics-policy-bind-[A-Za-z0-9_-]+$/);
 try{
  for(const path of [...selected,setup,...newConfigs,...prior,...c60StaticInputs]){
   const file=resolve(root,path);assert.ok(relative(root,file)&&!relative(root,file).startsWith('..'));
   mkdirSync(dirname(file),{recursive:true});if(!existsSync(file))writeFileSync(file,'// owned static source '+path+'\n');
  }
  return run(root);
 }finally{
  assert.equal(dirname(root),parent);assert.match(relative(parent,root),/^zyon-metrics-policy-bind-[A-Za-z0-9_-]+$/);
  rmSync(root,{recursive:true,force:true});
 }
}
function measure(root){
 // An additive export is a test seam; the productive facade still accepts only
 // its original selected-file argument and fixes the actual repository root.
 assert.equal(typeof producer.measureActivationProofSourceInputs,'function','actual_fs_measurement_helper_required');
 assert.equal(producer.measureProofSourceInputs.length,1);
 return producer.measureActivationProofSourceInputs(root,selected);
}
const receipt=value=>({proofSourceInputSha256:value.inputSha256,proofInputFiles:structuredClone(value.files)});
function mutate(root,path){
 const before=measure(root),reported=receipt(before),file=resolve(root,path),bytes=readFileSync(file);
 try{
  writeFileSync(file,Buffer.concat([bytes,Buffer.from('// owned source mutation\n')]));
  const after=measure(root);assert.notEqual(after.inputSha256,before.inputSha256);
  assert.deepEqual(after.files,before.files);
  assert.throws(()=>producer.assertActivationProofSourceInputs(reported,after),/activation_proof_source_changed/);
 }finally{writeFileSync(file,bytes);}
 assert.deepEqual(measure(root),before);
}

test('T94 overview and policy configs are actual bound source inputs',async t=>{
 await t.test('retains exact selected whole-spec inventory and fixed-repo facade',()=>withOwnedTree(root=>{
  const value=measure(root);assert.deepEqual(value.files.map(row=>row.path),selected);
  assert.doesNotThrow(()=>producer.assertActivationProofSourceInputs(receipt(value),value));
 }));
 for(const path of newConfigs)await t.test('mutating '+path+' invalidates a prior receipt with unchanged selected specs',()=>withOwnedTree(root=>mutate(root,path)));
 await t.test('the actual overview setup source mutation also invalidates the prior receipt',()=>withOwnedTree(root=>mutate(root,setup)));
 await t.test('original two common trees and original base config remain bound',()=>withOwnedTree(root=>{for(const path of prior)mutate(root,path);}));
 await t.test('selected spec bytes still fail their exact file check even with rebased common digest',()=>withOwnedTree(root=>{
  const before=measure(root),file=resolve(root,selected[0]),bytes=readFileSync(file);
  try{writeFileSync(file,Buffer.concat([bytes,Buffer.from('// changed selected spec\n')]));
   const after=measure(root);assert.throws(()=>producer.assertActivationProofSourceInputs({...receipt(before),proofSourceInputSha256:after.inputSha256},after),/activation_proof_file_changed/);
  }finally{writeFileSync(file,bytes);}
  assert.deepEqual(measure(root),before);
 }));
 await t.test('either missing required new config fails measurement rather than silently disappearing',()=>withOwnedTree(root=>{
  const before=measure(root);for(const path of newConfigs){
   const file=resolve(root,path),bytes=readFileSync(file);try{unlinkSync(file);assert.throws(()=>measure(root),{code:'ENOENT'});}finally{writeFileSync(file,bytes);}
   assert.deepEqual(measure(root),before);
  }
 }));
 await t.test('missing overview setup changes the tree digest instead of preserving a prior receipt',()=>withOwnedTree(root=>{
  const before=measure(root),file=resolve(root,setup),bytes=readFileSync(file);
  try{unlinkSync(file);const after=measure(root);assert.deepEqual(after.files,before.files);
   assert.notEqual(after.inputSha256,before.inputSha256);assert.throws(()=>producer.assertActivationProofSourceInputs(receipt(before),after),/activation_proof_source_changed/);
  }finally{writeFileSync(file,bytes);}
  assert.deepEqual(measure(root),before);
 }));
 await t.test('newly used e2e tree retains existing symlink refusal',()=>withOwnedTree(root=>{
  const target=resolve(root,'owned-target'),link=resolve(root,'apps/dashboard/e2e/owned-junction');
  for(const path of [target,link])assert.ok(relative(root,path)&&!relative(root,path).startsWith('..'));
  mkdirSync(target);writeFileSync(join(target,'owned.ts'),'// owned target\n');symlinkSync(target,link,'junction');
  assert.throws(()=>measure(root),/activation_frontend_symlink/);
 }));
});
