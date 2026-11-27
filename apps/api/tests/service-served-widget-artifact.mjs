import assert from 'node:assert/strict';
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const prefix='/__service/release-widget/';
const reactNames=['Children','Component','Fragment','Profiler','PureComponent','StrictMode','Suspense',
  '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED','cloneElement','createContext','createElement','createFactory',
  'createRef','forwardRef','isValidElement','lazy','memo','startTransition','useCallback','useContext','useDebugValue',
  'useDeferredValue','useEffect','useId','useImperativeHandle','useInsertionEffect','useLayoutEffect','useMemo',
  'useReducer','useRef','useState','useSyncExternalStore','useTransition','version'];
let prepared;
/** Only dependency interoperability is bundled. The product library and CSS
 * below are served byte-for-byte from the already built, measured dist. */
async function assets(){
  const directory=resolve(repo,'apps/widget_v2/dist');
  assert.ok(lstatSync(directory).isDirectory()&&!lstatSync(directory).isSymbolicLink());
  const ownRequire=createRequire(resolve(repo,'apps/dashboard/package.json'));
  const viteRequire=createRequire(ownRequire.resolve('vite'));
  const esbuild=viteRequire('esbuild'),{build}=esbuild;
  const bridge=`const React=globalThis.__zyonReleaseReact;if(!React)throw Error('release_react_identity_required');export default React;export const {${reactNames.join(',')}}=React;`;
  const plugin={name:'owned-release-react-identity',setup(builder){
    builder.onResolve({filter:/^react$/},()=>({path:'owned-react',namespace:'owned-release-react'}));
    builder.onLoad({filter:/.*/,namespace:'owned-release-react'},()=>({contents:bridge,loader:'js'}));
  }};
  const bundle=async(contents,plugins=[])=>{
    const result=await build({stdin:{contents,resolveDir:resolve(repo,'apps/dashboard'),loader:'js'},bundle:true,
      format:'esm',platform:'browser',write:false,target:'es2020',define:{'process.env.NODE_ENV':'"production"'},plugins});
    assert.equal(result.outputFiles.length,1);return Buffer.from(result.outputFiles[0].contents);
  };
  let values;
  try{values=new Map([
    ['react.mjs',await bundle(`import React from 'react';export default React;export const {${reactNames.join(',')}}=React;`)],
    ['react-dom-client.mjs',await bundle("import client from 'react-dom/client';export default client;export const {createRoot,hydrateRoot}=client;",[plugin])],
    ['react-dom.mjs',await bundle("import dom from 'react-dom';export default dom;export const {createPortal,flushSync,findDOMNode,render,unmountComponentAtNode,version}=dom;",[plugin])],
    ['jsx-runtime.mjs',await bundle("import runtime from 'react/jsx-runtime';export default runtime;export const {Fragment,jsx,jsxs}=runtime;",[plugin])],
  ]);}finally{esbuild.stop();}
  for(const name of ['index.js',...readdirSync(directory).filter(value=>/^[a-zA-Z0-9_.-]+\.css$/.test(value))]){
    const file=resolve(directory,name);assert.ok(lstatSync(file).isFile()&&!lstatSync(file).isSymbolicLink());
    values.set(name,readFileSync(file));
  }
  assert.ok(values.get('index.js')?.length>0,'release_widget_library_missing');
  values.set('asset-list.json',Buffer.from(JSON.stringify({css:[...values.keys()].filter(name=>name.endsWith('.css'))})));
  return values;
}
/** Fixed routes in the private Next test worker only. No caller root, token,
 * generated result or arbitrary filesystem path is accepted. */
export async function serveOwnedReleaseWidget(request,response){
  const url=new URL(request.url,'http://127.0.0.1');
  if(!url.pathname.startsWith(prefix))return false;
  if(!['GET','HEAD'].includes(request.method)||url.search){response.statusCode=405;response.end();return true;}
  prepared??=assets();const values=await prepared;
  const name=url.pathname.slice(prefix.length),bytes=values.get(name);
  if(!bytes){response.statusCode=404;response.end();return true;}
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/javascript');
  response.setHeader('Content-Length',bytes.length);response.end(request.method==='HEAD'?undefined:bytes);return true;
}
