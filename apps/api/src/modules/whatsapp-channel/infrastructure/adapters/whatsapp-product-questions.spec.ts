import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutWhatsAppConversationAdapter } from "./checkout-whatsapp-conversation.adapter.js";
import { executeStorefrontUiAction } from "../../../storefront/infrastructure/agents/storefront-ui-action.executor.js";
import { buildConversationBlocks } from "../../../storefront/infrastructure/agents/conversation-block.builder.js";
import { buildMetaUiView } from "../../domain/ui/meta-ui-renderer.js";
import { conversationBlockSchema } from "../../../storefront/domain/contracts/conversation-block.schemas.js";

const productId = "qa-product", conversationId = "same-conversation";
const base: any = { version: 1, conversationId, stage: "store", history: [{ role: "user", content: "Catálogo" }],
  revision: "previous", page: 0, previousViews: [], selectedProductId: "essential", selectedVariantId: "old-variant", cartHasItems: true };
const buyer = { globalUserId: "canonical-buyer", phone: "5521999990000", fullName: "Comprador" };

test("public question blocks carry a canonical product, without manufacturing a buyer history", () => {
  const result = buildConversationBlocks({ merchantId: "merchant", userMessage: "Ver respondidas", finalContent: "",
    toolResults: { get_product_questions: { productId, productName: "QA físico", scope: "public_answered", filter: "answered",
      questions: [{ id: "faq", question: "Qual material?", answer: "Poliéster publicado." }], totalCount: 1 } } });
  const block = result.blocks.find(b => b.type === "product_questions");
  assert.ok(block); assert.equal(conversationBlockSchema.safeParse(block).success, true);
  assert.equal((block.data as any).scope, "public_answered");
  assert.equal(result.blocks.some(b => b.type === "question_submission"), false);
});

test("personal question blocks disclose only linked own intake and explicitly leave the answer unlinked", () => {
  const result = buildConversationBlocks({ merchantId: "merchant", userMessage: "Minhas Perguntas", finalContent: "",
    toolResults: { get_product_questions: { productId, productName: "QA físico", scope: "buyer_history", filter: "mine", historyLimited: true,
      returnedCount: 1, hasMore: false, questions: [{ id: "message", ticketId: "case", question: "Pergunta própria?", date: "2026-10-29T12:00:00Z", answerState: "not_linked" }] } } });
  assert.equal(result.blocks[0]?.type, "buyer_product_questions");
  assert.equal(conversationBlockSchema.safeParse(result.blocks[0]).success, true);
  assert.match(result.finalContent, /somente perguntas recentes/);
  const view = buildMetaUiView({ agentMessage: result.finalContent, blocks: result.blocks, quickReplies: [], state: base });
  assert.match(view.body, /Pergunta própria/); assert.match(view.body, /Resposta não vinculada/);
  assert.equal(view.body.includes("Perguntas públicas respondidas"), false);
});

test("native question intake retains the product ID across free text and creates one actual handoff", async () => {
  const calls: any[] = [], writes: any[] = [];
  const handlers: any = { getProductDetails: async ({ productId: requested }: any) => ({ product: { id: requested, name: "QA físico", price: 300, inStock: true } }),
    createQuestion: async (args: any) => { writes.push(args); return { id: "case", productId: args.productId, question: args.question,
      author: "Comprador", date: "2026-10-29", status: "awaiting_answer" }; } };
  const adapter = new CheckoutWhatsAppConversationAdapter({} as never, { getSession: async () => undefined } as never,
    { execute: async (input: any) => { calls.push(input); const result = await executeStorefrontUiAction(handlers, input.ui_action, "merchant", conversationId);
      return { ...result, suggested_next: [] }; } } as never, { executeForMerchant: async () => ({ name: "Athom" }) } as never);
  const prompt = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Fazer Pergunta", state: base,
    action: { kind: "tool", tool: "ask_product_question", args: { productId } } });
  assert.equal(prompt.state.pendingProductQuestion?.productId, productId);
  assert.equal(prompt.state.selectedProductId, productId);
  assert.equal(prompt.state.expectsFreeInput, true);
  assert.equal(writes.length, 0);
  const submitted = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Qual é a composição?", state: prompt.state });
  assert.equal(writes.length, 1); assert.equal(writes[0].productId, productId);
  assert.equal(writes[0].question, "Qual é a composição?");
  assert.equal(submitted.state.pendingProductQuestion, undefined); assert.equal(submitted.state.expectsFreeInput, false);
  assert.equal(submitted.state.conversationId, conversationId); assert.equal(submitted.state.cartHasItems, true);
  assert.equal(calls.length, 2);
  const view = buildMetaUiView(submitted);
  assert.match(view.body, /Protocolo: \*case\*/);
  assert.deepEqual(view.choices.find(c => c.label === "Ver Respondidas")?.action,
    { kind: "tool", tool: "get_product_questions", args: { productId, filter: "answered" } });
});

test("leaving question intake for the cart cancels the pending write", async () => {
  let writes = 0;
  const adapter = new CheckoutWhatsAppConversationAdapter({} as never, {} as never,
    { execute: async (input: any) => { if (input.ui_action.tool === "create_question") writes++;
      return { message: "Carrinho", blocks: [], suggested_next: [] }; } } as never,
    { executeForMerchant: async () => ({ name: "Athom" }) } as never);
  const response = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Ver Carrinho",
    state: { ...base, pendingProductQuestion: { productId }, expectsFreeInput: true }, action: { kind: "tool", tool: "get_cart", args: {} } });
  assert.equal(writes, 0); assert.equal(response.state.pendingProductQuestion, undefined);
});

test("typing Voltar or refusing during question intake cannot create a question", async () => {
  const adapter = new CheckoutWhatsAppConversationAdapter({} as never, {} as never,
    { execute: async () => assert.fail("cancellation must not write or invoke the agent") } as never,
    { executeForMerchant: async () => ({ name: "Athom" }) } as never);
  for (const message of ["Voltar", "Cancelar", "Não quero"]) {
    const response = await adapter.respondStore({ merchantId: "merchant", buyer, message,
      state: { ...base, pendingProductQuestion: { productId }, expectsFreeInput: true } });
    assert.equal(response.state.pendingProductQuestion, undefined);
    assert.equal(response.state.expectsFreeInput, false);
    assert.equal(response.state.cartHasItems, true);
  }
});
