import assert from "node:assert/strict";
import test from "node:test";
import { CompositeColumnMapper } from "./composite-column-mapper.adapter.js";
import { DeterministicColumnMapper } from "./deterministic-column-mapper.adapter.js";
import { LlmColumnMapper } from "./llm-column-mapper.adapter.js";
import type { ChatCompletionPort, ChatMessage } from "../../../support/domain/ports/chat-completion.port.js";

class StubChat implements ChatCompletionPort {
  constructor(private readonly reply: string | null) {}
  async complete(_messages: ChatMessage[]): Promise<string | null> {
    return this.reply;
  }
}

test("uses LLM result when LLM produces a valid mapping", async () => {
  const llmReply = JSON.stringify({ "Nome": "name", "SKU": "sku", "Price": "price" });
  const llm = new LlmColumnMapper(new StubChat(llmReply));
  const det = new DeterministicColumnMapper();
  const composite = new CompositeColumnMapper(llm, det);

  const result = await composite.mapColumns(["Nome", "SKU", "Price"], []);
  assert.deepEqual(result.mapping, { Nome: "name", SKU: "sku", Price: "price" });
});

test("falls back to deterministic when LLM returns null", async () => {
  const llm = new LlmColumnMapper(new StubChat(null));
  const det = new DeterministicColumnMapper();
  const composite = new CompositeColumnMapper(llm, det);

  const result = await composite.mapColumns(
    ["Nome do Produto", "Código", "Preço (R$)", "Estoque"],
    [],
  );
  assert.deepEqual(result.mapping, {
    "Nome do Produto": "name",
    "Código": "sku",
    "Preço (R$)": "price",
    "Estoque": "stock",
  });
});

test("falls back to deterministic when LLM garbage / validator rejects", async () => {
  const llm = new LlmColumnMapper(new StubChat("not json at all"));
  const det = new DeterministicColumnMapper();
  const composite = new CompositeColumnMapper(llm, det);

  const result = await composite.mapColumns(["Name", "SKU", "Price"], []);
  assert.deepEqual(result.mapping, {
    Name: "name",
    SKU: "sku",
    Price: "price",
  });
});
