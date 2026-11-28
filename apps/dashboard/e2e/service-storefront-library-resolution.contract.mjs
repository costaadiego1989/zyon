import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {createStorefrontScopedLibraryPlugin} from './service-storefront-library-resolution.mjs';

const storefront=resolve('owned/apps/storefront/src'),dashboard=resolve('owned/apps/dashboard/src');
function fixture(){const calls=[],plugin=createStorefrontScopedLibraryPlugin(storefront),context={async resolve(...args){calls.push(args);return{id:args[0]};}};return{calls,run:(id,from,options)=>plugin.resolveId.call(context,id,from,options)};}
test('real storefront consent lib imports resolve from that storefront source',async()=>{const f=fixture(),from=resolve(storefront,'components/StorefrontConsent.tsx');for(const name of['buyer-auth','storefront-consent'])assert.deepEqual(await f.run('@/lib/'+name,from,{isEntry:false}),{id:resolve(storefront,'lib',name)});assert.equal(f.calls.length,2);for(const call of f.calls){assert.equal(call[1],from);assert.deepEqual(call[2],{isEntry:false,skipSelf:true});}});
test('dashboard imports and other aliases are delegated without any replacement',async()=>{const f=fixture();for(const [id,from] of[['@/lib/buyer-auth',resolve(dashboard,'page.tsx')],['@/components/Other',resolve(storefront,'page.tsx')],['react',resolve(storefront,'page.tsx')]])assert.equal(await f.run(id,from),null);assert.equal(f.calls.length,0);});
test('sibling directory prefixes, relative importers and virtual modules cannot borrow storefront scope',async()=>{const f=fixture();for(const from of[storefront+'-other/page.tsx',resolve(storefront,'../private/page.tsx'),'relative.tsx','\0virtual',undefined])assert.equal(await f.run('@/lib/buyer-auth',from),null);assert.equal(f.calls.length,0);});
test('Vite query and filesystem importer forms preserve the same bounded scope',async()=>{const f=fixture(),from=resolve(storefront,'components/StorefrontConsent.tsx');for(const importer of[from+'?import','/@fs/'+from])assert.deepEqual(await f.run('@/lib/buyer-auth',importer),{id:resolve(storefront,'lib/buyer-auth')});assert.equal(f.calls.length,2);});

test('an owned storefront importer cannot resolve traversal outside its own lib directory',async()=>{const f=fixture(),from=resolve(storefront,'components/StorefrontConsent.tsx');for(const id of['@/lib/../../dashboard/src/lib/private','@/lib/../private','@/lib/'])assert.equal(await f.run(id,from),null);assert.equal(f.calls.length,0);});
