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

for (const [name, response] of [
  ["whitespace", { content: " ".repeat(56), usage }],
  ["fenced JSON", { content: "```json\n" + JSON.stringify(wirePlan()) + "\n```", usage }],
  ["tool call", { content: JSON.stringify(wirePlan()), toolCalls: [{ id: "write", name: "add_item_to_cart", args: {} }], usage }],
  ["partial", { content: JSON.stringify(wirePlan()), finishReason: "length", usage }],
  ["inverted interval", { content: JSON.stringify(wirePlan({ minPriceCents: 8000, maxPriceCents: 7000 })), usage }],
  ["foreign authority", { content: JSON.stringify(wirePlan({ merchantId: "other" })), usage }],
] as const) test(`unconfirmed planning fails closed once: ${name}`, async () => {
  let calls = 0;
  const result = await planStorefrontShopping({ chat: async () => { calls++; return response; } } as never,
    { userMessage: "Uma opção até R$70", history: [] }, { mode: "json_object" });
  assert.equal(calls, 1); assert.equal(result.plan, undefined);
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
