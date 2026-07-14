import test from "node:test";
import assert from "node:assert/strict";
import { ConfigRegenerationHandler } from "../config-regeneration-handler.js";
import type { ConfigDocumentBuilderPort } from "../config-regeneration-handler.js";
import type { ConfigSources } from "../config-embedding-repository.js";
import type { MerchantConfigDocument } from "../config-document-builder.js";

interface RecordedCall {
  merchantId: string;
  timestamp: number;
}

interface MockBuilder extends ConfigDocumentBuilderPort {
  calls: RecordedCall[];
}

function createMockBuilder(): MockBuilder {
  const calls: RecordedCall[] = [];
  return {
    calls,
    build: async (sources: ConfigSources): Promise<MerchantConfigDocument> => {
      calls.push({ merchantId: sources.merchantId, timestamp: Date.now() });
      return {
        merchantId: sources.merchantId,
        documentText: "mock document",
        version: 1,
        generatedAt: new Date(),
        sections: {
          identity: "",
          appearance: "",
          behavior: "",
          negotiation: "",
          faq: "",
          guardrails: "",
          badges: ""
        }
      };
    }
  };
}

function createMockEmbeddingService() {
  return {
    embed: async (_text: string) => ({
      vector: Array.from({ length: 1536 }, () => 0),
      model: "openai/text-embedding-3-small" as const,
      tokensUsed: 10
    })
  };
}

function createMockRepo() {
  const records: Map<string, any> = new Map();
  return {
    records,
    upsert: async (record: any) => { records.set(record.merchantId, record); },
    getByMerchantId: async (id: string) => records.get(id) ?? null,
    searchSimilar: async () => []
  };
}

function sampleSources(merchantId = "m1"): ConfigSources {
  return {
    merchantId,
    storeName: "Loja",
    storeUrl: "https://loja.com",
    provider: "shopify",
    theme: { accentColor: "#000", textColor: "#FFF", backgroundColor: "#FFF", fontFamily: "Inter", density: "compact" },
    settings: { mode: "silent_until_trigger", openWidgetOnTrigger: false, cooldownSeconds: 30, maxInterventionsPerSession: 2 },
    rules: { maxDiscountPercent: 10, minimumMarginPercent: 38, brandVoice: "consultative" },
    policy: { enabled: true, minOfferDiscountPercent: 5, maxDiscountPercent: 10, maxRounds: 3, maxAiCostCents: 50 },
    faq: [],
    customGuardrails: []
  };
}

// ─── Event triggers ──────────────────────────────────────────────────────────

test("ConfigRegenerationHandler triggers on checkout_settings.updated", async () => {
  const mockBuilder = createMockBuilder();
  const handler = new ConfigRegenerationHandler({
    builder: mockBuilder,
    embeddingService: createMockEmbeddingService(),
    repository: createMockRepo(),
    debounceMs: 0
  });

  await handler.handle("checkout_settings.updated", sampleSources());
  assert.equal(mockBuilder.calls.length, 1);
});

test("ConfigRegenerationHandler triggers on merchant_theme.updated", async () => {
  const mockBuilder = createMockBuilder();
  const handler = new ConfigRegenerationHandler({
    builder: mockBuilder,
    embeddingService: createMockEmbeddingService(),
    repository: createMockRepo(),
    debounceMs: 0
  });

  await handler.handle("merchant_theme.updated", sampleSources());
  assert.equal(mockBuilder.calls.length, 1);
});

test("ConfigRegenerationHandler triggers on agent_rules.updated", async () => {
  const mockBuilder = createMockBuilder();
  const handler = new ConfigRegenerationHandler({
    builder: mockBuilder,
    embeddingService: createMockEmbeddingService(),
    repository: createMockRepo(),
    debounceMs: 0
  });

  await handler.handle("agent_rules.updated", sampleSources());
  assert.equal(mockBuilder.calls.length, 1);
});

// ─── Debounce ────────────────────────────────────────────────────────────────

test("ConfigRegenerationHandler debounces: max 1 per 30s per merchant", async () => {
  const mockBuilder = createMockBuilder();
  const handler = new ConfigRegenerationHandler({
    builder: mockBuilder,
    embeddingService: createMockEmbeddingService(),
    repository: createMockRepo(),
    debounceMs: 30_000
  });

  await handler.handle("checkout_settings.updated", sampleSources("m1"));
  await handler.handle("merchant_theme.updated", sampleSources("m1"));
  await handler.handle("agent_rules.updated", sampleSources("m1"));

  // Only 1 call should go through within the debounce window.
  assert.equal(mockBuilder.calls.length, 1);
});

test("ConfigRegenerationHandler debounces per merchant independently", async () => {
  const mockBuilder = createMockBuilder();
  const handler = new ConfigRegenerationHandler({
    builder: mockBuilder,
    embeddingService: createMockEmbeddingService(),
    repository: createMockRepo(),
    debounceMs: 30_000
  });

  await handler.handle("checkout_settings.updated", sampleSources("m1"));
  await handler.handle("checkout_settings.updated", sampleSources("m2"));

  // Different merchants should both execute.
  assert.equal(mockBuilder.calls.length, 2);
});

// ─── Async (never blocks) ────────────────────────────────────────────────────

test("ConfigRegenerationHandler.handle returns void (never blocks caller with data)", async () => {
  const handler = new ConfigRegenerationHandler({
    builder: createMockBuilder(),
    embeddingService: createMockEmbeddingService(),
    repository: createMockRepo(),
    debounceMs: 0
  });

  const result = await handler.handle("checkout_settings.updated", sampleSources());
  assert.equal(result, undefined);
});

test("ConfigRegenerationHandler stores result in repository", async () => {
  const repo = createMockRepo();
  const handler = new ConfigRegenerationHandler({
    builder: createMockBuilder(),
    embeddingService: createMockEmbeddingService(),
    repository: repo,
    debounceMs: 0
  });

  await handler.handle("checkout_settings.updated", sampleSources("m1"));
  await handler.flush("m1"); // Wait for inflight rebuild to complete.
  const stored = await repo.getByMerchantId("m1");
  assert.ok(stored !== null);
  assert.equal(stored!.merchantId, "m1");
  assert.equal(stored!.embeddingVector.length, 1536);
});

test("ConfigRegenerationHandler stores document even if embedding fails (fallback)", async () => {
  const repo = createMockRepo();
  const handler = new ConfigRegenerationHandler({
    builder: createMockBuilder(),
    embeddingService: { embed: async () => null },
    repository: repo,
    debounceMs: 0
  });

  await handler.handle("checkout_settings.updated", sampleSources("m1"));
  await handler.flush("m1"); // Wait for inflight rebuild to complete.
  const stored = await repo.getByMerchantId("m1");
  assert.ok(stored !== null);
  assert.equal(stored!.merchantId, "m1");
  assert.deepEqual(stored!.embeddingVector, []);
});
