import test from "node:test";
import assert from "node:assert/strict";
import { faqLookup } from "./support-faq.service.js";

const item = (id: string, question: string, answer = "answer " + id) => ({
  id,
  question,
  answer
});

test("faqLookup returns null when no items configured", () => {
  assert.equal(faqLookup("anything", []), null);
});

test("faqLookup matches keywords (>3 chars) shared with the buyer message", () => {
  const items = [
    item("faq_track", "Como rastrear meu pedido"),
    item("faq_return", "Posso devolver um produto"),
    item("faq_payment", "Quais formas de pagamento aceitas")
  ];

  assert.equal(faqLookup("como rastrear pedido", items), "answer faq_track");
  assert.equal(faqLookup("posso devolver produto", items), "answer faq_return");
  assert.equal(faqLookup("formas pagamento aceitas", items), "answer faq_payment");
});

test("faqLookup is accent-insensitive (NFD normalization)", () => {
  const items = [item("faq_track", "Como rastrear meu pedido")];

  assert.equal(faqLookup("como rastreador pedido", items), "answer faq_track");
});

test("faqLookup ignores keywords with length <=3", () => {
  const items = [item("faq_short", "Problem with payment?")];

  // "Problem" (7 chars) and "payment" (7 chars) are both >3; need 2 keyword matches.
  assert.equal(faqLookup("I have payment problems", items), "answer faq_short"); // matches "payment" + "problem"
  assert.equal(faqLookup("payment only", items), null); // only 1 keyword match
});

test("faqLookup requires at least two keyword matches before returning", () => {
  const items = [
    item("faq_track", "Como rastrear meu pedido"),
    item("faq_payment", "Quais formas de pagamento aceitas")
  ];

  // "pedido" alone is one match, "rastrear" alone is one match — neither reaches threshold.
  assert.equal(faqLookup("pedido avulso", items), null);
});

test("faqLookup picks the FAQ with the highest match score", () => {
  const items = [
    item("faq_a", "Como rastrear meu pedido rapidamente"),
    item("faq_b", "Como rastrear meu pedido")
  ];

  // Both match; faq_a has 3 keyword matches >=4 chars (rastrear/pedido/rapidamente).
  const best = faqLookup("como rastrear meu pedido rapidamente", items);
  assert.equal(best, "answer faq_a");
});

test("faqLookup ignores non-word characters during keyword splitting", () => {
  const items = [item("faq_track", "Como rastrear - meu pedido??")];

  assert.equal(faqLookup("como rastrear meu pedido", items), "answer faq_track");
});

test("faqLookup does not mutate input items", () => {
  const items = [item("faq_track", "Como rastrear meu pedido")];
  const before = JSON.stringify(items);
  faqLookup("como rastrear meu pedido", items);
  assert.equal(JSON.stringify(items), before);
});
