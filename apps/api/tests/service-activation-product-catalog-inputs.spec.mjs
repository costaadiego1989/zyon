import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync,unlinkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,relative} from 'node:path';
import {assertActivationProofSourceInputs,measureActivationProofSourceInputs} from './service-activation-release-producer.mjs';

// Filesystem-only producer contract. No application, release fixture or test
// source is replaced. Every mutation is confined to a newly owned temp tree.
// Static FS prerequisites only; no commercial/result/state fixture.
const compositionCommonPaths=['apps/dashboard/playwright.service-overview-local.config.ts',
'apps/dashboard/playwright.service-policy-local.config.ts',
'apps/dashboard/playwright.service-appointments-board.config.ts',
'apps/dashboard/playwright.service-availability-local.config.ts',
'apps/dashboard/playwright.product-cart-journey.storefront.config.ts',
  'apps/dashboard/playwright.product-cart-journey.whatsapp.config.ts',
  'apps/dashboard/playwright.product-catalog-read.storefront.config.ts',
  'apps/dashboard/playwright.product-catalog-read.whatsapp.config.ts',
  'apps/dashboard/playwright.product-contact-delivery.storefront.config.ts',
  'apps/dashboard/playwright.product-contact-delivery.whatsapp.config.ts',
  'apps/dashboard/playwright.product-discovery-read.storefront.config.ts',
  'apps/dashboard/playwright.product-discovery-read.whatsapp.config.ts',
  'apps/dashboard/playwright.product-payment.storefront.config.ts',
  'apps/dashboard/playwright.product-payment.whatsapp.config.ts',
  'apps/dashboard/playwright.product-payment-duplex.storefront.config.ts',
  'apps/dashboard/playwright.product-payment-duplex.whatsapp.config.ts',
  'apps/dashboard/playwright.product-search-read.storefront.config.ts',
  'apps/dashboard/playwright.product-search-read.whatsapp.config.ts',
  'apps/dashboard/playwright.service-buyer-storefront.config.ts',
  'apps/dashboard/playwright.service-buyer-whatsapp.config.ts',
  'apps/api/src/modules/storefront/application/services/read-post-add-cart-suggestions.ts',
  'apps/api/src/modules/whatsapp-channel/infrastructure/adapters/checkout-whatsapp-conversation.adapter.ts',
  'apps/storefront/src/lib/post-cart-suggestions.ts',
  'apps/storefront/vitest.config.mjs','apps/storefront/package.json','apps/storefront/tsconfig.json','apps/dashboard/src/lib/auth/permissions.ts','apps/storefront/src/lib/storefront-cross-sell-operation-owner.spec.tsx'];
const selected=[
  'apps/dashboard/e2e-product-catalog/product-catalog-read.storefront.spec.ts',
  'apps/dashboard/e2e-product-catalog/product-catalog-read.whatsapp.spec.ts',
];
const helper='apps/dashboard/e2e-product-catalog/product-catalog-read-helpers.ts';
const nextConfig='apps/dashboard/playwright.product-catalog-read.storefront.config.ts';
const whatsappConfig='apps/dashboard/playwright.product-catalog-read.whatsapp.config.ts';
const prior=['apps/api/tests/prior-fixture.mjs','apps/dashboard/e2e/prior-helper.ts','apps/dashboard/playwright.service-local.config.ts'];
function fixture(run){
  const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'zyon-activation-catalog-'));
  const owned=relative(parent,root);
  assert.equal(dirname(root),parent);assert.match(owned,/^zyon-activation-catalog-[A-Za-z0-9_-]+$/);
  try{
    for(const path of [...selected,helper,nextConfig,whatsappConfig,...prior]){
      const file=resolve(root,path);assert.ok(relative(root,file)&&!relative(root,file).startsWith('..'));
      mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'// owned source '+path+'\n');
    }
    for(const path of compositionCommonPaths){
      const file=resolve(root,path);assert.ok(relative(root,file)&&!relative(root,file).startsWith('..'));
      if(!existsSync(file)){mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'// owned static common input '+path+'\n');}
    }
    return run(root);
  }finally{
    assert.equal(dirname(root),parent);assert.match(relative(parent,root),/^zyon-activation-catalog-[A-Za-z0-9_-]+$/);
    rmSync(root,{recursive:true,force:true});
  }
}
const receipt=current=>({proofSourceInputSha256:current.inputSha256,proofInputFiles:structuredClone(current.files)});
function assertMutationBound(root,path){
  const before=measureActivationProofSourceInputs(root,selected),reported=receipt(before),file=resolve(root,path),original=readFileSync(file);
  try{
    writeFileSync(file,Buffer.concat([original,Buffer.from('// owned mutation\n')]));
    const after=measureActivationProofSourceInputs(root,selected);
    assert.notEqual(after.inputSha256,before.inputSha256);
    assert.deepEqual(after.files,before.files); // selected spec bytes did not change
    assert.throws(()=>assertActivationProofSourceInputs(reported,after),/activation_proof_source_changed/);
  }finally{writeFileSync(file,original);}
  assert.deepEqual(measureActivationProofSourceInputs(root,selected),before);
}

