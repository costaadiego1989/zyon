import { readdirSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { parseFiscalTestDatabaseUrl } from "./testing/fiscal-test-database.js";

export const fiscalApiRoot = fileURLToPath(new URL("../", import.meta.url));
const fiscalWorkspaceRoot = resolve(fiscalApiRoot, "../..");

/** Source paths remain source paths with real fixture HTTP constructor metadata. */
export function discoverFiscalTestFiles(): string[] {
  const files: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !["fixtures", "__fixtures__", "dist", "node_modules"].includes(entry.name)) visit(path);
      else if (entry.isFile() && /\.spec\.(?:ts|mjs)$/.test(entry.name)) {
        const name = relative(fiscalApiRoot, path).split(sep).join("/");
        if (name.startsWith("src/modules/fiscal/") || /fiscal/i.test(basename(name))) files.push(name);
      }
    }
  }
  for (const directory of ["src", "tests", "scripts"]) visit(join(fiscalApiRoot, directory));
  return files.sort();
}

export async function runFiscalTestFiles(files: readonly string[], options: { capture?: boolean; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ exitCode: number; stdout: string; stderr: string; signal: NodeJS.Signals | null }> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env, NODE_ENV: "test", REDIS_URL: "", REDIS_ENABLED: "false", BILLING_TRIAL_QUEUE_REQUIRED: "false" };
  // Node's worker marker belongs to its parent test protocol. Inheriting it
  // makes an independent --test child silently refuse to execute its files.
  delete env.NODE_TEST_CONTEXT;
  parseFiscalTestDatabaseUrl(env.FISCAL_TEST_DATABASE_URL);
  if (!files.length) throw new Error("fiscal_source_suites_missing");
  return new Promise(resolveRun => {
    const child = spawn(process.execPath, ["--import", "./apps/api/tests/test-network-guard.mjs", "--loader", "./apps/api/tests/fiscal-runtime-loader.mjs", "--test", "--test-concurrency=1", ...files.map(file => resolve(fiscalApiRoot, file))], {
      cwd: fiscalWorkspaceRoot, env, stdio: options.capture ? "pipe" : "inherit", timeout: options.timeoutMs ?? 1_200_000,
    });
    let stdout = "", stderr = "";
    child.stdout?.on("data", chunk => { stdout += String(chunk); });
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    child.once("error", () => resolveRun({ exitCode: 1, stdout, stderr: stderr + "fiscal_source_child_start_failed", signal: null }));
    child.once("close", (code, signal) => resolveRun({ exitCode: code ?? 1, stdout, stderr, signal }));
  });
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const files = discoverFiscalTestFiles();
  if (process.argv.slice(2).length === 1 && process.argv[2] === "--list") {
    process.stdout.write(files.join("\n") + "\n");
  } else if (process.argv.length !== 2) {
    process.stderr.write("fiscal_source_runner_argument_invalid\n"); process.exitCode = 1;
  } else {
    try {
      process.stdout.write("Fiscal source suites: " + files.length + "; concurrency=1; metadata loader\n");
      process.exitCode = (await runFiscalTestFiles(files)).exitCode;
    } catch {
      process.stderr.write("fiscal_source_runner_requires_isolated_local_database\n"); process.exitCode = 1;
    }
  }
}
