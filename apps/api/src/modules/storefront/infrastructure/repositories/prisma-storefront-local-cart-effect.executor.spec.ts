import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { storefrontClaimedCartEffectRequestSchema, type StorefrontResolvedLocalCartItem, type StorefrontLocalCartCommercialOutcomeV1 } from "../../domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { PrismaStorefrontLocalCartEffectExecutor, type StorefrontLocalCartEffectDependencies } from "./prisma-storefront-local-cart-effect.executor.js";
import { StorefrontCartSnapshotConflictError } from "../../domain/errors/storefront-cart-snapshot-conflict.error.js";
import { LegacySavedPriceReviewRequired } from "../../application/services/legacy-saved-price-review.js";

// This strict delegate fake runs the REAL cart UoW/core. It verifies adapter
// sequencing/contracts only, never SQL isolation, immutable evidence or native rollback.
const requestId = "56f51c75-e1d5-4a84-9031-e616927707a0", claimToken = "28e16d88-f9f7-4605-8f9f-88ff96eebc95";
const effectId = "a5537938-7496-4ea4-94b4-ec872a418337", timestamp = new Date("2026-10-18T00:00:00.000Z");
const input = () => storefrontClaimedCartEffectRequestSchema.parse({
  scope: { merchantId: "merchant", conversationId: "conversation", cartId: "session", principalId: "principal" },
  intent: { version: 1, message_id: "message", expected_revision: 0, command: { tool: "add_item_to_cart", args: { variantId: "variant", quantity: 2 } } },
  fingerprint: { version: 1, bytes: new Uint8Array(32).fill(17) }, claim: { requestId, claimToken, claimGeneration: 1 },
});
const resolved = () => ({ productId: "product", name: "Fixture", sku: "SYNTHETIC", unitPriceCents: 200 });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; };
const initialCart = (): StorefrontCart => ({ id: "physical-cart", merchantId: "merchant", sessionId: "session", items: [],
  couponCode: null, discount: 0, freeShipping: false, total: 0, createdAt: timestamp, updatedAt: timestamp });
const commercial = (cart: StorefrontCart): StorefrontLocalCartCommercialOutcomeV1 => ({ version: 1, discountCents: 25, freeShipping: false,
  quote: { currency: "BRL", originalSubtotalCents: cart.total, promotionDiscountCents: 0, subtotalCents: cart.total, merchandiseTotalCents: cart.total - 25,
    items: cart.items.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: item.quantity,
      baseUnitPriceCents: item.unitPriceCents, unitPriceCents: item.unitPriceCents })) } });
type Call = { step: string; sql?: string; values?: unknown[]; args?: unknown };
type Options = { scopeRows?: unknown; requestRows?: unknown; effectRows?: unknown; insertRows?: unknown;
  cart?: StorefrontCart; catalog?: unknown; resolver?: unknown; outcome?: unknown; beforeTransaction?: Promise<void>; beforeCommit?: Promise<void>;
  onAdmission?: () => void; existingCatalog?: unknown; canonicalPriceCents?: number | null;
  failure?: "begin" | "lock" | "scope" | "request" | "effect" | "cart-read" | "catalog" | "resolve" | "rules" | "update" | "insert" | "commit" };
