import assert from 'node:assert/strict';
import test from 'node:test';
import {nativePrismaEngineForPlatform} from './native-prisma-admission-guards.mjs';

const linux={platform:'linux',arch:'x64',osRelease:'ID=debian\nVERSION_ID="12"\n',glibc:'2.36',openssl:'3.0.17'};
test('release native Prisma preserves the existing Windows library target',()=>{
  assert.deepEqual(nativePrismaEngineForPlatform({platform:'win32'}),{file:'query_engine-windows.dll.node',nativeEngine:'windows-library'});
});
test('release native Prisma admits only the actual Debian12 x64 glibc OpenSSL3 target',()=>{
  assert.deepEqual(nativePrismaEngineForPlatform(linux),{file:'libquery_engine-debian-openssl-3.0.x.so.node',nativeEngine:'debian-openssl-3.0.x-library'});
});
for(const [field,value] of [['platform','darwin'],['arch','arm64'],['osRelease','ID=alpine\nVERSION_ID=12\n'],
  ['osRelease','ID=debian\nVERSION_ID=13\n'],['glibc',undefined],['openssl','1.1.1'],['openssl','3.1.0']]){
  test(`release native Prisma rejects unsupported ${field} ${String(value)}`,()=>{
    assert.throws(()=>nativePrismaEngineForPlatform({...linux,[field]:value}));
  });
}
