import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { load as baseLoad } from "./ready-prod-loader.mjs";
export { resolve } from "./ready-prod-loader.mjs";
const ts = createRequire(import.meta.url)("typescript");

// Nest's guards and interceptors receive the same constructor metadata as
// the production build; the lightweight unit-test loader omits metadata.
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\.tsx?$/.test(url)) {
    const result = ts.transpileModule(readFileSync(new URL(url), "utf8"), { fileName: fileURLToPath(url), compilerOptions: {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true, emitDecoratorMetadata: true, jsx: ts.JsxEmit.ReactJSX,
    } });
    return { format: "module", source: result.outputText, shortCircuit: true };
  }
  return baseLoad(url, context, nextLoad);
}
