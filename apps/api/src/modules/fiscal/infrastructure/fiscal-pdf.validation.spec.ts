import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fiscalPdfFixture } from "../../../../tests/fiscal-artifact-fixtures.js";
import * as source from "./fiscal-pdf.validation.js";

const require = createRequire(import.meta.url);
const api = fileURLToPath(new URL("../../../../", import.meta.url));
const metadata = fileURLToPath(new URL("../../../../tests/platform-support-loader.mjs", import.meta.url));
const metadataUrl = new URL("../../../../tests/platform-support-loader.mjs", import.meta.url).href;
const selectArguments = (args: string[]) => {
  const select = (source as unknown as { fiscalPdfWorkerExecArgv: (args: string[]) => string[] }).fiscalPdfWorkerExecArgv;
  assert.equal(typeof select, "function", "the worker must preserve unrelated inherited Node options");
  return select(args);
};

test("FISCAL-83 argument policy removes only exact paired metadata hooks", () => {
  for (const flag of ["--loader", "--experimental-loader", "--import", "--require", "-r"]) {
    for (const path of [metadata, metadataUrl]) {
      assert.deepEqual(selectArguments(["--disable-proto=throw", flag, path, "--conditions", "fiscal"]), ["--disable-proto=throw", "--conditions", "fiscal"]);
    }
  }
});

test("FISCAL-83 argument policy removes exact equals hooks and retains other paths", () => {
  for (const flag of ["--loader", "--experimental-loader", "--import", "--require", "-r"]) {
    assert.deepEqual(selectArguments([flag + "=" + metadataUrl, flag + "=./unrelated/platform-support-loader.mjs"]), [flag + "=./unrelated/platform-support-loader.mjs"]);
  }
});

test("FISCAL-83 argument policy retains unrelated options values order and NODE_OPTIONS", () => {
  const args = ["--frozen-intrinsics", "--loader", "./unrelated-loader.mjs", "--import=./audit.mjs", "--require", "./policy.cjs", "-r", "./instrumentation.cjs", "--conditions", metadata, "--title", "fiscal", "--loader=file:///invalid%path", "--loader"];
  const before = process.env.NODE_OPTIONS;
  assert.deepEqual(selectArguments(args), args);
  assert.equal(process.env.NODE_OPTIONS, before);
});

test("FISCAL-83 actual source worker omits metadata bootstrap and executes unrelated preload", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "zyon-fiscal-pdf-"));
  const preload = resolve(directory, "audit.mjs"), entry = resolve(directory, "validate.mjs"), report = resolve(directory, "worker.json");
  const preloadUrl = pathToFileURL(preload).href;
  writeFileSync(preload, `import { isMainThread } from "node:worker_threads"; import { writeFileSync } from "node:fs"; if (!isMainThread) writeFileSync(${JSON.stringify(report)}, JSON.stringify({ args: process.execArgv, nodeOptions: process.env.NODE_OPTIONS }));`);
  writeFileSync(entry, `import { validateFiscalPdf } from ${JSON.stringify(new URL("./fiscal-pdf.validation.ts", import.meta.url).href)}; await validateFiscalPdf(Uint8Array.from(Buffer.from(process.argv[2], "base64"))); process.stdout.write("validated");`);
  try {
    assert.equal(execFileSync(process.execPath, ["--conditions=fiscal83", "--loader", metadataUrl, "--import", preloadUrl, entry, Buffer.from(await fiscalPdfFixture()).toString("base64")], { cwd: api, encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] }), "validated");
    assert.deepEqual(JSON.parse(readFileSync(report, "utf8")), { args: ["--conditions=fiscal83", "--import", preloadUrl], nodeOptions: process.env.NODE_OPTIONS });
  } finally {
    for (const file of [report, entry, preload]) if (existsSync(file)) unlinkSync(file);
    rmdirSync(directory);
  }
});

