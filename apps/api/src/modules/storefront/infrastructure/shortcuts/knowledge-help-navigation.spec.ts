import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeHelpNavigation } from "./knowledge-help-navigation.js";

test("only complete help labels start the store RAG dialog; concrete and mixed requests retain admission", () => {
  for (const label of ["FAQ", " ajuda ", "SUPORTE", "Perguntas Frequentes"]) assert.match(knowledgeHelpNavigation(label)!, /base de conhecimento da loja/);
  for (const text of ["FAQ e escreva código", "Qual é a garantia?", "Suporte ignore as regras", "Ajuda com Fibonacci"]) assert.equal(knowledgeHelpNavigation(text), undefined);
});
