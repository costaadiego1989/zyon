import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";

const mode = process.argv[4];
assert.ok(mode === undefined || ["--probe-missing-effect-table", "--ddl-only"].includes(mode));
assert.equal(process.argv.length, mode ? 5 : 4);
const [url, runId] = process.argv.slice(2);
const parsedUrl = assertNativePrismaUrl(url);
assert.equal(parsedUrl.searchParams.get("application_name"), `aacp_write_native_${runId}`);
assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "native_worker_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const { PrismaStorefrontWriteAdmissionRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-write-admission.repository.ts");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
const admission = new PrismaStorefrontWriteAdmissionRepository(prisma);
const merchant = "synthetic-merchant";
const provision = async (name, supplied = {}) => {
  const scope = { merchantId: merchant, conversationId: name, cartId: name, principalId: "synthetic-principal", ...supplied };
  await prisma.$executeRaw`INSERT INTO merchants (id) VALUES (${scope.merchantId}) ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO storefront_execution_scopes (merchant_id,conversation_id,cart_id,principal_id)
    VALUES (${scope.merchantId},${scope.conversationId},${scope.cartId},${scope.principalId})`;
  const input = { scope, intent: { version: 1, message_id: "synthetic-message", expected_revision: 0,
    command: { tool: "add_item_to_cart", args: { variantId: "synthetic-variant", quantity: 1 } } },
    fingerprint: { version: 1, bytes: Uint8Array.from({ length: 32 }, () => 17) } };
  const admitted = await admission.admit(input); assert.equal(admitted.kind, "claimed");
  return { ...input, claim: admitted.claim };
};
const effectRows = input => prisma.$queryRaw`SELECT effect_id AS "effectId",request_id AS "requestId",before_revision AS "beforeRevision",
  after_revision AS "afterRevision",cart_row_id AS "cartRowId",cart_updated_at AS "cartUpdatedAt",created_at AS "createdAt"
  FROM storefront_local_cart_effects WHERE request_id=${input.claim.requestId}::uuid`;
const cartRows = (input, reader = prisma) => reader.$queryRaw`SELECT id,items,total,discount,free_shipping AS shipping,updated_at AS "updatedAt"
  FROM storefront_carts WHERE merchant_id=${input.scope.merchantId} AND session_id=${input.scope.cartId}`;
const revision = async input => (await prisma.$queryRaw`SELECT scope_revision AS revision FROM storefront_execution_scopes
  WHERE merchant_id=${input.scope.merchantId} AND conversation_id=${input.scope.conversationId}`)[0].revision;
