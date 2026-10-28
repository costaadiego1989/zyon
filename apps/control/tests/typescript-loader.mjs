import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
    for (const extension of [".ts", ".tsx"]) {
      const candidate = new URL(specifier.slice(0, -3) + extension, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", shortCircuit: true, source: "export default {};" };
  if (url.startsWith("file:") && /\.tsx?$/.test(url)) {
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      fileName: fileURLToPath(url),
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText };
  }
  return nextLoad(url, context);
}
