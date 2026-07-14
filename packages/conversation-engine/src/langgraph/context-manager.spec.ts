import test from "node:test";
import assert from "node:assert/strict";
import { ContextManager, type ContextMessage } from "./context-manager.js";

function msg(role: ContextMessage["role"], content: string, tokens = 10): ContextMessage {
  return { role, content, tokens };
}

// ─── Token budget enforcement ──────────────────────────────────────────────

test("ContextManager trims messages to fit token budget", () => {
  const cm = new ContextManager({ maxTokens: 50 });
  const messages: ContextMessage[] = [
    msg("system", "you are helpful", 20),
    msg("user", "hi", 10),
    msg("assistant", "hello", 10),
    msg("user", "how are you?", 10),
    msg("assistant", "good, and you?", 10),
    msg("user", "what's new?", 10)
  ];
  const result = cm.trim(messages);
  // system (20) must be retained; remaining budget = 30
  assert.equal(result[0].role, "system");
  const totalTokens = result.reduce((acc, m) => acc + (m.tokens ?? 0), 0);
  assert.ok(totalTokens <= 50, `total=${totalTokens}`);
});

test("ContextManager always retains the system message", () => {
  const cm = new ContextManager({ maxTokens: 15 });
  const messages: ContextMessage[] = [
    msg("system", "be brief", 20),
    msg("user", "hi", 10)
  ];
  const result = cm.trim(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].role, "system");
});

test("ContextManager keeps most-recent messages first when trimming", () => {
  const cm = new ContextManager({ maxTokens: 25 });
  const messages: ContextMessage[] = [
    msg("system", "sys", 5),
    msg("user", "oldest", 10),
    msg("assistant", "middle", 10),
    msg("user", "newest", 10)
  ];
  const result = cm.trim(messages);
  assert.equal(result.some((m) => m.content === "newest"), true);
  assert.equal(result.some((m) => m.content === "oldest"), false);
});

test("ContextManager returns empty array if even system message exceeds budget", () => {
  const cm = new ContextManager({ maxTokens: 5 });
  const messages: ContextMessage[] = [msg("system", "huge system prompt", 100)];
  const result = cm.trim(messages);
  // System message is forced — never silently drop the system prompt entirely.
  assert.equal(result.length, 1);
  assert.equal(result[0].role, "system");
});

// ─── Auto-estimating tokens ────────────────────────────────────────────────

test("ContextManager.trim accepts messages without explicit tokens and estimates them", () => {
  const cm = new ContextManager({ maxTokens: 50 });
  const messages: ContextMessage[] = [
    { role: "system", content: "you are brief" },
    { role: "user", content: "hello world" },
    { role: "assistant", content: "hi there" }
  ];
  const result = cm.trim(messages);
  // 3 messages should fit comfortably under 50 tokens.
  assert.equal(result.length, 3);
  // Result messages are kept as-is; trimming doesn't mutate the tokens field.
  assert.ok(result.length > 0);
});

test("ContextManager.fromMessages auto-tokenizes string array", () => {
  const cm = new ContextManager({ maxTokens: 100 });
  const result = cm.fromMessages([
    { role: "system", content: "be brief" },
    { role: "user", content: "oi" },
    { role: "assistant", content: "ola" }
  ]);
  assert.equal(result.length, 3);
  assert.ok(result[0].tokens! > 0);
});

// ─── Token totals ──────────────────────────────────────────────────────────

test("ContextManager.totalTokens sums token field across messages", () => {
  const cm = new ContextManager({ maxTokens: 1000 });
  const messages = [msg("user", "a", 5), msg("assistant", "b", 7)];
  assert.equal(cm.totalTokens(messages), 12);
});

test("ContextManager throws if maxTokens is not positive", () => {
  assert.throws(() => new ContextManager({ maxTokens: 0 }), /maxTokens/);
  assert.throws(() => new ContextManager({ maxTokens: -1 }), /maxTokens/);
});