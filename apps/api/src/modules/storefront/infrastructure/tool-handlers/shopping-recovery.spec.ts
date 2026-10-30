import test from "node:test";
import assert from "node:assert/strict";
import { createShoppingRecommendationReader } from "./shopping-recommendation.handler.js";
import { shoppingSearchPlanSchema } from "../../domain/contracts/shopping-search-plan.schemas.js";
import { storefrontToolOutputSchemas } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { createAllowedScopeAgent } from "../agents/storefront-scope.fixture.js";
import { storefrontConversationOutputSchema } from "../../domain/contracts/storefront-conversation.schemas.js";
import { buildMetaUiView } from "../../../whatsapp-channel/domain/ui/meta-ui-renderer.js";
import { shoppingFamilyMatches } from "../../domain/services/shopping-recovery.js";

test("a family word is not proved by an unrelated word containing its letters", () => {
  assert.equal(shoppingFamilyMatches("cabo", "Acabou o creme de uso diário."), false);
  assert.equal(shoppingFamilyMatches("kit organizador", "Kit organizador de cabos preto."), true);
  assert.equal(shoppingFamilyMatches("cabo", "Cabo-USB preto."), true);
});

const merchantId = "owned", ctx = { merchantId, sessionId: "session", userMessage: "Kit Organizador Viajante; se não tiver, recomende semelhante de preferência azul até R$70. Não adicione nem cobre." };
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const product = (id = "essential", price = 6000, attributes: Record<string, string> = { cor: "preto" }) => ({ id,
  name: `Kit Organizador ${id}`, description: "Organizador para cabos na mochila", type: "physical" as const,
  price, inStock: true, source: "local" as const, variants: [{ id: `variant:${id}`, sku: id,
    attributes, basePriceInCents: price, stockQuantity: 10, stockReserved: 0, isActive: true }] });
const criteria = (extra: Record<string, unknown> = {}) => ({ version: 1, query: "kit organizador viajante", maxPriceCents: 7000,
  attributes: [{ name: "cor", value: "azul", operator: "equals", priority: "preferred" }], unsupportedCriteria: [],
  recovery: { familyQuery: "kit organizador", optionalQueryTerms: ["viajante"] }, ...extra });

function fixture(rows = [product()], options: any = {}) {
  const queries: any[] = [], quotes: any[] = [];
  let writes = 0;
  const read = createShoppingRecommendationReader({
    merchantRepo: { getExistingRules: async () => ({ maxDiscountPercent: 10, minimumMarginPercent: 0 }) },
    cartRepo: new Proxy({}, { get: () => () => { writes++; throw Error("write forbidden"); } }),
    prisma: {
      productPromotion: { findMany: async (q: any) => { assert.equal(q.where.merchantId, merchantId); return options.promotions ?? []; } },
      productPrice: { findMany: async (q: any) => { quotes.push(q); assert.deepEqual(q.where.variant.product,
        { merchantId, isActive: true, deletedAt: null });
        const row = rows.find(p => p.variants.some(v => q.where.variantId.in.includes(v.id)))!;
        const variant = row.variants.find(v => q.where.variantId.in.includes(v.id))!;
        return options.unknown || options.foreign ? [] : [{ variantId: variant.id, basePriceInCents: variant.basePriceInCents,
          costInCents: 100, variant: { productId: row.id, product: { categoryId: "family", metadata: {} } } }]; } },
    },
  } as never, { ...ctx, ...(options.context ?? {}) }, async args => {
    queries.push(structuredClone(args));
    if (options.error) throw Error("catalog unavailable");
    if (options.page) return options.page(args, queries.length);
    const plan = args.criteria!;
    const products = rows.filter(p => normalize(p.name).includes(normalize(args.query!))
      && plan.attributes.filter(a => a.priority === "required" || a.operator === "not_equals").every(a =>
        a.operator === "equals" ? normalize(p.variants[0]!.attributes[a.name] ?? "") === normalize(a.value)
          : !!p.variants[0]!.attributes[a.name] && normalize(p.variants[0]!.attributes[a.name]!) !== normalize(a.value)));
    return { products, nextCursor: null, query: args.query };
  });
  return { handler: read, read: async (plan = criteria()) => storefrontToolOutputSchemas.search_products.parse(await read({ criteria: plan as never, limit: 3 })), queries, quotes, writes: () => writes };
}

