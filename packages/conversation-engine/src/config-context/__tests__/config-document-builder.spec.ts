import test from "node:test";
import assert from "node:assert/strict";
import { ConfigDocumentBuilder } from "../config-document-builder.js";
import type {
  ConfigSources,
  ConfigEmbeddingRepository
} from "../config-embedding-repository.js";
import type { MerchantConfigEmbeddingRecord } from "../config-embedding-repository.js";

class InMemoryConfigEmbeddingRepository implements ConfigEmbeddingRepository {
  private store = new Map<string, MerchantConfigEmbeddingRecord>();

  async upsert(record: MerchantConfigEmbeddingRecord): Promise<void> {
    this.store.set(record.merchantId, record);
  }
  async getByMerchantId(merchantId: string): Promise<MerchantConfigEmbeddingRecord | null> {
    return this.store.get(merchantId) ?? null;
  }
  async searchSimilar(): Promise<MerchantConfigEmbeddingRecord[]> {
    return [];
  }
}

function sampleSources(overrides: Partial<ConfigSources> = {}): ConfigSources {
  return {
    merchantId: "merchant-1",
    storeName: "Loja Exemplo",
    storeUrl: "https://lojaexemplo.com.br",
    provider: "shopify",
    theme: {
      accentColor: "#0F766E",
      secondaryColor: "#1E40AF",
      textColor: "#111827",
      backgroundColor: "#F7F8FA",
      fontFamily: "Inter, sans-serif",
      density: "comfortable",
      agentName: "Sofia",
      trustBadges: ["Site Seguro", "Entrega Garantida"]
    },
    settings: {
      mode: "proactive",
      openWidgetOnTrigger: true,
      cooldownSeconds: 60,
      maxInterventionsPerSession: 3
    },
    rules: {
      maxDiscountPercent: 10,
      minimumMarginPercent: 38,
      brandVoice: "consultative",
      blockedPhrases: [],
      requiredDisclaimers: []
    },
    policy: {
      enabled: true,
      minOfferDiscountPercent: 5,
      maxDiscountPercent: 10,
      maxRounds: 3,
      maxAiCostCents: 50
    },
    faq: [
      { id: "q1", question: "Vocês entregam em todo Brasil?", answer: "Sim, via Correios." }
    ],
    customGuardrails: ["Use sempre 'R$' antes de valores."],
    ...overrides
  };
}

test("ConfigDocumentBuilder.build returns a structured document with all sections", async () => {
  const repo = new InMemoryConfigEmbeddingRepository();
  const builder = new ConfigDocumentBuilder(repo);
  const doc = await builder.build(sampleSources());

  assert.equal(doc.merchantId, "merchant-1");
  assert.equal(typeof doc.documentText, "string");
  assert.ok(doc.documentText.length > 0, "documentText must not be empty");
  assert.ok(doc.version >= 1);
  assert.ok(doc.generatedAt instanceof Date);
  assert.equal(typeof doc.sections.identity, "string");
  assert.equal(typeof doc.sections.appearance, "string");
  assert.equal(typeof doc.sections.behavior, "string");
  assert.equal(typeof doc.sections.negotiation, "string");
  assert.equal(typeof doc.sections.faq, "string");
  assert.equal(typeof doc.sections.guardrails, "string");
  assert.equal(typeof doc.sections.badges, "string");
});

test("ConfigDocumentBuilder.identity section contains store name, agent name, platform", async () => {
  const builder = new ConfigDocumentBuilder(new InMemoryConfigEmbeddingRepository());
  const doc = await builder.build(sampleSources());

  assert.match(doc.sections.identity, /Loja Exemplo/);
  assert.match(doc.sections.identity, /Sofia/);
  assert.match(doc.sections.identity, /shopify/);
  assert.match(doc.sections.identity, /lojaexemplo\.com\.br/);
});

