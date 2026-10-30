import test from "node:test";
import assert from "node:assert/strict";
import { planStorefrontShopping, shoppingPlannerOutputSchema } from "./structured-shopping-planner.js";

const usage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
export const wirePlan = (extra: Record<string, unknown> = {}) => ({ schemaVersion: 1, plan: { version: 1, query: "*",
  minPriceCents: null, maxPriceCents: null, minRating: null, attributes: [], sortBy: null, delivery: null,
  unsupportedCriteria: [], ...extra } });

test("planning freezes typed buyer requirements separately from narration and preserves corrections in context", async () => {
  const history = [{ role: "user" as const, content: "Meu teto é R$ 70." },
    { role: "assistant" as const, content: "O completo custa R$ 100 antes da oferta." }];
  let calls = 0;
  const result = await planStorefrontShopping({ chat: async request => {
    calls++;
    assert.equal(request.tools, undefined);
    assert.equal(request.temperature, 0);
    assert.equal(JSON.parse(request.messages[0]!.content!).id, "storefront.shopping-plan");
    const input = JSON.parse(request.messages[1]!.content!);
    assert.deepEqual(input.history, history);
    assert.match(input.userMessage, /95/);
    return { content: JSON.stringify(wirePlan({ query: "organizador", maxPriceCents: 9500 })), usage };
  } } as never, { userMessage: "Corrigindo meu limite: até R$ 95. Não adicione nada.", history }, { mode: "json_object", model: "qa" });
  assert.equal(calls, 1);
  assert.equal(result.plan?.maxPriceCents, 9500);
  assert.equal(result.plan?.minPriceCents, undefined);
  assert.equal(result.plan?.query, "organizador");
  assert.deepEqual(result.usage, usage);
});

test("all nullable requirement decisions are mandatory in the planner contract", () => {
  const value = wirePlan({ maxPriceCents: 7000 });
  assert.equal(shoppingPlannerOutputSchema.safeParse(value).success, true);
  const { maxPriceCents: _omitted, ...missing } = value.plan;
  assert.equal(shoppingPlannerOutputSchema.safeParse({ ...value, plan: missing }).success, false);
});

test("discountOnly has a supported, advertised nullable decision and old wires retain no discount filter", async () => {
  assert.equal(shoppingPlannerOutputSchema.parse(wirePlan()).plan.discountOnly, null);
  for (const value of [true, null]) {
    const result = await planStorefrontShopping({ chat: async request => {
      const contract = JSON.parse(request.messages[0]!.content!).outputContract.properties.plan;
      assert.ok(contract.required.includes("discountOnly"));
      return { content: JSON.stringify(wirePlan({ discountOnly: value })), usage };
    } } as never, { userMessage: "Quais produtos estão com desconto?", history: [] }, { mode: "json_object" });
    assert.equal(result.plan?.discountOnly, value === null ? undefined : value);
  }
  for (const invalid of [false, "true", "false"]) assert.equal(shoppingPlannerOutputSchema.safeParse(wirePlan({ discountOnly: invalid })).success, false);
});

test("replayed inverse false from the provider is an unconfirmed plan, never an unfiltered catalog read", async () => {
  const result = await planStorefrontShopping({ chat: async () => ({ content: JSON.stringify(wirePlan({ discountOnly: false })), usage }) } as never,
    { userMessage: "Mostre somente produtos que não estão com desconto.", history: [] }, { mode: "json_object" });
  assert.equal(result.plan, undefined);
});

test("optional recovery is a read proposal with a closed contract and preserves all original hard criteria", async () => {
  const recovery = { familyQuery: "kit organizador", optionalQueryTerms: ["Viajante"] };
  const wire = wirePlan({ query: "kit organizador Viajante", maxPriceCents: 7000, recovery,
    attributes: [{ name: "cor", value: "azul", operator: "equals", priority: "required" }] });
  assert.equal(shoppingPlannerOutputSchema.safeParse(wire).success, true);
  for (const extra of [{ merchantId: "foreign" }, { cypher: "MATCH(n)" }, { authorizeCart: true }])
    assert.equal(shoppingPlannerOutputSchema.safeParse({ ...wire, plan: { ...wire.plan, recovery: { ...recovery, ...extra } } }).success, false);
  const result = await planStorefrontShopping({ chat: async () => ({ content: JSON.stringify(wire), usage }) } as never,
    { userMessage: "Kit Viajante até70 azul obrigatório", history: [] }, { mode: "json_object" });
  assert.deepEqual(result.plan?.recovery, recovery); assert.equal(result.plan?.maxPriceCents, 7000);
  assert.equal(result.plan?.attributes[0]!.priority, "required");
});

