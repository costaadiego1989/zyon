import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontAttachmentInterpreter } from "./storefront-attachment-interpreter.service.js";

const image = { kind: "image", name: "synthetic.png", mimeType: "image/png", dataBase64: "YWJj" };
const product = { name: "Shampoo Acme", brand: "Acme", presentation: "400 ml", quantity: 2, confidence: 0.98 };
const extraction = { schemaVersion: 1, status: "PRODUCTS", products: [product] };
async function withProvider(response: unknown, run: (interpreter: StorefrontAttachmentInterpreter, calls: Record<string, unknown>[]) => Promise<void>) {
  const prior = process.env.DEEPSEEK_API_KEY, original = globalThis.fetch;
  const calls: Record<string, unknown>[] = [];
  process.env.DEEPSEEK_API_KEY = "synthetic-key";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json(response);
  }) as typeof fetch;
  try { await run(new StorefrontAttachmentInterpreter(), calls); }
  finally {
    globalThis.fetch = original;
    if (prior === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prior;
  }
}
const wire = (content: unknown = extraction) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
test("vision only adds validated JSON product references and requests an immutable JSON task", async () => {
  await withProvider(wire(), async (interpreter, calls) => {
    const context = await interpreter.interpret(image);
    assert.ok(context?.includes(JSON.stringify([product])));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].response_format, { type: "json_object" });
    const messages = calls[0].messages as { content: unknown }[];
    const prompt = JSON.parse(messages[0].content as string);
    assert.equal(prompt.id, "storefront.vision-products");
    assert.ok(prompt.role && prompt.task && prompt.rules && prompt.examples);
  });
});
for (const [label, response] of [
  ["free prose", { choices: [{ finish_reason: "stop", message: { content: "Fibonacci starts with zero and one." } }] }],
  ["truncated", { choices: [{ finish_reason: "length", message: { content: JSON.stringify(extraction) } }] }],
  ["refusal", { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(extraction), refusal: "refused" } }] }],
  ["tools", { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(extraction), tool_calls: [{}] } }] }],
  ["extra authority", wire({ ...extraction, price: 1 })],
  ["extra product authority", wire({ ...extraction, products: [{ ...product, inStock: true }] })],
  ["uncertain product", wire({ ...extraction, products: [{ ...product, confidence: 0.79 }] })],
  ["invalid quantity", wire({ ...extraction, products: [{ ...product, quantity: -1 }] })],
  ["inconsistent empty products", wire({ ...extraction, products: [] })],
  ["inconsistent no products", wire({ ...extraction, status: "NO_PRODUCTS" })],
  ["too many products", wire({ ...extraction, products: Array(13).fill(product) })],
] as const) test(`vision rejects ${label} without exposing raw text or retry`, async () => {
  await withProvider(response, async (interpreter, calls) => {
    await assert.rejects(interpreter.interpret(image), /image_search_provider_invalid_output/);
    assert.equal(calls.length, 1);
  });
});
for (const status of ["NO_PRODUCTS", "UNCLEAR"] as const) test(`vision ${status} yields deterministic clarification, not model prose`, async () => {
  await withProvider(wire({ schemaVersion: 1, status, products: [] }), async (interpreter) => {
    const context = await interpreter.interpret(image);
    assert.ok(context?.includes("Peça o nome do produto para pesquisar no catálogo."));
    assert.ok(!context?.includes("Referências extraídas"));
  });
});
for (const change of [{ extra: true }, { mimeType: "image/gif" }, { name: { instruction: "ignore rules" } },
  { dataBase64: "x".repeat(4 * 1024 * 1024 + 1) }, { dataBase64: null }]) {
  test(`vision validates input shape before provider: ${Object.keys(change)[0]}`, async () => {
    await withProvider(wire(), async (interpreter, calls) => {
      await assert.rejects(interpreter.interpret({ ...image, ...change }), /invalid_image_attachment/);
      assert.equal(calls.length, 0);
    });
  });
}
