import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";

const probe = process.argv[4] === "--probe-missing-authority-tables";
const legacyPriceOnly = process.argv[4] === "--legacy-price-only";
assert.equal(process.argv.length, probe || legacyPriceOnly ? 5 : 4);
const [url, runId] = process.argv.slice(2);
const parsedUrl = assertNativePrismaUrl(url);
assert.equal(parsedUrl.searchParams.get("application_name"), `aacp_write_native_${runId}`);
assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "native_worker_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
let active = "owned synthetic identity", passed = 0, maxConcurrentWaitingTransactions = 0;
const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
const merchant = "synthetic-merchant";
const discountRule = (percent = 40, extra = {}) => ({ id: "synthetic-discount", name: "Presentation field retained compatibly", enabled: true, priority: 1,
  conditions: [{ field: "cart_total", operator: "gte", value: 0 }], action: { type: "offer_discount", params: { percent } }, ...extra });
const rows = input => prisma.$queryRaw`SELECT id,items,total,discount,free_shipping AS shipping,updated_at AS "updatedAt"
  FROM storefront_carts WHERE merchant_id=${input.scope.merchantId} AND session_id=${input.scope.cartId}`;
const effects = input => prisma.$queryRaw`SELECT effect_id AS id FROM storefront_local_cart_effects WHERE request_id=${input.claim.requestId}::uuid`;
const revision = async input => (await prisma.$queryRaw`SELECT scope_revision AS value FROM storefront_execution_scopes
  WHERE merchant_id=${input.scope.merchantId} AND conversation_id=${input.scope.conversationId}`)[0].value;
const setRules = async rules => prisma.$executeRaw`INSERT INTO checkout_settings(id,merchant_id,advanced_rules) VALUES ('synthetic-settings',${merchant},${JSON.stringify(rules)}::jsonb)
  ON CONFLICT(merchant_id) DO UPDATE SET advanced_rules=EXCLUDED.advanced_rules`;