for (const [name, response] of [
  ["whitespace", { content: " ".repeat(56), usage }],
  ["fenced JSON", { content: "```json\n" + JSON.stringify(wirePlan()) + "\n```", usage }],
  ["tool call", { content: JSON.stringify(wirePlan()), toolCalls: [{ id: "write", name: "add_item_to_cart", args: {} }], usage }],
  ["partial", { content: JSON.stringify(wirePlan()), finishReason: "length", usage }],
  ["inverted interval", { content: JSON.stringify(wirePlan({ minPriceCents: 8000, maxPriceCents: 7000 })), usage }],
  ["foreign authority", { content: JSON.stringify(wirePlan({ merchantId: "other" })), usage }],
  ["untyped attributes from real budget regression", { content: JSON.stringify(wirePlan({ maxPriceCents: 7000,
    attributes: ["pequeno", "poucos cabos", "mochila"] })), usage }],
] as const) test(`unconfirmed planning fails closed once: ${name}`, async () => {
  let calls = 0;
  const result = await planStorefrontShopping({ chat: async () => { calls++; return response; } } as never,
    { userMessage: "Uma opção até R$70", history: [] }, { mode: "json_object" });
  assert.equal(calls, 1); assert.equal(result.plan, undefined);
});

test("json_object exposes the complete attribute and delivery contract before extracting the real budget request", async () => {
  const attributes = [{ name: "tamanho", value: "pequeno", operator: "equals", priority: "preferred" }];
  let calls = 0;
  const result = await planStorefrontShopping({ chat: async request => {
    calls++;
    assert.equal(request.responseFormat?.type, "json_object");
    const prompt = JSON.parse(request.messages[0]!.content!);
    const plan = prompt.outputContract.properties.plan;
    assert.ok(plan.required.includes("recovery"));
    assert.equal(plan.additionalProperties, false);
    assert.deepEqual(plan.properties.attributes.items.required, ["name", "value", "operator", "priority"]);
    assert.deepEqual(plan.properties.attributes.items.properties.operator.enum, ["equals", "not_equals"]);
    assert.deepEqual(plan.properties.attributes.items.properties.priority.enum, ["required", "preferred"]);
    assert.equal(plan.properties.attributes.items.additionalProperties, false);
    const delivery = plan.properties.delivery.anyOf.find((value: { type?: string }) => value.type === "object");
    assert.deepEqual(Object.keys(delivery.properties), ["freeOnly", "maxPriceCents", "maxBusinessDays", "zipCode"]);
    assert.equal(delivery.additionalProperties, false);
    assert.ok(plan.required.includes("maxPriceCents"));
    return { content: JSON.stringify(wirePlan({ query: "organizador de cabos", maxPriceCents: 7000, attributes })), usage };
  } } as never, { userMessage: "Tenho orçamento máximo de R$ 70 para um organizador pequeno para poucos cabos na mochila. Consulte as condições vigentes e mostre somente opções dentro desse valor, sem adicionar nem cobrar.", history: [] }, { mode: "json_object" });
  assert.equal(calls, 1); assert.equal(result.plan?.maxPriceCents, 7000);
  assert.deepEqual(result.plan?.attributes, attributes);
});

test("strict schema mode advertises mandatory nullable fields and no executable authority", async () => {
  await planStorefrontShopping({ chat: async request => {
    assert.equal(request.responseFormat?.type, "json_schema");
    const schema = (request.responseFormat as any).json_schema.schema;
    assert.ok(schema.properties.plan.required.includes("maxPriceCents"));
    assert.equal(schema.properties.plan.additionalProperties, false);
    return { content: JSON.stringify(wirePlan()), usage };
  } } as never, { userMessage: "Mostre o catálogo", history: [] }, { mode: "json_schema" });
});
