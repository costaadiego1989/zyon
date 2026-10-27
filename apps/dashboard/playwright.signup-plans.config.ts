import { defineConfig } from "@playwright/test";
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const requestedStaticDir = process.env.DASHBOARD_STATIC_DIR;
const requestedApiOrigin = process.env.DASHBOARD_STATIC_API_ORIGIN;
if (Boolean(requestedStaticDir) !== Boolean(requestedApiOrigin)) {
  throw new Error("Static layout tests require both DASHBOARD_STATIC_DIR and DASHBOARD_STATIC_API_ORIGIN");
}
let staticDir: string | undefined;
if (requestedStaticDir) {
  if (!isAbsolute(requestedStaticDir)) throw new Error("DASHBOARD_STATIC_DIR must be absolute");
  staticDir = realpathSync(requestedStaticDir);
  if (!statSync(staticDir).isDirectory() || !existsSync(join(staticDir, "index.html")) || !statSync(join(staticDir, "index.html")).isFile()) {
    throw new Error("DASHBOARD_STATIC_DIR must contain an existing index.html");
  }
  // This path is passed to the local webServer shell, never to a build command.
  if (/["`$%!&|<>^\r\n]/.test(staticDir)) throw new Error("Unsupported static directory shell characters");
  const api = new URL(requestedApiOrigin!);
  if (!["http:", "https:"].includes(api.protocol) || api.username || api.password || api.pathname !== "/" || api.search || api.hash) {
    throw new Error("DASHBOARD_STATIC_API_ORIGIN must be an HTTP(S) origin without credentials or path");
  }
}

export default defineConfig({
  testDir:"./e2e",testMatch:"signup-plan-layout.spec.ts",workers:1,retries:0,timeout:30_000,
  reporter:[["list"]],outputDir:staticDir?"test-results/signup-plan-layout-static":"test-results/signup-plan-layout",
  use:{baseURL:"http://127.0.0.1:5219",headless:true,serviceWorkers:"block",trace:"retain-on-failure",screenshot:"only-on-failure"},
  projects:[{name:"chromium",use:{browserName:"chromium"}}],
  webServer:{command:staticDir
      ?`node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5219 --strictPort --outDir "${staticDir.replace(/\\/g,"/")}"`
      :"node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5219 --strictPort",
    url:"http://127.0.0.1:5219",reuseExistingServer:false,timeout:60_000,
    env:staticDir?{NODE_OPTIONS:"--max-old-space-size=512"}
      :{VITE_API_BASE_URL:"http://127.0.0.1:5219/audit-api",NODE_OPTIONS:"--max-old-space-size=512"}},
});