const reset = async ({ cost = 2000, max = 10, min = 38, rules = [discountRule()], autonomous = true } = {}) => {
  await prisma.$executeRaw`DELETE FROM product_promotions`;
  await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=10000,cost_in_cents=${cost},currency='BRL' WHERE variant_id='synthetic-variant'`;
  await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=5000,cost_in_cents=1000,currency='BRL' WHERE variant_id='other-variant'`;
  await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=${max},minimum_margin_percent=${min},autonomous_engine_enabled=${autonomous} WHERE merchant_id=${merchant}`;
  await setRules(rules);
};
try {
  await prisma.$connect();
  const [marker] = await prisma.$queryRaw`SELECT current_database() AS database,run_id FROM synthetic_native_marker`;
  assert.deepEqual(marker, { database: "storefront_synthetic", run_id: runId });
  await check("real Prisma sees required authority tables before loading readers", async () => {
    const [table] = await prisma.$queryRaw`SELECT to_regclass('public.product_prices')::text AS prices,to_regclass('public.merchant_rules')::text AS policies,
      to_regclass('public.checkout_settings')::text AS settings,to_regclass('public.product_promotions')::text AS promotions`;
    assert.deepEqual(table, { prices: "product_prices", policies: "merchant_rules", settings: "checkout_settings", promotions: "product_promotions" });
  });
  if (legacyPriceOnly) {
    const { runStorefrontLegacyPriceNativeCases } = await import("./storefront-legacy-price.native-cases.mjs");
    await runStorefrontLegacyPriceNativeCases({ prisma, runId, merchantId: merchant, check });
    console.log(JSON.stringify({ status: "passed", phase: "legacy-price-only", tests: passed, prismaClients: 1,
      actualLegacyCartRepository: true, actualPrismaCommercialReader: true, rawDatabaseAssertions: true,
      claimedV1Executed: false, defaultAuthoritySuiteExecuted: false, httpAuthorizationProven: false,
      paymentProven: false, productionAccess: false }));
  } else {
  const { createPrismaStorefrontLocalCartEffectDependencies } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-local-cart-effect.dependencies.ts");
  const { PrismaStorefrontWriteAdmissionRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-write-admission.repository.ts");
  const { PrismaStorefrontLocalCartEffectExecutor } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-local-cart-effect.executor.ts");
  const { PrismaStorefrontCartRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cart.repository.ts");
  const { storefrontLocalCartCommercialOutcomeV1Schema } = await import("../src/modules/storefront/domain/contracts/storefront-claimed-cart-effect.schemas.ts");
  const assertCommercial = (value, discountCents) => { const parsed = storefrontLocalCartCommercialOutcomeV1Schema.parse(value);
    assert.equal(parsed.discountCents, discountCents); assert.equal(parsed.freeShipping, false); return parsed; };
  const admission = new PrismaStorefrontWriteAdmissionRepository(prisma), executor = new PrismaStorefrontLocalCartEffectExecutor(prisma), legacy = new PrismaStorefrontCartRepository(prisma);
  const provision = async name => {
    const scope = { merchantId: merchant, conversationId: name, cartId: name, principalId: "synthetic-principal" };
    await prisma.$executeRaw`INSERT INTO merchants(id) VALUES (${merchant}) ON CONFLICT DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO storefront_execution_scopes(merchant_id,conversation_id,cart_id,principal_id) VALUES (${merchant},${name},${name},${scope.principalId})`;
    const input = { scope, intent: { version: 1, message_id: "synthetic-message", expected_revision: 0, command: { tool: "add_item_to_cart", args: { variantId: "synthetic-variant", quantity: 1 } } },
      fingerprint: { version: 1, bytes: Uint8Array.from({ length: 32 }, () => 17) } };
    const admitted = await admission.admit(input); assert.equal(admitted.kind, "claimed"); return { ...input, claim: admitted.claim };
  };
  const observed = () => {
    const real = createPrismaStorefrontLocalCartEffectDependencies(), calls = { resolve: 0, rules: 0 };
    let quotation;
    return { calls, quote: () => structuredClone(quotation), value: { resolveItem: async (...args) => { calls.resolve++; return real.resolveItem(...args); },
      evaluateRules: async (...args) => { calls.rules++; const result = await real.evaluateRules(...args); quotation = result; return result; } } };
  };
  const assertRolledBack = async (input, before = []) => { assert.deepEqual(await rows(input), before); assert.equal((await effects(input)).length, 0); assert.equal(await revision(input), 0n); };
  await check("real catalog BRL cost Decimal policy and rules atomically persist capped incentive", async () => {
    await reset(); const input = await provision("authority-commit"), deps = observed();
    const result = await executor.execute(input, deps.value); assert.equal(result.kind, "effect_recorded");
    const [cart] = await rows(input); assert.equal(cart.items[0].unitPriceCents, 10000); assert.equal(cart.items[0].sku, "synthetic-sku");
    assert.equal(cart.items[0].categoryId, "synthetic-category"); assert.equal(cart.total, 10000); assert.equal(cart.discount, 1000); assert.equal(cart.shipping, false);
    assert.equal((await effects(input)).length, 1); assert.equal(await revision(input), 1n); assert.deepEqual(deps.calls, { resolve: 1, rules: 1 });
    await setRules({ invalid: true });
    assert.deepEqual(await executor.execute(input, deps.value), { ...result, kind: "receipt_required" }); assert.deepEqual(deps.calls, { resolve: 1, rules: 1 });
  });
  await check("margin cost-null and cost-zero semantics use actual engine without estimated fallback", async () => {
    for (const [name, cost, expected] of [["margin-blocked",9500,0],["cost-null",null,0],["cost-zero",0,1000]]) {
      await reset({ cost }); const input = await provision(name); await executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies());
      assert.equal((await rows(input))[0].discount, expected); assert.equal(await revision(input), 1n);
    }
  });
  await check("Decimal percentage and real-denominated caps never round above authority", async () => {
    await reset({ max: 10.125 }); const decimal = await provision("decimal-cap"); await executor.execute(decimal, createPrismaStorefrontLocalCartEffectDependencies());
    assert.equal((await rows(decimal))[0].discount, 1012);
    await reset({ rules: [discountRule(40, { action: { type: "offer_discount", params: { percent: 40, maxDiscountReais: 5.55 } } })] });
    const cap = await provision("reais-cap"); await executor.execute(cap, createPrismaStorefrontLocalCartEffectDependencies()); assert.equal((await rows(cap))[0].discount, 555);
  });
  await check("shipping remains false without quote and first-match priority is preserved", async () => {
    await reset({ rules: [discountRule(40, { priority: 2 }), discountRule(0, { id: "shipping", priority: 1, action: { type: "offer_free_shipping", params: {} } })] });
    const input = await provision("no-quote"); await executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies());
    const [cart] = await rows(input); assert.equal(cart.shipping, false); assert.equal(cart.discount, 0);
  });
  await check("missing setting and JSON-null rules mean no configured incentive but merchant policy remains mandatory", async () => {
    await reset(); await prisma.$executeRaw`DELETE FROM checkout_settings WHERE merchant_id=${merchant}`;
    const missing = await provision("missing-setting"); await executor.execute(missing, createPrismaStorefrontLocalCartEffectDependencies()); assert.equal((await rows(missing))[0].discount, 0);
    await setRules(null); const empty = await provision("null-rules"); await executor.execute(empty, createPrismaStorefrontLocalCartEffectDependencies()); assert.equal((await rows(empty))[0].discount, 0);
  });
  await check("disabled valid product-scoped rule is inert rather than authorizing a discount", async () => {
    await reset({ rules: [discountRule(40, { enabled: false, productId: "synthetic-product" })] });
    const input = await provision("disabled-product-rule"); await executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies());
    assert.equal((await rows(input))[0].discount, 0);
  });
  await check("enabled payment and trigger conditions cannot authorize against missing context while disabled valid rules stay inert", async () => {
    for (const [name, field, value] of [["payment-null-string","payment_method","null"],["payment-pix","payment_method","pix"],
      ["trigger-exitintent","trigger_fired","exitintent"],["payment-null-value","payment_method",null]]) {
      await reset({ rules: [discountRule(10, { conditions: [{ field, operator: "eq", value }] })] });
      const input = await provision(name);
      await assert.rejects(executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies()),
        value === null ? { name: "ZodError" } : { message: "storefront_effect_rules_unsupported" });
      await assertRolledBack(input);
    }
    await reset({ rules: [discountRule(10, { enabled: false, conditions: [{ field: "payment_method", operator: "eq", value: "pix" }] }),
      discountRule(10, { id: "disabled-trigger", enabled: false, conditions: [{ field: "trigger_fired", operator: "eq", value: "exitintent" }] })] });
    const input = await provision("disabled-context-rules"); await executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies());
    assert.equal((await rows(input))[0].discount, 0);
  });
  await check("all catalog lines supply current SKU category and cost rather than stale cart snapshots", async () => {
    await reset({ rules: [discountRule(10, { conditions: [{ field: "product_in_cart", operator: "contains", value: "other-current-sku" },
      { field: "category_in_cart", operator: "contains", value: "other-current-category" }] })] });
    const input = await provision("hydrate-all-lines");
    await legacy.addItem(merchant, input.scope.cartId, { variantId: "other-variant", productId: "other-product", name: "SYNTHETIC", sku: "STALE-SKU", categoryId: "STALE-CATEGORY", unitPriceCents: 5000 });
    await executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies());
    const [cart] = await rows(input); assert.equal(cart.total, 15000); assert.equal(cart.discount, 1500);
  });
  await check("real readers see uncommitted price cost and policy changes only in supplied transaction and rollback them", async () => {
    await reset(); const input = await provision("read-own-writes"), real = createPrismaStorefrontLocalCartEffectDependencies();
    const rollback = new Error("synthetic_read_your_writes_rollback");
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=20000,cost_in_cents=4000 WHERE variant_id='synthetic-variant'`;
      await tx.$executeRaw`UPDATE merchant_rules SET max_discount_percent=5 WHERE merchant_id=${merchant}`;
      const resolved = await real.resolveItem(tx, input.scope, input.intent); assert.equal(resolved.unitPriceCents, 20000);
      const now = new Date(), cart = { id: "synthetic-only", merchantId: merchant, sessionId: input.scope.cartId, items: [{ ...resolved, variantId: "synthetic-variant", quantity: 1 }],
        couponCode: null, discount: 0, freeShipping: false, total: 20000, createdAt: now, updatedAt: now };
      assertCommercial(await real.evaluateRules(tx, input.scope, cart), 1000);
      // Discriminating cost observation: the old committed cost would still
      // authorize 1000, while this uncommitted high cost must block the incentive.
      await tx.$executeRaw`UPDATE product_prices SET cost_in_cents=19000 WHERE variant_id='synthetic-variant'`;
      assertCommercial(await real.evaluateRules(tx, input.scope, cart), 0);
      await tx.$executeRaw`UPDATE product_prices SET cost_in_cents=4000 WHERE variant_id='synthetic-variant'`;
      await tx.$executeRaw`UPDATE checkout_settings SET advanced_rules=${JSON.stringify([discountRule(3)])}::jsonb WHERE merchant_id=${merchant}`;
      assertCommercial(await real.evaluateRules(tx, input.scope, cart), 600);
      await tx.$executeRaw`INSERT INTO product_promotions(id,merchant_id,variant_id,discount_type,discount_value,starts_at,ends_at)
        VALUES ('uncommitted-promo',${merchant},'synthetic-variant','percent',10,CURRENT_TIMESTAMP-INTERVAL '1 day',CURRENT_TIMESTAMP+INTERVAL '1 day')`;
      assert.equal((await real.resolveItem(tx, input.scope, input.intent)).unitPriceCents, 20000);
      const promotion = assertCommercial(await real.evaluateRules(tx, input.scope, cart), 0);
      assert.equal(promotion.quote.promotionDiscountCents, 1000); assert.equal(promotion.quote.subtotalCents, 19000);
      throw rollback;
    }, { maxWait: 10_000, timeout: 15_000 }), error => error === rollback);
    const [price] = await prisma.$queryRaw`SELECT base_price_in_cents AS price,cost_in_cents AS cost FROM product_prices WHERE variant_id='synthetic-variant'`;
    assert.deepEqual(price, { price: 10000, cost: 2000 });
    assert.deepEqual((await prisma.$queryRaw`SELECT advanced_rules AS rules FROM checkout_settings WHERE merchant_id=${merchant}`)[0].rules, [discountRule()]);
    assert.equal((await prisma.$queryRaw`SELECT count(*)::int AS count FROM product_promotions`)[0].count, 0);
    await assertRolledBack(input);
  });
  await check("missing mandatory merchant policy never upserts defaults or records an effect", async () => {
    await reset({ rules: [] }); const input = await provision("missing-policy");
    await prisma.$executeRaw`ALTER TABLE merchant_rules RENAME TO synthetic_saved_merchant_rules`;
    try {
      await prisma.$executeRaw`CREATE TABLE merchant_rules (LIKE synthetic_saved_merchant_rules INCLUDING ALL)`;
      await assert.rejects(executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies()), { name: "ZodError" }); await assertRolledBack(input);
      assert.equal((await prisma.$queryRaw`SELECT count(*)::int AS count FROM merchant_rules`)[0].count, 0);
    } finally { await prisma.$executeRaw`DROP TABLE merchant_rules`; await prisma.$executeRaw`ALTER TABLE synthetic_saved_merchant_rules RENAME TO merchant_rules`; }
  });
  await check("malformed advanced policy unsupported action and disabled autonomy reject atomically", async () => {
    for (const [name, rules, autonomous] of [["malformed-rule",{ invalid: true },true],["unsupported-action",[discountRule(10,{ action: { type: "invent_discount", params: {} } })],true],
      ["enabled-product-rule",[discountRule(10, { productId: "synthetic-product" })],true],
      ["autonomy-off",[discountRule()],false]]) {
      await reset({ rules, autonomous }); const input = await provision(name);
      await assert.rejects(executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies()),
        name === "enabled-product-rule" || name === "autonomy-off" ? { message: "storefront_effect_rules_unsupported" } : { name: "ZodError" });
      await assertRolledBack(input);
    }
  });
  await check("reader query failure does not fall back to empty rules or commit the cart", async () => {
    await reset(); const input = await provision("query-error");
    await prisma.$executeRaw`ALTER TABLE checkout_settings RENAME TO synthetic_saved_settings`;
    try { await assert.rejects(executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies()), { code: "P2021" }); await assertRolledBack(input); }
    finally { await prisma.$executeRaw`ALTER TABLE synthetic_saved_settings RENAME TO checkout_settings`; }
  });
  await check("wrong currency and invalid catalog money reject without price or cost coercion", async () => {
    for (const [name, field] of [["usd-price","currency"],["negative-price","price"],["negative-cost","cost"]]) {
      await reset(); const input = await provision(name);
      if (field === "currency") await prisma.$executeRaw`UPDATE product_prices SET currency='USD' WHERE variant_id='synthetic-variant'`;
      else if (field === "price") await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=-1 WHERE variant_id='synthetic-variant'`;
      else await prisma.$executeRaw`UPDATE product_prices SET cost_in_cents=-1 WHERE variant_id='synthetic-variant'`;
      await assert.rejects(executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies()), { name: "ZodError" }); await assertRolledBack(input);
    }
  });
  await check("missing price row is unavailable authority rather than a zero-price fallback", async () => {
    await reset(); const input = await provision("missing-price");
    await prisma.$executeRaw`DELETE FROM product_prices WHERE variant_id='synthetic-variant'`;
    try { await assert.rejects(executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies()), { message: "storefront_effect_catalog_authority_invalid" }); await assertRolledBack(input); }
    finally { await prisma.$executeRaw`INSERT INTO product_prices(id,variant_id,base_price_in_cents,cost_in_cents) VALUES ('synthetic-price','synthetic-variant',10000,2000)`; }
  });
  await check("stale price on a non-target existing line rolls back add effect and revision without repricing", async () => {
    await reset(); const input = await provision("stale-other-line");
    await legacy.addItem(merchant, input.scope.cartId, { variantId: "other-variant", productId: "other-product", name: "SYNTHETIC", sku: "other-current-sku", unitPriceCents: 5000 });
    const before = await rows(input); await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=5001 WHERE variant_id='other-variant'`;
    await assert.rejects(executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies()), { message: "storefront_effect_existing_price_or_product_changed" }); await assertRolledBack(input, before);
  });
  const promo = async (id, { productId = null, variantId = null, categoryId = null, couponId = null, owner = merchant, active = true, future = false, expired = false,
    discountType = couponId ? null : "percent", discountValue = couponId ? null : 10, promoPriceInCents = null } = {}) =>
    prisma.$executeRaw`INSERT INTO product_promotions(id,merchant_id,product_id,variant_id,category_id,coupon_id,discount_type,discount_value,promo_price_in_cents,is_active,starts_at,ends_at)
      VALUES (${id},${owner},${productId},${variantId},${categoryId},${couponId},${discountType},${discountValue},${promoPriceInCents},${active},
        CASE WHEN ${future} THEN CURRENT_TIMESTAMP+INTERVAL '10 days' ELSE CURRENT_TIMESTAMP-INTERVAL '10 days' END,
        CASE WHEN ${expired} THEN CURRENT_TIMESTAMP-INTERVAL '1 day' ELSE CURRENT_TIMESTAMP+INTERVAL '20 days' END)`;
  await check("active variant product category and coupon rows authorize a transient quote, never persist promotional base prices", async () => {
    for (const [name, bound] of [["variant-promo",{ variantId: "synthetic-variant" }],["product-promo",{ productId: "synthetic-product" }],
      ["category-promo",{ categoryId: "synthetic-category" }],["coupon-promo",{ variantId: "synthetic-variant", couponId: "synthetic-coupon" }]]) {
      await reset(); const input = await provision(name), deps = observed(); await promo(name, bound);
      const result = await executor.execute(input, deps.value); assert.equal(result.kind, "effect_recorded");
      const quotation = assertCommercial(deps.quote(), bound.couponId ? 1000 : 0), [stored] = await rows(input);
      assert.equal(quotation.quote.promotionDiscountCents, bound.couponId ? 0 : 1000);
      assert.equal(stored.items[0].unitPriceCents, 10000); assert.equal(stored.total, 10000); assert.equal(stored.discount, quotation.discountCents);
      assert.equal(Object.hasOwn(stored.items[0], "pricingOriginalUnitPriceCents"), false);
      assert.deepEqual(Object.keys(result).sort(), ["effectId", "kind", "requestId", "revision"]);
      assert.equal(await revision(input), 1n); assert.equal((await effects(input)).length, 1);
    }
  });
  await check("inactive future expired and foreign-tenant promotions do not block valid base-BRL authority", async () => {
    await reset(); await promo("inactive", { variantId: "synthetic-variant", active: false }); await promo("future", { productId: "synthetic-product", future: true });
    await promo("expired", { categoryId: "synthetic-category", expired: true }); await promo("foreign", { variantId: "synthetic-variant", owner: "foreign-merchant" });
    const input = await provision("non-applicable-promos"); await executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies()); assert.equal((await rows(input))[0].discount, 1000);
  });
  await check("promotion on another existing line shares the original merchandise ceiling with additional D", async () => {
    await reset(); const input = await provision("other-line-promo");
    await legacy.addItem(merchant, input.scope.cartId, { variantId: "other-variant", productId: "other-product", name: "SYNTHETIC", sku: "other-current-sku", unitPriceCents: 5000 });
    await promo("other-line-active", { variantId: "other-variant" }); const deps = observed();
    await executor.execute(input, deps.value); const quotation = assertCommercial(deps.quote(), 1000), [stored] = await rows(input);
    assert.equal(quotation.quote.originalSubtotalCents, 15000); assert.equal(quotation.quote.promotionDiscountCents, 500);
    assert.equal(quotation.quote.subtotalCents, 14500); assert.equal(quotation.quote.merchandiseTotalCents, 13500);
    assert.equal(stored.total, 15000); assert.equal(stored.discount, 1000); assert.equal(stored.items.find(line => line.variantId === "other-variant").unitPriceCents, 5000);
  });
  await check("greatest fixed explicit-price and percent promotion separates P and D; duplicate cannot regrant or reprice", async () => {
    await reset({ max: 20 }); const input = await provision("combined-promotion"), deps = observed();
    await promo("percent10", { variantId: "synthetic-variant", discountValue: 10 });
    await promo("fixed15", { productId: "synthetic-product", discountType: "fixed", discountValue: 1500 });
    await promo("explicit12", { categoryId: "synthetic-category", discountType: null, discountValue: null, promoPriceInCents: 8800 });
    const result = await executor.execute(input, deps.value), quotation = assertCommercial(deps.quote(), 500), [stored] = await rows(input);
    assert.equal(quotation.quote.originalSubtotalCents, 10000); assert.equal(quotation.quote.promotionDiscountCents, 1500);
    assert.equal(quotation.quote.subtotalCents, 8500); assert.equal(quotation.quote.merchandiseTotalCents, 8000);
    assert.equal(quotation.quote.commercialNotices[0].code, "discount_limit_reached");
    assert.equal(stored.total, 10000); assert.equal(stored.items[0].unitPriceCents, 10000); assert.equal(stored.discount, 500);
    await setRules({ malformed: true }); await prisma.$executeRaw`UPDATE product_promotions SET discount_value=99 WHERE id='percent10'`;
    assert.deepEqual(await executor.execute(input, deps.value), { ...result, kind: "receipt_required" });
    assert.deepEqual(deps.calls, { resolve: 1, rules: 1 }); assert.deepEqual((await rows(input))[0], stored);
  });
  await check("missing cost high cost and merchant zero never persist promotional savings as extra D", async () => {
    for (const [name, settings, code] of [["promo-cost-null", { cost: null }, "benefit_conditions_not_met"],
      ["promo-high-cost", { cost: 9500 }, "benefit_conditions_not_met"], ["promo-policy-zero", { max: 0 }, "discount_unavailable"]]) {
      await reset(settings); const input = await provision(name), deps = observed(); await promo(name, { variantId: "synthetic-variant" });
      await executor.execute(input, deps.value); const quotation = assertCommercial(deps.quote(), 0), [stored] = await rows(input);
      assert.equal(quotation.quote.promotionDiscountCents, 0); assert.equal(quotation.quote.subtotalCents, 10000);
      assert.equal(quotation.quote.commercialNotices[0].code, code); assert.equal(stored.total, 10000); assert.equal(stored.discount, 0);
    }
  });
  await check("forged transient identity rolls back add cart effect and revision without any second evaluation", async () => {
    await reset(); const input = await provision("forged-quote"), real = createPrismaStorefrontLocalCartEffectDependencies(); let evaluations = 0;
    await assert.rejects(executor.execute(input, { resolveItem: real.resolveItem, evaluateRules: async (...args) => {
      evaluations++; const outcome = await real.evaluateRules(...args); outcome.quote.items[0].productId = "foreign-product"; return outcome;
    } }), { message: "storefront_effect_quote_cart_mismatch" });
    assert.equal(evaluations, 1); await assertRolledBack(input);
  });
  await check("malformed promotional descriptor rolls back the prior add with no fallback or effect", async () => {
    await reset(); const input = await provision("malformed-promo");
    await promo("malformed-promo", { variantId: "synthetic-variant", promoPriceInCents: 100 });
    await assert.rejects(executor.execute(input, createPrismaStorefrontLocalCartEffectDependencies()), { message: "product_promotion_descriptor_ambiguous" });
    await assertRolledBack(input);
  });
  await check("candidate final write forwards added snapshot CAS and rolls back intervening same-tx changes", async () => {
    await reset(); const input = await provision("candidate-added-cas"), real = createPrismaStorefrontLocalCartEffectDependencies();
    await assert.rejects(executor.execute(input, { resolveItem: real.resolveItem, evaluateRules: async (tx, scope, cart) => {
      const outcome = await real.evaluateRules(tx, scope, cart);
      await tx.storefrontCart.update({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.cartId } }, data: { discount: 1 } });
      return outcome;
    } }), { message: "storefront_cart_snapshot_conflict" });
    await assertRolledBack(input);
  });
  await check("twenty simultaneous same-claim executions run real readers once and commit one base-price cart incentive effect and revision", async () => {
    await reset({ max: 20 }); const input = await provision("authority-race"), deps = observed();
    await promo("authority-race-promo", { variantId: "synthetic-variant", discountValue: 15 });
    let held, release; const acquired = new Promise(resolve => { held = resolve; }), unlock = new Promise(resolve => { release = resolve; });
    const key = JSON.stringify(["storefront-cart", merchant, input.scope.cartId]);
    const holder = prisma.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`; held(); await unlock; }, { maxWait: 10_000, timeout: 15_000 });
    holder.catch(() => held()); let pending;
    try {
      await acquired; pending = Promise.all(Array.from({ length: 20 }, () => executor.execute(input, deps.value))).then(results => ({ results }), error => ({ error }));
      let waiting = 0;
      for (let attempt = 0; attempt < 60; attempt++) {
        const [{ count }] = await prisma.$queryRaw`SELECT count(DISTINCT a.pid)::int AS count FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${`aacp_write_native_${runId}`} AND l.locktype='advisory' AND NOT l.granted`;
        waiting = count; if (waiting === 20) break; await new Promise(resolve => setTimeout(resolve, 75));
      }
      assert.equal(waiting, 20); maxConcurrentWaitingTransactions = waiting; release(); await holder;
      const outcome = await pending; if (outcome.error) throw outcome.error;
      assert.equal(outcome.results.filter(result => result.kind === "effect_recorded").length, 1); assert.equal(outcome.results.filter(result => result.kind === "receipt_required").length, 19);
      assert.equal(new Set(outcome.results.map(result => result.effectId)).size, 1);
    } finally { release(); await holder; if (pending) await pending; }
    assert.deepEqual(deps.calls, { resolve: 1, rules: 1 }); const [cart] = await rows(input);
    assert.equal(cart.items[0].quantity, 1); assert.equal(cart.total, 10000); assert.equal(cart.discount, 500); assert.equal((await effects(input)).length, 1); assert.equal(await revision(input), 1n);
    assert.equal(assertCommercial(deps.quote(), 500).quote.promotionDiscountCents, 1500);
  });
  console.log(JSON.stringify({ status: "passed", tests: passed, actualPrismaReaders: true, realRulesEngine: true, maxConcurrentWaitingTransactions,
    prismaClients: 1, persistedBaseBrlOnly: true, transientPromotionalQuotationProven: true, durablePromotionalHistoryProven: false,
    repeatablePolicySnapshotProven: false, businessExactlyOnceProven: false, productionAccess: false }));
  }
} catch (error) {
  console.error(JSON.stringify({ status: "failed", test: active, errorType: error?.name ?? "Error", code: typeof error?.code === "string" ? error.code : undefined }));
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
