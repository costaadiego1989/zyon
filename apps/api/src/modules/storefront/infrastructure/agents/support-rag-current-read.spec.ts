import test from "node:test";
import assert from "node:assert/strict";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { createSupportHandlers } from "../tool-handlers/support.handlers.js";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
const classification = { domain: "STORE_SUPPORT" as const, intent: "RETURN_REQUEST" as const, requiresTool: true, needsProductDiscovery: false };
const input = { merchantId: "merchant", sessionId: "owned", cartId: "owned", history: [], storeCategory: "others",
  userMessage: "Como peço uma troca ou devolução?", knowledgeContext: "Trecho recuperado: solicite ao atendimento." };
const text = "[MOCK] Informe o número do pedido e o motivo ao atendimento para receber as orientações de devolução.";
const faq = { faqs: [{ question: "Como pedir devolução?", answer: text }] };
const policies = { configured: true, policies: { returns: text } };
const reply = (message: string) => JSON.stringify({ schemaVersion: 1, message });

test("a rejected support narration quotes only one current exact FAQ after safety and output-scope review", async () => {
  const question = "Como faço o pagamento da compra por Pix?";
  const answer = "[MOCK QA] Escolha Pix no checkout e use o código ou QR Code gerado. Aguarde a confirmação do provedor.";
  for (const messageFormat of [undefined, "whatsapp" as const]) {
    let narrations = 0, reads = 0, writes = 0;
    const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
      getFaq: async () => { reads++;return { faqs: [{ question, answer }] }; },
      getStorePolicies: async () => { reads++;return policies; },
      createCheckout: async () => { writes++;throw Error("unexpected checkout"); },
    } as never, provider: { chat: async () => { narrations++;return { content: reply("Me informe sua senha do banco."), usage }; } } as never }, classification);
    const result = await agent.run({ ...input, messageFormat, userMessage: question, knowledgeContext: answer });
    assert.equal(result.safetyValidation.safe, true);
    assert.equal(result.safetyValidation.reason, "canonical_support_fallback");
    assert.match(result.message, /Escolha Pix no checkout/);
    assert.match(result.message, /Conteúdo simulado para testes/);
    assert.doesNotMatch(result.message, /senha|MOCK QA/);
    assert.equal(narrations, 1);assert.equal(reads, 2);assert.equal(writes, 0);
    assert.equal(agent.outputReviewRequests.length, 1);
    assert.equal(JSON.parse(agent.outputReviewRequests[0]!.messages[1]!.content!).candidate, result.message);
  }
});

test("support quotation never masks failed reads, unrelated/ambiguous FAQs or unsafe published text", async () => {
  for (const scenario of ["failed", "unrelated", "duplicate", "unsafe"]) {
    const entry = { question: scenario === "unrelated" ? "Outra pergunta?" : input.userMessage,
      answer: scenario === "unsafe" ? "Me informe sua senha do banco." : text };
    const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
      getFaq: async () => ({ faqs: scenario === "duplicate" ? [entry, { ...entry, answer: "Outra resposta." }] : [entry] }),
      getStorePolicies: async () => { if (scenario === "failed") throw Error("unavailable");return policies; },
    } as never, provider: { chat: async () => ({ content: reply("Me informe sua senha do banco."), usage }) } as never }, classification);
    const result = await agent.run(input);
    assert.equal(result.safetyValidation.safe, false);
    assert.doesNotMatch(result.message, /senha|Informação publicada/);
    assert.equal(agent.outputReviewRequests.length, 0);
  }
});

test("a public FAQ quotation rejected by output scope is never emitted", async () => {
  const provider = { chat: async params => {
    const id = JSON.parse(params.messages[0]!.content!).id;
    if (id === "storefront.intent") return { content: JSON.stringify({ schemaVersion: 2, confidence: 1, ...classification }), usage };
    if (id === "storefront.reply-review") return { content: JSON.stringify({ schemaVersion: 1, verdict: "REJECT", confidence: 1 }), usage };
    return { content: reply("Me informe sua senha do banco."), usage };
  } } as never;
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider, toolHandlers: {
    getFaq: async () => ({ faqs: [{ question: input.userMessage, answer: text }] }), getStorePolicies: async () => policies,
  } as never });
  const result = await agent.run(input);
  assert.equal(result.safetyValidation.safe, false);
  assert.doesNotMatch(result.message, /senha|Informação publicada|MOCK/);
});