test("SALE21: absent exact model and preferred blue return a real related black option within R$70, with differences and no writes", async () => {
  const f = fixture(), input = criteria(), before = structuredClone(input);
  const out = await f.read(input);
  assert.deepEqual(out.products.map(p => [p.id, p.price]), [["essential", 6000]]);
  assert.equal(out.searchEvidence!.matchType, "similar");
  assert.match(out.searchEvidence!.message, /semelhante/i); assert.match(out.searchEvidence!.message, /preto/);
  assert.match(out.searchEvidence!.message, /azul/); assert.match(out.searchEvidence!.message, /comparar|detalhes/i);
  assert.equal(f.queries.length, 2); assert.equal(f.writes(), 0);
  assert.deepEqual(out.searchEvidence!.appliedPlan, shoppingSearchPlanSchema.parse(input)); assert.deepEqual(input, before);
});

test("exact match wins without broadening and preferred attributes are checked on the priced variant", async () => {
  const f = fixture([product("viajante", 6500, { cor: "azul" })]);
  const out = await f.read(); assert.equal(out.searchEvidence!.matchType, "exact"); assert.equal(f.queries.length, 1);
  assert.deepEqual(out.products.map(p => p.id), ["viajante"]);
});

test("SALE22: mandatory blue and every exclusion survive both reads; ask before changing them", async () => {
  const f = fixture(), input = criteria({ attributes: [
    { name: "cor", value: "azul", operator: "equals", priority: "required" },
    { name: "material", value: "couro", operator: "not_equals", priority: "preferred" }] });
  const out = await f.read(input); assert.deepEqual(out.products, []);
  for (const q of f.queries) assert.ok(q.criteria.attributes.every((a: any) => a.priority === "required"));
  assert.match(out.searchEvidence!.message, /azul/); assert.match(out.searchEvidence!.message, /aceita|flexibilizar/i);
});

test("SALE23: cap50 never admits the R$60 item or silently increases the cap", async () => {
  const f = fixture(); const out = await f.read(criteria({ maxPriceCents: 5000 }));
  assert.deepEqual(out.products, []); assert.match(out.searchEvidence!.message, /50,00/);
  assert.match(out.searchEvidence!.message, /limite|teto|orçamento/); assert.equal(f.writes(), 0);
});

test("R$95 recovery uses the canonical R$90 promotion, without treating contextual purpose as a fabricated requirement", async () => {
  const row = product("completo", 10000), f = fixture([row], { promotions: [{ id: "promo", merchantId, productId: row.id,
    isActive: true, discountType: "percent", discountValue: 10, startsAt: new Date(0), endsAt: new Date("2099-01-01") }] });
  const out = await f.read(criteria({ maxPriceCents: 9500 })); assert.equal(out.products[0]!.price, 9000);
  assert.equal(out.products[0]!.variants![0]!.price, 9000);
});

test("recovery without monetary bounds still uses canonical price authority", async () => {
  const { maxPriceCents: _max, ...input } = criteria(); const f = fixture();
  const out = await f.read(input as never); assert.equal(out.products[0]!.price, 6000); assert.equal(f.quotes.length, 1);
});

test("actual provider shape: an optional exact name outside the query may only narrow the first read when proved in current text", async () => {
  const f = fixture(); const input = criteria({ query: "kit organizador", recovery: { familyQuery: "kit organizador", optionalQueryTerms: ["Viajante"] } });
  const out = await f.read(input); assert.equal(out.products[0]!.price, 6000);
  assert.equal(f.queries[0].query.toLowerCase(), "kit organizador viajante");
  assert.equal(f.queries[1].query, "kit organizador"); assert.equal(out.searchEvidence!.matchType, "similar");
  const unknownName = fixture(undefined, { context: { userMessage: "Quero um kit organizador azul." } });
  await assert.rejects(unknownName.read(input), /scope_unconfirmed/); assert.equal(unknownName.queries.length, 0);
  const exclusive = fixture(undefined, { context: { userMessage: "Quero somente o modelo Viajante." } });
  await assert.rejects(exclusive.read(input), /scope_unconfirmed/); assert.equal(exclusive.queries.length, 0);
});

