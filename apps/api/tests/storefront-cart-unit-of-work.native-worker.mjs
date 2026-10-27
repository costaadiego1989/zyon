import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";

const legacyOnly = process.argv[4] === "--legacy-characterization";
assert.equal(process.argv.length, legacyOnly ? 5 : 4, "native_worker_requires_parent_generated_url_and_run");
const [url, runId] = process.argv.slice(2);
const parsedUrl = assertNativePrismaUrl(url);
assert.equal(parsedUrl.searchParams.get("application_name"), `aacp_write_native_${runId}`);
assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "native_worker_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const { PrismaStorefrontCartRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cart.repository.ts");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
const legacy = new PrismaStorefrontCartRepository(prisma);
const merchant = "synthetic-merchant";
const scope = cartId => ({ merchantId: merchant, cartId });
const item = (extra = {}) => ({ variantId: "synthetic-variant", productId: "synthetic-product", name: "Synthetic only", sku: "synthetic-sku", unitPriceCents: 100, quantity: 1, ...extra });
const witness = (tx, sessionId, id = sessionId) => tx.$executeRaw`INSERT INTO synthetic_cart_proof (id,merchant_id,session_id,witness) VALUES (${id},${merchant},${sessionId},'SYNTHETIC_TEST_ONLY')`;
const cartRows = sessionId => prisma.$queryRaw`SELECT id,merchant_id,session_id,items,total,discount,coupon_code,
  free_shipping AS shipping,created_at AS created,updated_at AS updated,expires_at AS expires
  FROM storefront_carts WHERE merchant_id=${merchant} AND session_id=${sessionId}`;