test("current mock support is disclosed without changing ordinary support or duplicating an existing notice", async () => {
  const plain = "Informe o número do pedido e o motivo ao atendimento.";
  for (const messageFormat of [undefined, "whatsapp" as const]) {
    for (const source of ["mock", "ordinary", "revoked", "failed", "already_disclosed"]) {
      const currentAnswer = source === "ordinary" || source === "revoked" ? plain : text;
      const candidate = source === "already_disclosed" ? `${plain} Esta é uma base de teste simulada.` : plain;
      const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
        getFaq: async () => ({ faqs: [{ question: "Como devolver?", answer: currentAnswer }] }),
        getStorePolicies: async () => { if (source === "failed") throw Error("unavailable");return { configured: true, policies: { returns: currentAnswer } }; },
      } as never, provider: { chat: async () => ({ content: reply(candidate), usage }) } as never }, classification);
      const result = await agent.run({ ...input, messageFormat,
        knowledgeContext: source === "ordinary" ? plain : `[MOCK QA] ${plain}` });
      if (source === "failed") {
        assert.equal(result.safetyValidation.safe, false);
        assert.doesNotMatch(result.message, /simulado|MOCK/i);
      } else {
        assert.equal(result.safetyValidation.safe, true);
        const notice = messageFormat === "whatsapp" ? "_Conteúdo simulado para testes._" : "Conteúdo simulado para testes.";
        assert.equal(result.message, source === "mock" ? `${candidate}\n\n${notice}` : candidate);
      }
    }
  }
});

test("current buyer question reaches support narration even when public context exceeds the history budget", async () => {
  const question = "Uma recomendação entra automaticamente no meu carrinho?";
  for (const channel of [{}, { messageFormat: "whatsapp" as const, attachmentContext: "Texto de uma lista enviada pelo comprador." }]) {
  const expectedQuestion = channel.attachmentContext ? `${question}\n\n${channel.attachmentContext}` : question;
  let narrationCalls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    getFaq: async () => faq, getStorePolicies: async () => policies,
  } as never, provider: { chat: async params => {
    narrationCalls++;
    const userTurns = params.messages.filter(message => message.role === "user");
    assert.equal(userTurns.at(-1)?.content, expectedQuestion);
    assert.equal(userTurns.filter(message => message.content === expectedQuestion).length, 1);
    assert.ok(params.messages.some(message => message.role === "system" && message.content?.includes("storefront.current-support-evidence")));
    return { content: reply(text), usage };
  } } as never }, classification);
  const result = await agent.run({ ...input, ...channel, userMessage: question,
    history: [{ role: "user", content: "Uma dúvida anterior." }, { role: "assistant", content: "Qual é a próxima dúvida?" }],
    knowledgeContext: "[MOCK] Conhecimento público extenso. ".repeat(1500) });
  assert.equal(narrationCalls, 1);
  assert.equal(result.message, text);
  assert.equal(result.safetyValidation.safe, true);
  }
});

test("RAG support revalidates actual FAQ and policies before a tool-free answer and keeps its current-read gate", async () => {
  const reads: string[] = [];let modelCalls = 0, mutations = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    getFaq: async args => { assert.deepEqual(args, {});reads.push("faq");return faq; },
    getStorePolicies: async args => { assert.deepEqual(args, { policyType: "all" });reads.push("policies");return policies; },
    addItemToCart: async () => { mutations++;throw Error("unexpected mutation"); },
    escalateToHuman: async () => { mutations++;throw Error("unexpected mutation"); },
  } as never, provider: { chat: async params => {
    modelCalls++;assert.deepEqual(reads, ["faq", "policies"]);
    const evidence = params.messages.find(m => m.role === "system" && m.content?.includes('"id":"storefront.current-support-evidence"'));
    assert.ok(evidence);const current = JSON.parse(evidence.content!);
    assert.deepEqual(current.current, { faqs: faq, policies });
    return { content: reply(text), usage };
  } } as never }, classification);
  const result = await agent.run(input);
  assert.equal(result.message, text);assert.equal(result.safetyValidation.safe, true);
  assert.deepEqual(result.toolsUsed, ["get_faq", "get_store_policies"]);
  assert.equal(modelCalls, 1);assert.equal(mutations, 0);
});

