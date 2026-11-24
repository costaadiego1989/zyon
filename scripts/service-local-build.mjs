import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {serviceTestEnvironment} from '../apps/api/tests/service-test-runtime.mjs';
import {frontendBuildProfile} from './service-frontend-profile.mjs';

const supplied=process.argv.slice(2),target=supplied.at(-1),extra=supplied.slice(0,-1);
const frontendProfile=frontendBuildProfile(target,extra);
const env={...serviceTestEnvironment(process.env),NODE_ENV:'production',
  NODE_OPTIONS:`--import ${new URL('../apps/api/tests/test-network-guard.mjs',import.meta.url).href}${frontendProfile.nodeOptionsSuffix}`};
if(target!=='widget-v2')Object.assign(env,{NEXT_TELEMETRY_DISABLED:'1',
  VITE_API_BASE_URL:'https://127.0.0.1:5187',
  VITE_OAUTH_REDIRECT_URI:'https://127.0.0.1:5187/auth/oauth/callback',
  VITE_GOOGLE_CLIENT_ID:'synthetic-local-only.apps.googleusercontent.com',
  VITE_TURNSTILE_SITE_KEY:'synthetic-local-only',
  NEXT_PUBLIC_API_BASE_URL:'http://127.0.0.1:5187',AACP_API_URL:'http://127.0.0.1:5187'});
// Invoke the already cached version pinned by the workspace, bypassing the
// global manager's automatic installer when the environment is filtered.
assert.equal(process.platform,'win32','service_local_build_windows_toolchain_required');
assert.ok(process.env.LOCALAPPDATA,'service_local_tool_cache_required');
const pnpmRoot=resolve(process.env.LOCALAPPDATA,'pnpm/.tools/pnpm/9.15.0/node_modules/pnpm');
assert.equal(JSON.parse(readFileSync(resolve(pnpmRoot,'package.json'),'utf8')).version,'9.15.0');
const child=spawn(process.execPath,[resolve(pnpmRoot,'bin/pnpm.cjs'),'--filter',`@zyon/${target}`,'build'],
  {env,cwd:fileURLToPath(new URL('../',import.meta.url)),windowsHide:true,stdio:'inherit'});
child.once('error',error=>{console.error(error.message);process.exitCode=1;});
child.once('exit',(code,signal)=>{process.exitCode=signal||code===null?1:code;});
