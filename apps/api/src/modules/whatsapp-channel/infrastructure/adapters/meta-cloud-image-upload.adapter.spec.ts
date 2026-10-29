import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaCloudImageUploadAdapter } from './meta-cloud-image-upload.adapter.js';
import { MetaCloudSenderAdapter } from './meta-cloud-sender.adapter.js';
const input = { link: 'https://images.unsplash.com/product.jpg', phoneNumberId: '12345', accessToken: 'private-token', graph: 'https://graph.facebook.com/v23.0' };
const jpeg = new Uint8Array([255,216,255,1,2]);

test('images are uploaded once to Meta per connected phone; CDN never receives the token', async t => {
  const calls: any[] = [];
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    calls.push({url: String(url), init});
    if (String(url).startsWith('https://images.unsplash.com')) return new Response(jpeg, {headers: {'content-type': 'image/jpeg'}});
    return Response.json({id: '987654'});
  });
  const adapter = new MetaCloudImageUploadAdapter();
  assert.equal(await adapter.prepare(input), '987654');
  assert.equal(await adapter.prepare(input), '987654');
  assert.equal(calls.length, 2);
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), null);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[1].url, input.graph + '/12345/media');
  assert.equal(new Headers(calls[1].init.headers).get('Authorization'), 'Bearer private-token');
  assert.equal(calls[1].init.body.get('messaging_product'), 'whatsapp');
  assert.equal(calls[1].init.body.get('file').type, 'image/jpeg');
  await adapter.prepare({...input, phoneNumberId: 'another'}); assert.equal(calls.length, 4);
});

test('unapproved origins are not fetched and malformed, excessive or non-image bytes are rejected', async t => {
  let fetches = 0;
  const mock = t.mock.method(globalThis, 'fetch', async () => { fetches++; return new Response('<html>error</html>'); });
  const adapter = new MetaCloudImageUploadAdapter();
  assert.equal(await adapter.prepare({...input, link: 'https://127.0.0.1/internal'}), undefined);
  assert.equal(fetches, 0);
  await assert.rejects(adapter.prepare({...input, link: 'http://images.unsplash.com/a.jpg'}), /source_invalid/);
  await assert.rejects(adapter.prepare(input), /type_unsupported/);
  mock.mock.mockImplementation(async () => new Response(jpeg, {headers: {'content-length': '5242881'}}));
  await assert.rejects(adapter.prepare(input), /too_large/);
  mock.mock.mockImplementation(async () => new Response(new Uint8Array(5242881)));
  await assert.rejects(adapter.prepare(input), /too_large/);
});

test('connected sender uses the uploaded media ID with receipt correlation instead of a CDN hotlink', async t => {
  let message: any;
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    if (String(url).startsWith('https://images.unsplash.com')) return new Response(jpeg);
    if (String(url).endsWith('/media')) return Response.json({id: '987654'});
    message = JSON.parse(init.body); return Response.json({messages:[{id:'wamid.actual'}]});
  });
  const config: any = {id:'connected', merchantId:'merchant', enabled:true, provider:'META_CLOUD', status:'ACTIVE',
    credentials:{accessToken:input.accessToken,phoneNumberId:input.phoneNumberId,wabaId:'99999'}};
  const sender = new MetaCloudSenderAdapter({findById:async()=>config} as any, new MetaCloudImageUploadAdapter());
  assert.equal((await sender.sendMedia({deviceId:'META_CLOUD:connected',toNumber:'552193001883',text:'*Produto*',mediaUrl:input.link,mimetype:'image/jpeg',correlationId:'zyon:turn:1'})).status, 'sent');
  assert.deepEqual(message.image, {id:'987654',caption:'*Produto*'});
  assert.equal(message.biz_opaque_callback_data, 'zyon:turn:1');
});
