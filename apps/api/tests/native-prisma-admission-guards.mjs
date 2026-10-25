import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export function nativePrismaWorkerEnvironment(source) {
  const allowed = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "TEMP", "TMP", "TZ"];
  return { ...Object.fromEntries(allowed.filter(key => source[key] !== undefined).map(key => [key, source[key]])), NODE_ENV: "test" };
}

/** Called only for the child process created by this test's parent. */
export async function terminateOwnedNativeWorker(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  let timer;
  try {
    await new Promise((resolve, reject) => {
      child.once("close", resolve);
      timer = setTimeout(() => reject(new Error("owned_native_worker_cleanup_timeout")), timeoutMs);
      child.kill();
    });
  } finally { clearTimeout(timer); }
}

export function assertNativePrismaUrl(raw) {
  const url = new URL(raw);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.username, "postgres"); assert.equal(url.password, "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/storefront_synthetic");
  assert.ok(/^\d+$/.test(url.port) && Number(url.port) > 1024 && Number(url.port) <= 65535, "ephemeral_loopback_port_required");
  assert.equal(url.hash, "");
  const entries = [...url.searchParams];
  assert.equal(entries.length, 5);
  for (const [key, value] of [["schema", "public"], ["connection_limit", "24"], ["connect_timeout", "15"], ["pool_timeout", "15"]]) assert.equal(url.searchParams.get(key), value);
  assert.match(url.searchParams.get("application_name") ?? "", /^aacp_write_native_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.ok(entries.every(([key]) => ["schema", "connection_limit", "connect_timeout", "pool_timeout", "application_name"].includes(key)));
  return url;
}

const within = (file, root) => { const relative = path.relative(root, file); return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

/** Inspects generated code/paths only; never reads an .env file or imports Prisma. */
export function assertGeneratedPrismaEnvironment({ source, generatedDirectory, workspaceRoot, apiRoot, exists = existsSync }) {
  assert.ok(within(generatedDirectory, workspaceRoot), "generated_client_outside_workspace");
  assert.ok(exists(path.join(generatedDirectory, "schema.prisma")), "generated_schema_required_no_fallback_dir");
  const matches = [...source.matchAll(/"relativeEnvPaths"\s*:\s*(\{[^}]*\})/g)];
  assert.equal(matches.length, 1, "known_generated_env_metadata_required");
  const metadata = JSON.parse(matches[0][1]);
  assert.ok(metadata && typeof metadata === "object" && !Array.isArray(metadata));
  assert.ok(Object.keys(metadata).every(key => ["rootEnvPath", "schemaEnvPath"].includes(key)), "unknown_generated_env_metadata");
  const checked = new Set([path.join(workspaceRoot, ".env"), path.join(apiRoot, ".env"), path.join(apiRoot, "prisma", ".env"), path.join(generatedDirectory, ".env")]);
  for (const key of ["rootEnvPath", "schemaEnvPath"]) {
    const value = metadata[key];
    assert.ok(value === undefined || value === null || typeof value === "string" && value.length > 0, "unknown_generated_env_path");
    if (typeof value === "string") {
      assert.ok(!path.isAbsolute(value) && !/[\x00\r\n]/.test(value), "unsafe_generated_env_path");
      const candidate = path.resolve(generatedDirectory, value);
      assert.ok(within(candidate, workspaceRoot) && path.basename(candidate) === ".env", "unknown_generated_env_location");
      checked.add(candidate);
    }
  }
  for (const candidate of checked) assert.equal(exists(candidate), false, "env_file_presence_forbidden_before_prisma_import");
  return { relativeEnvPaths: metadata, checkedCount: checked.size };
}

export function inspectNativePrismaClient(apiRoot) {
  assert.equal(process.platform, "win32", "native_windows_prisma_fixture_required");
  const workspaceRoot = path.resolve(apiRoot, "../..");
  const require = createRequire(path.join(apiRoot, "package.json"));
  const clientEntry = require.resolve("@prisma/client");
  assert.ok(within(clientEntry, workspaceRoot), "prisma_package_outside_workspace");
  const generatedEntry = createRequire(clientEntry).resolve(".prisma/client/default");
  const generatedDirectory = path.dirname(generatedEntry);
  const safety = assertGeneratedPrismaEnvironment({ source: readFileSync(path.join(generatedDirectory, "index.js"), "utf8"), generatedDirectory, workspaceRoot, apiRoot });
  assert.ok(existsSync(path.join(generatedDirectory, "query_engine-windows.dll.node")), "cached_windows_prisma_engine_required_no_download");
  return { ...safety, nativeEngine: "windows-library", clientEntry };
}
