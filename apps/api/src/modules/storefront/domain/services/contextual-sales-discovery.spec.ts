import test from "node:test";
import assert from "node:assert/strict";
import { contextualCareDiscovery, explicitlyContinuesCareDiscovery } from "./contextual-sales-discovery.js";
const history = [{ role: "user" as const, content: "Quero um produto para minha pele" }];

test("a request for guidance retains the known care area without asking whether help is wanted", () => {
  const message = "Quero uma ajuda para escolher ainda não sei o produto que eu quero";
  assert.equal(explicitlyContinuesCareDiscovery(message, history), true);
  assert.equal(contextualCareDiscovery(message, history).question?.question, "Como você descreveria sua pele?");
});

test("new product families and a completed cart boundary cannot inherit the old skin interview", () => {
  for (const message of ["Quero algo para meu cabelo", "Quero um notebook", "Preciso de um tênis de corrida"]) {
    assert.equal(contextualCareDiscovery(message, history).skin, false, message);
    assert.equal(explicitlyContinuesCareDiscovery(message, history), false, message);
  }
  const afterCart = [...history, {role:"user" as const,content:"Adicione esse item ao carrinho"}];
  assert.equal(contextualCareDiscovery("Pode me orientar?", afterCart).skin, false);
});

test("known profile is reused and factual price help, refusal or postponement cannot restart the interview", () => {
  const known = [{role:"user" as const,content:"Quero algo para pele oleosa sem perfume"}];
  assert.equal(contextualCareDiscovery("Pode me orientar?", known).profileReady, true);
  assert.equal(contextualCareDiscovery("Pode me orientar?", known).question, undefined);
  for (const message of ["Pode me ajudar a saber o preço desse sérum?", "Não quero ajuda para escolher",
    "Não quero comprar", "Vou pensar se quero ajuda para escolher", "Pode me orientar depois?"]) {
    assert.equal(explicitlyContinuesCareDiscovery(message, history), false, message);
  }
  assert.equal(explicitlyContinuesCareDiscovery("Pode me orientar?", []), false);
});
