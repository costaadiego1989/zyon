import assert from 'node:assert/strict';import {test} from 'node:test';import sharp from 'sharp';import {createHash} from 'node:crypto';
import {CatalogImageAdapter} from './catalog-image.adapter.js';import {assistantProduct} from '../application/__tests__/assistant-fixture.js';

test('FR-03 catalog photography is captured as immutable PNG without an image API key or paid request',async()=>{
 const photo=await sharp({create:{width:40,height:40,channels:3,background:'#228844'}}).png().toBuffer(),requests:string[]=[];let uploaded:Buffer|undefined;
 const adapter=new CatalogImageAdapter({META_ADS_IMAGE_SOURCE_HOSTS:'media.example.test'},{isConfigured:()=>true,upload:async(bytes,type,folder,key)=>{assert.equal(type,'image/png');assert.equal(folder,'meta-ads/store-a/catalog');assert.match(key!,/^photo-/);uploaded=bytes;return{url:'https://cdn.example.test/immutable-photo.png',key:'photo.png'} as any;}},async(url,init)=>{requests.push(String(url));assert.equal(init?.redirect,'error');return new Response(photo,{headers:{'Content-Type':'image/png'}});});
 assert.equal(adapter.configured(),true);const result=await adapter.capture({merchantId:'store-a',mediaKey:'photo-123',product:assistantProduct});assert.equal(result.url,'https://cdn.example.test/immutable-photo.png');assert.equal(result.sourceUrl,assistantProduct.imageUrl);assert.equal(result.imageSha256,createHash('sha256').update(uploaded!).digest('hex'));assert.deepEqual(requests,[assistantProduct.imageUrl]);assert.equal((await sharp(uploaded!).metadata()).format,'png');
});

test('FR-03 private foreign redirected oversized and non-photo sources cannot become approved catalog assets',async()=>{
 let uploads=0;const store={isConfigured:()=>true,upload:async()=>{uploads++;throw Error('must not upload');}};
 for(const imageUrl of ['http://media.example.test/a.png','https://127.0.0.1/a.png','https://localhost/a.png','https://foreign.example.test/a.png','https://user:pass@media.example.test/a.png']){
  const adapter=new CatalogImageAdapter({META_ADS_IMAGE_SOURCE_HOSTS:'media.example.test'},store,async()=>{throw Error('must not fetch');});await assert.rejects(adapter.capture({merchantId:'store-a',mediaKey:'photo-123',product:{...assistantProduct,imageUrl}}),{code:'image_source_untrusted'});
 }
 for(const response of [new Response(null,{status:302,headers:{Location:'http://127.0.0.1'}}),new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}}),new Response('x',{headers:{'Content-Length':'13000000'}})]){
  const adapter=new CatalogImageAdapter({META_ADS_IMAGE_SOURCE_HOSTS:'media.example.test'},store,async()=>response);await assert.rejects(adapter.capture({merchantId:'store-a',mediaKey:'photo-123',product:assistantProduct}));
 }assert.equal(uploads,0);
});
