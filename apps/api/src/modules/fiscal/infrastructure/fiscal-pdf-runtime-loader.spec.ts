import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fiscalPdfFixture } from "../../../../tests/fiscal-artifact-fixtures.js";
import { fiscalPdfWorkerExecArgv } from "./fiscal-pdf.validation.js";

const api = fileURLToPath(new URL("../../../../", import.meta.url));
const runtime = new URL("../../../../tests/fiscal-runtime-loader.mjs", import.meta.url);

test("FISCAL-83 current fiscal metadata harness is omitted only at its exact worker hook path", () => {
  for (const hook of ["--loader", "--experimental-loader", "--import", "--require", "-r"]) {
    for (const value of [runtime.href, fileURLToPath(runtime)]) {
      const retained = ["--disable-proto=throw", "--import=./audit.mjs", "--conditions", "fiscal"];
      assert.deepEqual(fiscalPdfWorkerExecArgv([hook, value, ...retained]), retained);
      assert.deepEqual(fiscalPdfWorkerExecArgv([hook + "=" + value, ...retained]), retained);
    }
  }
  const unrelated = ["--loader", "./unrelated/fiscal-runtime-loader.mjs", "--conditions", runtime.href];
  assert.deepEqual(fiscalPdfWorkerExecArgv(unrelated), unrelated);
});

test("FISCAL-83 actual parser omits the current metadata harness and retains preload and prototype hardening", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "zyon-fiscal-pdf-runtime-"));
  const preload = resolve(directory, "audit.mjs"), entry = resolve(directory, "validate.mjs"), report = resolve(directory, "worker.json");
  const preloadUrl = pathToFileURL(preload).href;
  writeFileSync(preload, `import { isMainThread } from "node:worker_threads"; import { writeFileSync } from "node:fs"; if (!isMainThread) { let protoDisabled = !Object.prototype.hasOwnProperty.call(Object.prototype, "__proto__"); try { void ({}).__proto__; } catch (error) { protoDisabled = error?.code === "ERR_PROTO_ACCESS"; } writeFileSync(${JSON.stringify(report)}, JSON.stringify({ args: process.execArgv, protoDisabled, nodeOptions: process.env.NODE_OPTIONS })); }`);
  writeFileSync(entry, `import { validateFiscalPdf } from ${JSON.stringify(new URL("./fiscal-pdf.validation.ts", import.meta.url).href)}; await validateFiscalPdf(Uint8Array.from(Buffer.from(process.argv[2], "base64"))); process.stdout.write("validated");`);
  try {
    assert.equal(execFileSync(process.execPath, ["--disable-proto=throw", "--conditions=fiscal83", "--loader", runtime.href,
      "--import", preloadUrl, entry, Buffer.from(await fiscalPdfFixture()).toString("base64")], {
      cwd: api, encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"],
    }), "validated");
    assert.deepEqual(JSON.parse(readFileSync(report, "utf8")), {
      args: ["--conditions=fiscal83", "--import", preloadUrl], protoDisabled: true, nodeOptions: process.env.NODE_OPTIONS,
    });
  } finally {
    for (const file of [report, entry, preload]) if (existsSync(file)) unlinkSync(file);
    rmdirSync(directory);
  }
});