test('S1 proof inputs retain the exact selected whole-spec inventory',()=>fixture(root=>{
  const current=measureActivationProofSourceInputs(root,selected);
  assert.deepEqual(current.files.map(value=>value.path),selected);
  assert.doesNotThrow(()=>assertActivationProofSourceInputs(receipt(current),current));
}));
test('S1 helper mutation invalidates a receipt with unchanged selected specs',()=>fixture(root=>assertMutationBound(root,helper)));
test('S1 actual Next config mutation invalidates a receipt with unchanged selected specs',()=>fixture(root=>assertMutationBound(root,nextConfig)));
test('S1 actual signed-WA viewer config mutation invalidates a receipt with unchanged selected specs',()=>fixture(root=>assertMutationBound(root,whatsappConfig)));
test('S1 input extension retains both prior common trees and the prior config',()=>fixture(root=>{
  for(const path of prior)assertMutationBound(root,path);
}));
test('S1 required spec mutation still fails the exact file-byte check',()=>fixture(root=>{
  const before=measureActivationProofSourceInputs(root,selected),file=resolve(root,selected[0]),original=readFileSync(file);
  try{
    writeFileSync(file,Buffer.concat([original,Buffer.from('// owned spec mutation\n')]));
    const after=measureActivationProofSourceInputs(root,selected);
    // Isolate the selected-file proof as well as the common-tree proof.
    assert.throws(()=>assertActivationProofSourceInputs({...receipt(before),proofSourceInputSha256:after.inputSha256},after),/activation_proof_file_changed/);
  }finally{writeFileSync(file,original);}
  assert.deepEqual(measureActivationProofSourceInputs(root,selected),before);
}));
test('S1 missing helper invalidates a prior receipt instead of preserving its tree digest',()=>fixture(root=>{
  const before=measureActivationProofSourceInputs(root,selected),file=resolve(root,helper),original=readFileSync(file);
  try{
    unlinkSync(file);
    const after=measureActivationProofSourceInputs(root,selected);
    assert.deepEqual(after.files,before.files);assert.notEqual(after.inputSha256,before.inputSha256);
    assert.throws(()=>assertActivationProofSourceInputs(receipt(before),after),/activation_proof_source_changed/);
  }finally{writeFileSync(file,original);}
  assert.deepEqual(measureActivationProofSourceInputs(root,selected),before);
}));
test('S1 either missing required config fails measurement rather than being silently omitted',()=>fixture(root=>{
  const before=measureActivationProofSourceInputs(root,selected);
  for(const path of [nextConfig,whatsappConfig]){
    const file=resolve(root,path),original=readFileSync(file);
    try{unlinkSync(file);assert.throws(()=>measureActivationProofSourceInputs(root,selected),{code:'ENOENT'});}
    finally{writeFileSync(file,original);}
    assert.deepEqual(measureActivationProofSourceInputs(root,selected),before);
  }
}));
test('S1 additional browser tree retains the existing symlink refusal',()=>fixture(root=>{
  const target=resolve(root,'owned-link-target'),link=resolve(root,'apps/dashboard/e2e-product-catalog/owned-junction');
  for(const path of [target,link])assert.ok(relative(root,path)&&!relative(root,path).startsWith('..'));
  mkdirSync(target);writeFileSync(join(target,'owned.ts'),'// own target\n');
  // A directory junction is supported on Windows without a file-symlink grant.
  // Target and link are both within this newly owned temporary fixture only.
  symlinkSync(target,link,'junction');
  assert.throws(()=>measureActivationProofSourceInputs(root,selected),/activation_frontend_symlink/);
}));