const proofCount = async sessionId => (await prisma.$queryRaw`SELECT count(*)::int AS count FROM synthetic_cart_proof WHERE merchant_id=${merchant} AND session_id=${sessionId}`)[0].count;
const attempts = async () => (await prisma.$queryRaw`SELECT last_value::int AS value FROM synthetic_cart_proof_attempts`)[0].value;
let passed = 0, active = "fixture identity", maxConcurrentWaitingTransactions = 0, nativeLineIdentityChecks = 0;
const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
try {
  await prisma.$connect();
  const [marker] = await prisma.$queryRaw`SELECT current_database() AS database,run_id FROM synthetic_native_marker`;
  assert.deepEqual(marker, { database: "storefront_synthetic", run_id: runId });
  await check("actual Prisma connects to owned synthetic marker and PostgreSQL16", async () => {
    const [{ version }] = await prisma.$queryRaw`SELECT current_setting('server_version') AS version`;
    assert.ok(version.startsWith("16."));
  });
  await check("CHARACTERIZATION legacy repository commits cart despite enclosing transaction rollback", async () => {
    await assert.rejects(prisma.$transaction(async tx => {
      await legacy.addItem(merchant, "legacy-gap", item());
      await legacy.applyRuleOutcome(merchant, "legacy-gap", { discountCents: 7, freeShipping: true });
      await witness(tx, "legacy-gap");
      throw new Error("synthetic_outer_rollback");
    }, { maxWait: 10_000, timeout: 15_000 }));
    const [persisted] = await cartRows("legacy-gap");
    assert.equal(persisted.items[0].quantity, 1); assert.equal(persisted.total, 100);
    assert.equal(persisted.discount, 7); assert.equal(persisted.shipping, true);
    assert.equal(await proofCount("legacy-gap"), 0);
  });
  if (!legacyOnly) {
    const { PrismaStorefrontCartUnitOfWork } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cart-unit-of-work.ts");
    const uow = new PrismaStorefrontCartUnitOfWork(prisma);
    const identityCheck = async (name, work) => { await check(name, work); nativeLineIdentityChecks++; };
    const color = (id, quantity = 2) => item({ variantId: "color-variant", productId: "color-product", sku: "COLOR",
      name: "Same-price color product", quantity, selectedOptions: [{ groupId: "color", groupName: "Color",
        itemId: id, itemName: id === "blue" ? "Azul" : "Vermelho", priceModifierInCents: 0 }] });
    const selector = id => ({ optionItemIds: [id], serviceSlotId: null });
    const seedColors = async sessionId => {
      await legacy.addItem(merchant, sessionId, color("blue"));
      await legacy.addItem(merchant, sessionId, color("red"));
      const [row] = await cartRows(sessionId);
      assert.equal(row.items.length, 2); assert.equal(row.items[0].unitPriceCents, row.items[1].unitPriceCents);
      return row;
    };
    await identityCheck("native exact options quantity updates preserve the other same-price color through direct and UoW repositories", async () => {
      const sessionId = "identity-update", before = await seedColors(sessionId);
      const direct = await legacy.updateItemQuantity(merchant, sessionId, "color-variant", 3, selector("blue"));
      assert.deepEqual(direct.items[1], before.items[1]); assert.equal(direct.items[0].quantity, 3); assert.equal(direct.total, 500);
      const bound = await uow.run(scope(sessionId), ({ cart }) => cart.updateItemQuantity(merchant, sessionId, "color-variant", 1, selector("red")));
      assert.deepEqual(bound.items[0], direct.items[0]); assert.equal(bound.items[1].quantity, 1); assert.equal(bound.total, 400);
      assert.deepEqual((await cartRows(sessionId))[0].items, bound.items);
    });
    await identityCheck("native targeted UoW quantity zero removes only one same-price color", async () => {
      const sessionId = "identity-zero", before = await seedColors(sessionId);
      const result = await uow.run(scope(sessionId), ({ cart }) => cart.updateItemQuantity(merchant, sessionId, "color-variant", 0, selector("blue")));
      assert.deepEqual(result.items, [before.items[1]]); assert.equal(result.total, 200);
      assert.deepEqual((await cartRows(sessionId))[0].items, [before.items[1]]);
    });
    await identityCheck("native targeted UoW remove preserves the other same-price color", async () => {
      const sessionId = "identity-remove", before = await seedColors(sessionId);
      const result = await uow.run(scope(sessionId), ({ cart }) => cart.removeItem(merchant, sessionId, "color-variant", selector("red")));
      assert.deepEqual(result.items, [before.items[0]]); assert.equal(result.total, 200);
      assert.deepEqual((await cartRows(sessionId))[0].items, [before.items[0]]);
    });
    for (const operation of ["remove", "zero", "update"]) await identityCheck(`native omitted ambiguous ${operation} preserves all persisted values and TTL`, async () => {
      const sessionId = "identity-ambiguous-" + operation; await seedColors(sessionId); const before = await cartRows(sessionId);
      for (const port of [legacy, { removeItem: (...args) => uow.run(scope(sessionId), ({ cart }) => cart.removeItem(...args)),
        updateItemQuantity: (...args) => uow.run(scope(sessionId), ({ cart }) => cart.updateItemQuantity(...args)) }]) {
        await assert.rejects(operation === "remove" ? port.removeItem(merchant, sessionId, "color-variant")
          : port.updateItemQuantity(merchant, sessionId, "color-variant", operation === "zero" ? 0 : 3), /cart_option_line_selection_required/);
        assert.deepEqual(await cartRows(sessionId), before);
      }
    });
    await identityCheck("native stock admission totals physical quantities across color lines and rolls back refusal without TTL refresh", async () => {
      const sessionId = "identity-shared-stock"; await seedColors(sessionId); const before = await cartRows(sessionId);
      await assert.rejects(uow.run(scope(sessionId), ({ cart }) => cart.updateItemQuantity(merchant, sessionId, "color-variant", 4, selector("blue"))), /variant_out_of_stock/);
      assert.deepEqual(await cartRows(sessionId), before);
      const approved = await legacy.updateItemQuantity(merchant, sessionId, "color-variant", 3, selector("blue"));
      assert.equal(approved.items.reduce((sum, line) => sum + line.quantity, 0), 5);
    });
    await identityCheck("native duplicate option IDs refuse remove and update without writes or TTL refresh", async () => {
      const sessionId = "identity-malformed"; await seedColors(sessionId); const before = await cartRows(sessionId);
      const malformed = { optionItemIds: ["blue", "blue"], serviceSlotId: null };
      await assert.rejects(legacy.removeItem(merchant, sessionId, "color-variant", malformed), /cart_line_selection_invalid/);
      await assert.rejects(uow.run(scope(sessionId), ({ cart }) => cart.updateItemQuantity(merchant, sessionId, "color-variant", 0, malformed)), /cart_line_selection_invalid/);
      assert.deepEqual(await cartRows(sessionId), before);
    });
    await identityCheck("native callback rollback restores targeted quantity and TTL together with its witness", async () => {
      const sessionId = "identity-rollback"; await seedColors(sessionId); const before = await cartRows(sessionId);
      await assert.rejects(uow.run(scope(sessionId), async ({ cart, tx }) => {
        await cart.updateItemQuantity(merchant, sessionId, "color-variant", 3, selector("blue"));
        await witness(tx, sessionId); throw new Error("synthetic_identity_callback_rollback");
      }), /synthetic_identity_callback_rollback/);
      assert.deepEqual(await cartRows(sessionId), before); assert.equal(await proofCount(sessionId), 0);
    });
    await identityCheck("native explicit null service slot targets the old unscheduled line after a real catalog schedule change", async () => {
      const sessionId = "identity-service-slots", service = item({ variantId: "identity-service-variant", productId: "identity-service-product", sku: "SERVICE" });
      await legacy.addItem(merchant, sessionId, service); // Real no-schedule service admission.
      const schedule = { serviceSchedule: { timeZone: "UTC", durationMinutes: 30,
        slots: [{ id: "slot-a", date: "2100-01-01", startTime: "10:00" }] } };
      // Synthetic merchant catalog configuration change only; no cart rows or
      // selected slots are fabricated. The second add revalidates real metadata.
      await prisma.$executeRaw`UPDATE products SET metadata=${JSON.stringify(schedule)}::jsonb WHERE id='identity-service-product' AND merchant_id=${merchant}`;
      const { resolveSelectedServiceSlot } = await import("../src/modules/catalog/domain/services/service-schedule.ts");
      const slot = resolveSelectedServiceSlot(schedule, "slot-a"); assert.ok(slot);
      await legacy.addItem(merchant, sessionId, { ...service, selectedServiceSlot: slot });
      const before = await cartRows(sessionId); assert.equal(before[0].items.length, 2);
      await assert.rejects(legacy.removeItem(merchant, sessionId, "identity-service-variant", { optionItemIds: [] }), /cart_option_line_selection_required/);
      assert.deepEqual(await cartRows(sessionId), before);
      const remaining = await uow.run(scope(sessionId), ({ cart }) => cart.removeItem(merchant, sessionId, "identity-service-variant", { optionItemIds: [], serviceSlotId: null }));
      assert.equal(remaining.items.length, 1); assert.deepEqual(remaining.items[0].selectedServiceSlot, slot);
      const empty = await legacy.removeItem(merchant, sessionId, "identity-service-variant", { optionItemIds: [], serviceSlotId: "slot-a" });
      assert.deepEqual(empty.items, []); assert.equal(empty.total, 0);
    });
    const { StorefrontCartSnapshotConflictError } = await import("../src/modules/storefront/domain/errors/storefront-cart-snapshot-conflict.error.ts");
    await check("snapshot CAS rejects a late rule grant after a real concurrent cart writer without changing TTL", async () => {
      await legacy.addItem(merchant, "snapshot-rules", item({ quantity: 2 }));
      const authorized = await legacy.getOrCreate(merchant, "snapshot-rules");
      const changed = await legacy.updateItemQuantity(merchant, "snapshot-rules", "synthetic-variant", 1);
      await legacy.applyRuleOutcome(merchant, "snapshot-rules", { discountCents: 10, freeShipping: false }, changed);
      const before = await cartRows("snapshot-rules");
      await assert.rejects(legacy.applyRuleOutcome(merchant, "snapshot-rules", { discountCents: 20, freeShipping: false }, authorized), StorefrontCartSnapshotConflictError);
      assert.deepEqual(await cartRows("snapshot-rules"), before);
      assert.equal(before[0].total, 100); assert.equal(before[0].discount, 10);
    });
    await check("snapshot CAS refuses a stale coupon cart write without pretending redemption rollback", async () => {
      await legacy.addItem(merchant, "snapshot-coupon", item({ quantity: 2 }));
      const authorized = await legacy.getOrCreate(merchant, "snapshot-coupon");
      await legacy.updateItemQuantity(merchant, "snapshot-coupon", "synthetic-variant", 1);
      const before = await cartRows("snapshot-coupon");
      await assert.rejects(legacy.applyCoupon(merchant, "snapshot-coupon", "SYNTHETIC", 20, authorized), StorefrontCartSnapshotConflictError);
      assert.deepEqual(await cartRows("snapshot-coupon"), before);
      const [row] = await prisma.$queryRaw`SELECT coupon_code FROM storefront_carts WHERE merchant_id=${merchant} AND session_id='snapshot-coupon'`;
      assert.equal(row.coupon_code, null);
    });
    await check("transaction-bound wrapper forwards stale snapshots and rolls back its own prior proof", async () => {
      await legacy.addItem(merchant, "snapshot-bound", item({ quantity: 2 }));
      const authorized = await legacy.getOrCreate(merchant, "snapshot-bound");
      await legacy.updateItemQuantity(merchant, "snapshot-bound", "synthetic-variant", 1);
      const before = await cartRows("snapshot-bound");
      await assert.rejects(uow.run(scope("snapshot-bound"), async ({ cart, tx }) => {
        await witness(tx, "snapshot-bound");
        await cart.applyRuleOutcome(merchant, "snapshot-bound", { discountCents: 20, freeShipping: false }, authorized);
      }), StorefrontCartSnapshotConflictError);
      assert.deepEqual(await cartRows("snapshot-bound"), before);
      assert.equal(await proofCount("snapshot-bound"), 0);
    });
    const mutate = async (sessionId, { cart, tx }, proofId = sessionId) => {
      await cart.addItem(merchant, sessionId, item());
      await cart.applyRuleOutcome(merchant, sessionId, { discountCents: 7, freeShipping: true });
      await witness(tx, sessionId, proofId);
      return "synthetic-result";
    };
    await check("UoW commits add rule outcome and synthetic proof together on the actual transaction", async () => {
      assert.equal(await uow.run(scope("commit"), bound => mutate("commit", bound)), "synthetic-result");
      const [row] = await cartRows("commit");
      assert.equal(row.items[0].quantity, 1); assert.equal(row.total, 100); assert.equal(row.discount, 7); assert.equal(row.shipping, true);
      assert.equal(await proofCount("commit"), 1);
      assert.ok(row.expires.getTime() > Date.now() + 71 * 3600_000 && row.expires.getTime() < Date.now() + 73 * 3600_000);
    });
    await check("callback rejection rolls back every cart mutation and synthetic proof without retry", async () => {
      const before = await attempts();
      await assert.rejects(uow.run(scope("callback-error"), async bound => { await mutate("callback-error", bound); throw new Error("synthetic_callback_rejection"); }));
      assert.equal((await cartRows("callback-error")).length, 0); assert.equal(await proofCount("callback-error"), 0);
      assert.equal(await attempts(), before + 1);
    });
    await check("settled fire-and-forget rejection invalidates UoW and rolls back prior cart and proof", async () => {
      await assert.rejects(uow.run(scope("settled-rejection"), async bound => {
        await mutate("settled-rejection", bound);
        void bound.cart.addItem(merchant, "settled-rejection", item({ quantity: 0 })).catch(() => {});
        await new Promise(resolve => setImmediate(resolve));
      }));
      assert.equal((await cartRows("settled-rejection")).length, 0);
      assert.equal(await proofCount("settled-rejection"), 0);
    });
    await check("explicitly caught validation rejection still poisons transaction and rolls back all work", async () => {
      await assert.rejects(uow.run(scope("caught-rejection"), async bound => {
        await mutate("caught-rejection", bound);
        try { await bound.cart.addItem(merchant, "caught-rejection", item({ quantity: 0 })); } catch {}
        await new Promise(resolve => setImmediate(resolve));
      }));
      assert.equal((await cartRows("caught-rejection")).length, 0);
      assert.equal(await proofCount("caught-rejection"), 0);
    });
    await check("rollback preserves an existing cart rather than erasing or partially updating it", async () => {
      await legacy.addItem(merchant, "existing-rollback", item({ quantity: 2 }));
      await legacy.applyRuleOutcome(merchant, "existing-rollback", { discountCents: 3, freeShipping: false });
      const before = await cartRows("existing-rollback");
      await assert.rejects(uow.run(scope("existing-rollback"), async bound => { await mutate("existing-rollback", bound); throw new Error("synthetic_existing_rollback"); }));
      assert.deepEqual(await cartRows("existing-rollback"), before);
      assert.equal(await proofCount("existing-rollback"), 0);
    });
    await check("cart update rejection rolls back prior add and previously inserted synthetic proof", async () => {
      await assert.rejects(uow.run(scope("update-error"), async ({ cart, tx }) => {
        await cart.addItem(merchant, "update-error", item()); await witness(tx, "update-error");
        await cart.applyRuleOutcome(merchant, "update-error", { discountCents: 7, freeShipping: true });
      }));
      assert.equal((await cartRows("update-error")).length, 0); assert.equal(await proofCount("update-error"), 0);
    });
    for (const sessionId of ["proof-error", "commit-error"]) await check(`${sessionId} rejection never returns result and rolls back cart plus proof without retry`, async () => {
      const before = await attempts(); let returned = false;
      await assert.rejects(uow.run(scope(sessionId), bound => mutate(sessionId, bound)).then(value => { returned = true; return value; }));
      assert.equal(returned, false); assert.equal((await cartRows(sessionId)).length, 0); assert.equal(await proofCount(sessionId), 0);
      assert.equal(await attempts(), before + 1);
    });
    await check("strict merchant and session binding rejects cross-scope operations and rolls back", async () => {
      for (const [foreignMerchant, foreignSession] of [["foreign-merchant", "bound"], [merchant, "foreign-session"]])
        await assert.rejects(uow.run(scope("bound"), async ({ cart }) => { await cart.addItem(foreignMerchant, foreignSession, item()); }));
      assert.equal((await cartRows("bound")).length, 0); assert.equal((await cartRows("foreign-session")).length, 0);
    });
    await check("stock and foreign catalog admission remain enforced inside UoW", async () => {
      for (const [sessionId, line] of [["stock", item({ variantId: "limited-variant", quantity: 4 })], ["foreign", item({ variantId: "foreign-variant", productId: "foreign-product" })]]) {
        await assert.rejects(uow.run(scope(sessionId), async ({ cart }) => { await cart.addItem(merchant, sessionId, line); }));
        assert.equal((await cartRows(sessionId)).length, 0);
      }
    });
    await check("quantity total and marketplace guards remain enforced without partial cart persistence", async () => {
      for (const [sessionId, line] of [["bad-quantity", item({ quantity: 100 })], ["bad-total", item({ quantity: 2, unitPriceCents: 2_147_483_647 })]]) {
        await assert.rejects(uow.run(scope(sessionId), async ({ cart }) => { await cart.addItem(merchant, sessionId, line); }));
        assert.equal((await cartRows(sessionId)).length, 0);
      }
      await assert.rejects(uow.run(scope("marketplace"), async ({ cart }) => {
        await cart.addItem(merchant, "marketplace", item({ marketplace: { lineItemId: "line", sellerMerchantId: "seller", federatedProductId: "federated" } }));
        await cart.applyRuleOutcome(merchant, "marketplace", { discountCents: 1, freeShipping: false });
      }));
      assert.equal((await cartRows("marketplace")).length, 0);
    });
    await check("escaped bound cart rejects calls after transaction completion", async () => {
      let escaped;
      await uow.run(scope("escaped"), async ({ cart }) => { escaped = cart; await cart.getOrCreate(merchant, "escaped"); });
      await assert.rejects(escaped.addItem(merchant, "escaped", item()));
      assert.equal((await cartRows("escaped"))[0].items.length, 0);
    });
    await check("unawaited operation is drained and rejected instead of committing partial work", async () => {
      await assert.rejects(uow.run(scope("unawaited"), async ({ cart }) => { void cart.addItem(merchant, "unawaited", item()).catch(() => {}); }));
      assert.equal((await cartRows("unawaited")).length, 0);
    });
    await check("overlapping bound operations reject and roll back even with actual Prisma delegates", async () => {
      await assert.rejects(uow.run(scope("overlap"), async ({ cart }) => {
        const first = cart.addItem(merchant, "overlap", item());
        const second = cart.applyRuleOutcome(merchant, "overlap", { discountCents: 1, freeShipping: false });
        await Promise.all([first, second]);
      }));
      assert.equal((await cartRows("overlap")).length, 0);
    });
    await check("twenty UoWs overlap at the exact cart advisory lock and preserve all quantities and proofs", async () => {
      const sessionId = 'race"\\unicode-\u00e7\u{1f600}', bound = scope(sessionId);
      let held, release;
      const acquired = new Promise(resolve => { held = resolve; });
      const unlock = new Promise(resolve => { release = resolve; });
      const key = JSON.stringify(["storefront-cart", merchant, sessionId]);
      const holder = prisma.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`; held(); await unlock; }, { maxWait: 10_000, timeout: 15_000 });
      holder.catch(() => held()); let pending;
      try {
        await acquired;
        pending = Promise.all(Array.from({ length: 20 }, (_, index) => uow.run(bound, async ({ cart, tx }) => {
          await cart.addItem(merchant, sessionId, item()); await cart.applyRuleOutcome(merchant, sessionId, { discountCents: 5, freeShipping: false });
          await witness(tx, sessionId, `race-${index}`);
        }))).then(results => ({ results }), error => ({ error }));
        let waiting = 0;
        for (let attempt = 0; attempt < 60; attempt++) {
          const [{ count }] = await prisma.$queryRaw`SELECT count(DISTINCT a.pid)::int AS count FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${`aacp_write_native_${runId}`} AND l.locktype='advisory' AND NOT l.granted`;
          waiting = count; if (waiting === 20) break; await new Promise(resolve => setTimeout(resolve, 75));
        }
        assert.equal(waiting, 20); maxConcurrentWaitingTransactions = waiting; release(); await holder;
        const outcome = await pending; if (outcome.error) throw outcome.error;
        assert.equal(outcome.results.length, 20);
      } finally { release(); await holder; if (pending) await pending; }
      const [row] = await cartRows(sessionId); assert.equal(row.items[0].quantity, 20); assert.equal(row.total, 2000); assert.equal(row.discount, 5);
      assert.equal(await proofCount(sessionId), 20);
    });
  }
  console.log(JSON.stringify({ status: "passed", tests: passed, legacyCharacterizationOnly: legacyOnly, actualPrismaCart: true, maxConcurrentWaitingTransactions,
    nativeLineIdentityChecks, prismaClients: 1, databaseNetwork: "none", syntheticProofOnly: true, businessExactlyOnceProven: false, productionAccess: false }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", test: active, errorType: error?.name ?? "Error", code: typeof error?.code === "string" ? error.code : undefined }));
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
