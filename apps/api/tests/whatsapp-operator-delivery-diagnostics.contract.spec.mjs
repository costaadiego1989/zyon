import assert from 'node:assert/strict';
import test from 'node:test';
import {extractProviderTrapFailure,observeProviderTrapFailure} from './whatsapp-operator-delivery-diagnostics.mjs';

const marker='service_app_cleanup_failed:service_provider_attempt_forbidden:';
const code=items=>marker+JSON.stringify(items);
const frame='    at Example.run (file:///C:/private-root/apps/api/dist/shared/example.js:7:9)';

test('parent extraction retains only the kind, function and relative compiled location',()=>{
  const slash=String.fromCharCode(92),windows='    at Example.run (C:'+slash+['private-root','apps','api','dist','shared','example.js'].join(slash)+':7:9)';
  assert.deepEqual(extractProviderTrapFailure(code([{kind:'fetch',frames:[windows,
    '    at StandaloneConnector.connect (C:/private-root/node_modules/ioredis/built/connectors/StandaloneConnector.js:55:8)']} ])),
    [{kind:'fetch',frames:[{function:'Example.run',path:'dist/shared/example.js',line:7},{function:'StandaloneConnector.connect'}]}]);
});

test('raw error fields, URLs, absolute paths, queries, headers and payloads never leave extraction',()=>{
  const result=extractProviderTrapFailure(code([{kind:'socket',frames:[frame,
    '    at Client.run (https://synthetic-private.invalid/path?token=synthetic-private)'],
    message:'synthetic-private',url:'https://synthetic-private.invalid',headers:{authorization:'synthetic-private'},payload:'synthetic-private'}]));
  const serialized=JSON.stringify(result);
  for(const forbidden of ['synthetic-private','private-root','https:','authorization','payload','message','headers','url'])
    assert.equal(serialized.includes(forbidden),false,'private or arbitrary field escaped the parent projection');
  assert.deepEqual(Object.keys(result[0]).sort(),['frames','kind']);
});

test('a complete first diagnostic survives an already truncated later worker suffix',()=>{
  const first={kind:'fetch',frames:[frame]};
  assert.deepEqual(extractProviderTrapFailure(marker+'['+JSON.stringify(first)+',{"kind":"socket","frames":["incomplete'),
    [{kind:'fetch',frames:[{function:'Example.run',path:'dist/shared/example.js',line:7}]}]);
});

test('parent extraction enforces the three-attempt, six-frame and input/object bounds',()=>{
  const items=Array.from({length:4},()=>({kind:'fetch',frames:Array(7).fill(frame)}));
  const result=extractProviderTrapFailure(code(items));assert.equal(result.length,3);
  assert.ok(result.every(item=>item.frames.length===6));
  assert.deepEqual(extractProviderTrapFailure('x'.repeat(8192)+code([{kind:'fetch',frames:[frame]}])),[]);
  assert.deepEqual(extractProviderTrapFailure(code([{kind:'fetch',frames:[frame],unused:'x'.repeat(4096)}])),[]);
});

test('unknown kinds, malformed input and unsafe locations produce no guessed data',()=>{
  assert.deepEqual(extractProviderTrapFailure(code([{kind:'other',frames:[frame]}])),[]);
  assert.deepEqual(extractProviderTrapFailure(marker+'[{'),[]);
  assert.deepEqual(extractProviderTrapFailure(undefined),[]);
  assert.deepEqual(extractProviderTrapFailure(42),[]);
  const result=extractProviderTrapFailure(code([{kind:'fetch',frames:[
    '    at Example.run (C:/root/apps/api/dist/../synthetic-private.js:7:9)',
    '    at Zero.run (C:/root/apps/api/dist/shared/example.js:0:9)',
    '    at Query.run (C:/root/apps/api/dist/shared/example.js?token=synthetic-private:7:9)']} ]));
  assert.ok(result[0].frames.every(item=>!Object.hasOwn(item,'path')&&!Object.hasOwn(item,'line')));
  assert.equal(JSON.stringify(result).includes('synthetic-private'),false);
});

test('a throwing diagnostic sink cannot replace the original worker failure',t=>{
  t.mock.method(console,'info',()=>{throw new Error('synthetic_diagnostic_sink_failure');});
  const original=new Error('synthetic_original_worker_failure'),input=code([{kind:'fetch',frames:[frame]}]);
  assert.doesNotThrow(()=>observeProviderTrapFailure(input));
  try{observeProviderTrapFailure(input);throw original;}catch(error){assert.ok(error===original);}
});

test('bounded cyclic AggregateError graphs prefer the original inner worker suffix without mutating it',()=>{
  const leaf=new Error(code([{kind:'socket',frames:[frame]}]));
  const outer=new AggregateError([leaf],'synthetic_outer');outer.cause=outer;
  assert.deepEqual(extractProviderTrapFailure(outer),[{kind:'socket',frames:[{function:'Example.run',path:'dist/shared/example.js',line:7}]}]);
  assert.ok(outer.errors[0]===leaf);assert.ok(outer.cause===outer);
  const bad={get message(){throw new Error('synthetic_getter_failure');}};
  assert.doesNotThrow(()=>observeProviderTrapFailure(bad));assert.deepEqual(extractProviderTrapFailure(bad),[]);
  const deep=new Error(code([{kind:'fetch',frames:[frame]}]));
  let nested=deep;for(let index=0;index<4;index++)nested=new AggregateError([nested],'synthetic_depth');
  assert.deepEqual(extractProviderTrapFailure(nested),[]);
});