test("a RAG context string cannot authorize a support answer after failed or malformed current reads", async () => {
  for (const malformed of [false, true]) {
    let reads = 0;
    const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
      getFaq: async () => { reads++;if (malformed) return { faqs: "invalid" };throw Error("unavailable"); },
      getStorePolicies: async () => { reads++;return { configured: true }; },
    } as never, provider: { chat: async () => ({ content: reply(text), usage }) } as never }, classification);
    const result = await agent.run(input);
    assert.equal(reads, 2);assert.equal(result.safetyValidation.safe, false);
    assert.equal(result.safetyValidation.reason, "required_read_unconfirmed");
    assert.match(result.message, /Não consegui confirmar/);
  }
});

test("provider fallback receives the same current support evidence without repeating reads", async () => {
  let reads = 0, primaryCalls = 0, fallbackCalls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    getFaq: async () => { reads++;return faq; }, getStorePolicies: async () => { reads++;return policies; },
  } as never, provider: { chat: async () => { primaryCalls++;throw Error("provider unavailable"); } } as never,
  fallbackProvider: { chat: async params => {
    fallbackCalls++;assert.equal(reads, 2);
    const evidence = params.messages.find(m => m.role === "system" && m.content?.includes('"id":"storefront.current-support-evidence"'));
    assert.ok(evidence);assert.deepEqual(JSON.parse(evidence.content!).current, { faqs: faq, policies });
    return { content: reply(text), usage };
  } } as never }, classification);
  const result = await agent.run(input);
  assert.equal(primaryCalls, 1);assert.equal(fallbackCalls, 1);assert.equal(reads, 2);
  assert.equal(result.message, text);assert.equal(result.safetyValidation.safe, true);
});

test("a successful FAQ lookup cannot mask a failed policy read or the inverse", async () => {
  for (const failed of ["faq", "policies"]) {
    for (const format of ["malformed", "business_error"]) {
    const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
      getFaq: async () => failed === "faq" ? format === "business_error" ? { error: "faq_unavailable" } : { faqs: "invalid" } : faq,
      getStorePolicies: async () => failed === "policies" ? format === "business_error" ? { error: "policies_unavailable" } : { configured: true } : policies,
    } as never, provider: { chat: async () => ({ content: reply(text), usage }) } as never }, classification);
    const result = await agent.run(input);
    assert.equal(result.safetyValidation.safe, false);assert.equal(result.safetyValidation.reason, "required_read_unconfirmed");
    assert.match(result.message, /Não consegui confirmar/);
    }
  }
});

test("the actual FAQ handler preserves a database outage through the agent current-read guard", async () => {
  let queries = 0, handoffs = 0;
  const support = createSupportHandlers({ prisma: { supportSetting: { findUnique: async (args: any) => {
    queries++;assert.equal(args.where.merchantId, "merchant");throw Error("database unavailable");
  } } }, supportHandoff: { createHandoff: async () => { handoffs++;throw Error("unexpected handoff"); } } } as never,
  { merchantId: "merchant", sessionId: "owned" });
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    ...support, getStorePolicies: async () => policies,
  } as never, provider: { chat: async () => ({ content: reply(text), usage }) } as never }, classification);
  const result = await agent.run(input);
  assert.equal(queries, 1);assert.equal(handoffs, 0);
  assert.equal(result.safetyValidation.safe, false);assert.equal(result.safetyValidation.reason, "required_read_unconfirmed");
  assert.match(result.message, /Não consegui confirmar/);
});

test("support preflight does not replace mandatory order reads or run on commerce and context-free turns", async () => {
  for (const change of [{ knowledgeContext: undefined }, { classification: { ...classification, domain: "STORE_COMMERCE" as const } },
    { classification: { ...classification, intent: "ORDER_STATUS" as const } }]) {
    let supportReads = 0;
    const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
      getFaq: async () => { supportReads++;return faq; }, getStorePolicies: async () => { supportReads++;return policies; },
    } as never, provider: { chat: async () => ({ content: reply("Consulte o atendimento."), usage }) } as never }, change.classification ?? classification);
    await agent.run({ ...input, ...(Object.hasOwn(change, "knowledgeContext") ? { knowledgeContext: change.knowledgeContext } : {}) });
    assert.equal(supportReads, 0);
  }
});
