import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const source = fileURLToPath(new URL('../src/', import.meta.url));
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = path.join(source, specifier.slice(2));
    for (const suffix of ['.ts', '.tsx', '/index.ts']) {
      if (fs.existsSync(base + suffix)) return { url: pathToFileURL(base + suffix).href, shortCircuit: true };
    }
  }
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    const base = fileURLToPath(url).replace(/\.js$/, '');
    for (const suffix of ['.ts', '.tsx']) {
      if (fs.existsSync(base + suffix)) return { url: pathToFileURL(base + suffix).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (/\.tsx?$/.test(url)) return {
    format: 'module', shortCircuit: true,
    source: ts.transpileModule(fs.readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  };
  return nextLoad(url, context);
}