function fixture(options: Options = {}) {
  const request = input(), calls: Call[] = [], failure = new Error(`synthetic-${options.failure ?? "fixture"}`);
  const scopeRow = { ...request.scope, protocolOwned: true, revision: 0n };
  const requestRow = { ...request.scope, requestId, messageId: "message", protocolVersion: 1, fingerprintVersion: 1,
    requestFingerprint: new Uint8Array(32).fill(17), commandKind: "add_item_to_cart", expectedRevision: 0n, claimGeneration: 1n, state: "processing" };
  const effectRow = { ...request.scope, effectId, requestId, claimGeneration: 1n, beforeRevision: 0n, afterRevision: 1n,
    cartRowId: "physical-cart", cartUpdatedAt: timestamp };
  let persisted = structuredClone(options.cart ?? initialCart()), current = structuredClone(persisted);
  const fail = (step: string) => { if (options.failure === step) throw failure; };
  const tx = {
    async $executeRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      const sql = parts.join("?"); assert.match(sql, /pg_advisory_xact_lock/); calls.push({ step: "lock", sql, values }); fail("lock"); return 1;
    },
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      const sql = parts.join("?");
      if (sql.includes("current_setting('transaction_isolation')")) return [{ isolation: "read committed", candidates: [] }];
      const step = /INSERT\s+INTO\s+storefront_local_cart_effects/i.test(sql) ? "insert"
        : /FROM\s+storefront_execution_scopes/i.test(sql) ? "scope"
          : /FROM\s+storefront_write_requests/i.test(sql) ? "request"
            : /FROM\s+storefront_local_cart_effects/i.test(sql) ? "effect" : assert.fail(`unexpected SQL: ${sql}`);
      calls.push({ step, sql, values }); fail(step);
      return structuredClone(step === "scope" ? options.scopeRows ?? [scopeRow] : step === "request" ? options.requestRows ?? [requestRow]
        : step === "effect" ? options.effectRows ?? [] : options.insertRows ?? [effectRow]);
    },
    storefrontCart: {
      async findUnique(args: unknown) { calls.push({ step: "cart-read", args }); fail("cart-read"); return { id: current.id, items: structuredClone(current.items), couponCode: current.couponCode }; },
      async upsert(args: unknown) { calls.push({ step: "upsert", args }); return structuredClone(current); },
      async update(args: { where: { id: string }; data: Partial<StorefrontCart> }) {
        calls.push({ step: "update", args: structuredClone(args) }); fail("update"); current = { ...current, ...structuredClone(args.data) }; return structuredClone(current);
      },
    },
    productVariant: {
      async findMany(args: unknown) {
        calls.push({ step: "existing-catalog", args });
        if (options.existingCatalog !== undefined) return structuredClone(options.existingCatalog);
        const query = args as { where: { id: { in: string[] } } };
        return ["existing", "variant"].filter(id => query.where.id.in.includes(id)).map(id => ({ id, product: { id: "product", type: "physical", metadata: {} } }));
      },
      async findFirst(args: unknown) { calls.push({ step: "catalog", args }); fail("catalog");
        if (options.catalog !== undefined) return structuredClone(options.catalog);
        const projection = args as { select: { product: { select: { id?: boolean } } } };
        if (!projection.select.product.select.id) options.onAdmission?.();
        return projection.select.product.select.id ? { product: { id: "product", type: "physical", metadata: {} } }
          : { product: { type: "physical", metadata: {} }, stock: [{ quantity: 100, reserved: 0 }],
            // Independent catalog authority, not the resolver's mutable quote.
            price: options.canonicalPriceCents === null ? null : { basePriceInCents: options.canonicalPriceCents ?? 200 } }; },
    },
  };
  const prisma = { async $transaction<T>(work: (value: Prisma.TransactionClient) => Promise<T>, config: unknown) {
    calls.push({ step: "begin", args: config }); fail("begin"); await options.beforeTransaction; current = structuredClone(persisted);
    try { const result = await work(tx as unknown as Prisma.TransactionClient); calls.push({ step: "commit" }); await options.beforeCommit; fail("commit"); persisted = structuredClone(current); return result; }
    catch (error) { calls.push({ step: "rollback" }); throw error; }
  } };
  const dependencies: StorefrontLocalCartEffectDependencies = {
    async resolveItem(transaction, scope, intent) {
      calls.push({ step: "resolve", args: { scope, intent } }); fail("resolve"); assert.equal(transaction, tx);
      assert.deepEqual(Object.keys(scope).sort(), Object.keys(request.scope).sort());
      assert.equal(Object.isFrozen(scope), true); assert.equal(Object.isFrozen(intent.command.args), true);
      return (Object.hasOwn(options, "resolver") ? options.resolver : resolved()) as StorefrontResolvedLocalCartItem;
    },
    async evaluateRules(transaction, scope, cart) {
      calls.push({ step: "rules", args: { scope, cart } }); fail("rules"); assert.equal(transaction, tx);
      assert.deepEqual(Object.keys(scope).sort(), Object.keys(request.scope).sort());
      assert.equal(Object.isFrozen(cart), true); assert.equal(Object.isFrozen(cart.items), true);
      assert.ok(cart.items.every(line => Object.isFrozen(line)));
      return (Object.hasOwn(options, "outcome") ? options.outcome : commercial(cart)) as StorefrontLocalCartCommercialOutcomeV1;
    },
  };
  return { executor: new PrismaStorefrontLocalCartEffectExecutor(prisma as unknown as PrismaClient), request, calls, tx, dependencies,
    scopeRow, requestRow, effectRow, failure, saved: () => structuredClone(persisted) };
}

