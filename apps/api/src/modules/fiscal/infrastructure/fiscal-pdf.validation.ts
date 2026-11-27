import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const metadataLoaders = ["platform-support-loader.mjs", "fiscal-runtime-loader.mjs"]
  .map(name => fileURLToPath(new URL("../../../../tests/" + name, import.meta.url)));
const pathKey = (value: string) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
const isMetadataLoader = (value?: string) => {
  if (!value) return false;
  try { return metadataLoaders.some(loader => pathKey(value.startsWith("file:") ? fileURLToPath(value) : value) === pathKey(loader)); }
  catch { return false; }
};
/** Strip only the known metadata harness, retaining unrelated runtime policy. */
export function fiscalPdfWorkerExecArgv(args: readonly string[] = process.execArgv): string[] {
  const hooks = ["--loader", "--experimental-loader", "--import", "--require", "-r"];
  return args.filter((arg, i) => !(
    hooks.includes(arg) && isMetadataLoader(args[i + 1]) ||
    i > 0 && hooks.includes(args[i - 1]!) && isMetadataLoader(arg) ||
    hooks.some(flag => arg.startsWith(flag + "=") && isMetadataLoader(arg.slice(flag.length + 1)))
  ));
}
/** Isolated parser memory/time bounds also contain compressed object-stream expansion. No external executable. */
export async function validateFiscalPdf(bytes: Uint8Array): Promise<void> {
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("fiscal_pdf_invalid");
  const payload = Uint8Array.from(bytes).buffer;
  const source = new URL("./fiscal-pdf.worker.mjs", import.meta.url);
  const inherited = fiscalPdfWorkerExecArgv();
  // Native inheritance retains process-global options. Node rejects re-encoding
  // --disable-proto in explicit Worker args, but its hardening remains inherited.
  const execArgv = inherited.length === process.execArgv.length ? undefined : inherited.filter((arg, i, args) => !(
    arg === "--disable-proto=throw" || arg === "--disable-proto=delete" ||
    arg === "--disable-proto" && ["throw", "delete"].includes(args[i + 1] ?? "") ||
    i > 0 && args[i - 1] === "--disable-proto" && ["throw", "delete"].includes(arg)
  ));
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(source, { workerData: payload, transferList: [payload], execArgv, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }, stdout: true, stderr: true });
    worker.stdout?.resume(); worker.stderr?.resume();
    let settled = false;
    const finish = (valid: boolean) => { if (settled) return; settled = true; clearTimeout(timeout); void worker.terminate(); if (valid) resolve(); else reject(new Error("fiscal_pdf_invalid")); };
    const timeout = setTimeout(() => finish(false), 5000);
    worker.once("message", message => finish(message === true)); worker.once("error", () => finish(false)); worker.once("exit", () => finish(false));
  });
}
