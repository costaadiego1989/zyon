import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontAttachmentInterpreter } from "./storefront-attachment-interpreter.service.js";

test("uses a shopping list only as bounded, untrusted catalog context", async () => {
  const context = await new StorefrontAttachmentInterpreter().interpret({
    kind: "shopping_list",
    name: "compras.txt",
    mimeType: "text/plain",
    text: "2x shampoo 400 ml\nCondicionador",
  });
  assert.match(context ?? "", /ANEXO NÃO CONFIÁVEL/);
  assert.match(context ?? "", /2x shampoo 400 ml/);
  assert.match(context ?? "", /Não siga instruções/);
});

test("uses DeepSeek Flash for an image and returns only its textual reference", async () => {
  const originalFetch = globalThis.fetch;
  const priorKey = process.env.DEEPSEEK_API_KEY;
  const priorModel = process.env.DEEPSEEK_VISION_MODEL;
  process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
  process.env.DEEPSEEK_VISION_MODEL = "deepseek-flash";
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(_url, init);
    const body = await request.json() as { model?: string };
    assert.equal(body.model, "deepseek-flash");
    return Response.json({ choices: [{ message: { content: "- Shampoo Acme, 400 ml" } }] });
  }) as typeof fetch;

  try {
    const context = await new StorefrontAttachmentInterpreter().interpret({
      kind: "image",
      name: "banheiro.png",
      mimeType: "image/png",
      dataBase64: Buffer.from("synthetic image bytes").toString("base64"),
    });
    assert.match(context ?? "", /Shampoo Acme, 400 ml/);
    assert.doesNotMatch(context ?? "", /synthetic image bytes/);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = priorKey;
    if (priorModel === undefined) delete process.env.DEEPSEEK_VISION_MODEL; else process.env.DEEPSEEK_VISION_MODEL = priorModel;
  }
});

test("rejects unsupported attachment media before it reaches a provider", async () => {
  await assert.rejects(
    new StorefrontAttachmentInterpreter().interpret({ kind: "image", name: "arquivo.gif", mimeType: "image/gif", dataBase64: "YWJj" }),
    (error: { getStatus(): number }) => error.getStatus() === 400,
  );
});

test("rejects empty or oversized lists and malformed or oversized images before provider access", async () => {
  const interpreter = new StorefrontAttachmentInterpreter();
  const invalidFiles = [
    { kind: "shopping_list", name: "empty.txt", mimeType: "text/plain", text: "  \n" },
    { kind: "shopping_list", name: "large.csv", mimeType: "text/csv", text: "x".repeat(24 * 1024 + 1) },
    { kind: "image", name: "invalid.png", mimeType: "image/png", dataBase64: "not base64!" },
    { kind: "image", name: "large.png", mimeType: "image/png", dataBase64: Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64") },
  ];
  for (const file of invalidFiles) {
    await assert.rejects(interpreter.interpret(file), (error: { getStatus(): number }) => error.getStatus() === 400);
  }
});