test("one real UoW controls lock, exact claim gates, add/rules and minimal persisted effect reference", async () => {
  const f = fixture();
  assert.deepEqual(await f.executor.execute(f.request, f.dependencies), { kind: "effect_recorded", requestId, effectId, revision: 1 });
  assert.equal(f.calls.filter(call => call.step === "begin").length, 1);
  assert.deepEqual(f.calls[0].args, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 });
  assert.deepEqual(f.calls.slice(0, 5).map(call => call.step), ["begin", "lock", "scope", "request", "effect"]);
  assert.deepEqual(f.calls.filter(call => ["resolve", "rules", "update", "insert"].includes(call.step)).map(call => call.step), ["resolve", "update", "rules", "update", "insert"]);
  assert.equal(f.saved().items[0].variantId, "variant"); assert.equal(f.saved().items[0].quantity, 2);
  assert.equal(f.saved().total, 400); assert.equal(f.saved().discount, 25); assert.equal(f.saved().freeShipping, false);
  assert.equal(f.calls.at(-1)?.step, "commit");
});

const noWork = (calls: Call[]) => assert.ok(!calls.some(call => ["cart-read", "catalog", "existing-catalog", "resolve", "upsert", "update", "rules", "insert"].includes(call.step)));
test("V1 promotion projection persists original prices plus D only, never P or quote fields", async () => {
  const added = initialCart(); added.items = [{ ...resolved(), variantId: "variant", quantity: 2 }]; added.total = 400;
  const outcome = commercial(added); outcome.quote.items[0].unitPriceCents = 170; outcome.quote.promotionDiscountCents = 60;
  outcome.quote.subtotalCents = 340; outcome.quote.merchandiseTotalCents = 315;
  const f = fixture({ outcome });
  assert.deepEqual(await f.executor.execute(f.request, f.dependencies), { kind: "effect_recorded", requestId, effectId, revision: 1 });
  assert.equal(f.saved().discount, 25); assert.equal(f.saved().total, 400); assert.equal(f.saved().items[0].unitPriceCents, 200);
  assert.equal(f.saved().discountBudget, undefined); assert.equal(f.saved().commercialNotices, undefined);
  assert.ok(f.calls.filter(call => call.step === "update").every(call => !JSON.stringify(call.args).includes("quote")));
});
for (const [field, value] of [["variantId", "foreign"], ["productId", "foreign"], ["quantity", 1], ["baseUnitPriceCents", 201]] as const) test(`arithmetically valid quote with mismatched ${field} rolls back added cart`, async () => {
  const added = initialCart(); added.items = [{ ...resolved(), variantId: "variant", quantity: 2 }]; added.total = 400;
  const outcome = commercial(added), line = outcome.quote.items[0]; Object.assign(line, { [field]: value });
  line.unitPriceCents = line.baseUnitPriceCents; outcome.quote.originalSubtotalCents = line.baseUnitPriceCents * line.quantity;
  outcome.quote.subtotalCents = outcome.quote.originalSubtotalCents; outcome.quote.merchandiseTotalCents = outcome.quote.subtotalCents - outcome.discountCents;
  const f = fixture({ outcome }); await assert.rejects(f.executor.execute(f.request, f.dependencies));
  assert.deepEqual(f.saved(), initialCart()); assert.equal(f.calls.filter(call => call.step === "update").length, 1);
  assert.ok(!f.calls.some(call => call.step === "insert"));
});
test("legacy persistence outcome cannot substitute for a V1 commercial quote", async () => {
  const f = fixture({ outcome: { discountCents: 25, freeShipping: false } });
  await assert.rejects(f.executor.execute(f.request, f.dependencies)); assert.deepEqual(f.saved(), initialCart());
});
test("commercial write CAS compares added snapshot even if trusted callback changes the same transaction cart", async () => {
  const f = fixture(), evaluate = f.dependencies.evaluateRules;
  f.dependencies.evaluateRules = async (...args) => {
    const outcome = await evaluate(...args);
    await f.tx.storefrontCart.update({ where: { id: "physical-cart" }, data: { discount: 5 } });
    return outcome;
  };
  await assert.rejects(f.executor.execute(f.request, f.dependencies), error => error instanceof StorefrontCartSnapshotConflictError);
  assert.deepEqual(f.saved(), initialCart()); assert.equal(f.calls.filter(call => call.step === "rules").length, 1);
  assert.ok(!f.calls.some(call => call.step === "insert")); assert.equal(f.calls.at(-1)?.step, "rollback");
});
test("claim token is parameterized in full scoped WHERE and never projected or passed to dependencies", async () => {
  const f = fixture(); await f.executor.execute(f.request, f.dependencies);
  const query = f.calls.find(call => call.step === "request")!;
  const [projection, where] = query.sql!.split(/\bFROM\b/i);
  assert.ok(!/claim_token|claimToken/.test(projection));
  for (const column of ["merchant_id", "conversation_id", "cart_id", "principal_id", "claim_token", "claim_generation"])
    assert.ok(where.includes(column));
  for (const value of ["merchant", "conversation", "session", "principal", requestId, claimToken, 1n]) assert.ok(query.values!.includes(value));
  assert.ok(f.calls.filter(call => call.step === "lock").every(call => call.values?.[0] === JSON.stringify(["storefront-cart", "merchant", "session"])));
  for (const call of f.calls.filter(call => ["resolve", "rules"].includes(call.step))) {
    const serialized = JSON.stringify(call.args);
    assert.ok(!serialized.includes(claimToken)); assert.ok(!serialized.includes("fingerprint"));
  }
});
for (const field of ["merchantId", "conversationId", "cartId", "principalId"] as const) test(`foreign scope ${field} cannot access evidence or callbacks`, async () => {
  const f = fixture(); f.scopeRow[field] = "foreign";
  assert.deepEqual(await f.executor.execute(f.request, f.dependencies), { kind: "scope_unavailable" }); noWork(f.calls);
  assert.ok(!f.calls.some(call => ["request", "effect"].includes(call.step)));
});
for (const missing of [true, false]) test(`missing/unowned scope ${missing} does not create scope`, async () => {
  const f = fixture(missing ? { scopeRows: [] } : {}); if (!missing) f.scopeRow.protocolOwned = false;
  assert.deepEqual(await f.executor.execute(f.request, f.dependencies), { kind: "scope_unavailable" }); noWork(f.calls);
});
test("missing exact scoped/token/gen claim returns not_current without any commercial work", async () => {
  const f = fixture({ requestRows: [] });
  assert.deepEqual(await f.executor.execute(f.request, f.dependencies), { kind: "not_current" }); noWork(f.calls);
});
for (const [field, value] of [["messageId", "changed"], ["protocolVersion", 2], ["fingerprintVersion", 2],
  ["requestFingerprint", new Uint8Array(32).fill(34)], ["expectedRevision", 1n]] as const) {
  test(`request identity mismatch ${field} does no work and exposes no reference`, async () => {
    const f = fixture(); Object.assign(f.requestRow, { [field]: value });
    assert.deepEqual(await f.executor.execute(f.request, f.dependencies), { kind: "identity_conflict" }); noWork(f.calls);
  });
}
test("raw command kind outside candidate SQL CHECK is corrupted projection, not a supported identity", async () => {
  const f = fixture(); f.requestRow.commandKind = "other";
  await assert.rejects(f.executor.execute(f.request, f.dependencies)); noWork(f.calls);
  assert.ok(!f.calls.some(call => call.step === "commit"));
});
test("unknown request without existing effect refuses new work", async () => {
  const f = fixture(); f.requestRow.state = "unknown";
  assert.deepEqual(await f.executor.execute(f.request, f.dependencies), { kind: "not_current" }); noWork(f.calls);
});
for (const revision of [1n, BigInt(Number.MAX_SAFE_INTEGER)]) test(`revision ${revision} cannot run a fresh effect`, async () => {
  const f = fixture(); f.scopeRow.revision = revision;
  if (revision === BigInt(Number.MAX_SAFE_INTEGER)) {
    f.request.intent.expected_revision = Number.MAX_SAFE_INTEGER; f.requestRow.expectedRevision = revision;
  }
  assert.deepEqual(await f.executor.execute(f.request, f.dependencies), { kind: "revision_conflict" }); noWork(f.calls);
});
for (const state of ["processing", "unknown"]) test(`existing effect reference precedes ${state}/revision gates and runs no callbacks`, async () => {
  const f = fixture(); f.requestRow.state = state; f.scopeRow.revision = 1n;
  const duplicate = fixture({ scopeRows: [f.scopeRow], requestRows: [f.requestRow], effectRows: [f.effectRow] });
  assert.deepEqual(await duplicate.executor.execute(duplicate.request, duplicate.dependencies), { kind: "receipt_required", requestId, effectId, revision: 1 });
  noWork(duplicate.calls);
});
test("request snapshot detaches Buffer/scope/intent/claim before transaction begins", async () => {
  const gate = deferred(), f = fixture({ beforeTransaction: gate.promise }), bytes = Buffer.alloc(48, 17);
  f.request.fingerprint.bytes = bytes.subarray(8, 40);
  const pending = f.executor.execute(f.request, f.dependencies);
  f.request.scope.cartId = "changed"; f.request.intent.command.args.variantId = "changed";
  f.request.intent.command.args.quantity = 99; f.request.claim.claimToken = effectId; bytes.fill(34); gate.resolve();
  assert.equal((await pending).kind, "effect_recorded");
  assert.equal(f.saved().items[0].quantity, 2); assert.equal(f.saved().items[0].variantId, "variant");
  assert.ok(f.calls.find(call => call.step === "request")!.values!.includes(claimToken));
});
test("effect result does not escape before owning COMMIT resolves", async () => {
  const gate = deferred(), f = fixture({ beforeCommit: gate.promise }); let settled = false;
  const pending = f.executor.execute(f.request, f.dependencies).then(result => { settled = true; return result; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(f.calls.some(call => call.step === "commit")); assert.equal(settled, false);
  gate.resolve(); assert.equal((await pending).kind, "effect_recorded");
});
for (const failure of ["begin", "lock", "scope", "request", "effect", "cart-read", "catalog", "resolve", "rules", "update", "insert", "commit"] as const) {
  test(`${failure} failure propagates once, never retries/resets status or returns a successful effect`, async () => {
    const f = fixture({ failure });
    await assert.rejects(f.executor.execute(f.request, f.dependencies), error => error === f.failure);
    assert.equal(f.calls.filter(call => call.step === "begin").length, 1);
    assert.equal(f.saved().items.length, 0);
    assert.ok(f.calls.filter(call => call.step === "lock").every(call => !/UPDATE|INSERT|DELETE/.test(call.sql!)));
  });
}
for (const resolver of [null, { ...resolved(), variantId: "forged" }, { ...resolved(), quantity: 99 }, { ...resolved(), marketplace: {} },
  { ...resolved(), selectedOptions: [] }, { ...resolved(), selectedServiceSlot: {} }, { ...resolved(), productId: "foreign" },
  { ...resolved(), unitPriceCents: -1 }, { ...resolved(), unitPriceCents: 2_147_483_648 }]) {
  test(`resolver validation fails closed before cart writes ${JSON.stringify(resolver)}`, async () => {
    const f = fixture({ resolver }); await assert.rejects(f.executor.execute(f.request, f.dependencies));
    assert.ok(!f.calls.some(call => ["upsert", "update", "rules", "insert"].includes(call.step)));
  });
}
for (const outcome of [null, { discountCents: -1, freeShipping: false }, { discountCents: 401, freeShipping: false },
  { discountCents: 0, freeShipping: "yes" }, { discountCents: 0, freeShipping: false, extra: true }]) {
  test(`rule outcome validation rolls back the prior add ${JSON.stringify(outcome)}`, async () => {
    const f = fixture({ outcome }); await assert.rejects(f.executor.execute(f.request, f.dependencies));
    assert.equal(f.saved().items.length, 0); assert.equal(f.calls.filter(call => call.step === "update").length, 1);
    assert.ok(!f.calls.some(call => call.step === "insert"));
  });
}
for (const patch of [{ effectId: "bad" }, { claimGeneration: 2n }, { afterRevision: 2n }, { beforeRevision: 1n },
  { cartRowId: "foreign" }, { principalId: "foreign" }, { cartUpdatedAt: new Date(0) }, { claimToken },
  { afterRevision: BigInt(Number.MAX_SAFE_INTEGER) + 1n }]) {
  test(`invalid INSERT RETURNING aborts inside transaction ${Object.keys(patch)[0]}`, async () => {
    const base = fixture(), f = fixture({ insertRows: [{ ...base.effectRow, ...patch }] });
    await assert.rejects(f.executor.execute(f.request, f.dependencies));
    assert.ok(!f.calls.some(call => call.step === "commit")); assert.equal(f.saved().items.length, 0);
  });
}
for (const patch of [{ claimGeneration: 2n }, { beforeRevision: 1n }, { afterRevision: 0n }, { requestId: effectId },
  { cartId: "foreign" }, { claimToken }]) test(`invalid duplicate effect reference is not accepted ${Object.keys(patch)[0]}`, async () => {
  const base = fixture(); base.scopeRow.revision = 1n;
  const f = fixture({ scopeRows: [base.scopeRow], effectRows: [{ ...base.effectRow, ...patch }] });
  await assert.rejects(f.executor.execute(f.request, f.dependencies)); noWork(f.calls);
});

for (const contents of ["coupon", "options", "service", "marketplace"] as const) test(`unsupported existing cart ${contents} is rejected before resolver`, async () => {
  const cart = initialCart();
  const line = { ...resolved(), variantId: "existing", quantity: 1 };
  if (contents === "coupon") cart.couponCode = "SYNTHETIC";
  if (contents === "options") cart.items = [{ ...line, selectedOptions: [{ groupId: "g", groupName: "G", itemId: "i", itemName: "I", priceModifierInCents: 0 }] }];
  if (contents === "service") cart.items = [{ ...line, selectedServiceSlot: { slotId: "synthetic" } as never }];
  if (contents === "marketplace") cart.items = [{ ...line, marketplace: { lineItemId: "line", sellerMerchantId: "seller", federatedProductId: "federated" } }];
  const f = fixture({ cart }); await assert.rejects(f.executor.execute(f.request, f.dependencies));
  assert.ok(!f.calls.some(call => ["resolve", "upsert", "update", "rules", "insert"].includes(call.step)));
});
for (const catalog of [null, { product: { id: "product", type: "digital", metadata: {} } }, { product: { id: "product", type: "service", metadata: {} } },
  { product: { id: "other-product", type: "physical", metadata: {} } }, { product: { id: "product", type: "physical", metadata: { optionGroups: [{ id: "size", name: "Size", items: [{ id: "one", name: "One" }] }] } } }]) {
  test(`catalog target must be matching physical without food options ${JSON.stringify(catalog)}`, async () => {
    const f = fixture({ catalog }); await assert.rejects(f.executor.execute(f.request, f.dependencies));
    assert.ok(!f.calls.some(call => ["upsert", "update", "rules", "insert"].includes(call.step)));
  });
}
test("catalog precheck and core admission both use active non-deleted merchant-scoped variant lookup", async () => {
  const f = fixture(); await f.executor.execute(f.request, f.dependencies);
  const lookups = f.calls.filter(call => call.step === "catalog"); assert.equal(lookups.length, 2);
  for (const call of lookups) {
    const { where } = call.args as { where: unknown };
    assert.deepEqual(where, { id: "variant", isActive: true, product: { merchantId: "merchant", isActive: true, deletedAt: null } });
  }
});
test("resolver output is detached before awaiting core admission", async () => {
  const result = resolved(), f = fixture({ resolver: result, onAdmission: () => { result.unitPriceCents = 9999; result.name = "changed"; } });
  await f.executor.execute(f.request, f.dependencies);
  assert.equal(f.saved().items[0].unitPriceCents, 200); assert.equal(f.saved().items[0].name, "Fixture");
});
test("core total guard remains authoritative after valid bounded unit price resolution", async () => {
  const f = fixture({ resolver: { ...resolved(), unitPriceCents: 2_147_483_647 }, canonicalPriceCents: 2_147_483_647 });
  await assert.rejects(f.executor.execute(f.request, f.dependencies), /cart_total_invalid/);
  assert.equal(f.calls.filter(call => call.step === "update").length, 0);
  assert.ok(!f.calls.some(call => ["rules", "insert"].includes(call.step)));
});
for (const canonicalPriceCents of [null, 201]) test(`core admission refuses ${canonicalPriceCents === null ? "missing" : "divergent"} canonical price instead of trusting the resolver`, async () => {
  const f = fixture({ canonicalPriceCents });
  await assert.rejects(f.executor.execute(f.request, f.dependencies), error => error instanceof LegacySavedPriceReviewRequired && error.reason === "source_changed");
  assert.deepEqual(f.saved(), initialCart());
  assert.ok(!f.calls.some(call => ["update", "rules", "insert", "commit"].includes(call.step)));
  assert.equal(f.calls.at(-1)?.step, "rollback");
});
for (const patch of [{ extra: true }, { claim: { ...input().claim, claimGeneration: 2 } },
  { fingerprint: { version: 1, bytes: new Uint8Array(15) } }]) test(`invalid effect input fails before any SQL ${Object.keys(patch)[0]}`, async () => {
  const f = fixture(); await assert.rejects(f.executor.execute({ ...f.request, ...patch } as never, f.dependencies)); assert.deepEqual(f.calls, []);
});
for (const rows of [[], [{ unknown: true }], [fixture().effectRow, fixture().effectRow]]) test(`invalid effect INSERT row cardinality/projection ${rows.length}`, async () => {
  const f = fixture({ insertRows: rows }); await assert.rejects(f.executor.execute(f.request, f.dependencies));
  assert.ok(!f.calls.some(call => call.step === "commit"));
});

for (const mismatch of ["price", "product"] as const) test(`preexisting target ${mismatch} mismatch cannot mix old and resolved authority`, async () => {
  const cart = initialCart(); cart.items = [{ ...resolved(), variantId: "variant", quantity: 1,
    ...(mismatch === "price" ? { unitPriceCents: 100 } : { productId: "other-product" }) }];
  const f = fixture({ cart }); await assert.rejects(f.executor.execute(f.request, f.dependencies));
  assert.equal(f.calls.filter(call => call.step === "update").length, 0);
  assert.ok(!f.calls.some(call => ["rules", "insert"].includes(call.step)));
});
test("preexisting service without a JSON slot marker is still refused using tenant catalog", async () => {
  const cart = initialCart(); cart.items = [{ ...resolved(), variantId: "existing", quantity: 1 }];
  const f = fixture({ cart, existingCatalog: [{ id: "existing", product: { id: "product", type: "service", metadata: {} } }] });
  await assert.rejects(f.executor.execute(f.request, f.dependencies));
  assert.ok(!f.calls.some(call => ["resolve", "upsert", "update", "rules", "insert"].includes(call.step)));
});

test("matching existing physical target keeps price and adds only frozen requested quantity", async () => {
  const cart = initialCart(); cart.items = [{ ...resolved(), variantId: "variant", quantity: 1 }];
  const f = fixture({ cart });
  assert.equal((await f.executor.execute(f.request, f.dependencies)).kind, "effect_recorded");
  assert.equal(f.saved().items.length, 1); assert.equal(f.saved().items[0].quantity, 3);
  assert.equal(f.saved().items[0].unitPriceCents, 200); assert.equal(f.saved().total, 600);
  assert.deepEqual((f.calls.find(call => call.step === "existing-catalog")!.args as { where: unknown }).where,
    { id: { in: ["variant"] }, isActive: true, product: { merchantId: "merchant", isActive: true, deletedAt: null } });
});
for (const raw of ["scope-extra", "scope-overflow", "request-token", "request-overflow", "request-many"] as const) {
  test(`malformed raw ${raw} rejects before commercial work`, async () => {
    const base = fixture();
    const options: Options = raw === "scope-extra" ? { scopeRows: [{ ...base.scopeRow, extra: true }] }
      : raw === "scope-overflow" ? { scopeRows: [{ ...base.scopeRow, revision: BigInt(Number.MAX_SAFE_INTEGER) + 1n }] }
        : raw === "request-token" ? { requestRows: [{ ...base.requestRow, claimToken }] }
          : raw === "request-overflow" ? { requestRows: [{ ...base.requestRow, expectedRevision: BigInt(Number.MAX_SAFE_INTEGER) + 1n }] }
            : { requestRows: [base.requestRow, base.requestRow] };
    const f = fixture(options); await assert.rejects(f.executor.execute(f.request, f.dependencies)); noWork(f.calls);
    assert.ok(!f.calls.some(call => call.step === "commit"));
  });
}

test("duplicate reference ahead of anchored revision is refused without catalog or callbacks", async () => {
  const base = fixture(), f = fixture({ effectRows: [base.effectRow] });
  await assert.rejects(f.executor.execute(f.request, f.dependencies)); noWork(f.calls);
});
test("raw request generation outside the no-takeover candidate is refused without callbacks", async () => {
  const base = fixture(), f = fixture({ requestRows: [{ ...base.requestRow, claimGeneration: 2n }] });
  await assert.rejects(f.executor.execute(f.request, f.dependencies)); noWork(f.calls);
});
const existingVariant = () => ({ id: "existing", product: { id: "product", type: "physical", metadata: {} } });
for (const rows of [[], [existingVariant(), existingVariant()], [{ ...existingVariant(), id: "other" }],
  [{ ...existingVariant(), product: { ...existingVariant().product, id: "foreign-product" } }], [{ ...existingVariant(), extra: true }]]) {
  test(`existing catalog rows must be exact, unique and product-bound ${JSON.stringify(rows)}`, async () => {
    const cart = initialCart(); cart.items = [{ ...resolved(), variantId: "existing", quantity: 1 }];
    const f = fixture({ cart, existingCatalog: rows }); await assert.rejects(f.executor.execute(f.request, f.dependencies));
    assert.ok(!f.calls.some(call => ["resolve", "upsert", "update", "rules", "insert"].includes(call.step)));
  });
}

