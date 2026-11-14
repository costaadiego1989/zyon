import assert from 'node:assert/strict';
import test from 'node:test';
import {assertLocalServiceOrigin,serviceBrowserEnvironment} from './service-local-scope.mjs';

test('T3 local scope',()=>{
  assert.equal(assertLocalServiceOrigin('http://127.0.0.1:5187'),'http://127.0.0.1:5187');
  for(const value of ['https://example.com','http://localhost:5187','http://0.0.0.0:5187',
    'http://127.0.0.1:80','http://127.0.0.1:5187/path','http://user:pass@127.0.0.1:5187','http://127.0.0.1:5187?target=external'])
    assert.throws(()=>assertLocalServiceOrigin(value));
  const env=serviceBrowserEnvironment({PATH:'safe-path',USERPROFILE:'safe-profile',OPENAI_API_KEY:'private-canary',
    DATABASE_URL:'postgresql://external',VITE_API_BASE_URL:'https://external',NODE_OPTIONS:'--import external'});
  assert.equal(env.PATH,'safe-path');assert.equal(env.USERPROFILE,'safe-profile');
  for(const key of ['OPENAI_API_KEY','DATABASE_URL','VITE_API_BASE_URL','NODE_OPTIONS'])assert.equal(Object.hasOwn(env,key),false);
});
