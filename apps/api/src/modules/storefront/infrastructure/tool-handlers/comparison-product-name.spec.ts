import test from "node:test";
import assert from "node:assert/strict";
import { resolveComparisonNames } from "./comparison-product-name.js";
import { createProductHandlers } from "./product.handlers.js";
import { validateStorefrontToolOutput } from "../../domain/contracts/storefront-tool-output.schemas.js";

const merchantId = "merchant";
const essential = { id: "essential", name: "QA Vendas — Kit Organizador Essencial (teste sem envio)" };
const complete = { id: "complete", name: "QA Vendas — Kit Organizador Completo (teste sem envio)" };
function namesRepository(rows: Array<{ id: string; name: string }>) {
  const calls: Array<{ merchantId: string; limit: number; cursor?: string }> = [];
  return { calls, async listPublicNames(input: { merchantId: string; limit: number; cursor?: string }) {
    calls.push(input); assert.equal(input.merchantId, merchantId);
    const start = input.cursor ? rows.findIndex(row => row.id === input.cursor) + 1 : 0;
    const items = rows.slice(start, start + input.limit);
    return { items, ...(start + input.limit < rows.length ? { nextCursor: items.at(-1)!.id } : {}) };
  } };
}

test("a unique contiguous public phrase resolves to its canonical product, without QA-specific stripping", async () => {
  const repo = namesRepository([essential, complete]);
  const result = await resolveComparisonNames(repo, merchantId, ["Kit Organizador Essencial", "Kit Organizador Completo"]);
  assert.deepEqual(result.map(item => [item.status, item.candidates[0]?.id]), [["resolved", "essential"], ["resolved", "complete"]]);
  assert.equal(result[0]!.candidates[0]!.name, essential.name);
});

test("exact names have priority, but duplicate exact names remain ambiguous", async () => {
  const one = await resolveComparisonNames(namesRepository([{ id: "exact", name: "Café Especial" }, { id: "decorated", name: "Marca Café Especial Premium" }]), merchantId, ["Café Especial"]);
  assert.equal(one[0]!.candidates[0]!.id, "exact");
  const duplicate = await resolveComparisonNames(namesRepository([{ id: "first", name: "Café Especial" }, { id: "second", name: "CAFE ESPECIAL" }]), merchantId, ["cafe especial"]);
  assert.equal(duplicate[0]!.status, "ambiguous"); assert.equal(duplicate[0]!.candidateCount, 2);
});

test("partial words and missing names never become product substitutions", async () => {
  const result = await resolveComparisonNames(namesRepository([{ id: "projector", name: "Projector" }]), merchantId, ["Pro", "Kit inexistente"]);
  assert.deepEqual(result.map(item => item.status), ["not_found", "not_found"]);
});

test("uniqueness includes later pages rather than selecting the first matching name", async () => {
  const rows = Array.from({ length: 102 }, (_, index) => ({ id: `p${String(index).padStart(4, "0")}`, name: `Produto ${index}` }));
  rows[0]!.name = "Marca A Kit Especial"; rows[101]!.name = "Marca B Kit Especial";
  const repo = namesRepository(rows), result = await resolveComparisonNames(repo, merchantId, ["Kit Especial"]);
  assert.equal(repo.calls.length, 2); assert.equal(repo.calls[1]!.cursor, "p0099");
  assert.equal(result[0]!.status, "ambiguous"); assert.equal(result[0]!.candidateCount, 2);
});

test("an exhausted cost window never claims uniqueness or absence", async () => {
  const rows = Array.from({ length: 301 }, (_, index) => ({ id: `p${String(index).padStart(4, "0")}`, name: index === 0 ? "Nome pedido" : `Produto ${index}` }));
  const repo = namesRepository(rows), result = await resolveComparisonNames(repo, merchantId, ["Nome pedido", "Não visto"]);
  assert.equal(repo.calls.length, 3); assert.deepEqual(result.map(item => item.status), ["limited", "limited"]);
  assert.deepEqual(result.map(item => item.candidates), [[], []]);
});

test("duplicate rows or cyclic cursors cannot fabricate complete coverage", async () => {
  const result = await resolveComparisonNames({ listPublicNames: async () => ({ items: [essential], nextCursor: essential.id }) }, merchantId, ["Kit Organizador Essencial"]);
  assert.equal(result[0]!.status, "limited");
  assert.equal((await resolveComparisonNames({}, merchantId, ["Nome"]))[0]?.status, "limited");
});

test("an unavailable reader is limited rather than proof of product absence", async () => {
  const result = await resolveComparisonNames({ listPublicNames: async () => { throw Error("unavailable"); } }, merchantId, ["Nome"]);
  assert.equal(result[0]!.status, "limited"); assert.deepEqual(result[0]!.candidates, []);
});

