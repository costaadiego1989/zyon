import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,relative} from 'node:path';
import {measureActivationProofSourceInputs,assertActivationProofSourceInputs} from './service-activation-release-producer.mjs';
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
const selected=['apps/dashboard/e2e-product-catalog/product-search-read.storefront.spec.ts','apps/dashboard/e2e-product-catalog/product-search-read.whatsapp.spec.ts'];
const helper='apps/dashboard/e2e-product-catalog/product-search-read-helpers.ts';
const configs=['apps/dashboard/playwright.product-search-read.storefront.config.ts','apps/dashboard/playwright.product-search-read.whatsapp.config.ts'];
function fixture(run){
  const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'zyon-search-proof-'));
  assert.equal(dirname(root),parent);assert.match(relative(parent,root),/^zyon-search-proof-[A-Za-z0-9_-]+$/);
  try{
    const paths=[...selected,helper,...configs,'apps/api/tests/owned-helper.mjs','apps/dashboard/e2e/owned-prior.ts',
      'apps/dashboard/playwright.service-local.config.ts','apps/dashboard/playwright.product-catalog-read.storefront.config.ts','apps/dashboard/playwright.product-catalog-read.whatsapp.config.ts'];
    for(const path of paths){const file=resolve(root,path);assert.ok(relative(root,file)&&!relative(root,file).startsWith('..'));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'// owned '+path+'\n');}
    for(const path of compositionCommonPaths){
      const file=resolve(root,path);assert.ok(relative(root,file)&&!relative(root,file).startsWith('..'));
      if(!existsSync(file)){mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'// owned static common input '+path+'\n');}
    }
    return run(root);
  }finally{assert.equal(dirname(root),parent);assert.match(relative(parent,root),/^zyon-search-proof-[A-Za-z0-9_-]+$/);rmSync(root,{recursive:true,force:true});}
}
function mutation(root,path){
  const before=measureActivationProofSourceInputs(root,selected),file=resolve(root,path),bytes=readFileSync(file);
  try{
    writeFileSync(file,Buffer.concat([bytes,Buffer.from('// own mutation\n')]));const after=measureActivationProofSourceInputs(root,selected);
    assert.deepEqual(after.files,before.files);assert.notEqual(after.inputSha256,before.inputSha256);
    assert.throws(()=>assertActivationProofSourceInputs({proofSourceInputSha256:before.inputSha256,proofInputFiles:before.files},after),/activation_proof_source_changed/);
  }finally{writeFileSync(file,bytes);}
  assert.deepEqual(measureActivationProofSourceInputs(root,selected),before);
}
test('S2A actual helper source mutation invalidates the old receipt',()=>fixture(root=>mutation(root,helper)));
test('S2A actual Next config source mutation invalidates the old receipt',()=>fixture(root=>mutation(root,configs[0])));
test('S2A actual signed-WA viewer config mutation invalidates the old receipt',()=>fixture(root=>mutation(root,configs[1])));