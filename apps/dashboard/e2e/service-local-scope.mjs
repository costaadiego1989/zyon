import assert from 'node:assert/strict';
import {serviceTestEnvironment} from '../../api/tests/service-test-runtime.mjs';

export function assertLocalServiceOrigin(value){
  const url=new URL(value);
  assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');
  assert.ok(Number(url.port)>1024&&Number(url.port)<=65535);
  assert.equal(url.username,'');assert.equal(url.password,'');assert.equal(url.pathname,'/');
  assert.equal(url.search,'');assert.equal(url.hash,'');assert.equal(value,url.origin);
  return url.origin;
}
export function serviceBrowserEnvironment(source){
  const env=serviceTestEnvironment(source);
  for(const key of ['USERPROFILE','LOCALAPPDATA','ProgramFiles','ProgramFiles(x86)','PROGRAMFILES','PROGRAMFILES(X86)','SystemDrive'])
    if(source[key]!==undefined)env[key]=source[key];
  return env;
}
