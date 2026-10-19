import test from "node:test";
import assert from "node:assert/strict";
import { buildStoreSystemPrompt } from "./store-system-prompt.builder.js";

test("consultative selling distinguishes discovery, navigation and informed recommendation", () => {
  const prompt = buildStoreSystemPrompt({ merchantName: "Loja QA", agentIdentity: { tone: "acolhedor", language: "pt-BR" } });
  assert.match(prompt, /vendedor consultivo profissional, acolhedor/);
  assert.match(prompt, /Intenção vaga/);
  assert.match(prompt, /UMA pergunta/);
  assert.match(prompt, /não repita apresentação nem perguntas já respondidas/);
  assert.match(prompt, /preservando orçamento e restrições/);
  assert.match(prompt, /search_products com limit=3/);
  assert.match(prompt, /se já há informação suficiente, pesquise e recomende imediatamente/);
  assert.match(prompt, /2 a 4 frases curtas/);
  assert.doesNotMatch(prompt, /máx 20 palavras|responda APENAS a pergunta específica/);
  assert.match(prompt, /Não conceda desconto por conta própria/);
  assert.match(prompt, /Nunca invente escassez, pressione ou prometa resultado de saúde/);
});

test("the configured segment informs identity but cannot contradict the authorized catalog", () => {
  const prompt = buildStoreSystemPrompt({ storeCategory: "electronics" });
  assert.match(prompt, /Segmento cadastrado da loja: "electronics"/);
  assert.match(prompt, /produtos retornados pelas ferramentas prevalecem/);
  assert.doesNotMatch(prompt, /Todos os produtos são exclusivamente|NUNCA sugira ou mencione produtos fora/);
  assert.match(prompt, /NUNCA invente produtos, preços ou estoque/);
});

test("sales guidance preserves configured identity, commercial gates and quick-purchase preferences", () => {
  const prompt = buildStoreSystemPrompt({ agentIdentity: { agentName: "Consultora QA", persona: "atenciosa", language: "es" },
    merchantPolicy: { maxDiscountPercent: 5, allowFreeShipping: false },
    oneBuyClick: { enabled: true, shippingPreference: "cheapest", paymentPreference: "pix" } });
  assert.match(prompt, /Consultora QA/);
  assert.match(prompt, /Idioma obrigatório: es/);
  assert.match(prompt, /Desconto máximo permitido: 5%/);
  assert.match(prompt, /Frete grátis NÃO permitido/);
  assert.match(prompt, /ONEBUYCLICK ATIVO/);
  assert.match(prompt, /mais economico/);
  assert.match(prompt, /Pagamento preferido: Pix/);
  assert.match(prompt, /Nunca escolha a primeira variante/);
  assert.match(prompt, /Nunca confirme pagamento, desconto ou frete sem o resultado deterministico da API/);
});
