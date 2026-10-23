import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTestEnvironment } from "./compiled-test-plan.mjs";

// Use a fresh process rather than modifying the caller's environment. Clearing
// NODE_OPTIONS also prevents inherited --env-file/--import activation.
const child = spawn(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
  fileURLToPath(new URL("./compiled-test-worker.mjs", import.meta.url))], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: createTestEnvironment(process.env), stdio: "inherit", windowsHide: true,
});
child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
