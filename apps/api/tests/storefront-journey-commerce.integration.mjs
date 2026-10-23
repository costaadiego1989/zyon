import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { constructionOnlyEnvironment } from "./nest-construction-only.guards.mjs";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { createDisposableRedis } from "./local-disposable-redis.mjs";
import { inspectNativePrismaClient, terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";
import { inspectOriginalJourneyBudget, parseJourneyBudgetAuditFlags } from "./storefront-journey-original-budget.mjs";
import { assertFreshJourneyRuntimeArtifacts, journeyRuntimeArtifactEntries } from "./storefront-journey-compiled-artifact.mjs";
import { installCheckoutSessionVersionTrigger } from "./checkout-session-version-trigger.mjs";
import { parseJourneyLifecycleLine } from "./storefront-journey-lifecycle.mjs";

// Independent phase A; never broaden bootstrap-only or enable any provider.
const flags = ["--local-disposable", "--prisma-loopback-exec", "--compiled-test-artifact", "--commerce-only", "--no-real-provider"];
const budgetAudit = parseJourneyBudgetAuditFlags(process.argv.slice(2), flags);
const apiRoot = fileURLToPath(new URL("../", import.meta.url)), tree = "dist-test";
assertFreshJourneyRuntimeArtifacts();
for (const entry of journeyRuntimeArtifactEntries()) assert.ok(existsSync(new URL(`../${tree}/${entry}`, import.meta.url)), "fresh_canonical_compiled_artifacts_required");
inspectNativePrismaClient(apiRoot);
const workspaceRoot = resolve(apiRoot, "../..");
for (const root of [apiRoot, workspaceRoot]) for (const name of ["prisma.config.ts", "prisma.config.js", "prisma.config.mjs", "prisma.config.cjs", "prisma.config.mts", "prisma.config.cts",
  ".config/prisma.ts", ".config/prisma.js", ".config/prisma.mjs", ".config/prisma.cjs"]) {
  const path = resolve(root, name);
  if (path === resolve(apiRoot, "prisma.config.ts")) {
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"),
      "90fff1aba794a45710e913c8297df44c739ed8e06bf457ec0809fc65c723e34d", "journey_prisma_cli_config_changed_requires_review");
  } else assert.equal(existsSync(path), false, "journey_unreviewed_prisma_cli_config_forbidden");
}
const before = inspectOriginalJourneyBudget(budgetAudit);
const runId = randomUUID(), merchantId = randomUUID(), buyerId = randomUUID();
let db, redis, child, failure, result, stdout = "", stderr = "";
const stage = value => console.log("JOURNEY_COMMERCE_STAGE " + JSON.stringify(value));
try {
  db = await createDisposablePostgres({ transport: "loopback-exec" }); redis = await createDisposableRedis();
  stage({ stage: "owned_resources_created", providerCalls: 0 });
  // Same reviewed canonical full-schema/CLI path as bootstrap; no migration
  // history claim and no truncated handwritten commerce schema.
  const require = createRequire(new URL("../package.json", import.meta.url));
  const packagePath = require.resolve("prisma/package.json"), pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const bin = pkg.bin?.prisma;
  assert.ok(pkg.name === "prisma" && typeof bin === "string" && bin && !bin.includes("\0") && !isAbsolute(bin), "journey_local_prisma_declared_cli_required");
  const packageRoot = dirname(packagePath), cli = resolve(packageRoot, bin), cliRelative = relative(packageRoot, cli);
  assert.ok(cliRelative && cliRelative !== ".." && !cliRelative.startsWith("..\\") && !cliRelative.startsWith("../") && !isAbsolute(cliRelative)
    && existsSync(cli) && statSync(cli).isFile(), "journey_local_prisma_declared_cli_must_stay_in_package");
  const enginesEntry = createRequire(cli).resolve("@prisma/engines"), schemaEngine = resolve(dirname(enginesEntry), "..", "schema-engine-windows.exe");
  for (const file of [cli, enginesEntry, schemaEngine]) {
    const path = relative(workspaceRoot, file);
    assert.ok(path !== ".." && !path.startsWith("..\\") && !isAbsolute(path) && existsSync(file), "journey_cached_local_prisma_cli_engine_required_no_download");
  }
  const diff = await promisify(execFile)(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
    cli, "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
    { cwd: apiRoot, env: { ...constructionOnlyEnvironment(process.env), DATABASE_URL: db.prismaUrl }, windowsHide: true, timeout: 60_000, maxBuffer: 8_000_000 });
  assert.ok(diff.stdout.includes("CREATE TABLE") && diff.stdout.includes('"merchants"') && diff.stdout.includes('"buyer_accounts"'), "canonical_full_schema_sql_required");
  await db.sql(diff.stdout);
  await installCheckoutSessionVersionTrigger(db);
  assert.ok(Number(await db.sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")) > 100, "complete_canonical_schema_required");
  await db.sql(`CREATE TABLE synthetic_native_marker (run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');
    CREATE TABLE synthetic_storefront_journey_binding (run_id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, buyer_id TEXT NOT NULL,
      session_id TEXT NOT NULL, api_origin TEXT NOT NULL, postgres_run_id TEXT NOT NULL, redis_run_id TEXT NOT NULL);`);
  stage({ stage: "canonical_schema_applied", migrationHistoryValidated: false, providerCalls: 0 });
  child = spawn(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
    fileURLToPath(new URL("./storefront-journey-commerce.worker.mjs", import.meta.url)), db.prismaUrl, db.runId, redis.url, redis.runId, tree, runId, merchantId, buyerId],
    { cwd: apiRoot, env: constructionOnlyEnvironment(process.env), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let offset = 0, overLimit = false;
  child.stdout.on("data", chunk => {
    stdout += chunk;
    if (stdout.length + stderr.length > 4_000_000) { overLimit = true; child.kill(); return; }
    const lines = stdout.slice(offset).split(/\r?\n/);
    for (const line of lines.slice(0, -1)) {
      if (line.startsWith("JOURNEY_COMMERCE_STAGE ") || line.startsWith("JOURNEY_COMMERCE_RESULT ")) process.stdout.write(line + "\n");
      const lifecycle = parseJourneyLifecycleLine(line);
      if (lifecycle) stage({ stage: "lifecycle", lifecycle });
      // FAILURE is emitted after owned-app cleanup. Allow natural exit1;
      // the bounded parent deadline still owns termination of a stuck worker.
    }
    offset = stdout.length - lines.at(-1).length;
  });
  child.stderr.on("data", chunk => { stderr += chunk; if (stdout.length + stderr.length > 4_000_000) { overLimit = true; child.kill(); } });
  let timer;
  const outcome = await Promise.race([new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); }),
    // Seven real scenarios plus owned AppModule shutdown, not the original
    // three-case budget. No request timeout, auth or application limit changes.
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error("journey_owned_commerce_child_deadline")), 300_000); })]).finally(() => clearTimeout(timer));
  assert.equal(overLimit, false); assert.equal(outcome.code, 0, "canonical_commerce_http_or_cleanup_failed"); assert.equal(outcome.signal, null);
  const results = stdout.split(/\r?\n/).filter(line => line.startsWith("JOURNEY_COMMERCE_RESULT "));
  assert.equal(results.length, 1); result = JSON.parse(results[0].slice("JOURNEY_COMMERCE_RESULT ".length));
  assert.equal(result.realHttpControllers, true); assert.equal(result.providerCalls, 0);
  assert.equal(result.repositoryOverrides, false); assert.equal(result.authOverrides, false);
  assert.equal(result.publicAddValidated, false); assert.equal(result.acceptedWidgetReceiptActivated, false);
  assert.equal(result.paidJourneyValidated, false); assert.equal(result.actualPspValidated, false); assert.equal(result.appClosed, true);
  assert.deepEqual(result.scenarios.map(item => item.kind), ["ordinary_legacy_canonical", "cross_sell_options", "checkout_cross_sell_options",
    "checkout_cross_sell_digital", "checkout_cross_sell_service", "checkout_cross_sell_mixed", "checkout_cross_sell_scheduled_blocked"]);
  for (const scenario of result.scenarios) {
    assert.equal(scenario.normalCheckout, true); assert.equal(scenario.canonicalRead, true); assert.equal(scenario.buyerHydrated, true);
    if (scenario.kind === "checkout_cross_sell_scheduled_blocked") {
      assert.equal(scenario.scheduledServiceBlocked, true);
      assert.equal(scenario.normalCrossSell.scheduledServiceBlocked, true);
      assert.equal(scenario.normalCrossSell.refusedWritesUnchanged, true);
      assert.equal(scenario.normalCrossSell.durableAcceptanceAbsent, true);
      assert.equal(scenario.merchandiseCents, 5000); assert.deepEqual(scenario.shipping, []);
      continue;
    }
    assert.equal(scenario.recoveredOriginalSession, true); assert.equal(scenario.negativePaymentWithoutConnection, true);
    assert.equal(scenario.recoveryAuthRefusalsValidated,
      ["ordinary_legacy_canonical", "cross_sell_options", "checkout_cross_sell_options"].includes(scenario.kind));
    const virtual = ["checkout_cross_sell_digital", "checkout_cross_sell_service"].includes(scenario.kind);
    assert.equal(scenario.virtualDelivery, virtual);
    assert.deepEqual(scenario.shipping, virtual ? [] : [{ mode: "flat", priceCents: 700 }, { mode: "neighborhood", priceCents: 900 }]);
  }
  for (const [kind, types] of [["checkout_cross_sell_options", ["physical", "physical"]], ["checkout_cross_sell_digital", ["digital", "digital"]],
    ["checkout_cross_sell_service", ["service", "service"]], ["checkout_cross_sell_mixed", ["physical", "digital"]]]) {
    const normal = result.scenarios.find(item => item.kind === kind).normalCrossSell;
    for (const field of ["advertisedDiscountApplied", "explicitOptions", "durableAcknowledgement", "refusedWritesUnchanged", "repeatAcceptNoWrite"])
      assert.equal(normal[field], true);
    assert.equal(normal.merchandiseCents, 9950); assert.deepEqual(normal.productTypes, types);
    assert.equal(normal.canonicalStage, types.some(type => type === "physical") ? "shipping" : "payment");
  }
  const neighborhood = result.scenarios.find(item => item.kind === "ordinary_legacy_canonical").neighborhoodOrigin;
  assert.ok(neighborhood);
  for (const key of ["sameCityNormalized", "foreignSessionRefusedNoWrites", "missingCityRefusedNoWrites", "foreignCityRefusedNoWrites",
    "foreignStateRefusedNoWrites", "forgedBodyCannotGrantCoverage", "originZipBound", "originMissingCityRefusedNoWrites",
    "unavailableQuoteRecordedNotFinancialMutation", "sourceCommercePreserved", "customerAndOriginRestored", "currentSelectionRestored"])
    assert.equal(neighborhood[key], true);
} catch (error) {
  for (const line of stdout.split(/\r?\n/).filter(line => line.startsWith("JOURNEY_COMMERCE_FAILURE "))) process.stderr.write(line + "\n");
  // Never dump unrelated worker/library stdout/stderr or credentials.
  failure = error;
} finally {
  const cleanup = [];
  try { await terminateOwnedNativeWorker(child); } catch (error) { cleanup.push(error); }
  for (const owned of [redis, db]) {
    if (!owned) continue;
    try { await owned.dispose(); assert.deepEqual(owned.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); }
    catch (error) { cleanup.push(error); }
  }
  try { const after = inspectOriginalJourneyBudget(budgetAudit); assert.equal(after.attemptedCalls, before.attemptedCalls, "commerce_must_not_consume_approved_llm_calls"); }
  catch (error) { cleanup.push(error); }
  if (cleanup.length) failure = new AggregateError([...(failure ? [failure] : []), ...cleanup], "journey_commerce_owned_resource_cleanup_failed");
  stage({ stage: "owned_resources_removed", status: failure ? "failed" : "passed",
    cleanupErrors: cleanup.length, ownedResourcesRemoved: cleanup.length === 0 });
}
if (failure) throw failure;
console.log(JSON.stringify({ ...result, fullCanonicalSchema: true, disposablePostgres: true, disposableRedis: true,
  cleanupRemaining: 0, approvedLlmCallsBefore: before.attemptedCalls, approvedLlmCallsAfter: before.attemptedCalls }));
