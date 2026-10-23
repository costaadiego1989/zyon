import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Dedicated local fixture: no real API, model, credentials or persistence.
const appDirectory = fileURLToPath(new URL("../", import.meta.url));
if (readdirSync(appDirectory).some(name => name === ".env" || name.startsWith(".env."))) {
  throw new Error("browser_fixture_refuses_local_environment_files");
}
const api = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (path === "/storefront/read-actions/config") {
    response.end(JSON.stringify({
      merchantId: "read-action-merchant", name: "Read action contract fixture", storeSlug: "read-actions",
      description: "Synthetic local browser fixture", theme: { mode: "light", accentColor: "#333333", fontFamily: "system-ui" },
      agentName: "Assistente", agentGreeting: "Como posso ajudar?", quickReplies: ["Explorar categorias"],
      voiceCheckoutEnabled: false, showBranding: false, stories: [], storeSettings: {},
    }));
  } else if (path === "/storefront/read-actions/stories") {
    response.end(JSON.stringify({ categories: [] }));
  } else {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "synthetic_route_not_found" }));
  }
});
await new Promise((resolve, reject) => { api.once("error", reject); api.listen(0, "127.0.0.1", resolve); });
const address = api.address();
const require = createRequire(import.meta.url);
const childEnv = {};
for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ComSpec", "PATHEXT"]) {
  if (process.env[name] !== undefined) childEnv[name] = process.env[name];
}
const guard = new URL("../../api/tests/test-network-guard.mjs", import.meta.url).href;
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "33117"], {
  cwd: appDirectory, windowsHide: true, stdio: "inherit", detached: process.platform !== "win32",
  env: {
    ...childEnv, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
    AACP_API_URL: `http://127.0.0.1:${address.port}`, NEXT_PUBLIC_API_BASE_URL: "/api/v1",
    NEXT_PUBLIC_API_WEBSOCKET_ORIGIN: `ws://127.0.0.1:${address.port}`,
    INTERNAL_SERVICE_TOKEN: "synthetic-local-browser-fixture",
    NODE_OPTIONS: `--max-old-space-size=1536 --import=${guard}`,
  },
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    // Exact PID owned by this fixture, never a process name or port lookup.
    if (process.platform === "win32") {
      const killed = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 10_000 });
      if (killed.error || killed.status !== 0) process.exitCode = 1;
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") process.exitCode = 1; }
    }
  }
  api.close();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.once("error", (error) => { console.error(error.message); stop(); process.exitCode = 1; });
child.once("exit", (code) => { api.close(); if (!stopping) process.exitCode = code ?? 1; });
