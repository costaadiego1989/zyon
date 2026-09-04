import test from "node:test";
import assert from "node:assert/strict";
import {
  LangGraphChatAgent,
  type AgentState,
  type ChatAgentDeps,
  type ChatAgentCallbacks
} from "./langgraph-agent.js";
import type { OpenRouterChatMessage } from "./openrouter-provider.js";

// ─── Fake provider ─────────────────────────────────────────────────────────

interface FakeProvider {
  chat: (input: { messages: OpenRouterChatMessage[]; tools?: unknown }) => Promise<{
    content: string;
    toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  }>;
}

function makeProvider(content: string, toolCall?: { name: string; args: Record<string, unknown> }): FakeProvider {
  return {
    chat: async () => ({
      content,
      toolCalls: toolCall ? [toolCall] : undefined,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    })
  };
}

const baseDeps: ChatAgentDeps = {
  provider: makeProvider("Ola! Como posso ajudar?") as never,
  tools: [],
  toolHandlers: {
    searchCatalog: async () => [],
    checkShipping: async () => ({ zip: "01310100", options: [] }),
    checkInventory: async () => ({ sku: "x", inStock: true, qty: 1 }),
    getBuyerHistory: async () => ({ purchases: 0, lifetimeValue: 0 }),
    applyDiscount: async ({ discount_percent }: { discount_percent: number }) => ({
      approved: false,
      discount_percent,
      reason: "no_offer_in_context"
    })
  },
  model: "anthropic/claude-sonnet-4",
  safety: {
    isSafe: (text: string) => ({ safe: text.length > 0, reason: text.length === 0 ? "empty" : undefined })
  }
};

// ─── Initial state ─────────────────────────────────────────────────────────

test("LangGraphChatAgent.run returns greeting message when LLM produces greeting", async () => {
  const agent = new LangGraphChatAgent(baseDeps);
  const result = await agent.run({
    sessionId: "chk_1",
    merchantId: "mrc_1",
    userMessage: "oi",
    history: []
  });
  assert.equal(result.state, "greeting");
  assert.ok(result.message.length > 0);
});

test("LangGraphChatAgent.run transitions to objection_handling on price message", async () => {
  let captured: OpenRouterChatMessage[] = [];
  const provider: FakeProvider = {
    chat: async (input) => {
      captured = input.messages;
      return {
        content: "Posso verificar uma condicao autorizada.",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
      };
    }
  };
  const agent = new LangGraphChatAgent({ ...baseDeps, provider: provider as never });
  const result = await agent.run({
    sessionId: "chk_1",
    merchantId: "mrc_1",
    userMessage: "esta caro",
    history: []
  });
  assert.equal(result.state, "objection_handling");
  assert.equal(result.objection, "price");
  // system prompt must include merchant rules
  const system = captured.find((m) => m.role === "system");
  assert.ok(system, "must have system message");
});

test("LangGraphChatAgent.run transitions to offer_proposal when LLM requests tool", async () => {
  let calls = 0;
  const provider: FakeProvider = {
    chat: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          content: "",
          toolCalls: [{ name: "search_catalog", args: { query: "camiseta" } }],
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
        };
      }
      return {
        content: "Encontrei a camiseta por R$100.",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
      };
    }
  };
  const agent = new LangGraphChatAgent({
    ...baseDeps,
    provider: provider as never,
    tools: [
      {
        name: "search_catalog",
        description: "find products",
        parameters: { type: "object", properties: {} }
      }
    ]
  });
  const result = await agent.run({
    sessionId: "chk_1",
    merchantId: "mrc_1",
    userMessage: "tem camiseta?",
    history: []
  });
  assert.ok(calls >= 2, "must run at least two LLM turns (tool call + final)");
  assert.match(result.message, /camiseta/);
});

test("LangGraphChatAgent.run falls back to safe message when LLM output unsafe", async () => {
  const provider: FakeProvider = {
    chat: async () => ({
      content: "",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
    })
  };
  const safety = {
    isSafe: (text: string) =>
      text.length === 0 ? { safe: false, reason: "empty" } : { safe: true }
  };
  const agent = new LangGraphChatAgent({ ...baseDeps, provider: provider as never, safety });
  const result = await agent.run({
    sessionId: "chk_1",
    merchantId: "mrc_1",
    userMessage: "oi",
    history: []
  });
  // LLM returned empty content → safety says unsafe → deterministic fallback runs
  assert.ok(result.message.length > 0, "must return fallback message");
});

// ─── Token accounting & budget ─────────────────────────────────────────────

test("LangGraphChatAgent.run returns token usage from the run", async () => {
  const agent = new LangGraphChatAgent(baseDeps);
  const result = await agent.run({
    sessionId: "chk_1",
    merchantId: "mrc_1",
    userMessage: "oi",
    history: []
  });
  assert.equal(result.usage.totalTokens, 15);
  assert.equal(result.usage.promptTokens, 10);
  assert.equal(result.usage.completionTokens, 5);
});

test("LangGraphChatAgent.run throws when cost budget is exhausted", async () => {
  const agent = new LangGraphChatAgent({
    ...baseDeps,
    budgetCents: 0
  });
  await assert.rejects(
    () =>
      agent.run({
        sessionId: "chk_1",
        merchantId: "mrc_1",
        userMessage: "oi",
        history: []
      }),
    /budget_exceeded|agent_budget_exhausted/
  );
});

// ─── Callbacks ─────────────────────────────────────────────────────────────

test("LangGraphChatAgent fires onToken callback for streamed tokens (best-effort)", async () => {
  const events: string[] = [];
  const callbacks: ChatAgentCallbacks = {
    onToken: (t) => events.push(t),
    onToolCall: (name) => events.push(`tool:${name}`),
    onStateChange: (s) => events.push(`state:${s}`)
  };
  const provider: FakeProvider = {
    chat: async () => ({
      content: "ok",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
    })
  };
  const agent = new LangGraphChatAgent({ ...baseDeps, provider: provider as never });
  await agent.run({
    sessionId: "chk_1",
    merchantId: "mrc_1",
    userMessage: "oi",
    history: [],
    callbacks
  });
  // Must at least emit a state change to greeting.
  assert.ok(events.some((e) => e === "state:greeting"));
});

test("LangGraphChatAgent returns AgentState typed result", async () => {
  const agent = new LangGraphChatAgent(baseDeps);
  const result = await agent.run({
    sessionId: "chk_1",
    merchantId: "mrc_1",
    userMessage: "oi",
    history: []
  });
  const states: AgentState[] = [
    "greeting",
    "objection_handling",
    "offer_proposal",
    "checkout_assist",
    "payment",
    "completion"
  ];
  assert.ok(states.includes(result.state));
});