async function assertWorkerHardening(moduleUrl: string, metadataHook: boolean, protoArgs = ["--disable-proto=throw"]) {
  const directory = mkdtempSync(resolve(tmpdir(), "zyon-fiscal-pdf-hardening-"));
  const preload = resolve(directory, "audit.mjs"), entry = resolve(directory, "validate.mjs"), report = resolve(directory, "worker.json");
  const preloadUrl = pathToFileURL(preload).href;
  writeFileSync(preload, `import { isMainThread } from "node:worker_threads"; import { writeFileSync } from "node:fs"; if (!isMainThread) { let protoDisabled = !Object.prototype.hasOwnProperty.call(Object.prototype, "__proto__"); try { void ({}).__proto__; } catch (error) { protoDisabled = error?.code === "ERR_PROTO_ACCESS"; } writeFileSync(${JSON.stringify(report)}, JSON.stringify({ protoDisabled, args: process.execArgv, nodeOptions: process.env.NODE_OPTIONS })); }`);
  writeFileSync(entry, `import { validateFiscalPdf } from ${JSON.stringify(moduleUrl)}; await validateFiscalPdf(Uint8Array.from(Buffer.from(process.argv[2], "base64"))); process.stdout.write("validated");`);
  try {
    const hooks = metadataHook ? ["--loader", metadataUrl] : [];
    assert.equal(execFileSync(process.execPath, [...protoArgs, "--conditions=fiscal83", ...hooks, "--import", preloadUrl, entry, Buffer.from(await fiscalPdfFixture()).toString("base64")], { cwd: api, encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] }), "validated");
    const inherited = metadataHook ? [] : protoArgs;
    assert.deepEqual(JSON.parse(readFileSync(report, "utf8")), { protoDisabled: true, args: [...inherited, "--conditions=fiscal83", "--import", preloadUrl], nodeOptions: process.env.NODE_OPTIONS });
  } finally {
    for (const file of [report, entry, preload]) if (existsSync(file)) unlinkSync(file);
    rmdirSync(directory);
  }
}

test("FISCAL-83 actual source worker preserves proto hardening while removing metadata bootstrap", async () => {
  for (const args of [["--disable-proto=throw"], ["--disable-proto", "throw"], ["--disable-proto=delete"], ["--disable-proto", "delete"]]) {
    await assertWorkerHardening(new URL("./fiscal-pdf.validation.ts", import.meta.url).href, true, args);
  }
});