test("typed positive preference alone activates exact-to-similar with immutable original plan, including recovery:null on the planner wire", async () => {
  const { recovery: _recovery, ...input } = criteria({ query: "kit organizador" });
  const f = fixture(); const out = await f.read(input as never);
  assert.equal(out.searchEvidence!.matchType, "similar"); assert.match(out.searchEvidence!.message, /preto/);
  assert.equal(f.queries.length, 2); assert.equal(out.searchEvidence!.appliedPlan.recovery, undefined);
  assert.deepEqual(out.searchEvidence!.appliedPlan, shoppingSearchPlanSchema.parse(input));
});

test("a bounded sixty-variant quote budget cannot become false absence or another recovery round", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => product(`viajante-${i}`, 10000, { cor: "azul" }));
  for (const row of rows) row.variants = Array.from({ length: 4 }, (_, n) => ({ ...row.variants[0]!, id: `${row.id}:${n}` }));
  const f = fixture(rows, { page: () => ({ products: rows, nextCursor: null }) });
  const out = await f.read(); assert.equal(f.quotes.length, 60); assert.equal(f.queries.length, 1);
  assert.equal(out.searchEvidence!.matchType, "incomplete"); assert.deepEqual(out.products, []);
});

test("unknown mandatory purpose is preserved instead of silently weakened", async () => {
  const f = fixture(); const out = await f.read(criteria({ attributes: [{ name: "finalidade", value: "poucos cabos na mochila", operator: "equals", priority: "required" }] }));
  assert.deepEqual(out.products, []); assert.match(out.searchEvidence!.message, /finalidade|poucos cabos/);
});

for (const [label, options] of Object.entries({ unknown: { unknown: true }, tenant: { foreign: true }, error: { error: true } }))
  test(`${label}: unavailable reads cannot establish absence or yield alternatives`, async () => {
    const f = fixture(undefined, options); await assert.rejects(f.read()); assert.equal(f.writes(), 0);
  });

test("exact scan shares a three-page budget with recovery and truncation never proves absence", async () => {
  const f = fixture(undefined, { page: (_: unknown, n: number) => ({ products: [], nextCursor: `page:${n}` }) });
  const out = await f.read(); assert.equal(f.queries.length, 3); assert.ok(f.queries.every(q => q.query.includes("viajante")));
  assert.equal(out.searchEvidence!.matchType, "incomplete"); assert.doesNotMatch(out.searchEvidence!.message, /não encontrei/i);
});

test("family scan has only the remainder of the shared budget, disclosing incomplete selection", async () => {
  const f = fixture(undefined, { page: (_: unknown, n: number) => ({ products: n === 1 ? [] : [product()], nextCursor: n === 1 ? null : `page:${n}` }) });
  const out = await f.read(); assert.equal(f.queries.length, 3); assert.equal(out.products.length, 1);
  assert.match(out.searchEvidence!.message, /seleção|completa/);
});

test("cyclic pagination rejects rather than retrying the same read", async () => {
  const f = fixture(undefined, { page: () => ({ products: [], nextCursor: "same" }) });
  await assert.rejects(f.read(), /cursor/); assert.equal(f.queries.length, 2);
});

test("unrelated, inactive and stockless rows never fill a recovery carousel", async () => {
  for (const row of [{ ...product("creme"), name: "Creme facial", description: "Pele sensível" },
    { ...product(), inStock: false }, { ...product(), variants: [{ ...product().variants[0]!, isActive: false }] },
    { ...product(), variants: [{ ...product().variants[0]!, stockReserved: 10 }] }]) {
    const f = fixture([row], { page: (_: unknown, n: number) => ({ products: n === 1 ? [] : [row], nextCursor: null }) });
    assert.deepEqual((await f.read()).products, []); assert.equal(f.writes(), 0);
  }
});