test("ConfigDocumentBuilder.appearance section contains colors and fonts", async () => {
  const builder = new ConfigDocumentBuilder(new InMemoryConfigEmbeddingRepository());
  const doc = await builder.build(sampleSources());

  assert.match(doc.sections.appearance, /#0F766E/);
  assert.match(doc.sections.appearance, /Inter/);
  assert.match(doc.sections.appearance, /comfortable/);
});

test("ConfigDocumentBuilder.behavior section contains mode, triggers, limits", async () => {
  const builder = new ConfigDocumentBuilder(new InMemoryConfigEmbeddingRepository());
  const doc = await builder.build(sampleSources());

  assert.match(doc.sections.behavior, /proactive/);
  assert.match(doc.sections.behavior, /60/);
  assert.match(doc.sections.behavior, /3/);
});

test("ConfigDocumentBuilder.negotiation section contains margins and max discount", async () => {
  const builder = new ConfigDocumentBuilder(new InMemoryConfigEmbeddingRepository());
  const doc = await builder.build(sampleSources());

  assert.match(doc.sections.negotiation, /10%/);
  assert.match(doc.sections.negotiation, /38/);
  assert.match(doc.sections.negotiation, /5%/);
});

test("ConfigDocumentBuilder.faq section contains all merchant Q&As formatted", async () => {
  const builder = new ConfigDocumentBuilder(new InMemoryConfigEmbeddingRepository());
  const doc = await builder.build(
    sampleSources({
      faq: [
        { id: "q1", question: "P1?", answer: "R1" },
        { id: "q2", question: "P2?", answer: "R2" }
      ]
    })
  );

  assert.match(doc.sections.faq, /P: P1\?/);
  assert.match(doc.sections.faq, /R: R1/);
  assert.match(doc.sections.faq, /P: P2\?/);
  assert.match(doc.sections.faq, /R: R2/);
});

test("ConfigDocumentBuilder.guardrails section is always included even with no custom rules", async () => {
  const builder = new ConfigDocumentBuilder(new InMemoryConfigEmbeddingRepository());
  const doc = await builder.build(sampleSources({ customGuardrails: [] }));

  // Hardcoded safety rules must always be present.
  assert.match(doc.sections.guardrails, /N[ÃA]O autorizar descontos/);
  assert.match(doc.sections.guardrails, /N[ÃA]O prometer frete gr/);
  assert.match(doc.sections.guardrails, /N[ÃA]O confirmar pagamento/);
  assert.match(doc.sections.guardrails, /CVV/);
  assert.match(doc.sections.guardrails, /estoque/);
  assert.match(doc.sections.guardrails, /prazo de entrega/);
});

test("ConfigDocumentBuilder.guardrails section appends custom merchant rules", async () => {
  const builder = new ConfigDocumentBuilder(new InMemoryConfigEmbeddingRepository());
  const doc = await builder.build(
    sampleSources({ customGuardrails: ["Sempre use 'R$' antes de valores.", "Nunca use markdown."] })
  );

  assert.match(doc.sections.guardrails, /R\$.*antes de valores/);
  assert.match(doc.sections.guardrails, /markdown/);
});

test("ConfigDocumentBuilder.badges section lists trust badges", async () => {
  const builder = new ConfigDocumentBuilder(new InMemoryConfigEmbeddingRepository());
  const doc = await builder.build(sampleSources());

  assert.match(doc.sections.badges, /Site Seguro/);
  assert.match(doc.sections.badges, /Entrega Garantida/);
});

test("ConfigDocumentBuilder.documentText is the concatenation of all sections", async () => {
  const builder = new ConfigDocumentBuilder(new InMemoryConfigEmbeddingRepository());
  const doc = await builder.build(sampleSources());

  // Each section content must appear in the full documentText.
  assert.ok(doc.documentText.includes(doc.sections.identity));
  assert.ok(doc.documentText.includes(doc.sections.appearance));
  assert.ok(doc.documentText.includes(doc.sections.behavior));
  assert.ok(doc.documentText.includes(doc.sections.negotiation));
  assert.ok(doc.documentText.includes(doc.sections.faq));
  assert.ok(doc.documentText.includes(doc.sections.guardrails));
  assert.ok(doc.documentText.includes(doc.sections.badges));
});

test("ConfigDocumentBuilder does NOT embed sensitive data (apiKey, password)", async () => {
  const builder = new ConfigDocumentBuilder(new InMemoryConfigEmbeddingRepository());
  const doc = await builder.build(
    sampleSources({
      theme: {
        accentColor: "#0F766E",
        secondaryColor: "#1E40AF",
        textColor: "#111827",
        backgroundColor: "#F7F8FA",
        fontFamily: "Inter",
        density: "comfortable",
        agentName: "Sofia",
        trustBadges: ["segredo: sk_live_4242424242424242"]
      }
    })
  );

  // Even if a merchant dumps an API key in trust badges, it is sanitized.
  assert.doesNotMatch(doc.documentText, /sk_live_[a-z0-9]{8,}/i);
});

test("ConfigDocumentBuilder handles empty FAQ gracefully", async () => {
  const builder = new ConfigDocumentBuilder(new InMemoryConfigEmbeddingRepository());
  const doc = await builder.build(sampleSources({ faq: [] }));

  // FAQ section must exist, even if empty.
  assert.ok(doc.sections.faq.length >= 0);
  assert.ok(doc.documentText.includes("## FAQ"));
});

test("ConfigDocumentBuilder handles missing optional fields gracefully", async () => {
  const builder = new ConfigDocumentBuilder(new InMemoryConfigEmbeddingRepository());
  const doc = await builder.build(
    sampleSources({
      theme: {
        accentColor: "#000000",
        textColor: "#FFFFFF",
        backgroundColor: "#FFFFFF",
        fontFamily: "Arial",
        density: "compact"
      },
      settings: { mode: "manual_only", openWidgetOnTrigger: false, cooldownSeconds: 0, maxInterventionsPerSession: 0 },
      rules: { maxDiscountPercent: 0, minimumMarginPercent: 0, brandVoice: "popular" },
      policy: { enabled: false, minOfferDiscountPercent: 0, maxDiscountPercent: 0, maxRounds: 0, maxAiCostCents: 0 },
      faq: [],
      customGuardrails: []
    })
  );

  assert.ok(doc.documentText.length > 0);
  assert.match(doc.sections.identity, /Loja Exemplo/);
});