type Validator = (bytes: Uint8Array) => Promise<void>;
async function acceptsCurrentPdf(validate: Validator) {
  for (const objectStreams of [false, true]) {
    const bytes = await fiscalPdfFixture(objectStreams);
    const original = Uint8Array.from(bytes);
    assert.equal(await validate(bytes), undefined);
    assert.deepEqual(bytes, original, "validation cannot mutate the protected original");
  }
}
async function rejectsHostilePdf(validate: Validator) {
  const bytes = await fiscalPdfFixture(false);
  const text = Buffer.from(bytes).toString("latin1");
  const malformed = [
    text.replace(/\/Root \d+ \d+ R/, "/Root 999999 0 R"),
    text.replace(/\/Count 1\b/, "/Count 9"),
    text.replace(/(\/Kids \[\s*)(\d+)( 0 R)/, (_all, start, id, end) => start + "9".repeat(id.length) + end),
    text.replace(/startxref\s+\d+/, "startxref\n1"),
  ];
  for (const candidate of malformed) {
    assert.notEqual(candidate, text, "the hostile fixture must change the valid PDF");
    await assert.rejects(validate(Buffer.from(candidate, "latin1")), /^Error: fiscal_pdf_invalid$/);
  }
  for (const candidate of [Buffer.from("%PDF-1.4"), bytes.slice(0, bytes.length - 12), new Uint8Array(), new Uint8Array(20 * 1024 * 1024 + 1)]) {
    await assert.rejects(validate(candidate), /^Error: fiscal_pdf_invalid$/);
  }
}

test("FISCAL-83 source accepts current classic and object-stream PDFs without changing bytes", async () => {
  await acceptsCurrentPdf(source.validateFiscalPdf);
});

test("FISCAL-83 source rejects hostile truncated empty and oversized PDFs", async () => {
  await rejectsHostilePdf(source.validateFiscalPdf);
});

let emitted: typeof source;
test("FISCAL-83 direct semantic emit produces the current MJS worker and accepts valid PDFs", { timeout: 900000 }, async () => {
  const dist = resolve(api, "dist") + sep;
  for (const name of ["fiscal-pdf.worker.mjs", "fiscal-pdf.validation.js"]) {
    const target = resolve(api, "dist/modules/fiscal/infrastructure", name);
    assert.ok(target.startsWith(dist), "only the exact generated fiscal output can be removed");
    if (existsSync(target)) unlinkSync(target);
    assert.equal(existsSync(target), false);
  }
  execFileSync(process.execPath, ["--max-old-space-size=4096", require.resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"], { cwd: api, encoding: "utf8", timeout: 600000, stdio: "pipe" });
  assert.equal(existsSync(resolve(api, "dist/modules/fiscal/infrastructure/fiscal-pdf.worker.mjs")), true);
  // A separate Node process has no TypeScript loader or in-process source module cache.
  const program = `import { validateFiscalPdf } from ${JSON.stringify(new URL("../../../../dist/modules/fiscal/infrastructure/fiscal-pdf.validation.js", import.meta.url).href)}; const bytes = Uint8Array.from(Buffer.from(process.argv[2], "base64")); await validateFiscalPdf(bytes); process.stdout.write("validated");`;
  const smoke = resolve(api, "dist/modules/fiscal/infrastructure/fiscal-pdf.validation.smoke.mjs");
  writeFileSync(smoke, program);
  try {
    for (const objectStreams of [false, true]) {
      assert.equal(execFileSync(process.execPath, [smoke, Buffer.from(await fiscalPdfFixture(objectStreams)).toString("base64")], { cwd: api, encoding: "utf8", timeout: 15000 }), "validated");
    }
  } finally { unlinkSync(smoke); }
  emitted = await import(new URL("../../../../dist/modules/fiscal/infrastructure/fiscal-pdf.validation.js", import.meta.url).href);
  await acceptsCurrentPdf(emitted.validateFiscalPdf);
});

test("FISCAL-83 emitted API rejects hostile truncated empty and oversized PDFs", async () => {
  assert.equal(typeof emitted?.validateFiscalPdf, "function", "fresh semantic output must be available");
  await rejectsHostilePdf(emitted.validateFiscalPdf);
});

test("FISCAL-83 emitted worker preserves native proto hardening without a metadata hook", async () => {
  assert.equal(typeof emitted?.validateFiscalPdf, "function", "fresh semantic output must be available");
  for (const args of [["--disable-proto=throw"], ["--disable-proto", "throw"], ["--disable-proto=delete"], ["--disable-proto", "delete"]]) {
    await assertWorkerHardening(new URL("../../../../dist/modules/fiscal/infrastructure/fiscal-pdf.validation.js", import.meta.url).href, false, args);
  }
});

import { PDFDocument } from "pdf-lib";

function exactSizeFiscalPdf(size: number): Uint8Array {
  let padding = size - 500;
  for (let attempt = 0; attempt < 8; attempt++) {
    const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n", "ascii")];
    const offsets = [0];
    const addObject = (id: number, body: Buffer) => {
      offsets.push(chunks.reduce((total, chunk) => total + chunk.length, 0));
      chunks.push(Buffer.from(`${id} 0 obj\n`, "ascii"), body, Buffer.from("\nendobj\n", "ascii"));
    };
    addObject(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"));
    addObject(2, Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "ascii"));
    addObject(3, Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>", "ascii"));
    addObject(4, Buffer.concat([Buffer.from(`<< /Length ${padding} >>\nstream\n`, "ascii"), Buffer.alloc(padding, 0x20), Buffer.from("\nendstream", "ascii")]));
    const xref = chunks.reduce((total, chunk) => total + chunk.length, 0);
    chunks.push(Buffer.from("xref\n0 5\n0000000000 65535 f \n" + offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "ascii"));
    const bytes = Buffer.concat(chunks);
    if (bytes.length === size) return bytes;
    padding += size - bytes.length;
  }
  throw new Error("pdf_boundary_fixture_size_setup_failed");
}

async function assertExactPdfByteBoundary(validate: Validator) {
  const atLimit = exactSizeFiscalPdf(20 * 1024 * 1024);
  const aboveLimit = exactSizeFiscalPdf(20 * 1024 * 1024 + 1);
  assert.equal(atLimit.length, 20 * 1024 * 1024);
  assert.equal(aboveLimit.length, atLimit.length + 1);
  // Independently parse both equivalent blank pages before using the validator's size decision.
  for (const bytes of [atLimit, aboveLimit]) {
    const document = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
    assert.equal(document.getPageCount(), 1, "both byte-boundary fixtures must be well-formed PDFs");
    assert.equal(document.getPage(0).getWidth(), 595); assert.equal(document.getPage(0).getHeight(), 842);
  }
  assert.equal(await validate(atLimit), undefined, "a valid PDF exactly at20MiB must be accepted");
  await assert.rejects(validate(aboveLimit), /^Error: fiscal_pdf_invalid$/, "the equivalent valid PDF at20MiB+1 must be rejected");
}

async function assertNativePdfDeadlineAndResources(moduleUrl: string, metadataHook: boolean) {
  const directory = mkdtempSync(resolve(tmpdir(), "zyon-fiscal-pdf-limits-"));
  const preload = resolve(directory, "hold-worker.mjs"), entry = resolve(directory, "limits.mjs");
  const report = resolve(directory, "worker.json"), release = resolve(directory, "release");
  writeFileSync(preload, `import { isMainThread, resourceLimits, workerData, threadId } from "node:worker_threads"; import { existsSync, writeFileSync } from "node:fs";
if (!isMainThread && workerData instanceof ArrayBuffer) {
  writeFileSync(${JSON.stringify(report)}, JSON.stringify({ threadId, limits: { old: resourceLimits.maxOldGenerationSizeMb, young: resourceLimits.maxYoungGenerationSizeMb, stack: resourceLimits.stackSizeMb }, nodeOptions: process.env.NODE_OPTIONS ?? null }));
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(${JSON.stringify(release)})) Atomics.wait(pause, 0, 0, 10);
}`);
  writeFileSync(entry, `import assert from "node:assert/strict"; import { mock } from "node:test"; import { Worker } from "node:worker_threads"; import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { validateFiscalPdf } from ${JSON.stringify(moduleUrl)};
assert.equal(process.env.NODE_OPTIONS, undefined, "probe_setup_no_global_heap_override");
const originalTerminate = Worker.prototype.terminate; let termination;
Worker.prototype.terminate = function(...args) { termination = originalTerminate.apply(this, args); return termination; };
let state = "pending", rejection; let outcome;
mock.timers.enable({ apis: ["setTimeout"] });
try {
  outcome = validateFiscalPdf(Uint8Array.from(Buffer.from(process.argv[2], "base64"))).then(() => { state = "accepted"; }, error => { state = "rejected"; rejection = error.message; });
  const setupDeadline = performance.now() + 10000, pause = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(${JSON.stringify(report)})) { if (performance.now() >= setupDeadline) throw new Error("probe_setup_native_worker_missing"); await new Promise(setImmediate); Atomics.wait(pause, 0, 0, 2); }
  const observed = JSON.parse(readFileSync(${JSON.stringify(report)}, "utf8"));
  assert.ok(observed.threadId > 0, "probe_setup_real_worker_thread");
  assert.equal(observed.nodeOptions, null, "probe_setup_worker_no_global_heap_override");
  assert.deepEqual(observed.limits, { old: 128, young: 32, stack: 4 }, "native_worker_resource_limits");
  mock.timers.tick(4999); await new Promise(setImmediate);
  assert.equal(state, "pending", "pdf_deadline_pending_at4999");
  mock.timers.tick(1); await new Promise(setImmediate);
  assert.equal(state, "rejected", "pdf_deadline_rejected_at5000");
  assert.equal(rejection, "fiscal_pdf_invalid");
  assert.ok(termination, "pdf_deadline_terminates_native_worker");
  assert.equal(await termination, 1, "pdf_deadline_native_worker_exit");
  process.stdout.write(JSON.stringify({ limits: observed.limits, pendingAt4999: true, rejectedAt5000: true, terminated: true, nodeOptions: null }));
} finally {
  writeFileSync(${JSON.stringify(release)}, "release");
  mock.timers.reset();
  if (outcome) await outcome;
  if (termination) await termination;
  Worker.prototype.terminate = originalTerminate;
}`);
  const previousOptions = process.env.NODE_OPTIONS;
  const env = { ...process.env }; delete env.NODE_OPTIONS;
  try {
    const hooks = metadataHook ? ["--loader", metadataUrl] : [];
    const output = execFileSync(process.execPath, [...hooks, "--import", pathToFileURL(preload).href, entry, Buffer.from(await fiscalPdfFixture(false)).toString("base64")], { cwd: api, env, encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
    assert.deepEqual(JSON.parse(output), { limits: { old: 128, young: 32, stack: 4 }, pendingAt4999: true, rejectedAt5000: true, terminated: true, nodeOptions: null });
    assert.equal(process.env.NODE_OPTIONS, previousOptions, "only the controlled probe child removes the heap override");
  } finally {
    // Always release even a failed/setup-timed-out child before removing its owned files.
    writeFileSync(release, "release");
    for (const file of [report, entry, preload, release]) if (existsSync(file)) unlinkSync(file);
    rmdirSync(directory);
  }
}

test("FISCAL-83 source native resource limits and deterministic4999/5000deadline are enforced", async () => {
  await assertNativePdfDeadlineAndResources(new URL("./fiscal-pdf.validation.ts", import.meta.url).href, true);
});
test("FISCAL-83 emitted native resource limits and deterministic4999/5000deadline are enforced", async () => {
  assert.equal(typeof emitted?.validateFiscalPdf, "function", "fresh semantic output must be available");
  await assertNativePdfDeadlineAndResources(new URL("../../../../dist/modules/fiscal/infrastructure/fiscal-pdf.validation.js", import.meta.url).href, false);
});
test("FISCAL-83 source valid PDFs distinguish exactly20MiB from one byte above", async () => {
  await assertExactPdfByteBoundary(source.validateFiscalPdf);
});
test("FISCAL-83 emitted valid PDFs distinguish exactly20MiB from one byte above", async () => {
  assert.equal(typeof emitted?.validateFiscalPdf, "function", "fresh semantic output must be available");
  await assertExactPdfByteBoundary(emitted.validateFiscalPdf);
});
