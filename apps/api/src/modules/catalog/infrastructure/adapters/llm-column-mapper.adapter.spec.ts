import assert from "node:assert/strict";
import test from "node:test";
import { LlmColumnMapper } from "./llm-column-mapper.adapter.js";
import type { ChatCompletionPort, ChatMessage } from "../../../support/domain/ports/chat-completion.port.js";

class StubChat implements ChatCompletionPort {
  public lastMessages: ChatMessage[] = [];
  constructor(private readonly reply: string | null) {}
  async complete(messages: ChatMessage[]): Promise<string | null> {
    this.lastMessages = messages;
    return this.reply;
  }
}

test("valid JSON mapping is returned", async () => {
  const stub = new StubChat(
    JSON.stringify({
      "Nome do Produto": "name",
      "Código": "sku",
      "Preço (R$)": "price",
    }),
  );
  const llm = new LlmColumnMapper(stub);
  const result = await llm.tryMap(
    ["Nome do Produto", "Código", "Preço (R$)"],
    [],
  );
  assert.ok(result !== null);
  assert.deepEqual(result!.mapping, {
    "Nome do Produto": "name",
    "Código": "sku",
    "Preço (R$)": "price",
  });
  // system prompt must include strict rules
  const sys = stub.lastMessages[0]?.content ?? "";
  assert.match(sys, /map spreadsheet column headers/i);
  assert.match(sys, /Return ONLY a JSON object/i);
});

test("code-fenced JSON is parsed correctly", async () => {
  const reply = "```json\n{\"Name\":\"name\",\"SKU\":\"sku\"}\n```";
  const stub = new StubChat(reply);
  const llm = new LlmColumnMapper(stub);
  const result = await llm.tryMap(["Name", "SKU"], []);
  assert.ok(result !== null);
  assert.deepEqual(result!.mapping, { Name: "name", SKU: "sku" });
});

test("garbage reply returns null (validation rejects)", async () => {
  const stub = new StubChat("totally not json { foo bar baz");
  const llm = new LlmColumnMapper(stub);
  const result = await llm.tryMap(["Name", "SKU"], []);
  assert.equal(result, null);
});

test("row-value mapping (not headers) is rejected by validator", async () => {
  // LLM hallucinated row values as canonical fields — validator must reject
  const stub = new StubChat(JSON.stringify({ "0": "name", "1": "sku" }));
  const llm = new LlmColumnMapper(stub);
  const result = await llm.tryMap(["Name", "SKU"], []);
  assert.equal(result, null);
});

test("complete() returning null yields tryMap null", async () => {
  const stub = new StubChat(null);
  const llm = new LlmColumnMapper(stub);
  const result = await llm.tryMap(["Name", "SKU"], []);
  assert.equal(result, null);
});

test("mapping without essential fields (name/sku/price) returns null", async () => {
  const stub = new StubChat(
    JSON.stringify({ Description: "description", Category: "category" }),
  );
  const llm = new LlmColumnMapper(stub);
  const result = await llm.tryMap(["Description", "Category"], []);
  assert.equal(result, null);
});

test("sample rows (up to 3) are passed as user message JSON", async () => {
  const stub = new StubChat(JSON.stringify({ Name: "name", SKU: "sku" }));
  const llm = new LlmColumnMapper(stub);
  await llm.tryMap(
    ["Name", "SKU"],
    [
      { Name: "Cadeira", SKU: "C-1" },
      { Name: "Mesa", SKU: "M-1" },
      { Name: "Luminaria", SKU: "L-1" },
      { Name: "Estante", SKU: "E-1" },
    ],
  );
  const user = stub.lastMessages[1]?.content ?? "";
  assert.match(user, /Name/);
  assert.match(user, /SKU/);
  // at most 3 sample rows
  const occurrences = (user.match(/Cadeira|Mesa|Luminaria|Estante/g) ?? []).length;
  assert.ok(occurrences <= 3, `expected <=3 rows, got ${occurrences}`);
});

test("_unitHints is split off when present", async () => {
  const stub = new StubChat(
    JSON.stringify({
      Name: "name",
      SKU: "sku",
      Price: "price",
      _unitHints: { priceInReais: true, weightInKg: false },
    }),
  );
  const llm = new LlmColumnMapper(stub);
  const result = await llm.tryMap(["Name", "SKU", "Price"], []);
  assert.ok(result !== null);
  assert.deepEqual(result!.unitHints, { priceInReais: true, weightInKg: false });
  assert.equal(Object.prototype.hasOwnProperty.call(result!.mapping, "_unitHints"), false);
});
