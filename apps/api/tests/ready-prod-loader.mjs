import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const packages = new Map();
for (const folder of fs.readdirSync(path.join(root, "packages"))) {
  const directory = path.join(root, "packages", folder);
  const manifest = path.join(directory, "package.json");
  const entry = path.join(directory, "src", "index.ts");
  if (fs.existsSync(manifest) && fs.existsSync(entry)) {
    packages.set(JSON.parse(fs.readFileSync(manifest, "utf8")).name, pathToFileURL(entry).href);
  }
}

export async function resolve(specifier, context, nextResolve) {
  // Resolve workspace packages to this checkout, never another worktree's dist.
  if (packages.has(specifier)) return { url: packages.get(specifier), shortCircuit: true };
  if (specifier === "@prisma/client" && process.env.READY_PROD_TEST_PRISMA_CLIENT) {
    return { url: pathToFileURL(path.resolve(process.env.READY_PROD_TEST_PRISMA_CLIENT)).href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
    const candidate = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
    if (fs.existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\.tsx?$/.test(url)) {
    const result = ts.transpileModule(fs.readFileSync(new URL(url), "utf8"), {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true, emitDecoratorMetadata: false,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    return { format: "module", source: result.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