test("query recovery rejects arbitrary broadening, removed exclusions, hard brand/model, and lost compatibility", async () => {
  for (const [input, context] of [
    [criteria({ recovery: { familyQuery: "creme", optionalQueryTerms: ["viajante"] } }), {}],
    [criteria({ recovery: { familyQuery: "*", optionalQueryTerms: ["kit organizador viajante"] } }), {}],
    [criteria({ query: "kit sem couro", recovery: { familyQuery: "kit", optionalQueryTerms: ["sem couro"] } }), {}],
    [criteria(), { userMessage: "Quero somente o modelo Viajante, sem adicionar." }],
    [criteria(), { userMessage: "Quero apenas a marca Viajante." }],
    [criteria(), { userMessage: "Quero somente o Kit Organizador Viajante." }],
    [criteria(), { userMessage: "Deve ser obrigatoriamente azul." }],
    [criteria(), { userMessage: "A cor azul é obrigatória." }],
    [criteria(), { userMessage: "Quero azul obrigatório." }],
    [criteria(), { userMessage: "Azul não é opcional." }],
    [criteria(), { userMessage: "O modelo Viajante é obrigatório." }],
    [criteria({ query: "kit compativel iphone", recovery: { familyQuery: "kit compativel", optionalQueryTerms: ["iphone"] } }), { userMessage: "Preciso de kit compatível com iPhone." }],
  ] as any[]) {
    const f = fixture(undefined, { context }); const out = await f.read(input);
    assert.deepEqual(out.products, []); assert.equal(f.queries.length, 1);
    assert.ok(f.queries[0].query !== "*" && !f.queries[0].query.includes("creme"));
  }
});

test("negating the obligation keeps a typed preference relaxable; negating optionality does not", async () => {
  for (const userMessage of ["Azul não é obrigatório.", "Não precisa ser azul.", "Não é obrigatório azul."]) {
    const f = fixture(undefined, { context: { userMessage } });
    const out = await f.read(criteria({ query: "kit organizador", recovery: { familyQuery: "kit organizador", optionalQueryTerms: [] } }));
    assert.equal(out.searchEvidence!.matchType, "similar"); assert.equal(out.products[0]!.id, "essential");
  }
});

test("a mistaken optional label cannot erase the product family and present an unrelated namesake", async () => {
  for (const recovery of [
    { familyQuery: "viajante", optionalQueryTerms: ["kit organizador"] },
    { familyQuery: "kit", optionalQueryTerms: ["organizador", "viajante"] },
    { familyQuery: "kit viajante", optionalQueryTerms: ["organizador"] },
  ]) {
    const row = { ...product("cosmetic"), name: "Creme Viajante Kit", description: "Creme para a pele" };
    const f = fixture([row]); const out = await f.read(criteria({ recovery }));
    assert.deepEqual(out.products, []); assert.equal(f.queries.length, 1); assert.equal(f.writes(), 0);
  }
  const namesake = fixture([{ ...product("cosmetic"), name: "Creme Viajante", description: "Creme para a pele" }]);
  await assert.rejects(namesake.read(criteria({ query: "viajante",
    recovery: { familyQuery: "viajante", optionalQueryTerms: ["kit organizador"] } })), /scope_unconfirmed/);
  assert.equal(namesake.queries.length, 0); assert.equal(namesake.writes(), 0);
  const singleFamily = fixture(undefined, { context: { userMessage: "Tênis SprintPlus; se não tiver, mostre semelhantes." } });
  await assert.rejects(singleFamily.read(criteria({ query: "tênis",
    recovery: { familyQuery: "tênis", optionalQueryTerms: ["SprintPlus"] } })), /scope_unconfirmed/);
  assert.equal(singleFamily.queries.length, 0);
});