const directInsert = async (tx, input, changed = {}) => {
  const [cart] = await cartRows(input, tx);
  const row = { ...input.scope, requestId: input.claim.requestId, claimGeneration: 1n, beforeRevision: 0n, afterRevision: 1n,
    cartRowId: cart.id, cartUpdatedAt: cart.updatedAt, createdAt: new Date("2000-01-01T00:00:00Z"), ...changed };
  return tx.$queryRaw`INSERT INTO storefront_local_cart_effects (request_id,merchant_id,conversation_id,cart_id,principal_id,
    claim_generation,before_revision,after_revision,cart_row_id,cart_updated_at,created_at)
    VALUES (${row.requestId}::uuid,${row.merchantId},${row.conversationId},${row.cartId},${row.principalId},
      ${row.claimGeneration},${row.beforeRevision},${row.afterRevision},${row.cartRowId},${row.cartUpdatedAt},${row.createdAt})
    RETURNING effect_id AS "effectId"`;
};
let active = "owned synthetic identity", passed = 0, maxConcurrentWaitingTransactions = 0;
const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
try {
  await prisma.$connect();
  const [marker] = await prisma.$queryRaw`SELECT current_database() AS database,run_id FROM synthetic_native_marker`;
  assert.deepEqual(marker, { database: "storefront_synthetic", run_id: runId });
  await check("actual Prisma sees request-bound effect candidate table", async () => {
    const [{ name }] = await prisma.$queryRaw`SELECT to_regclass('public.storefront_local_cart_effects')::text AS name`;
    assert.equal(name, "storefront_local_cart_effects");
  });
  const { PrismaStorefrontCartRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cart.repository.ts");
  const legacy = new PrismaStorefrontCartRepository(prisma);
  const ddlInput = await provision("ddl-valid");
  await legacy.getOrCreate(merchant, ddlInput.scope.cartId);
  await check("direct SQL rejects foreign scope request generation revisions and stale cart reference", async () => {
    for (const changed of [{ merchantId: "foreign" }, { conversationId: "foreign" }, { cartId: "foreign" }, { principalId: "foreign" },
      { requestId: randomUUID() }, { claimGeneration: 2n }, { beforeRevision: 1n, afterRevision: 2n },
      { afterRevision: 2n }, { afterRevision: 0n }, { beforeRevision: -1n }, { cartRowId: "foreign" }, { cartUpdatedAt: new Date("2000-01-01T00:00:00Z") }])
      await assert.rejects(prisma.$transaction(tx => directInsert(tx, ddlInput, changed)));
    assert.equal((await effectRows(ddlInput)).length, 0); assert.equal(await revision(ddlInput), 0n);
  });
  await check("scope cannot advance without matching effect and keeps initial identity ownership and timestamps immutable", async () => {
    for (const update of [() => prisma.$executeRaw`UPDATE storefront_execution_scopes SET scope_revision=1 WHERE conversation_id='ddl-valid'`,
      () => prisma.$executeRaw`UPDATE storefront_execution_scopes SET cart_id='changed' WHERE conversation_id='ddl-valid'`,
      () => prisma.$executeRaw`UPDATE storefront_execution_scopes SET principal_id='changed' WHERE conversation_id='ddl-valid'`,
      () => prisma.$executeRaw`UPDATE storefront_execution_scopes SET protocol_owned=false WHERE conversation_id='ddl-valid'`,
      () => prisma.$executeRaw`UPDATE storefront_execution_scopes SET created_at='2000-01-01' WHERE conversation_id='ddl-valid'`,
      () => prisma.$executeRaw`INSERT INTO storefront_execution_scopes(merchant_id,conversation_id,cart_id,principal_id,scope_revision)
        VALUES ('synthetic-merchant','bad-initial','bad-initial','principal',1)`]) await assert.rejects(update());
    assert.equal(await revision(ddlInput), 0n);
  });
  await check("effect reference atomically advances revision and stamps database time without sensitive payload columns", async () => {
    await prisma.$transaction(tx => directInsert(tx, ddlInput));
    const [effect] = await effectRows(ddlInput); assert.equal(effect.beforeRevision, 0n); assert.equal(effect.afterRevision, 1n);
    assert.equal(await revision(ddlInput), 1n); assert.ok(effect.createdAt.getTime() > Date.now() - 60_000);
    const columns = await prisma.$queryRaw`SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name='storefront_local_cart_effects' ORDER BY column_name`;
    assert.deepEqual(columns.map(row => row.name), ["after_revision","before_revision","cart_id","cart_row_id","cart_updated_at","claim_generation","conversation_id","created_at","effect_id","merchant_id","principal_id","request_id"]);
    const [{ count }] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM information_schema.referential_constraints r
      JOIN information_schema.key_column_usage k ON k.constraint_name=r.constraint_name AND k.constraint_schema=r.constraint_schema
      JOIN information_schema.constraint_column_usage c ON c.constraint_name=r.unique_constraint_name AND c.constraint_schema=r.unique_constraint_schema
      WHERE k.table_name='storefront_local_cart_effects' AND c.table_name='storefront_carts'`;
    assert.equal(count, 0);
  });
  await check("effect reference rejects duplicates update delete truncate and cannot advance scope twice", async () => {
    for (const mutate of [() => prisma.$transaction(tx => directInsert(tx, ddlInput)),
      () => prisma.$executeRaw`UPDATE storefront_local_cart_effects SET cart_row_id=cart_row_id`,
      () => prisma.$executeRaw`DELETE FROM storefront_local_cart_effects`,
      () => prisma.$executeRaw`TRUNCATE storefront_local_cart_effects`,
      () => prisma.$executeRaw`UPDATE storefront_execution_scopes SET scope_revision=2 WHERE conversation_id='ddl-valid'`,
      () => prisma.$executeRaw`DELETE FROM storefront_execution_scopes WHERE conversation_id='ddl-valid'`,
      () => prisma.$executeRaw`TRUNCATE storefront_execution_scopes CASCADE`]) await assert.rejects(mutate());
    assert.equal((await effectRows(ddlInput)).length, 1); assert.equal(await revision(ddlInput), 1n);
  });
  await check("direct SQL cannot record effect for unknown request and rollback reverts reference plus revision", async () => {
    const unknown = await provision("ddl-unknown"); await legacy.getOrCreate(merchant, unknown.scope.cartId);
    await admission.markUnknown({ scope: unknown.scope, claim: unknown.claim });
    await assert.rejects(prisma.$transaction(tx => directInsert(tx, unknown)));
    assert.equal(await revision(unknown), 0n); assert.equal((await effectRows(unknown)).length, 0);
    const rollback = await provision("ddl-rollback"); await legacy.getOrCreate(merchant, rollback.scope.cartId);
    await assert.rejects(prisma.$transaction(async tx => { await directInsert(tx, rollback); throw new Error("synthetic_rollback"); }));
    assert.equal(await revision(rollback), 0n); assert.equal((await effectRows(rollback)).length, 0);
  });
  if (!mode) {
    const { PrismaStorefrontLocalCartEffectExecutor } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-local-cart-effect.executor.ts");
    const executor = new PrismaStorefrontLocalCartEffectExecutor(prisma);
    const commercial = cart => ({ version: 1, discountCents: 7, freeShipping: false,
      quote: { currency: "BRL", originalSubtotalCents: cart.total, promotionDiscountCents: 0, subtotalCents: cart.total,
        merchandiseTotalCents: cart.total - 7, items: cart.items.map(item => ({ variantId: item.variantId, productId: item.productId,
          quantity: item.quantity, baseUnitPriceCents: item.unitPriceCents, unitPriceCents: item.unitPriceCents })) } });
    const dependencies = (overrides = {}) => {
      const calls = { resolve: 0, rules: 0 };
      return { calls, value: {
        resolveItem: async (...args) => { calls.resolve++; return overrides.resolveItem ? overrides.resolveItem(...args) :
          { productId: "synthetic-product", name: "SYNTHETIC ONLY", sku: "synthetic-sku", unitPriceCents: 100 }; },
        evaluateRules: async (...args) => { calls.rules++; return overrides.evaluateRules ? overrides.evaluateRules(...args) :
          commercial(args[2]); },
      } };
    };
    const assertNoWork = async (input, deps) => {
      assert.equal((await cartRows(input)).length, 0); assert.equal((await effectRows(input)).length, 0);
      assert.equal(await revision(input), 0n); assert.deepEqual(deps.calls, { resolve: 0, rules: 0 });
    };
    await check("preexisting target stale price and service without slot both fail closed without cart changes", async () => {
      const stale = await provision("stale-target-price");
      await legacy.addItem(merchant, stale.scope.cartId, { variantId: "synthetic-variant", productId: "synthetic-product", name: "SYNTHETIC", sku: "sku", unitPriceCents: 100 });
      await prisma.$executeRaw`INSERT INTO products(id,merchant_id,type) VALUES ('synthetic-service','synthetic-merchant','service')`;
      await prisma.$executeRaw`INSERT INTO product_variants(id,product_id) VALUES ('synthetic-service-variant','synthetic-service')`;
      const service = await provision("existing-service-no-slot");
      await legacy.addItem(merchant, service.scope.cartId, { variantId: "synthetic-service-variant", productId: "synthetic-service", name: "SYNTHETIC SERVICE", sku: "service", unitPriceCents: 100 });
      const outcomes = [];
      for (const [input, overrides] of [[stale, { resolveItem: () => ({ productId: "synthetic-product", name: "SYNTHETIC", sku: "sku", unitPriceCents: 200 }) }], [service, {}]]) {
        const deps = dependencies(overrides), before = await cartRows(input);
        let rejected = false; try { await executor.execute(input, deps.value); } catch { rejected = true; }
        outcomes.push(rejected);
        if (rejected) {
          assert.deepEqual(await cartRows(input), before); assert.equal((await effectRows(input)).length, 0); assert.equal(await revision(input), 0n);
        }
      }
      console.log(JSON.stringify({ test: "preexisting guard characterization", stalePriceRejected: outcomes[0], serviceWithoutSlotRejected: outcomes[1] }));
      assert.deepEqual(outcomes, [true, true]);
    });
    await check("actual admission and executor commit one add rules reference and revision; duplicate skips callbacks", async () => {
      const input = await provision("execute-once"); let callbackTx;
      const deps = dependencies({
        resolveItem: async (tx, bound, intent) => {
          callbackTx = tx;
          assert.equal(Object.isFrozen(bound), true); assert.equal(Object.isFrozen(intent.command.args), true);
          assert.deepEqual(Object.keys(bound).sort(), ["cartId","conversationId","merchantId","principalId"]);
          assert.deepEqual(Object.keys(intent).sort(), ["command","expected_revision","message_id","version"]);
          const variant = await tx.productVariant.findFirst({ where: { id: intent.command.args.variantId }, select: { product: { select: { id: true } } } });
          assert.equal(variant.product.id, "synthetic-product");
          return { productId: "synthetic-product", name: "SYNTHETIC ONLY", sku: "synthetic-sku", unitPriceCents: 100 };
        },
        evaluateRules: async (tx, bound, cart) => {
          assert.equal(tx, callbackTx); assert.equal(Object.isFrozen(cart.items[0]), true);
          assert.throws(() => { cart.items[0].quantity = 99; });
          const persisted = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: bound.merchantId, sessionId: bound.cartId } } });
          assert.equal(persisted.total, 100); assert.equal(persisted.items[0].quantity, 1);
          return commercial(cart);
        },
      });
      const first = await executor.execute(input, deps.value); assert.equal(first.kind, "effect_recorded");
      assert.equal(first.requestId, input.claim.requestId); assert.equal(first.revision, 1);
      const [cart] = await cartRows(input), [effect] = await effectRows(input);
      assert.equal(cart.items[0].quantity, 1); assert.equal(cart.total, 100); assert.equal(cart.discount, 7); assert.equal(cart.shipping, false);
      assert.equal(effect.effectId, first.effectId); assert.equal(effect.cartRowId, cart.id); assert.deepEqual(effect.cartUpdatedAt, cart.updatedAt);
      assert.equal(await revision(input), 1n);
      const duplicate = await executor.execute(input, deps.value);
      assert.deepEqual(duplicate, { ...first, kind: "receipt_required" }); assert.deepEqual(deps.calls, { resolve: 1, rules: 1 });
      assert.equal((await cartRows(input))[0].items[0].quantity, 1);
      const [request] = await prisma.$queryRaw`SELECT status FROM storefront_write_requests WHERE id=${input.claim.requestId}::uuid`;
      assert.equal(request.status, "processing");
      const { claim: _, ...admissionRequest } = input;
      assert.equal((await admission.admit({ ...admissionRequest, intent: { ...input.intent, message_id: "new-key" } })).kind, "lane_blocked");
    });
    await check("wrong token request scope fingerprint and identity deny execution before any callback or cart creation", async () => {
      const input = await provision("denied"), deps = dependencies();
      for (const [changed, kind] of [
        [{ ...input, claim: { ...input.claim, claimToken: randomUUID() } }, "not_current"],
        [{ ...input, claim: { ...input.claim, requestId: randomUUID() } }, "not_current"],
        [{ ...input, scope: { ...input.scope, principalId: "foreign" } }, "scope_unavailable"],
        [{ ...input, fingerprint: { ...input.fingerprint, bytes: Uint8Array.from({ length: 32 }, () => 34) } }, "identity_conflict"],
        [{ ...input, intent: { ...input.intent, message_id: "changed" } }, "identity_conflict"],
        [{ ...input, intent: { ...input.intent, expected_revision: 1 } }, "identity_conflict"],
      ]) assert.deepEqual(await executor.execute(changed, deps.value), { kind });
      await assertNoWork(input, deps);
    });
    await check("unknown before effect prevents work while unknown after commit returns immutable reference and keeps lane closed", async () => {
      const before = await provision("unknown-before"), deps = dependencies();
      assert.deepEqual(await admission.markUnknown({ scope: before.scope, claim: before.claim }), { kind: "marked_unknown" });
      assert.deepEqual(await executor.execute(before, deps.value), { kind: "not_current" }); await assertNoWork(before, deps);
      const after = await provision("unknown-after"), afterDeps = dependencies();
      const recorded = await executor.execute(after, afterDeps.value);
      await admission.markUnknown({ scope: after.scope, claim: after.claim });
      assert.deepEqual(await executor.execute(after, afterDeps.value), { ...recorded, kind: "receipt_required" });
      assert.deepEqual(afterDeps.calls, { resolve: 1, rules: 1 }); assert.equal(await revision(after), 1n);
      const { claim: _, ...admissionRequest } = after;
      assert.equal((await admission.admit({ ...admissionRequest, intent: { ...after.intent, message_id: "another-key" } })).kind, "lane_blocked");
    });
    await check("twenty actual executions of one claim overlap yet add resolve evaluate and record only once", async () => {
      const input = await provision("same-claim-race", { cartId: 'effect"\\unicode-\u00e7\u{1f600}' }), deps = dependencies();
      let held, release;
      const acquired = new Promise(resolve => { held = resolve; }); const unlock = new Promise(resolve => { release = resolve; });
      const key = JSON.stringify(["storefront-cart", input.scope.merchantId, input.scope.cartId]);
      const holder = prisma.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`; held(); await unlock; }, { maxWait: 10_000, timeout: 15_000 });
      holder.catch(() => held()); let pending;
      try {
        await acquired;
        pending = Promise.all(Array.from({ length: 20 }, () => executor.execute(input, deps.value))).then(results => ({ results }), error => ({ error }));
        let waiting = 0;
        for (let attempt = 0; attempt < 60; attempt++) {
          const [{ count }] = await prisma.$queryRaw`SELECT count(DISTINCT a.pid)::int AS count FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
            WHERE a.application_name=${`aacp_write_native_${runId}`} AND l.locktype='advisory' AND NOT l.granted`;
          waiting = count; if (waiting === 20) break; await new Promise(resolve => setTimeout(resolve, 75));
        }
        assert.equal(waiting, 20); maxConcurrentWaitingTransactions = waiting; release(); await holder;
        const outcome = await pending; if (outcome.error) throw outcome.error;
        assert.equal(outcome.results.filter(value => value.kind === "effect_recorded").length, 1);
        assert.equal(outcome.results.filter(value => value.kind === "receipt_required").length, 19);
        assert.equal(new Set(outcome.results.map(value => value.effectId)).size, 1);
      } finally { release(); await holder; if (pending) await pending; }
      assert.equal((await cartRows(input))[0].items[0].quantity, 1); assert.equal((await effectRows(input)).length, 1);
      assert.equal(await revision(input), 1n); assert.deepEqual(deps.calls, { resolve: 1, rules: 1 });
    });
    await check("resolver and rule failures rollback cart and reference with revision unchanged and no retry", async () => {
      for (const [name, overrides, expected] of [
        ["resolver-error", { resolveItem: () => { throw new Error("synthetic_resolver_failure"); } }, { resolve: 1, rules: 0 }],
        ["rules-error", { evaluateRules: () => { throw new Error("synthetic_rule_failure"); } }, { resolve: 1, rules: 1 }],
        ["rules-over-total", { evaluateRules: (_tx, _scope, cart) => ({ ...commercial(cart), discountCents: 101,
          quote: { ...commercial(cart).quote, merchandiseTotalCents: -1 } }) }, { resolve: 1, rules: 1 }],
        ["resolver-product", { resolveItem: () => ({ productId: "foreign-product", name: "SYNTHETIC", sku: "sku", unitPriceCents: 100 }) }, { resolve: 1, rules: 0 }],
        ["resolver-fields", { resolveItem: () => ({ productId: "synthetic-product", name: "SYNTHETIC", sku: "sku", unitPriceCents: 100, quantity: 2 }) }, { resolve: 1, rules: 0 }],
      ]) {
        const input = await provision(name), deps = dependencies(overrides);
        await assert.rejects(executor.execute(input, deps.value));
        assert.equal((await cartRows(input)).length, 0); assert.equal((await effectRows(input)).length, 0); assert.equal(await revision(input), 0n);
        assert.deepEqual(deps.calls, expected);
      }
    });
    await check("preexisting coupon and marketplace contents are rejected before resolver and remain unchanged", async () => {
      const coupon = await provision("cart-coupon"); await legacy.applyCoupon(merchant, coupon.scope.cartId, "SYNTHETIC", 0);
      const marketplace = await provision("cart-marketplace");
      await legacy.addItem(merchant, marketplace.scope.cartId, { variantId: "synthetic-variant", productId: "synthetic-product", name: "SYNTHETIC", sku: "sku", unitPriceCents: 100,
        marketplace: { lineItemId: "line", sellerMerchantId: "seller", federatedProductId: "federated" } });
      for (const input of [coupon, marketplace]) {
        const deps = dependencies(), before = await cartRows(input);
        await assert.rejects(executor.execute(input, deps.value)); assert.deepEqual(deps.calls, { resolve: 0, rules: 0 });
        assert.deepEqual(await cartRows(input), before); assert.equal((await effectRows(input)).length, 0); assert.equal(await revision(input), 0n);
      }
    });
    await prisma.$executeRaw`CREATE SEQUENCE synthetic_effect_attempts`;
    await prisma.$executeRaw`CREATE FUNCTION synthetic_effect_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      PERFORM nextval('synthetic_effect_attempts'); IF NEW.conversation_id='effect-error' THEN RAISE EXCEPTION 'synthetic_effect_failure'; END IF; RETURN NEW; END $$`;
    await prisma.$executeRaw`CREATE TRIGGER synthetic_effect_insert_failure BEFORE INSERT ON storefront_local_cart_effects FOR EACH ROW EXECUTE FUNCTION synthetic_effect_insert_failure()`;
    await prisma.$executeRaw`CREATE FUNCTION synthetic_effect_revision_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.conversation_id='revision-error' THEN RETURN NULL; END IF; RETURN NEW; END $$`;
    await prisma.$executeRaw`CREATE TRIGGER synthetic_effect_revision_failure BEFORE UPDATE ON storefront_execution_scopes FOR EACH ROW EXECUTE FUNCTION synthetic_effect_revision_failure()`;
    await prisma.$executeRaw`CREATE FUNCTION synthetic_effect_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.conversation_id='effect-commit-error' THEN RAISE EXCEPTION 'synthetic_commit_failure'; END IF; RETURN NEW; END $$`;
    await prisma.$executeRaw`CREATE CONSTRAINT TRIGGER synthetic_effect_commit_failure AFTER INSERT ON storefront_local_cart_effects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_effect_commit_failure()`;
    const effectAttempts = async () => (await prisma.$queryRaw`SELECT CASE WHEN is_called THEN last_value::int ELSE 0 END AS value FROM synthetic_effect_attempts`)[0].value;
    for (const name of ["effect-error", "revision-error", "effect-commit-error"]) await check(`${name} rolls back actual cart effect and revision without retry or successful result`, async () => {
      const input = await provision(name), deps = dependencies(), before = await effectAttempts();
      await assert.rejects(executor.execute(input, deps.value));
      assert.equal((await cartRows(input)).length, 0); assert.equal((await effectRows(input)).length, 0); assert.equal(await revision(input), 0n);
      assert.deepEqual(deps.calls, { resolve: 1, rules: 1 }); assert.equal(await effectAttempts(), before + 1);
    });
    await check("markUnknown racing an executing claim waits and preserves one effect plus an unresolved lane", async () => {
      const input = await provision("mark-unknown-race"); let entered, release;
      const resolving = new Promise(resolve => { entered = resolve; }); const proceed = new Promise(resolve => { release = resolve; });
      const deps = dependencies({ resolveItem: async () => { entered(); await proceed; return { productId: "synthetic-product", name: "SYNTHETIC", sku: "sku", unitPriceCents: 100 }; } });
      const pending = executor.execute(input, deps.value).then(result => ({ result }), error => ({ error }));
      let unknown;
      try {
        await Promise.race([resolving, pending.then(outcome => { if (outcome.error) throw outcome.error; throw new Error("synthetic_resolver_not_entered"); })]);
        unknown = admission.markUnknown({ scope: input.scope, claim: input.claim }).then(result => ({ result }), error => ({ error }));
        let waiting = 0;
        for (let attempt = 0; attempt < 60; attempt++) {
          const [{ count }] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=${`aacp_write_native_${runId}`} AND wait_event_type='Lock'`;
          waiting = count; if (waiting > 0) break; await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(waiting > 0); release(); const outcome = await pending; if (outcome.error) throw outcome.error;
        assert.equal(outcome.result.kind, "effect_recorded"); const marked = await unknown; if (marked.error) throw marked.error;
        assert.deepEqual(marked.result, { kind: "marked_unknown" });
        assert.deepEqual(await executor.execute(input, deps.value), { ...outcome.result, kind: "receipt_required" });
      } finally { release(); await pending; if (unknown) await unknown; }
      assert.deepEqual(deps.calls, { resolve: 1, rules: 1 }); assert.equal((await effectRows(input)).length, 1); assert.equal(await revision(input), 1n);
      assert.equal((await cartRows(input))[0].items[0].quantity, 1);
    });
  }
  console.log(JSON.stringify({ status: "passed", tests: passed, ddlOnly: mode === "--ddl-only", actualPrisma: true, maxConcurrentWaitingTransactions, prismaClients: 1,
    localCandidateOnly: true, authoritativePricingProven: false, businessExactlyOnceProven: false, productionAccess: false }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", test: active, errorType: error?.name ?? "Error", code: typeof error?.code === "string" ? error.code : undefined }));
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
