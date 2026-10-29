import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const blockedImports = ["@nestjs/", "prisma", "shopify", "openai", "process.env"];

test("checkout domain remains framework and vendor free", () => {
  const domainDir = dirname(fileURLToPath(import.meta.url));
  const files = collectDomainFiles(domainDir).filter((file) => !file.endsWith(".spec.js"));

  for (const file of files) {
    const source = readFileSync(file, "utf8").toLowerCase();
    for (const blocked of blockedImports) {
      assert.equal(
        source.includes(blocked),
        false,
        `${file} must not import or reference ${blocked}`
      );
    }
  }
});

function collectDomainFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return collectDomainFiles(path);
    return path.endsWith(".js") ? [path] : [];
  });
}
