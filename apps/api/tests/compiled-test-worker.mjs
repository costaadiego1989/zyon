import { readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "node:test";
import { tap } from "node:test/reporters";
import { collectTestImports } from "./compiled-test-plan.mjs";

const manifest = new URL("../dist-test/test-runner.js", import.meta.url);
const registrations = collectTestImports(readFileSync(manifest, "utf8"));
const files = registrations.map((name) => {
  const file = fileURLToPath(new URL(name, manifest));
  if (!statSync(file).isFile()) throw new Error("compiled_test_registration_missing");
  return file;
});
files.push(fileURLToPath(new URL("./compiled-runner.contract.spec.mjs", import.meta.url)));
console.log(`# Compiled API registry: ${registrations.length} registered files + runner contracts; isolated processes; integration gates disabled.`);
// Programmatic run avoids Windows' command-line length limit for this manifest.
// No source loader, metadata override, test filter or force-exit is used.
// The --import preload is inherited from this process by the file workers;
// do not require run({ execArgv }), introduced after the repo's Node 20 minimum.
const results = run({ files, concurrency: 4, timeout: 120_000 });
results.on("test:fail", (data) => {
  process.exitCode = 1;
  if (data.details.type !== "suite") console.log(`# runner_failure ${JSON.stringify({
    file: data.file ? relative(fileURLToPath(new URL("../", import.meta.url)), data.file).replaceAll("\\", "/") : null,
    name: data.name, line: data.line ?? null,
  })}`);
});
results.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
results.compose(tap).pipe(process.stdout);
