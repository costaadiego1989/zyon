import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createTestEnvironment, collectTestImports } from "./compiled-test-plan.mjs";

const api = new URL("../", import.meta.url);
const json = (name) => JSON.parse(readFileSync(new URL(name, api), "utf8"));

test("production and test builds have separate output trees and retain Nest metadata", () => {
  const parsed = ts.getParsedCommandLineOfConfigFile(fileURLToPath(new URL("tsconfig.test-runner.json", api)), {}, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: (error) => assert.fail(ts.flattenDiagnosticMessageText(error.messageText, "\n")),
  });
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.options.outDir, fileURLToPath(new URL("dist-test", api)).replaceAll("\\", "/"));
  assert.equal(parsed.options.emitDecoratorMetadata, true);
  assert.equal(parsed.options.noEmitOnError, true);
  assert.ok(parsed.fileNames.some((name) => name.endsWith("/src/test-runner.ts")));
  assert.ok(json("tsconfig.build.json").exclude.includes("**/*test-runner*.ts"));
});

test("default test command compiles tests explicitly and never runs a production-dist runner", () => {
  const { scripts } = json("package.json");
  assert.equal(scripts.test, "pnpm build && pnpm test:compile && pnpm test:compiled");
  assert.equal(scripts["test:compile"], "tsc -p tsconfig.test-runner.json");
  assert.equal(scripts["test:compiled"], "node ./tests/run-compiled-tests.mjs");
});

test("default test environment drops credentials, integration gates, injected loaders and custom endpoints", () => {
  const incoming = { PATH: "system-bin", SystemRoot: "C:\\Windows", TEMP: "temp", DATABASE_URL: "private",
    OPENAI_API_KEY: "private", REDIS_URL: "private", AWS_PROFILE: "prod", NODE_OPTIONS: "--import private",
    RUN_REAL_AI_E2E: "true", AACP_RUN_PRISMA_TESTS: "1", E2E_SEED_ENABLED: "true", NODE_ENV: "production",
    DOTENV_CONFIG_PATH: "private", OTEL_EXPORTER_OTLP_ENDPOINT: "https://private.test", CUSTOM_SECRET: "private" };
  const snapshot = { ...incoming };
  const env = createTestEnvironment(incoming);
  assert.deepEqual(incoming, snapshot);
  assert.equal(env.PATH, "system-bin");
  assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal(env.NODE_ENV, "test");
  assert.equal(env.RUN_REAL_AI_E2E, "false");
  assert.equal(env.AACP_RUN_PRISMA_TESTS, "0");
  assert.equal(env.E2E_SEED_ENABLED, "false");
  for (const key of ["DATABASE_URL", "OPENAI_API_KEY", "REDIS_URL", "AWS_PROFILE", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "OTEL_EXPORTER_OTLP_ENDPOINT", "CUSTOM_SECRET"]) {
    assert.equal(env[key], undefined, key);
  }
});

test("test inventory uses syntax, keeps all static registrations and isolates files", () => {
  assert.deepEqual(collectTestImports(`// import "./not-a-test.spec.js";
    import "./first.spec.js";
    import "./second.int-spec.js";
    if (process.env.E2E_SEED_ENABLED === "true") {
      await import("./modules/__test__/test-seed.controller.spec.js");
    }`), ["./first.spec.js", "./second.int-spec.js"]);
  const registrations = collectTestImports(readFileSync(new URL("src/test-runner.ts", api), "utf8"));
  assert.ok(registrations.length > 300);
  assert.ok(registrations.includes("./modules/checkout/presentation/http/checkout.ai-live-e2e-spec.js"));
  assert.ok(registrations.includes("./modules/auth/presentation/auth-merchant.prisma-e2e-spec.js"));
});

test("inventory rejects malformed, non-test, duplicate or escaping registrations", () => {
  for (const source of ['import "../outside.spec.js";', 'import "node:fs";', 'import "./main.js";',
    'import "./a.spec.js"; import "./a.spec.js";', 'import "./a.spec.js"; await import("./hidden.spec.js");']) {
    assert.throws(() => collectTestImports(source));
  }
});

const guarded = (source) => spawnSync(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href, "--input-type=module", "-e", source], {
  env: createTestEnvironment(process.env), encoding: "utf8", timeout: 10_000, windowsHide: true,
});

test("test worker blocks external fetch and TCP before connection", () => {
  const result = guarded(`import assert from "node:assert/strict"; import net from "node:net";
    await assert.rejects(fetch("https://example.com"), /test_external_network_forbidden/);
    assert.throws(() => net.connect({ host: "192.0.2.1", port: 443 }), /test_external_network_forbidden/);
    assert.throws(() => net.connect({ host: "127.0.0.1.example.test", port: 80 }), /test_external_network_forbidden/);
  `);
  assert.equal(result.status, 0, result.stderr);
});

test("test worker allows real loopback HTTP and synthetic fetch replacements", () => {
  const result = guarded(`import assert from "node:assert/strict"; import { createServer } from "node:http";
    const server = createServer((_req, res) => res.end("local-only"));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try { assert.equal(await (await fetch("http://127.0.0.1:" + server.address().port)).text(), "local-only"); }
    finally { await new Promise(resolve => server.close(resolve)); }
    globalThis.fetch = async () => new Response("synthetic");
    assert.equal(await (await fetch("https://provider.example.test")).text(), "synthetic");
  `);
  assert.equal(result.status, 0, result.stderr);
});

test("programmatic test run inherits the preload in an isolated file process", () => {
  const result = guarded(`import { run } from "node:test"; import { tap } from "node:test/reporters";
    const results = run({ files: [${JSON.stringify(fileURLToPath(new URL("./fixtures/runner-network-probe.mjs", import.meta.url)))}] });
    results.on("test:fail", () => { process.exitCode = 1; });
    results.compose(tap).pipe(process.stdout);
  `);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /# pass 1/);
  assert.match(result.stdout, /# fail 0/);
});

test("custom lookup keeps the requested hostname but may resolve only to loopback", () => {
  const result = guarded(`import assert from "node:assert/strict"; import { createServer, get } from "node:http";
    const server = createServer((req, res) => { assert.match(req.headers.host, /^verified-webhook.example:/); res.end("pinned"); });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const lookup = address => (_host, options, callback) => callback(null, options.all ? [{ address, family: 4 }] : address, 4);
    const send = address => new Promise((resolve, reject) => {
      get("http://verified-webhook.example:" + server.address().port, { lookup: lookup(address), agent: false }, res => {
        res.resume(); res.on("end", () => resolve(res.statusCode));
      }).on("error", reject);
    });
    try { assert.equal(await send("127.0.0.1"), 200); await assert.rejects(send("192.0.2.1"), /test_external_network_forbidden/); }
    finally { await new Promise(resolve => server.close(resolve)); }
  `);
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
