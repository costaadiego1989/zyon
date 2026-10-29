import test from "node:test";
import assert from "node:assert/strict";
import { ContextManager, DEFAULT_CONTEXT_WINDOW } from "../../langgraph/context-manager.js";
import type { ContextMessage } from "../../langgraph/context-manager.js";
import { injectConfigDocument } from "../context-injection.js";

// ─── System message injection ─────────────────────────────────────────────────

test("injectConfigDocument places merchant config as first system message", () => {
  const configDoc = "# Contexto do Merchant: Loja Test\n\n## Identidade\n- Nome: Sofia";
  const existingMessages: ContextMessage[] = [
    { role: "system", content: "Você é um assistente de checkout." },
    { role: "user", content: "Oi" }
  ];

  const result = injectConfigDocument(configDoc, existingMessages);

  // Config document must be the FIRST system message.
  assert.equal(result[0].role, "system");
  assert.ok(result[0].content.includes("Contexto do Merchant"));
  assert.ok(result[0].content.includes("Sofia"));
});

test("injectConfigDocument preserves original system prompt as second system message", () => {
  const configDoc = "# Contexto do Merchant: Loja Test";
  const existingMessages: ContextMessage[] = [
    { role: "system", content: "Você é um assistente de checkout." },
    { role: "user", content: "Oi" }
  ];

  const result = injectConfigDocument(configDoc, existingMessages);

  // Original system prompt must still be present.
  const systemMessages = result.filter((m) => m.role === "system");
  assert.equal(systemMessages.length, 2);
  assert.ok(systemMessages[1].content.includes("assistente de checkout"));
});

test("Config document is NEVER trimmed by context window", () => {
  // Create a huge config document that exceeds default context budget.
  const hugeDoc = "# Contexto\n" + "x".repeat(10_000);
  const existingMessages: ContextMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" }
  ];

  const injected = injectConfigDocument(hugeDoc, existingMessages);
  const cm = new ContextManager({ maxTokens: DEFAULT_CONTEXT_WINDOW });
  const trimmed = cm.trim(injected);

  // Config doc is a system message; system messages are ALWAYS retained per ContextManager spec.
  const systemMessages = trimmed.filter((m) => m.role === "system");
  const configMessage = systemMessages.find((m) => m.content.includes("Contexto"));
  assert.ok(configMessage, "Config document must survive trimming");
  assert.ok(configMessage!.content.length > 5000, "Config doc must not be truncated");
});

test("injectConfigDocument refreshes on session start (inserts provided doc)", () => {
  const doc1 = "# Contexto do Merchant: V1";
  const doc2 = "# Contexto do Merchant: V2";
  const msgs: ContextMessage[] = [{ role: "user", content: "Oi" }];

  const r1 = injectConfigDocument(doc1, msgs);
  const r2 = injectConfigDocument(doc2, msgs);

  // Each injection uses the latest document — proves refresh works.
  assert.ok(r1[0].content.includes("V1"));
  assert.ok(r2[0].content.includes("V2"));
  assert.ok(!r2[0].content.includes("V1"));
});

test("injectConfigDocument handles empty config doc gracefully (skips injection)", () => {
  const msgs: ContextMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" }
  ];

  const result = injectConfigDocument("", msgs);
  // With empty doc, messages remain unchanged.
  assert.deepEqual(result, msgs);
});

test("injectConfigDocument handles null/undefined config doc gracefully", () => {
  const msgs: ContextMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" }
  ];

  const result = injectConfigDocument(undefined as unknown as string, msgs);
  assert.deepEqual(result, msgs);
});
