import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";

const probe = process.argv[4] === "--probe-missing-state-fixture";
assert.equal(process.argv.length, probe ? 5 : 4);
const [url, runId] = process.argv.slice(2), parsedUrl = assertNativePrismaUrl(url);
assert.equal(parsedUrl.searchParams.get("application_name"), `aacp_write_native_${runId}`);
assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "native_worker_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
const merchant = "synthetic-merchant", scope = name => ({ merchantId: merchant, conversationId: name, cartId: name, principalId: "synthetic-principal" });
let active = "owned synthetic identity", passed = 0;
const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
// Private synthetic snapshots are never printed (even assertion causes are redacted).
// Include every ledger/cart row and timestamp, not merely row counts, to detect TTL
// or hidden state writes. Concurrent cases compare against the known writer commit.
const snapshot = async (renamedCart = false) => ({
  scopes: await prisma.$queryRaw`SELECT to_jsonb(s) AS value FROM storefront_execution_scopes s ORDER BY merchant_id,conversation_id`,
  requests: await prisma.$queryRaw`SELECT to_jsonb(r) AS value FROM storefront_write_requests r ORDER BY id`,
  effects: await prisma.$queryRaw`SELECT to_jsonb(e) AS value FROM storefront_local_cart_effects e ORDER BY request_id`,
  carts: renamedCart ? await prisma.$queryRaw`SELECT to_jsonb(c) AS value FROM synthetic_saved_carts c ORDER BY id`
    : await prisma.$queryRaw`SELECT to_jsonb(c) AS value FROM storefront_carts c ORDER BY id`,
});
const safeKeys = result => {
  if (result.kind === "scope_unavailable") { assert.deepEqual(result, { kind: "scope_unavailable" }); return; }
  assert.deepEqual(Object.keys(result).sort(), ["kind","request","revision"]);
  if (result.request !== null) {
    assert.deepEqual(Object.keys(result.request).sort(), ["effect","expectedRevision","messageId","protocolVersion","requestId","state"]);
    if (result.request.effect !== null) assert.deepEqual(Object.keys(result.request.effect).sort(), ["effectId","revision"]);
  }
};
const assertNoSecrets = (result, claim) => {
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /claimToken|claim_token|fingerprint|request_fingerprint|principalId|cartRowId|items|unitPriceCents|PRIVATE_SYNTHETIC/);
  if (claim) assert.equal(json.includes(claim.claimToken), false);
};
try {
  await prisma.$connect();
  const [marker] = await prisma.$queryRaw`SELECT current_database() AS database,run_id FROM synthetic_native_marker`;
  assert.deepEqual(marker, { database: "storefront_synthetic", run_id: runId });
  const { PrismaStorefrontWriteStateQuery } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-write-state.query.ts");
  const query = new PrismaStorefrontWriteStateQuery(prisma);
  const observe = async (input, reader = query) => {
    const before = await snapshot(), result = await reader.read({ scope: input.scope ?? input });
    assert.deepEqual(await snapshot(), before); safeKeys(result); assertNoSecrets(result, input.claim); return result;
  };
  await check("existing synthetic seed is observed without creating request or cart", async () => {
    assert.deepEqual(await observe(scope("synthetic-state-fixture")), { kind: "state", revision: 0, request: null });
  });
  const { PrismaStorefrontWriteAdmissionRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-write-admission.repository.ts");
  const { PrismaStorefrontLocalCartEffectExecutor } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-local-cart-effect.executor.ts");
  const { createPrismaStorefrontLocalCartEffectDependencies } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-local-cart-effect.dependencies.ts");
  const { ExecuteStorefrontLocalCartWrite } = await import("../src/modules/storefront/application/services/execute-storefront-local-cart-write.ts");
  const admission = new PrismaStorefrontWriteAdmissionRepository(prisma), executor = new PrismaStorefrontLocalCartEffectExecutor(prisma);
  const provision = async name => {
    const bound = scope(name);
    await prisma.$executeRaw`INSERT INTO storefront_execution_scopes(merchant_id,conversation_id,cart_id,principal_id) VALUES (${merchant},${name},${name},${bound.principalId})`;
    return { scope: bound, intent: { version: 1, message_id: "synthetic-message", expected_revision: 0,
      command: { tool: "add_item_to_cart", args: { variantId: "synthetic-variant", quantity: 1 } } },
      fingerprint: { version: 1, bytes: Uint8Array.from({ length: 32 }, () => 17) } };
  };
  const claim = async input => { const result = await admission.admit(input); assert.equal(result.kind, "claimed"); return result.claim; };
  const pendingState = (claimValue, state = "processing", effect = null, revision = 0) => ({ kind: "state", revision,
    request: { requestId: claimValue.requestId, messageId: "synthetic-message", protocolVersion: 1, expectedRevision: 0, state, effect } });
  const live = () => {
    const dependencies = createPrismaStorefrontLocalCartEffectDependencies(), calls = { resolve: 0, rules: 0, effect: 0, admit: 0, unknown: 0 };
    const deps = { resolveItem: async (...args) => { calls.resolve++; return dependencies.resolveItem(...args); },
      evaluateRules: async (...args) => { calls.rules++; return dependencies.evaluateRules(...args); } };
    const admissionPort = { admit: async input => { calls.admit++; return admission.admit(input); },
      markUnknown: async input => { calls.unknown++; return admission.markUnknown(input); } };
    const effectPort = { execute: async input => { calls.effect++; return executor.execute(input, deps); } };
    return { calls, deps, admissionPort, effectPort, execute: input => new ExecuteStorefrontLocalCartWrite(admissionPort, effectPort).execute(input) };
  };
  const cartRows = input => prisma.$queryRaw`SELECT id,items,total,discount,expires_at AS expires FROM storefront_carts WHERE merchant_id=${input.scope.merchantId} AND session_id=${input.scope.cartId}`;
  const effectCount = async input => (await prisma.$queryRaw`SELECT count(*)::int AS value FROM storefront_local_cart_effects WHERE merchant_id=${input.scope.merchantId} AND conversation_id=${input.scope.conversationId}`)[0].value;
  await check("missing or foreign full scope is unavailable without creating or exposing any state", async () => {
    const bound = scope("synthetic-state-fixture");
    for (const changed of [scope("absent"), { ...bound, merchantId: "foreign" }, { ...bound, cartId: "foreign" }, { ...bound, principalId: "foreign" }])
      assert.deepEqual(await observe(changed), { kind: "scope_unavailable" });
  });
  await check("processing and unknown observations never expose claim token fingerprint or imply execution permission", async () => {
    const input = await provision("pending"), original = await claim(input);
    assert.deepEqual(await observe({ ...input, claim: original }), pendingState(original));
    await admission.markUnknown({ scope: input.scope, claim: original });
    assert.deepEqual(await observe({ ...input, claim: original }), pendingState(original, "unknown"));
    const orchestration = live(); assert.deepEqual(await orchestration.execute(input), { kind: "receipt_required", requestId: original.requestId, state: "unknown" });
    assert.deepEqual(orchestration.calls, { resolve: 0, rules: 0, effect: 0, admit: 1, unknown: 0 }); assert.equal((await cartRows(input)).length, 0);
  });
  await check("real orchestration records one effect and duplicate admission cannot invoke any commercial dependency twice", async () => {
    const input = await provision("orchestrator-commit"), orchestration = live();
    const result = await orchestration.execute(input); assert.equal(result.kind, "local_effect_recorded"); assert.equal(result.revision, 1); assertNoSecrets(result);
    assert.deepEqual(await observe(input), pendingState({ requestId: result.requestId }, "processing", { effectId: result.effectId, revision: 1 }, 1));
    assert.deepEqual(await orchestration.execute(input), { kind: "receipt_required", requestId: result.requestId, state: "processing" });
    assert.deepEqual(await orchestration.execute({ ...input, intent: { ...input.intent, message_id: "new-key" } }), { kind: "lane_blocked" });
    assert.deepEqual(orchestration.calls, { resolve: 1, rules: 1, effect: 1, admit: 3, unknown: 0 });
    assert.equal((await cartRows(input))[0].items[0].quantity, 1); assert.equal(await effectCount(input), 1);
  });
  await check("identity conflicts preserve original state and never invoke the executor", async () => {
    const input = await provision("identity-conflict"), original = await claim(input), orchestration = live();
    assert.deepEqual(await orchestration.execute({ ...input, fingerprint: { version: 2, bytes: input.fingerprint.bytes } }), { kind: "identity_conflict" });
    assert.deepEqual(await orchestration.execute({ ...input, fingerprint: { version: 1, bytes: Uint8Array.from({ length: 32 }, () => 34) } }), { kind: "identity_conflict" });
    assert.deepEqual(await observe({ ...input, claim: original }), pendingState(original)); assert.equal(orchestration.calls.effect, 0);
  });
  await check("expired and missing cart never erase reference renew TTL or turn recovery into a new intent", async () => {
    const input = await provision("expired-cart"), orchestration = live(), recorded = await orchestration.execute(input);
    const expected = pendingState({ requestId: recorded.requestId }, "processing", { effectId: recorded.effectId, revision: 1 }, 1);
    await prisma.$executeRaw`UPDATE storefront_carts SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 day' WHERE session_id=${input.scope.cartId} AND merchant_id=${merchant}`;
    assert.deepEqual(await observe(input), expected);
    await prisma.$executeRaw`DELETE FROM storefront_carts WHERE session_id=${input.scope.cartId} AND merchant_id=${merchant}`;
    assert.deepEqual(await observe(input), expected);
    assert.deepEqual(await orchestration.execute(input), { kind: "receipt_required", requestId: recorded.requestId, state: "processing" });
    assert.equal((await cartRows(input)).length, 0); assert.equal(orchestration.calls.effect, 1);
  });
  await check("execution rollback becomes sanitized unknown and does not replay callbacks on duplicate", async () => {
    const input = await provision("execution-rollback"), orchestration = live();
    const failingDeps = { resolveItem: orchestration.deps.resolveItem, evaluateRules: async (...args) => { await orchestration.deps.evaluateRules(...args); throw new Error("PRIVATE_SYNTHETIC_RULE_FAILURE"); } };
    const effectPort = { execute: async claimed => { orchestration.calls.effect++; return executor.execute(claimed, failingDeps); } };
    const application = new ExecuteStorefrontLocalCartWrite(orchestration.admissionPort, effectPort), result = await application.execute(input);
    assert.equal(result.kind, "outcome_unknown"); assert.deepEqual(Object.keys(result).sort(), ["kind","requestId"]); assertNoSecrets(result);
    assert.deepEqual(await observe(input), pendingState({ requestId: result.requestId }, "unknown"));
    assert.equal((await cartRows(input)).length, 0); assert.equal(await effectCount(input), 0);
    assert.deepEqual(await application.execute(input), { kind: "receipt_required", requestId: result.requestId, state: "unknown" });
    assert.deepEqual(orchestration.calls, { resolve: 1, rules: 1, effect: 1, admit: 2, unknown: 1 });
  });
  await check("post-commit lost effect response returns unknown while immutable proof survives without callback replay", async () => {
    const input = await provision("effect-ack-lost"), orchestration = live(); let committed;
    const effectPort = { execute: async claimed => { committed = await orchestration.effectPort.execute(claimed); throw new Error("PRIVATE_SYNTHETIC_LOST_ACK"); } };
    const application = new ExecuteStorefrontLocalCartWrite(orchestration.admissionPort, effectPort), result = await application.execute(input);
    assert.deepEqual(result, { kind: "outcome_unknown", requestId: committed.requestId }); assertNoSecrets(result);
    assert.deepEqual(await observe(input), pendingState({ requestId: result.requestId }, "unknown", { effectId: committed.effectId, revision: 1 }, 1));
    assert.deepEqual(await application.execute(input), { kind: "receipt_required", requestId: result.requestId, state: "unknown" });
    assert.equal((await cartRows(input))[0].items[0].quantity, 1); assert.equal(await effectCount(input), 1);
    assert.deepEqual(orchestration.calls, { resolve: 1, rules: 1, effect: 1, admit: 2, unknown: 1 });
  });
  await check("post-commit lost admission response stays admission unknown with durable blocking request and no invented token", async () => {
    const input = await provision("admission-ack-lost"), orchestration = live(); let committed;
    const admissionPort = { admit: async value => { committed = await orchestration.admissionPort.admit(value); throw new Error("PRIVATE_SYNTHETIC_ADMISSION_ACK"); }, markUnknown: orchestration.admissionPort.markUnknown };
    assert.deepEqual(await new ExecuteStorefrontLocalCartWrite(admissionPort, orchestration.effectPort).execute(input), { kind: "admission_unknown" });
    assert.equal(committed.kind, "claimed"); assert.deepEqual(await observe({ ...input, claim: committed.claim }), pendingState(committed.claim));
    assert.deepEqual(await orchestration.execute(input), { kind: "receipt_required", requestId: committed.claim.requestId, state: "processing" });
    assert.deepEqual(orchestration.calls, { resolve: 0, rules: 0, effect: 0, admit: 2, unknown: 0 });
  });
  await check("one exact real SELECT succeeds in a database-enforced READ ONLY transaction without cart or secret projection", async () => {
    const input = { scope: scope("effect-ack-lost") }; let statements = 0;
    // TEST ONLY: production query must receive the trusted root client. This
    // delegate merely executes its unmodified SQL on an actual read-only DB tx.
    const readonly = new PrismaStorefrontWriteStateQuery({ $queryRaw: async (...args) => {
      statements++; const sql = args[0].join("?");
      assert.doesNotMatch(sql, /claim_token|fingerprint|storefront_carts|product_prices|merchant_rules|checkout_settings|product_promotions|\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
      return prisma.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        assert.equal((await tx.$queryRaw`SELECT current_setting('transaction_read_only') AS value`)[0].value, "on");
        return tx.$queryRaw(...args);
      });
    } });
    assert.deepEqual(await observe(input, readonly), await observe(input)); assert.equal(statements, 1);
  });
  await check("observation remains available when cart and all commercial authority tables are temporarily absent", async () => {
    const input = { scope: scope("effect-ack-lost") }, expected = await observe(input);
    const beforeRenames = await snapshot();
    // Fixed identifiers, never caller input. Query SQL itself is never rewritten.
    await prisma.$executeRaw`ALTER TABLE storefront_carts RENAME TO synthetic_saved_carts`;
    await prisma.$executeRaw`ALTER TABLE product_prices RENAME TO synthetic_saved_prices`;
    await prisma.$executeRaw`ALTER TABLE merchant_rules RENAME TO synthetic_saved_rules`;
    await prisma.$executeRaw`ALTER TABLE checkout_settings RENAME TO synthetic_saved_settings`;
    await prisma.$executeRaw`ALTER TABLE product_promotions RENAME TO synthetic_saved_promos`;
    try {
      const beforeRead = await snapshot(true), result = await query.read(input);
      assert.deepEqual(await snapshot(true), beforeRead); assert.deepEqual(result, expected); safeKeys(result); assertNoSecrets(result);
    }
    finally {
      await prisma.$executeRaw`ALTER TABLE synthetic_saved_promos RENAME TO product_promotions`;
      await prisma.$executeRaw`ALTER TABLE synthetic_saved_settings RENAME TO checkout_settings`;
      await prisma.$executeRaw`ALTER TABLE synthetic_saved_rules RENAME TO merchant_rules`;
      await prisma.$executeRaw`ALTER TABLE synthetic_saved_prices RENAME TO product_prices`;
      await prisma.$executeRaw`ALTER TABLE synthetic_saved_carts RENAME TO storefront_carts`;
    }
    assert.deepEqual(await snapshot(), beforeRenames); assert.deepEqual(await observe(input), expected);
  });
  await check("paused delivery of an actual completed SELECT stays coherent when writer commits before response delivery", async () => {
    const input = await provision("delivery-race"), original = await claim(input);
    let selected, release; const selectedSignal = new Promise(resolve => { selected = resolve; }), delivery = new Promise(resolve => { release = resolve; });
    const before = await snapshot(); let statements = 0;
    const delayed = new PrismaStorefrontWriteStateQuery({ $queryRaw: async (...args) => { statements++; const actualRows = await prisma.$queryRaw(...args); selected(); await delivery; return actualRows; } });
    const pending = delayed.read({ scope: input.scope }).then(result => ({ result }), error => ({ error }));
    try {
      await Promise.race([selectedSignal, pending.then(outcome => { if (outcome.error) throw outcome.error; throw new Error("synthetic_select_not_observed"); })]);
      const recorded = await executor.execute({ ...input, claim: original }, createPrismaStorefrontLocalCartEffectDependencies());
      assert.equal(recorded.kind, "effect_recorded"); const afterWriter = await snapshot(); assert.notDeepEqual(afterWriter, before);
      assert.deepEqual(await observe(input), pendingState(original, "processing", { effectId: recorded.effectId, revision: 1 }, 1));
      release(); const outcome = await pending; if (outcome.error) throw outcome.error;
      assert.deepEqual(outcome.result, pendingState(original)); safeKeys(outcome.result); assertNoSecrets(outcome.result, original);
      assert.deepEqual(await snapshot(), afterWriter); assert.equal(statements, 1);
    } finally { release(); await pending; }
  });
  console.log(JSON.stringify({ status: "passed", tests: passed, actualPrismaStateQuery: true, realApplicationOrchestration: true,
    prismaClients: 1, oneStatementMvcc: true, readOnlyRecovery: true, terminalRecoveryProven: false, businessExactlyOnceProven: false, productionAccess: false }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", test: active, errorType: error?.name ?? "Error", code: typeof error?.code === "string" ? error.code : undefined }));
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
