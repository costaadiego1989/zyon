import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
export async function resolve(specifier, context, next) {
  if (specifier === "@prisma/client") return { url: pathToFileURL(path.join(root, ".audit/verification/generated-client/index.js")).href, shortCircuit: true };
  if (specifier.startsWith("@zyon/")) {
    const filename = path.join(root, ".audit/verification/compiled/packages", specifier.slice(6), "src/index.js");
    if (fs.existsSync(filename)) return { url: pathToFileURL(filename).href, shortCircuit: true };
  }
  return next(specifier, context);
}
