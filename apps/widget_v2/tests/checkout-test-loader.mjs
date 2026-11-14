import * as base from "../../api/tests/ready-prod-loader.mjs";
import fs from "node:fs";
export const load = base.load;
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "react" && context.parentURL?.includes("/apps/widget/")) {
    return nextResolve(specifier, { ...context, parentURL: new URL("../package.json", import.meta.url).href });
  }
  if (specifier.startsWith("@/")) {
    const url = new URL("../src/" + specifier.slice(2), import.meta.url);
    for (const suffix of [".ts", ".tsx"]) if (fs.existsSync(new URL(url.href + suffix))) return { url: url.href + suffix, shortCircuit: true };
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const url = new URL(specifier, context.parentURL);
    for (const suffix of [".ts", ".tsx"]) if (fs.existsSync(new URL(url.href + suffix))) return { url: url.href + suffix, shortCircuit: true };
  }
  return base.resolve(specifier, context, nextResolve);
}
