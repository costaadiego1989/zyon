import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('../../../../../node_modules/typescript');
export async function resolve(specifier,context,nextResolve){
 if(specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.startsWith('file:')){
  const candidate=new URL(specifier.slice(0,-3)+'.ts',context.parentURL);
  if(fs.existsSync(candidate))return {url:candidate.href,shortCircuit:true};
 }
 return nextResolve(specifier,context);
}
export async function load(url,context,nextLoad){
 if(url.startsWith('file:') && /\.tsx?$/.test(url)){
  const source=fs.readFileSync(new URL(url),'utf8');
  const result=ts.transpileModule(source,{fileName:fileURLToPath(url),compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:false,jsx:ts.JsxEmit.ReactJSX}});
  return {format:'module',source:result.outputText,shortCircuit:true};
 }
 return nextLoad(url,context);
}
