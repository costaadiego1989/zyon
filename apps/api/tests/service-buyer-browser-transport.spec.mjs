import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {MODULE_METADATA} from '@nestjs/common/constants.js';
import {createBuyerBrowserEmailCapture,createBuyerBrowserMailbox} from './service-buyer-browser-transport.mjs';

const runId='6c5300a2-2017-4300-967f-000000000093',recipient='buyer-one@buyer-journey.example.test';

test('T93 local OTP capture replaces only the existing delivery provider and restores exact metadata',async()=>{
  class BuyerModule{}class RealVerifier{}const emailToken=Symbol('EMAIL_OTP_PROVIDER'),storeToken=Symbol('OTP_STORE');
  const original=[{provide:emailToken,useFactory:()=>({})},{provide:storeToken,useFactory:()=>({})},RealVerifier];
  Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,original,BuyerModule);
  const mailbox=createBuyerBrowserMailbox(runId),capture=createBuyerBrowserEmailCapture(runId,message=>mailbox.accept(message));
  const installation=capture.install(BuyerModule,emailToken);
  try{
    assert.throws(()=>mailbox.codeFor(recipient),/delivery_not_observed/);
    const providers=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,BuyerModule);
    assert.equal(providers.length,original.length);assert.equal(providers[1],original[1]);assert.equal(providers[2],RealVerifier);
    await providers[0].useValue.send(recipient,'314159',{merchantName:'Empresa local'});
    assert.deepEqual(mailbox.codeFor(recipient),{code:'314159',sequence:1});
    assert.deepEqual(capture.evidence(),{capturedEmailCount:1,externalEmailDeliveries:0});
    assert.deepEqual(mailbox.evidence(),capture.evidence());
    assert.equal(Object.hasOwn(capture.evidence(),'code'),false);
  }finally{installation.restore();capture.close();mailbox.close();}
  assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,BuyerModule),original);
  assert.throws(()=>mailbox.codeFor(recipient));await assert.rejects(capture.sender.send(recipient,'314159'));
});

test('T93 private OTP mailbox refuses foreign runs, missing delivery, replay and real recipient addresses',async()=>{
  const mailbox=createBuyerBrowserMailbox(runId),capture=createBuyerBrowserEmailCapture(runId,message=>mailbox.accept(message));
  const message={type:'local_buyer_browser_email',runId,sequence:1,email:recipient,code:'271828'};
  try{
    for(const patch of[{runId:'foreign'},{email:'real@example.com'},{sequence:2},{code:'token'},{accessToken:'forged'}])
      assert.throws(()=>mailbox.accept({...message,...patch}));
    assert.throws(()=>mailbox.codeFor(recipient),/delivery_not_observed/);
    await capture.sender.send(recipient,message.code);assert.throws(()=>mailbox.accept(message));
    await assert.rejects(capture.sender.send('real@example.com','271828'));
    assert.deepEqual(mailbox.evidence(),{capturedEmailCount:1,externalEmailDeliveries:0});
  }finally{capture.close();mailbox.close();}
});