const entity = (row: typeof essential) => ({ ...row, merchantId, isActive: true, type: "physical", totalStock: 10,
  description: row.id === "essential" ? "Estojo de 0,5 L com uma divisória." : "Estojo de 2 L com três divisórias.",
  defaultVariant: { basePriceInCents: row.id === "essential" ? 6000 : 10000, attributes: { cor: "preto" } } });

test("comparison hydrates current owned active products and exposes bounded public facts", async () => {
  const repo = namesRepository([essential, complete]);
  const handlers = createProductHandlers({ productRepo: { ...repo, findById: async (scope: string, id: string) => {
    assert.equal(scope, merchantId); return entity(id === essential.id ? essential : complete);
  } } } as never, { merchantId, sessionId: "comparison" });
  const result = await handlers.compareProducts({ productNames: ["Kit Organizador Essencial", "Kit Organizador Completo"], includeSimilar: false });
  assert.deepEqual(result.comparison.map(item => item.id), ["essential", "complete"]);
  assert.match(result.comparison[0]!.description!, /0,5 L/); assert.equal(result.requiresProductNames, false);
  assert.equal(validateStorefrontToolOutput("compare_products", result).ok, true);
});

test("different requested names resolving to the same id do not compare an item with itself", async () => {
  const handlers = createProductHandlers({ productRepo: { ...namesRepository([essential]), findById: async () => entity(essential) } } as never, { merchantId, sessionId: "comparison" });
  const result = await handlers.compareProducts({ productNames: [essential.name, "Kit Organizador Essencial"], includeSimilar: false });
  assert.equal(result.comparison.length, 1); assert.equal(result.requiresProductNames, true);
});

test("an ambiguous public name asks for selection without hydrating a first candidate or declaring absence", async () => {
  const handlers = createProductHandlers({ productRepo: { ...namesRepository([essential, { id: "another", name: "Outra marca Kit Organizador Essencial" }]),
    findById: async () => assert.fail("an ambiguous name cannot select the first product"),
  } } as never, { merchantId, sessionId: "comparison" });
  const result = await handlers.compareProducts({ productNames: ["Kit Organizador Essencial"], includeSimilar: false });
  assert.deepEqual(result.comparison, []); assert.deepEqual(result.missingProductNames, []);
  assert.equal(result.nameResolution[0]!.status, "ambiguous"); assert.equal(result.requiresProductNames, true);
  assert.match(result.message!, /escolher/); assert.equal(validateStorefrontToolOutput("compare_products", result).ok, true);
});

test("comparison descriptions are bounded and truncation remains visible through the tool contract", async () => {
  const handlers = createProductHandlers({ productRepo: { ...namesRepository([essential]),
    findById: async () => ({ ...entity(essential), description: "a".repeat(5000) }),
  } } as never, { merchantId, sessionId: "comparison" });
  const result = await handlers.compareProducts({ productNames: ["Kit Organizador Essencial"], includeSimilar: false });
  const validated = validateStorefrontToolOutput("compare_products", result);
  assert.equal(validated.ok, true); if (!validated.ok) assert.fail("typed public comparison required");
  const projected = validated.data as typeof result;
  assert.equal(projected.comparison[0]!.description!.length, 4000); assert.equal(projected.comparison[0]!.descriptionTruncated, true);
});

for (const invalid of [{ merchantId: "foreign", isActive: true }, { merchantId, isActive: false },
  { merchantId, isActive: true, id: "different-product" },
  { merchantId, isActive: true, name: "Produto renomeado durante a consulta" }]) {
  test(`name resolution revalidates the selected product: ${JSON.stringify(invalid)}`, async () => {
    const handlers = createProductHandlers({ productRepo: { ...namesRepository([essential]), findById: async (scope: string) => {
      assert.equal(scope, merchantId); return { ...entity(essential), ...invalid };
    } } } as never, { merchantId, sessionId: "comparison" });
    const result = await handlers.compareProducts({ productNames: ["Kit Organizador Essencial"], includeSimilar: false });
    assert.deepEqual(result.comparison, []); assert.deepEqual(result.missingProductNames, []);
    assert.equal(result.nameResolution[0]!.status, "limited"); assert.match(result.message!, /incompleta/);
  });
}

test("product id comparisons never scan names and do not expose an inactive or foreign product", async () => {
  const handlers = createProductHandlers({ productRepo: { listPublicNames: async () => assert.fail("id lookup must not scan the catalog"),
    findById: async (scope: string, id: string) => { assert.equal(scope, merchantId); return id === "essential" ? entity(essential) : { ...entity(complete), merchantId: "foreign" }; },
  } } as never, { merchantId, sessionId: "comparison" });
  const result = await handlers.compareProducts({ productIds: ["essential", "foreign"], includeSimilar: false });
  assert.deepEqual(result.comparison.map(item => item.id), ["essential"]);
});
