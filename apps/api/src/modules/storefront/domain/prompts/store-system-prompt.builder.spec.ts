import test from "node:test";
import assert from "node:assert/strict";
import { buildStoreSystemPrompt } from "./store-system-prompt.builder.js";

function operatingGuide(input: Parameters<typeof buildStoreSystemPrompt>[0]): string {
  const prompt = JSON.parse(buildStoreSystemPrompt(input));
  assert.equal(prompt.id, "storefront.sales");
  assert.equal(prompt.version, 2);
  assert.equal(typeof prompt.operatingInstructions, "string");
  return prompt.operatingInstructions;
}

test("consultative selling distinguishes discovery, navigation and informed recommendation", () => {
  const prompt = operatingGuide({ merchantName: "Loja QA", agentIdentity: { tone: "acolhedor", language: "pt-BR" } });
  assert.match(prompt, /vendedor consultivo profissional, acolhedor/);
  assert.match(prompt, /Intenção vaga/);
  assert.match(prompt, /UMA pergunta/);
  assert.match(prompt, /não repita apresentação nem perguntas já respondidas/);
  assert.match(prompt, /preservando orçamento e restrições/);
  assert.match(prompt, /search_products com limit=3/);
  assert.match(prompt, /se já há informação suficiente, pesquise e recomende imediatamente/);
  assert.match(prompt, /2 a 4 frases curtas/);
  assert.match(prompt, /DESCUBERTA EM ATÉ 3 NÍVEIS/);
  assert.match(prompt, /ask_product_preferences/);
  assert.match(prompt, /sem uma quarta pergunta de perfil/);
  assert.match(prompt, /respostas curtas que respondam exatamente a ela/);
  assert.match(prompt, /Só amplie quando a busca precisa não encontrar/);
  assert.match(prompt, /Orçamento, alergias, negativas, material, tamanho/);
  assert.match(prompt, /objetivo NÃO é uma segunda pergunta obrigatória/);
  assert.match(prompt, /recommendationMatch.type='similar'/);
  assert.match(prompt, /plano Scale e venda entre lojistas habilitada/);
  assert.doesNotMatch(prompt, /máx 20 palavras|responda APENAS a pergunta específica/);
  assert.match(prompt, /Não conceda desconto por conta própria/);
  assert.match(prompt, /Nunca invente escassez, pressione ou prometa resultado de saúde/);
});

test("the configured segment informs identity but cannot contradict the authorized catalog", () => {
  const prompt = operatingGuide({ storeCategory: "electronics" });
  assert.match(prompt, /Segmento cadastrado da loja: "electronics"/);
  assert.match(prompt, /produtos retornados pelas ferramentas prevalecem/);
  assert.doesNotMatch(prompt, /Todos os produtos são exclusivamente|NUNCA sugira ou mencione produtos fora/);
  assert.match(prompt, /NUNCA invente produtos, preços ou estoque/);
});

test("sales guidance preserves configured identity, commercial gates and quick-purchase preferences", () => {
  const prompt = operatingGuide({ agentIdentity: { agentName: "Consultora QA", persona: "atenciosa", language: "es" },
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

test("the JSON template retains structured context, examples and the response contract", () => {
  const merchantName = 'Loja "QA"\nHomologação';
  const prompt = JSON.parse(buildStoreSystemPrompt({ merchantName, storeCategory: "electronics" }));
  assert.equal(prompt.context.merchantName, merchantName);
  assert.equal(prompt.context.storeCategory, "electronics");
  assert.equal(typeof prompt.role, "string");
  assert.equal(typeof prompt.task, "string");
  assert.ok(prompt.examples.length > 0);
  assert.equal(prompt.outputContract.type, "object");
  assert.deepEqual(prompt.outputContract.required, ["schemaVersion", "message"]);
  assert.equal(prompt.outputContract.additionalProperties, false);
});

test("store introduction and canonical weekly hours reach both storefront and WhatsApp prompts", () => {
  const settings = { company: { description: "Acessórios de informática em Teresópolis.", businessHours: "legacy incorrect hours" },
    businessHours: [{ day: "seg", startTime: "09:00", endTime: "18:00", closed: false },
      { day: "sab", startTime: "09:00", endTime: "13:00", closed: false },
      { day: "dom", startTime: "", endTime: "", closed: true }] };
  for (const messageFormat of [undefined, "whatsapp"] as const) {
    const prompt = operatingGuide({ storeSettings: settings, messageFormat });
    assert.match(prompt, /Apresentação publicada: Acessórios de informática em Teresópolis/);
    assert.match(prompt, /Segunda-feira: 09:00 às 18:00/);
    assert.match(prompt, /Sábado: 09:00 às 13:00/);
    assert.match(prompt, /Domingo: fechado/);
    assert.doesNotMatch(prompt, /legacy incorrect hours|\[object Object\]|Terça-feira: fechado/);
    assert.match(prompt, /assistente virtual não altera o horário/);
  }
});

test("hours work without company data and invalid or duplicated days cannot become public claims", () => {
  const prompt = operatingGuide({ storeSettings: { businessHours: [
    { day: "seg", closed: false, startTime: "25:00", endTime: "18:00" },
    { day: "ter", closed: false, startTime: "09:00", endTime: "18:00" },
    { day: "ter", closed: true },
    { day: "qua", closed: false, startTime: "09:00", endTime: "17:30" },
    { day: "invented day", closed: true },
    { day: "qui", closed: "false", startTime: "09:00", endTime: "18:00" },
  ] } });
  assert.match(prompt, /Quarta-feira: 09:00 às 17:30/);
  assert.doesNotMatch(prompt, /Segunda-feira:|Terça-feira:|Quinta-feira:|invented day|25:00/);
});

test("missing hours cannot invent a schedule and legacy text is used only without the canonical array", () => {
  assert.match(operatingGuide({}), /Horários de atendimento não informados/);
  assert.match(operatingGuide({ storeSettings: { company: { businessHours: "Segunda a sexta, 10h às 16h" } } }), /10h às 16h/);
  assert.doesNotMatch(operatingGuide({ storeSettings: { businessHours: [], company: { businessHours: "obsolete hours" } } }), /obsolete hours/);
});