test("safe suffix recovery retains the family and lexical exclusion; a one-word real family still works", async () => {
  const row = { ...product(), name: "Kit Organizador sem couro", description: "Organizador para cabos sem couro" };
  const f = fixture([row]);
  const out = await f.read(criteria({ query: "kit organizador viajante sem couro",
    recovery: { familyQuery: "kit organizador sem couro", optionalQueryTerms: ["viajante"] } }));
  assert.equal(out.products.length, 1); assert.equal(f.queries[1].query, "kit organizador sem couro");
  const shoe = { ...product(), name: "Tênis Básico", description: "Tênis para corrida" };
  const shoes = fixture([shoe]);
  const result = await shoes.read(criteria({ query: "tênis SprintPlus", recovery: { familyQuery: "tênis", optionalQueryTerms: ["SprintPlus"] } }));
  assert.equal(result.products.length, 1); assert.equal(result.searchEvidence!.matchType, "similar");
});

test("same-variant verification rejects a cheap wrong-color variant even if another variant is blue", async () => {
  const row = product("viajante", 6000, { cor: "preto" });
  row.variants.push({ ...row.variants[0]!, id: "blue", attributes: { cor: "azul" }, basePriceInCents: 12000 });
  const f = fixture([row], { page: (_: unknown, n: number) => ({ products: n === 1 ? [row] : [], nextCursor: null }) });
  const out = await f.read(criteria({ attributes: [{ name: "cor", value: "azul", operator: "equals", priority: "required" }] }));
  assert.deepEqual(out.products, []);
});

for (const messageFormat of [undefined, "whatsapp"] as const) test(`Agent → canonical reader → output contract and WhatsApp UI preserve recovery facts (${messageFormat ?? "web"})`, async () => {
  const f = fixture(), input = criteria(); let modelCalls = 0, legacyReads = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, provider: { chat: async () => {
    modelCalls++; return { content: JSON.stringify({ schemaVersion: 1, plan: { minPriceCents: null, minRating: null,
      sortBy: null, delivery: null, ...input } }), usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
  } } as never, toolHandlers: { recommendProducts: f.handler,
    searchProducts: async () => { legacyReads++; throw Error("base-price fallback forbidden"); } } as never },
  { domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", requiresTool: true, needsProductDiscovery: true });
  const result = await agent.run({ ...ctx, userMessage: ctx.userMessage, cartId: ctx.sessionId, history: [], messageFormat });
  assert.equal(result.safetyValidation.safe, true); assert.equal(modelCalls, 1); assert.equal(legacyReads, 0);
  assert.equal(f.writes(), 0); assert.match(result.message, /preto/); assert.match(result.message, /semelhante/i);
  assert.equal(storefrontConversationOutputSchema.safeParse({ message: result.message, blocks: result.blocks,
    cartId: ctx.sessionId, suggestedNext: [] }).success, true);
  const block = result.blocks[0]!.data as any;
  assert.equal(block.products[0].price, 6000); assert.equal(block.criteria.maxPriceCents, 7000);
  assert.deepEqual(block.criteria.recovery, input.recovery);
  const view = buildMetaUiView({ agentMessage: result.message, merchantName: "Loja", quickReplies: [], blocks: result.blocks,
    state: { version: 1, conversationId: ctx.sessionId, stage: "store", history: [], revision: "current", page: 0, previousViews: [] } } as never);
  assert.ok(view.choices.length > 0);
});

test("Agent recovery with no monetary bounds still chooses the canonical reader", async () => {
  const f = fixture(); let legacyReads = 0;
  const { maxPriceCents: _max, ...input } = criteria();
  const agent = createAllowedScopeAgent({ structuredRouting: true, provider: { chat: async () => ({
    content: JSON.stringify({ schemaVersion: 1, plan: { minPriceCents: null, maxPriceCents: null, minRating: null,
      sortBy: null, delivery: null, ...input } }), usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }),
  } as never, toolHandlers: { recommendProducts: f.handler, searchProducts: async () => { legacyReads++; throw Error("forbidden"); } } as never },
  { domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", requiresTool: true, needsProductDiscovery: true });
  const result = await agent.run({ ...ctx, cartId: ctx.sessionId, history: [] });
  assert.equal(legacyReads, 0); assert.equal(f.quotes.length, 1); assert.equal(result.safetyValidation.safe, true);
});
